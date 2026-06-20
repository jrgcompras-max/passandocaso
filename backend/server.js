require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const auth = require("./auth");
const redeRouter = require("./rede");

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

// Imagens em base64 são grandes — aumenta o limite do corpo (ANTES das rotas).
// 15mb (>= 10mb) dá folga para o JPEG base64 do /api/extract.
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

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
    const status = e?.status || e?.statusCode;
    const msg = String(e?.message || "");
    // Imagem grande demais (limite do servidor ou da Anthropic).
    if (status === 413 || /too large|maximum|payload|image.*size|tamanho/i.test(msg)) {
      return res.status(413).json({
        erro: "A imagem é muito grande. Tente novamente com uma foto menor ou mais próxima do cabeçalho.",
      });
    }
    if (status === 429) {
      return res
        .status(429)
        .json({ erro: "Muitas solicitações no momento. Tente novamente em instantes." });
    }
    res.status(502).json({ erro: msg || "Falha ao ler o prontuário." });
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
  const categoriasOk = ["medico", "residente", "estudante", "enfermeiro", "outro"];
  const catBruta = String((req.body || {}).categoria || "medico").trim().toLowerCase();
  const categoria = categoriasOk.includes(catBruta) ? catBruta : "medico";
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
      `INSERT INTO usuarios (id, nome, email, senha_hash, is_admin, categoria, nome_exibicao)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, nome, email, senhaHash, auth.ehAdmin(email), categoria, nome],
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

// --- Super Admin (admin.passandocaso.com.br) ---

/** Status efetivo do usuário (trial pode ter expirado pela data). */
function statusUsuario(u) {
  if (u.plano === "ativo") return "ativo";
  if (u.plano === "expirado") return "expirado";
  if (u.trial_fim && new Date(u.trial_fim) < new Date()) return "expirado";
  return "trial";
}

/**
 * Login de admin: valida credenciais e exige que o e-mail esteja em
 * ADMIN_EMAILS. Garante a flag is_admin no banco. Body: { email, senha }.
 */
app.post("/api/admin/login", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const senha = String((req.body || {}).senha || "");
  if (!email || !senha) {
    return res.status(400).json({ erro: "Campos obrigatórios: email, senha." });
  }
  if (!auth.ehAdmin(email)) {
    return res.status(403).json({ erro: "Acesso restrito a administradores." });
  }
  try {
    const r = await db.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    let usuario = r.rows[0];
    if (!usuario || !(await auth.conferirSenha(senha, usuario.senha_hash))) {
      return res.status(401).json({ erro: "E-mail ou senha incorretos." });
    }
    if (!usuario.is_admin) {
      const u2 = await db.query(
        "UPDATE usuarios SET is_admin = TRUE WHERE id = $1 RETURNING *",
        [usuario.id],
      );
      usuario = u2.rows[0];
    }
    res.json({ token: auth.gerarToken(usuario), usuario: auth.usuarioPublico(usuario) });
  } catch (e) {
    console.error("Erro em /api/admin/login:", e);
    res.status(500).json({ erro: e.message || "Falha ao entrar." });
  }
});

/** Métricas + crescimento de cadastros (últimas 8 semanas). */
app.get("/api/admin/dashboard", auth.autenticar, auth.exigirAdmin, async (_req, res) => {
  try {
    const m = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE plano = 'trial' AND trial_fim >= NOW())::int AS em_trial,
        COUNT(*) FILTER (WHERE plano = 'ativo')::int AS ativos,
        COUNT(*) FILTER (WHERE plano = 'expirado' OR (plano = 'trial' AND trial_fim < NOW()))::int AS expirados,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS novos_hoje,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS novos_semana,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS novos_mes
      FROM usuarios;
    `);
    const g = await db.query(`
      SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS semana,
             COUNT(*)::int AS total
        FROM usuarios
       WHERE created_at >= date_trunc('week', NOW()) - INTERVAL '7 weeks'
       GROUP BY 1 ORDER BY 1;
    `);
    res.json({ metricas: m.rows[0], crescimento: g.rows });
  } catch (e) {
    console.error("Erro em GET /api/admin/dashboard:", e);
    res.status(500).json({ erro: e.message || "Falha ao carregar o dashboard." });
  }
});

/** Lista usuários (opcional ?status=trial|ativo|expirado), com contagem de pacientes. */
app.get("/api/admin/usuarios", auth.autenticar, auth.exigirAdmin, async (req, res) => {
  const filtro = String(req.query.status || "").toLowerCase();
  try {
    const r = await db.query(`
      SELECT u.id, u.nome, u.email, u.plano, u.is_admin, u.trial_fim, u.created_at,
             (SELECT COUNT(*) FROM pacientes p WHERE p.medico_id = u.id)::int AS pacientes
        FROM usuarios u
       ORDER BY u.created_at DESC
    `);
    let usuarios = r.rows.map((u) => {
      const fim = u.trial_fim ? new Date(u.trial_fim) : null;
      const diasRestantes = fim
        ? Math.max(0, Math.ceil((fim.getTime() - Date.now()) / 86_400_000))
        : null;
      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        plano: u.plano,
        isAdmin: u.is_admin,
        trialFim: u.trial_fim,
        criadoEm: u.created_at,
        pacientes: u.pacientes,
        diasRestantes,
        status: statusUsuario(u),
      };
    });
    if (["trial", "ativo", "expirado"].includes(filtro)) {
      usuarios = usuarios.filter((u) => u.status === filtro);
    }
    res.json({ usuarios });
  } catch (e) {
    console.error("Erro em GET /api/admin/usuarios:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar usuários." });
  }
});

/**
 * Ações sobre um usuário. Body: { acao: "estender"|"ativar"|"bloquear", dias? }.
 * - estender: dias ∈ {7,15,30}, soma ao maior entre trial_fim e agora; plano=trial.
 * - ativar: plano=ativo. - bloquear: plano=expirado.
 */
app.put("/api/admin/usuarios/:id", auth.autenticar, auth.exigirAdmin, async (req, res) => {
  const { id } = req.params;
  const acao = String((req.body || {}).acao || "");
  const dias = Number((req.body || {}).dias || 0);
  try {
    let q;
    let params;
    if (acao === "estender") {
      if (![7, 15, 30].includes(dias)) {
        return res.status(400).json({ erro: "dias deve ser 7, 15 ou 30." });
      }
      q =
        "UPDATE usuarios SET plano = 'trial', trial_fim = GREATEST(trial_fim, NOW()) + make_interval(days => $1) WHERE id = $2 RETURNING *";
      params = [dias, id];
    } else if (acao === "ativar") {
      q = "UPDATE usuarios SET plano = 'ativo' WHERE id = $1 RETURNING *";
      params = [id];
    } else if (acao === "bloquear") {
      q = "UPDATE usuarios SET plano = 'expirado' WHERE id = $1 RETURNING *";
      params = [id];
    } else {
      return res.status(400).json({ erro: "Ação inválida. Use estender, ativar ou bloquear." });
    }
    const r = await db.query(q, params);
    if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado." });
    res.json({ usuario: auth.usuarioPublico(r.rows[0]) });
  } catch (e) {
    console.error("Erro em PUT /api/admin/usuarios/:id:", e);
    res.status(500).json({ erro: e.message || "Falha ao atualizar usuário." });
  }
});

/** Exclui um usuário e todos os seus dados (pacientes, hospitais, evoluções). */
app.delete("/api/admin/usuarios/:id", auth.autenticar, auth.exigirAdmin, async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario.id) {
    return res.status(400).json({ erro: "Você não pode excluir a própria conta." });
  }
  try {
    await db.query("DELETE FROM pacientes WHERE medico_id = $1", [id]);
    await db.query("DELETE FROM hospitais WHERE medico_id = $1", [id]);
    await db.query("DELETE FROM evolucoes WHERE medico_id = $1", [id]);
    const r = await db.query("DELETE FROM usuarios WHERE id = $1 RETURNING id", [id]);
    if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado." });
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Erro em DELETE /api/admin/usuarios/:id:", e);
    res.status(500).json({ erro: e.message || "Falha ao excluir usuário." });
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

// Busca de estabelecimentos no CNES/DATASUS, com cache de 24h em memória.
const cacheCnes = new Map(); // chave -> { ts, dados }
const cacheMunic = new Map(); // "cidade|uf" -> { ts, cod }
const CNES_TTL_MS = 24 * 60 * 60 * 1000; // códigos IBGE (estáveis)
const CNES_RESULTADOS_TTL_MS = 60 * 60 * 1000; // resultados de busca (1h)
const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Tipos de unidade do CNES que interessam (hospitais, UPA, PS, postos/UBS) —
// EXCLUI consultório isolado (22), laboratório (39), farmácia (43), etc.
const CNES_TIPOS = {
  "1": "Posto de saúde",
  "2": "UBS",
  "4": "Policlínica",
  "5": "Hospital",
  "7": "Hospital especializado",
  "15": "Unidade mista",
  "20": "Pronto-socorro",
  "21": "Pronto-socorro",
  "73": "UPA",
};

/** Converte nome de cidade (+UF) no código de município do CNES (6 dígitos). */
async function codigoMunicipio(cidade, uf) {
  const chave = `${normalizar(cidade)}|${uf}`;
  const c = cacheMunic.get(chave);
  if (c && Date.now() - c.ts < CNES_TTL_MS) return c.cod;
  try {
    const url = uf
      ? `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`
      : `https://servicodados.ibge.gov.br/api/v1/localidades/municipios`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`IBGE HTTP ${r.status}`);
    const arr = await r.json();
    const m = (Array.isArray(arr) ? arr : []).find(
      (x) => normalizar(x.nome) === normalizar(cidade),
    );
    // CNES usa o código IBGE de 6 dígitos (sem o dígito verificador).
    const cod = m?.id ? String(m.id).slice(0, 6) : "";
    cacheMunic.set(chave, { ts: Date.now(), cod });
    return cod;
  } catch (e) {
    console.error("Erro IBGE:", e.message);
    return "";
  }
}

/** Busca uma página (até 20) de um tipo de unidade num município. */
async function paginaCnes(codMunic, tipo, offset) {
  const params = new URLSearchParams({
    codigo_municipio: codMunic,
    codigo_tipo_unidade: tipo,
    limit: "20",
    offset: String(offset),
  });
  const r = await fetch(
    `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?${params}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) throw new Error(`CNES HTTP ${r.status}`);
  const data = await r.json();
  return data.estabelecimentos || [];
}

/**
 * GET /api/hospitais/buscar?cidade=&uf=&termo=
 * Lista estabelecimentos institucionais (hospitais/UPA/PS/postos) do município,
 * via código IBGE de 6 dígitos + filtro por tipo de unidade (exclui consultórios).
 * `termo` filtra por nome (substring). Sem cidade não há como filtrar → [].
 */
app.get("/api/hospitais/buscar", auth.autenticar, async (req, res) => {
  const cidade = String(req.query.cidade || "").trim();
  const uf = String(req.query.uf || "").trim().toUpperCase();
  const termo = String(req.query.termo || "").trim();
  if (!cidade) {
    return res.json({ hospitais: [], fonte: "sem_cidade" });
  }
  const chave = `${normalizar(cidade)}|${uf}|${normalizar(termo)}`;
  const cache = cacheCnes.get(chave);
  if (cache && Date.now() - cache.ts < CNES_RESULTADOS_TTL_MS) {
    return res.json({ hospitais: cache.dados, fonte: "cache" });
  }
  try {
    const cod = await codigoMunicipio(cidade, uf);
    if (!cod) return res.json({ hospitais: [], fonte: "municipio_nao_encontrado" });

    // Para cada tipo relevante, busca 2 páginas (até 40) em paralelo.
    const tarefas = [];
    for (const tipo of Object.keys(CNES_TIPOS)) {
      tarefas.push(paginaCnes(cod, tipo, 0).catch(() => []));
      tarefas.push(paginaCnes(cod, tipo, 20).catch(() => []));
    }
    const paginas = await Promise.all(tarefas);

    const porCnes = new Map();
    for (const pag of paginas) {
      for (const e of pag) {
        const cnes = String(e.codigo_cnes || "");
        if (!cnes || porCnes.has(cnes)) continue;
        porCnes.set(cnes, {
          cnes,
          nomeFantasia: e.nome_fantasia || e.nome_razao_social || "",
          cidade,
          uf,
          endereco: e.endereco_estabelecimento || "",
          telefone: e.numero_telefone_estabelecimento || "",
          tipo: CNES_TIPOS[String(e.codigo_tipo_unidade)] || "",
        });
      }
    }
    let hospitais = [...porCnes.values()].filter((e) => e.nomeFantasia);
    if (termo) {
      const t = normalizar(termo);
      hospitais = hospitais.filter((e) => normalizar(e.nomeFantasia).includes(t));
    }
    // Hospitais primeiro, depois alfabético.
    const ordem = { Hospital: 0, "Hospital especializado": 1, UPA: 2, "Pronto-socorro": 3 };
    hospitais.sort(
      (a, b) =>
        (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9) ||
        a.nomeFantasia.localeCompare(b.nomeFantasia),
    );
    hospitais = hospitais.slice(0, 40);
    cacheCnes.set(chave, { ts: Date.now(), dados: hospitais });
    res.json({ hospitais, fonte: "cnes" });
  } catch (e) {
    console.error("Erro em /api/hospitais/buscar:", e.message);
    res.json({ hospitais: [], fonte: "indisponivel" });
  }
});

/** Lista os hospitais do usuário. */
app.get("/api/hospitais", auth.autenticar, async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, nome, cidade, cnes FROM hospitais WHERE medico_id = $1 ORDER BY nome",
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
        `INSERT INTO hospitais (id, medico_id, nome, cidade, cnes, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE
           SET nome = EXCLUDED.nome, cidade = EXCLUDED.cidade,
               cnes = COALESCE(EXCLUDED.cnes, hospitais.cnes), updated_at = NOW()`,
        [h.id, req.usuario.id, h.nome, h.cidade || "", h.cnes || null],
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

// --- Evolução temporal (Fase 3) — snapshot diário por paciente ---

/** Salva/atualiza (upsert) o snapshot do dia. Body: { pacienteId, data, ... } */
app.post("/api/evolucao-diaria/salvar", auth.autenticar, async (req, res) => {
  const b = req.body || {};
  const pacienteId = String(b.pacienteId || "");
  const data = String(b.data || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!pacienteId) return res.status(400).json({ erro: "pacienteId obrigatório." });
  try {
    const r = await db.query(
      `INSERT INTO evolucoes_diarias
         (paciente_id, medico_id, data, sinais_vitais, exames_laboratoriais,
          exames_imagem, evolucao_beira_leito, conduta, problemas_ativos, passou_caso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (paciente_id, medico_id, data) DO UPDATE SET
         sinais_vitais = EXCLUDED.sinais_vitais,
         exames_laboratoriais = EXCLUDED.exames_laboratoriais,
         exames_imagem = EXCLUDED.exames_imagem,
         evolucao_beira_leito = EXCLUDED.evolucao_beira_leito,
         conduta = EXCLUDED.conduta,
         problemas_ativos = EXCLUDED.problemas_ativos,
         passou_caso = COALESCE(EXCLUDED.passou_caso, evolucoes_diarias.passou_caso)
       RETURNING id`,
      [
        pacienteId, req.usuario.id, data,
        b.sinaisVitais ? JSON.stringify(b.sinaisVitais) : null,
        b.examesLab ? JSON.stringify(b.examesLab) : null,
        b.examesImagem || null,
        b.evolucaoBeiraleito ? JSON.stringify(b.evolucaoBeiraleito) : null,
        b.conduta || null,
        b.problemasAtivos ? JSON.stringify(b.problemasAtivos) : null,
        b.passouCaso || null,
      ],
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("Erro em /api/evolucao-diaria/salvar:", e);
    res.status(500).json({ erro: e.message || "Falha ao salvar evolução diária." });
  }
});

/** Lista os snapshots de um paciente (mais recentes primeiro, últimos N dias). */
app.get("/api/evolucao-diaria/:pacienteId", auth.autenticar, async (req, res) => {
  const { pacienteId } = req.params;
  const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
  try {
    const r = await db.query(
      `SELECT data, sinais_vitais, exames_laboratoriais, exames_imagem,
              evolucao_beira_leito, conduta, problemas_ativos, passou_caso
         FROM evolucoes_diarias
        WHERE paciente_id = $1 AND medico_id = $2
          AND data >= CURRENT_DATE - ($3::int - 1)
        ORDER BY data DESC`,
      [pacienteId, req.usuario.id, dias],
    );
    res.json({ registros: r.rows });
  } catch (e) {
    console.error("Erro em GET /api/evolucao-diaria:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar evolução." });
  }
});

/** Snapshot de uma data específica. */
app.get("/api/evolucao-diaria/:pacienteId/:data", auth.autenticar, async (req, res) => {
  const { pacienteId, data } = req.params;
  try {
    const r = await db.query(
      `SELECT * FROM evolucoes_diarias
        WHERE paciente_id = $1 AND medico_id = $2 AND data = $3`,
      [pacienteId, req.usuario.id, data],
    );
    res.json({ registro: r.rows[0] || null });
  } catch (e) {
    res.status(500).json({ erro: e.message || "Falha ao buscar registro." });
  }
});

// Fase 2 — rede clínica colaborativa (perfil, conexões, grupos, passagens).
app.use("/api", redeRouter);

// Tratador de erros final: corpo acima do limite (express.json) vira 413 claro
// em vez de erro genérico.
app.use((err, _req, res, _next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({
      erro: "A imagem é muito grande para enviar. Tente novamente com uma foto menor.",
    });
  }
  console.error("Erro não tratado:", err);
  res.status(500).json({ erro: "Erro interno do servidor." });
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
