require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 3000;

// Imagens em base64 são grandes — aumenta o limite do corpo JSON.
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    const msg = await anthropic.messages.create({
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
    const msg = await anthropic.messages.create({
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

// --- Evoluções (armazenamento em memória; trocar por banco depois) ---
// Chave: `${medicoId}|${data}` -> [{ pacienteId, nome, texto, salvoEm }]
const evolucoes = new Map();

/**
 * Salva (ou substitui) a evolução de um paciente para um médico/data.
 * Body: { medicoId, data (YYYY-MM-DD), pacienteId, nome, texto }
 */
app.post("/api/evolucao/salvar", (req, res) => {
  const { medicoId, data, pacienteId, nome, texto } = req.body || {};
  if (!medicoId || !data || !pacienteId) {
    return res
      .status(400)
      .json({ erro: "Campos obrigatórios: medicoId, data, pacienteId." });
  }

  const chave = `${medicoId}|${data}`;
  const lista = evolucoes.get(chave) || [];
  const semAntigo = lista.filter((e) => e.pacienteId !== pacienteId);
  semAntigo.push({
    pacienteId,
    nome: nome || "",
    texto: texto || "",
    salvoEm: new Date().toISOString(),
  });
  evolucoes.set(chave, semAntigo);

  res.json({ status: "ok", total: semAntigo.length });
});

/** Retorna as evoluções de um médico em uma data. */
app.get("/api/evolucao/:medicoId/:data", (req, res) => {
  const { medicoId, data } = req.params;
  const lista = evolucoes.get(`${medicoId}|${data}`) || [];
  res.json({ medicoId, data, evolucoes: lista });
});

app.listen(PORT, () => {
  console.log(`Passando o Caso — backend ouvindo na porta ${PORT}`);
});
