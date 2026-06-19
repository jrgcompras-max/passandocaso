require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS restrito aos domínios de produção + desenvolvimento local.
const ORIGENS_PERMITIDAS = [
  "https://passandocaso.com.br",
  "https://www.passandocaso.com.br",
  "https://app.passandocaso.com.br",
  "https://admin.passandocaso.com.br",
  "https://passandocaso.vercel.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
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
app.post("/api/extract", auth.autenticar, async (req, res) => {
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

app.post("/api/formatar", auth.autenticar, async (req, res) => {
  const { texto, instrucao } = req.body || {};
  if (typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ erro: "Campo obrigatório: texto." });
  }
  // Sem chave configurada: devolve o texto bruto em vez de falhar.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ texto });
  }

  // Instrução customizada (ex.: classificação) sobrescreve a de formatação.
  const instrucaoUsada =
    typeof instrucao === "string" && instrucao.trim()
      ? instrucao
      : INSTRUCAO_FORMATACAO;

  try {
    const msg = await getAnthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${instrucaoUsada}\n\n---\n${texto}` }],
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

app.post("/api/resumo", auth.autenticar, async (req, res) => {
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

// --- Autenticação (cadastro / login / recuperação) ---

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Cria uma conta. O PRIMEIRO usuário do sistema herda os dados de teste que
 * estavam sob "medico-001" (pacientes, hospitais e evoluções).
 * Body: { nome, email, senha } -> { token, usuario }
 */
app.post("/api/auth/cadastro", async (req, res) => {
  const nome = String((req.body || {}).nome || "").trim();
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const senha = String((req.body || {}).senha || "");
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Campos obrigatórios: nome, email, senha." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ erro: "E-mail inválido." });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter ao menos 6 caracteres." });
  }
  try {
    const existe = await db.query("SELECT 1 FROM usuarios WHERE email = $1", [email]);
    if (existe.rows.length) {
      return res.status(409).json({ erro: "Já existe uma conta com este e-mail." });
    }
    const id = crypto.randomUUID();
    const senhaHash = await auth.hashSenha(senha);
    const ins = await db.query(
      `INSERT INTO usuarios (id, nome, email, senha_hash, is_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, nome, email, senhaHash, auth.ehAdmin(email)],
    );
    const usuario = ins.rows[0];

    // Primeiro usuário do sistema herda os dados de teste (medico-001).
    const cnt = await db.query("SELECT COUNT(*)::int AS n FROM usuarios");
    if (cnt.rows[0].n === 1) {
      await db.query("UPDATE pacientes SET medico_id = $1 WHERE medico_id = 'medico-001'", [id]);
      await db.query("UPDATE hospitais SET medico_id = $1 WHERE medico_id = 'medico-001'", [id]);
      await db.query("UPDATE evolucoes SET medico_id = $1 WHERE medico_id = 'medico-001'", [id]);
      console.log(`[auth] Primeiro usuário (${email}) herdou os dados de medico-001.`);
    }

    res.status(201).json({ token: auth.gerarToken(usuario), usuario: auth.usuarioPublico(usuario) });
  } catch (e) {
    console.error("Erro em /api/auth/cadastro:", e);
    res.status(500).json({ erro: e.message || "Falha ao cadastrar." });
  }
});

/** Login. Body: { email, senha } -> { token, usuario } */
app.post("/api/auth/login", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const senha = String((req.body || {}).senha || "");
  if (!email || !senha) {
    return res.status(400).json({ erro: "Campos obrigatórios: email, senha." });
  }
  try {
    const r = await db.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    const usuario = r.rows[0];
    if (!usuario || !(await auth.conferirSenha(senha, usuario.senha_hash))) {
      return res.status(401).json({ erro: "E-mail ou senha incorretos." });
    }
    res.json({ token: auth.gerarToken(usuario), usuario: auth.usuarioPublico(usuario) });
  } catch (e) {
    console.error("Erro em /api/auth/login:", e);
    res.status(500).json({ erro: e.message || "Falha ao entrar." });
  }
});

/** Logout. JWT é stateless: o cliente apenas descarta o token. */
app.post("/api/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

/** Dados do usuário autenticado. */
app.get("/api/auth/me", auth.autenticar, (req, res) => {
  res.json({ usuario: auth.usuarioPublico(req.usuario) });
});

/** Estado do trial/assinatura do usuário autenticado. */
app.get("/api/auth/trial", auth.autenticar, (req, res) => {
  const u = auth.usuarioPublico(req.usuario);
  res.json({
    plano: u.plano,
    trialFim: u.trialFim,
    diasRestantes: u.diasRestantes,
    expirado: u.expirado,
  });
});

/**
 * Solicita recuperação de senha. Sempre responde 200 (não revela se o e-mail
 * existe). Sem SMTP configurado, o link é registrado no console do servidor.
 * Body: { email }
 */
app.post("/api/auth/recuperar", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ erro: "Campo obrigatório: email." });
  try {
    const r = await db.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    const usuario = r.rows[0];
    if (usuario) {
      const token = auth.gerarResetToken();
      await db.query(
        "UPDATE usuarios SET reset_token = $1, reset_token_exp = $2 WHERE id = $3",
        [token, auth.resetExpiraEm(), usuario.id],
      );
      const base = process.env.APP_WEB_URL || "https://app.passandocaso.com.br";
      await auth.enviarEmailRecuperacao(email, `${base}/redefinir?token=${token}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro em /api/auth/recuperar:", e);
    res.status(500).json({ erro: e.message || "Falha ao solicitar recuperação." });
  }
});

/** Redefine a senha a partir do token de recuperação. Body: { token, senha } */
app.post("/api/auth/redefinir", async (req, res) => {
  const { token } = req.body || {};
  const senha = String((req.body || {}).senha || "");
  if (!token || !senha) {
    return res.status(400).json({ erro: "Campos obrigatórios: token, senha." });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter ao menos 6 caracteres." });
  }
  try {
    const r = await db.query("SELECT * FROM usuarios WHERE reset_token = $1", [token]);
    const usuario = r.rows[0];
    if (!usuario || !usuario.reset_token_exp || new Date(usuario.reset_token_exp) < new Date()) {
      return res.status(400).json({ erro: "Token inválido ou expirado." });
    }
    await db.query(
      "UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_token_exp = NULL WHERE id = $2",
      [await auth.hashSenha(senha), usuario.id],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro em /api/auth/redefinir:", e);
    res.status(500).json({ erro: e.message || "Falha ao redefinir senha." });
  }
});

// --- Pacientes (sincronização app ⇄ banco) — escopo: usuário autenticado ---

/** Lista todos os pacientes do usuário (mais recentes primeiro). */
app.get("/api/pacientes", auth.autenticar, async (req, res) => {
  try {
    const r = await db.query(
      "SELECT dados FROM pacientes WHERE medico_id = $1 ORDER BY updated_at DESC",
      [req.usuario.id],
    );
    res.json({ pacientes: r.rows.map((row) => row.dados) });
  } catch (e) {
    console.error("Erro em GET /api/pacientes:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar pacientes." });
  }
});

/** Lista os pacientes do usuário em um hospital específico. */
app.get("/api/pacientes/hospital/:hospitalId", auth.autenticar, async (req, res) => {
  const { hospitalId } = req.params;
  try {
    const r = await db.query(
      `SELECT dados FROM pacientes
        WHERE medico_id = $1 AND COALESCE(hospital_id, 'geral') = $2
        ORDER BY updated_at DESC`,
      [req.usuario.id, hospitalId],
    );
    res.json({ hospitalId, pacientes: r.rows.map((row) => row.dados) });
  } catch (e) {
    console.error("Erro em GET /api/pacientes/hospital/:hospitalId:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar pacientes." });
  }
});

/**
 * Faz upsert de um array de pacientes do usuário autenticado (offline-first).
 * Body: { pacientes: Paciente[] }
 */
app.post("/api/pacientes/sync", auth.autenticar, async (req, res) => {
  const { pacientes } = req.body || {};
  if (!Array.isArray(pacientes)) {
    return res.status(400).json({ erro: "Campo obrigatório: pacientes (array)." });
  }
  try {
    for (const p of pacientes) {
      if (!p || !p.id) continue;
      const dataCriacao =
        (Array.isArray(p.diasAcompanhamento) && p.diasAcompanhamento[0]) ||
        new Date().toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE
           SET medico_id = EXCLUDED.medico_id,
               hospital_id = EXCLUDED.hospital_id,
               dados = EXCLUDED.dados,
               updated_at = NOW()`,
        [p.id, req.usuario.id, p.hospitalId || "geral", dataCriacao, p],
      );
    }
    res.json({ status: "ok", total: pacientes.length });
  } catch (e) {
    console.error("Erro em POST /api/pacientes/sync:", e);
    res.status(500).json({ erro: e.message || "Falha ao sincronizar." });
  }
});

/** Remove um paciente de um hospital do usuário. */
app.delete("/api/pacientes/:hospitalId/:pacienteId", auth.autenticar, async (req, res) => {
  const { hospitalId, pacienteId } = req.params;
  try {
    await db.query(
      `DELETE FROM pacientes
        WHERE medico_id = $1 AND id = $2
          AND COALESCE(hospital_id, 'geral') = $3`,
      [req.usuario.id, pacienteId, hospitalId],
    );
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Erro em DELETE /api/pacientes:", e);
    res.status(500).json({ erro: e.message || "Falha ao remover paciente." });
  }
});

// --- Hospitais (multi-tenancy por usuário) ---

/** Lista os hospitais do usuário. */
app.get("/api/hospitais", auth.autenticar, async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, nome, cidade FROM hospitais WHERE medico_id = $1 ORDER BY nome",
      [req.usuario.id],
    );
    res.json({ hospitais: r.rows });
  } catch (e) {
    console.error("Erro em GET /api/hospitais:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar hospitais." });
  }
});

/** Upsert da lista de hospitais do usuário. Body: { hospitais: [] } */
app.post("/api/hospitais/sync", auth.autenticar, async (req, res) => {
  const { hospitais } = req.body || {};
  if (!Array.isArray(hospitais)) {
    return res.status(400).json({ erro: "Campo obrigatório: hospitais (array)." });
  }
  try {
    for (const h of hospitais) {
      if (!h || !h.id || !h.nome) continue;
      await db.query(
        `INSERT INTO hospitais (id, medico_id, nome, cidade, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE
           SET nome = EXCLUDED.nome, cidade = EXCLUDED.cidade, updated_at = NOW()`,
        [h.id, req.usuario.id, h.nome, h.cidade || ""],
      );
    }
    res.json({ status: "ok", total: hospitais.length });
  } catch (e) {
    console.error("Erro em POST /api/hospitais/sync:", e);
    res.status(500).json({ erro: e.message || "Falha ao sincronizar hospitais." });
  }
});

/** Remove um hospital do usuário. */
app.delete("/api/hospitais/:hospitalId", auth.autenticar, async (req, res) => {
  const { hospitalId } = req.params;
  try {
    await db.query("DELETE FROM hospitais WHERE medico_id = $1 AND id = $2", [
      req.usuario.id,
      hospitalId,
    ]);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Erro em DELETE /api/hospitais:", e);
    res.status(500).json({ erro: e.message || "Falha ao remover hospital." });
  }
});

// --- Evoluções (PostgreSQL) ---

/**
 * Salva (ou substitui) a evolução de um paciente do usuário para uma data.
 * Body: { data (YYYY-MM-DD), pacienteId, nome, texto }
 */
app.post("/api/evolucao/salvar", auth.autenticar, async (req, res) => {
  const { data, pacienteId, texto } = req.body || {};
  const medicoId = req.usuario.id;
  if (!data || !pacienteId) {
    return res.status(400).json({ erro: "Campos obrigatórios: data, pacienteId." });
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

/** Retorna as evoluções do usuário em uma data (com o nome do paciente). */
app.get("/api/evolucao/:data", auth.autenticar, async (req, res) => {
  const { data } = req.params;
  try {
    const r = await db.query(
      `SELECT e.paciente_id, e.texto, e.created_at, p.dados->>'nomeCompleto' AS nome
         FROM evolucoes e
         LEFT JOIN pacientes p ON p.id = e.paciente_id
        WHERE e.medico_id = $1 AND e.data = $2
        ORDER BY e.created_at DESC`,
      [req.usuario.id, data],
    );
    const evolucoes = r.rows.map((row) => ({
      pacienteId: row.paciente_id,
      nome: row.nome || "",
      texto: row.texto,
      salvoEm: row.created_at,
    }));
    res.json({ data, evolucoes });
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
