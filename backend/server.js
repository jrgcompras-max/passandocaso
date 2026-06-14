require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS restrito aos domínios de produção + desenvolvimento local.
const ORIGENS_PERMITIDAS = [
  "https://passandocaso.com.br",
  "https://www.passandocaso.com.br",
  "https://passandocaso.vercel.app",
  "http://localhost:8080",
  "http://localhost:3000",
];
app.use(cors({ origin: ORIGENS_PERMITIDAS }));

// Imagens em base64 são grandes — aumenta o limite do corpo JSON.
app.use(express.json({ limit: "15mb" }));

// Inicialização preguiçosa: o construtor do SDK lança erro se não houver apiKey.
// Criar sob demanda evita derrubar o servidor no boot quando a chave não está
// configurada (o /health continua respondendo e as rotas retornam erro tratado).
let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

/**
 * Isola o objeto JSON dentro da resposta do modelo, que às vezes vem embrulhado
 * em cercas de código markdown (```json ... ```) ou com texto ao redor.
 */
function extrairBlocoJson(texto) {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error(`Resposta da IA não contém JSON:\n${texto}`);
  }
  return texto.slice(inicio, fim + 1);
}

// --- Health ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Proxy de extração multimodal. Recebe a imagem em base64 (JPEG) e a instrução,
 * chama o Claude com visão e devolve o JSON já parseado. A chave da Anthropic
 * fica só aqui no servidor — nunca no app mobile.
 *
 * Body: { imagemBase64: string, instrucao: string }
 */
app.post("/api/extract", async (req, res) => {
  const { imagemBase64, instrucao } = req.body || {};
  if (!imagemBase64 || !instrucao) {
    return res
      .status(400)
      .json({ erro: "Campos obrigatórios: imagemBase64, instrucao." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ erro: "ANTHROPIC_API_KEY não configurada no servidor." });
  }

  try {
    const msg = await getAnthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imagemBase64,
              },
            },
            { type: "text", text: instrucao },
          ],
        },
      ],
    });

    const bloco = msg.content.find((c) => c.type === "text");
    const texto = bloco ? bloco.text : "";
    const dados = JSON.parse(extrairBlocoJson(texto));
    res.json(dados);
  } catch (e) {
    console.error("Erro em /api/extract:", e);
    res.status(502).json({ erro: e.message || "Falha ao extrair dados." });
  }
});

/**
 * Passo de formatação (híbrido): recebe o texto da passagem de caso já montado
 * pelo app e pede ao Claude apenas para PADRONIZAR a redação/formatação — sem
 * adicionar, inferir, interpretar ou remover conteúdo clínico. Em qualquer falha
 * devolve o texto original (o app nunca fica sem resultado).
 *
 * Body: { texto: string }  ->  { texto: string }
 */
const INSTRUCAO_FORMATACAO =
  "Você recebe um texto de PASSAGEM DE CASO médico já redigido por um médico. " +
  "Sua única tarefa é melhorar a FORMATAÇÃO e a clareza da redação: padronizar pontuação, " +
  "capitalização, espaçamento e organização visual das seções. " +
  "REGRAS ABSOLUTAS: não adicione informação que não esteja no texto; não infira, interprete, " +
  "diagnostique nem sugira conduta; não remova nenhum dado clínico; não invente valores. " +
  "Mantenha exatamente o mesmo conteúdo, apenas mais bem formatado. " +
  "Responda SOMENTE com o texto final, sem comentários nem marcações de código.";

app.post("/api/formatar", async (req, res) => {
  const { texto } = req.body || {};
  if (typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ erro: "Campo obrigatório: texto." });
  }
  // Sem chave configurada: devolve o texto bruto em vez de falhar.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ texto });
  }

  try {
    const msg = await getAnthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${INSTRUCAO_FORMATACAO}\n\n---\n${texto}` }],
        },
      ],
    });
    const bloco = msg.content.find((c) => c.type === "text");
    const saida = bloco && bloco.text.trim() ? bloco.text.trim() : texto;
    res.json({ texto: saida });
  } catch (e) {
    console.error("Erro em /api/formatar:", e);
    // Falha de formatação não deve bloquear o fluxo: devolve o texto original.
    res.json({ texto });
  }
});

/**
 * Gera um RESUMO EXECUTIVO curto do paciente a partir dos dados já preenchidos
 * (diagnóstico, problemas, exames, sinais vitais, evolução). Diferente de
 * /api/formatar, aqui o modelo PODE sintetizar/condensar — mas sem inventar.
 *
 * Body: { dados: string }  ->  { resumo: string }
 */
const INSTRUCAO_RESUMO =
  "Você recebe os dados clínicos de um paciente internado, já preenchidos por um médico. " +
  "Produza um RESUMO EXECUTIVO de 3 a 4 frases curtas, telegráfico e objetivo, no estilo de passagem de plantão. " +
  "Inclua: dia de internação, diagnóstico, evolução recente (febre, exames em queda/elevação, suporte de O2) e a perspectiva (ex.: alta provável). " +
  "REGRAS: use apenas o que está nos dados; não invente valores, condutas nem diagnósticos; seja conciso. " +
  "Responda SOMENTE com o texto do resumo, sem títulos, comentários nem marcações de código.";

app.post("/api/resumo", async (req, res) => {
  const { dados } = req.body || {};
  if (typeof dados !== "string" || !dados.trim()) {
    return res.status(400).json({ erro: "Campo obrigatório: dados." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ erro: "ANTHROPIC_API_KEY não configurada no servidor." });
  }

  try {
    const msg = await getAnthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${INSTRUCAO_RESUMO}\n\n---\n${dados}` }],
        },
      ],
    });
    const bloco = msg.content.find((c) => c.type === "text");
    const resumo = bloco ? bloco.text.trim() : "";
    res.json({ resumo });
  } catch (e) {
    console.error("Erro em /api/resumo:", e);
    res.status(502).json({ erro: e.message || "Falha ao gerar resumo." });
  }
});

// --- Pacientes (sincronização app ⇄ banco) ---

/** Lista todos os pacientes de um médico (mais recentes primeiro). */
app.get("/api/pacientes/:medicoId", async (req, res) => {
  const { medicoId } = req.params;
  try {
    const r = await db.query(
      "SELECT dados FROM pacientes WHERE medico_id = $1 ORDER BY updated_at DESC",
      [medicoId],
    );
    res.json({ medicoId, pacientes: r.rows.map((row) => row.dados) });
  } catch (e) {
    console.error("Erro em GET /api/pacientes:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar pacientes." });
  }
});

/** Busca um paciente específico do médico. */
app.get("/api/pacientes/:medicoId/:pacienteId", async (req, res) => {
  const { medicoId, pacienteId } = req.params;
  try {
    const r = await db.query(
      "SELECT dados FROM pacientes WHERE medico_id = $1 AND id = $2",
      [medicoId, pacienteId],
    );
    if (!r.rows.length) {
      return res.status(404).json({ erro: "Paciente não encontrado." });
    }
    res.json(r.rows[0].dados);
  } catch (e) {
    console.error("Erro em GET /api/pacientes/:id:", e);
    res.status(500).json({ erro: e.message || "Falha ao buscar paciente." });
  }
});

/**
 * Recebe um array de pacientes do app e faz upsert no banco (offline-first: o
 * app continua usando o AsyncStorage como cache e empurra o estado para cá).
 * Body: { medicoId, pacientes: Paciente[] }
 */
app.post("/api/pacientes/sync", async (req, res) => {
  const { medicoId, pacientes } = req.body || {};
  if (!medicoId || !Array.isArray(pacientes)) {
    return res
      .status(400)
      .json({ erro: "Campos obrigatórios: medicoId, pacientes (array)." });
  }
  try {
    for (const p of pacientes) {
      if (!p || !p.id) continue;
      const dataCriacao =
        (Array.isArray(p.diasAcompanhamento) && p.diasAcompanhamento[0]) ||
        new Date().toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO pacientes (id, medico_id, data_criacao, dados, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE
           SET medico_id = EXCLUDED.medico_id,
               dados = EXCLUDED.dados,
               updated_at = NOW()`,
        [p.id, medicoId, dataCriacao, p],
      );
    }
    res.json({ status: "ok", total: pacientes.length });
  } catch (e) {
    console.error("Erro em POST /api/pacientes/sync:", e);
    res.status(500).json({ erro: e.message || "Falha ao sincronizar." });
  }
});

/** Remove um paciente do médico. */
app.delete("/api/pacientes/:medicoId/:pacienteId", async (req, res) => {
  const { medicoId, pacienteId } = req.params;
  try {
    await db.query("DELETE FROM pacientes WHERE medico_id = $1 AND id = $2", [
      medicoId,
      pacienteId,
    ]);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Erro em DELETE /api/pacientes:", e);
    res.status(500).json({ erro: e.message || "Falha ao remover paciente." });
  }
});

// --- Evoluções (PostgreSQL) ---

/**
 * Salva (ou substitui) a evolução de um paciente para um médico/data.
 * Body: { medicoId, data (YYYY-MM-DD), pacienteId, nome, texto }
 */
app.post("/api/evolucao/salvar", async (req, res) => {
  const { medicoId, data, pacienteId, nome, texto } = req.body || {};
  if (!medicoId || !data || !pacienteId) {
    return res
      .status(400)
      .json({ erro: "Campos obrigatórios: medicoId, data, pacienteId." });
  }
  try {
    // "Substitui" a evolução do dia: remove a anterior do mesmo paciente/data.
    await db.query(
      "DELETE FROM evolucoes WHERE medico_id = $1 AND data = $2 AND paciente_id = $3",
      [medicoId, data, pacienteId],
    );
    await db.query(
      `INSERT INTO evolucoes (paciente_id, medico_id, data, texto)
       VALUES ($1, $2, $3, $4)`,
      [pacienteId, medicoId, data, texto || ""],
    );
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Erro em POST /api/evolucao/salvar:", e);
    res.status(500).json({ erro: e.message || "Falha ao salvar evolução." });
  }
});

/** Retorna as evoluções de um médico em uma data (com o nome do paciente). */
app.get("/api/evolucao/:medicoId/:data", async (req, res) => {
  const { medicoId, data } = req.params;
  try {
    const r = await db.query(
      `SELECT e.paciente_id, e.texto, e.created_at, p.dados->>'nomeCompleto' AS nome
         FROM evolucoes e
         LEFT JOIN pacientes p ON p.id = e.paciente_id
        WHERE e.medico_id = $1 AND e.data = $2
        ORDER BY e.created_at DESC`,
      [medicoId, data],
    );
    const evolucoes = r.rows.map((row) => ({
      pacienteId: row.paciente_id,
      nome: row.nome || "",
      texto: row.texto,
      salvoEm: row.created_at,
    }));
    res.json({ medicoId, data, evolucoes });
  } catch (e) {
    console.error("Erro em GET /api/evolucao:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar evoluções." });
  }
});

// Sobe o servidor depois de garantir o schema do banco. Se o initDB falhar
// (ex.: DATABASE_URL ausente), ainda sobe — as rotas de IA seguem funcionando.
db.initDB()
  .catch((e) => console.error("Falha ao inicializar o banco:", e))
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Passando o Caso — backend ouvindo em 0.0.0.0:${PORT}`);
    });
  });
