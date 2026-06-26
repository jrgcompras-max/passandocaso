const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

/**
 * Segredo de assinatura do JWT. Em produção vem de process.env.JWT_SECRET
 * (defina nas Variables do Railway — ex.: "JWT_SECRET_TROCAR" por um valor real).
 * Sem ela, gera um segredo aleatório efêmero só para desenvolvimento: os tokens
 * deixam de valer a cada restart do servidor, o que é aceitável fora de produção.
 */
const DEV_FALLBACK = crypto.randomBytes(48).toString("hex");
const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK;
if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] JWT_SECRET não definida — usando segredo de desenvolvimento efêmero. " +
      "Defina JWT_SECRET nas variáveis de ambiente em produção (tokens invalidam a cada restart sem ela).",
  );
}

const TOKEN_VALIDADE = "30d"; // sessões longas para o app mobile
const RESET_VALIDADE_MS = 3600_000; // 1 hora

// E-mails com privilégio de super admin (Frente 3). Separe por vírgula em ADMIN_EMAILS.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function ehAdmin(email) {
  return ADMIN_EMAILS.includes((email || "").toLowerCase());
}

// --- Senhas (bcrypt) ---
function hashSenha(senha) {
  return bcrypt.hash(senha, 10);
}
function conferirSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

// --- Tokens (JWT) ---
function gerarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, email: usuario.email, admin: !!usuario.is_admin },
    JWT_SECRET,
    { expiresIn: TOKEN_VALIDADE },
  );
}
function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function gerarResetToken() {
  return crypto.randomBytes(32).toString("hex");
}
function resetExpiraEm() {
  return new Date(Date.now() + RESET_VALIDADE_MS);
}

/**
 * Projeção pública do usuário (sem hash de senha nem tokens de reset). Calcula o
 * estado do trial: dias restantes e se já expirou.
 */
function usuarioPublico(u) {
  const fim = u.trial_fim ? new Date(u.trial_fim) : null;
  const agora = new Date();
  const diasRestantes = fim
    ? Math.max(0, Math.ceil((fim.getTime() - agora.getTime()) / 86_400_000))
    : null;
  const expirado =
    u.plano === "expirado" || (u.plano === "trial" && !!fim && agora > fim);
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    plano: u.plano,
    isAdmin: !!u.is_admin,
    trialFim: u.trial_fim,
    diasRestantes,
    expirado,
    // Perfil profissional (Fase 2)
    categoria: u.categoria || "medico",
    especialidade: u.especialidade || null,
    subespecialidade: u.subespecialidade || null,
    crm: u.crm || null,
    foto_url: u.foto_url || null,
    ano_residencia: u.ano_residencia || null,
    instituicao_formacao: u.instituicao_formacao || null,
    nome_exibicao: u.nome_exibicao || u.nome,
    especialidade_definida: !!u.especialidade_definida,
    onboarding_completo: !!u.onboarding_completo,
    // Funcionalidades clínicas opcionais (toggles sincronizados entre dispositivos).
    features_ativas: u.features_ativas || {},
  };
}

/**
 * Middleware Express: exige um Bearer token válido. Carrega o usuário do banco e
 * o expõe em req.usuario. Responde 401 em qualquer falha.
 */
async function autenticar(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ erro: "Token de autenticação ausente." });
  try {
    const payload = verificarToken(token);
    const r = await db.query("SELECT * FROM usuarios WHERE id = $1", [payload.sub]);
    if (!r.rows.length) return res.status(401).json({ erro: "Usuário não encontrado." });
    req.usuario = r.rows[0];
    next();
  } catch {
    return res.status(401).json({ erro: "Token inválido ou expirado." });
  }
}

/** Middleware: exige que o usuário autenticado seja super admin. */
function exigirAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.is_admin) {
    return res.status(403).json({ erro: "Acesso restrito a administradores." });
  }
  next();
}

// --- E-mail (Resend via API key OU SMTP, com fallback "sem e-mail") ---
//
// Provedores suportados, nesta ordem de preferência:
//   1) Resend  → defina RESEND_API_KEY (e EMAIL_FROM com domínio verificado).
//   2) SMTP    → defina EMAIL_HOST / EMAIL_USER / EMAIL_PASS (e EMAIL_PORT).
//   3) Nenhum  → registra o link no console e segue (enviado: false).
//
// EMAIL_FROM: remetente (ex.: "Passando Caso <nao-responda@passandocaso.com.br>").
// No Resend o domínio do remetente PRECISA estar verificado no painel.

let _transporter = null;
function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }
  if (!_transporter) {
    const nodemailer = require("nodemailer");
    const porta = Number(process.env.EMAIL_PORT) || 587;
    _transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: porta,
      secure: porta === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return _transporter;
}

/** Qual provedor de e-mail está configurado: "resend" | "smtp" | null. */
function provedorEmail() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) return "smtp";
  return null;
}

function remetentePadrao() {
  return (
    process.env.EMAIL_FROM ||
    (process.env.EMAIL_USER && `Passando Caso <${process.env.EMAIL_USER}>`) ||
    "Passando Caso <onboarding@resend.dev>"
  );
}

/**
 * Envio genérico (best-effort) que escolhe o provedor disponível e LOGA cada
 * passo. Nunca lança para fora: devolve { enviado, provedor, erro? } pra quem
 * chamou decidir o que mostrar. Sem provedor, registra no console e segue.
 */
async function enviarEmailBruto(to, assunto, texto, html) {
  const provedor = provedorEmail();
  const from = remetentePadrao();

  if (!provedor) {
    console.log(`[email] Sem provedor configurado (defina RESEND_API_KEY ou EMAIL_*). Para ${to} — ${assunto}`);
    return { enviado: false, provedor: null, erro: "sem-provedor" };
  }

  try {
    if (provedor === "resend") {
      if (typeof fetch !== "function") {
        throw new Error("fetch indisponível nesta versão do Node (precisa Node 18+) para usar o Resend.");
      }
      console.log(`[email] Enviando via Resend para ${to} (de: ${from})...`);
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject: assunto, text: texto, html: html || `<p>${texto}</p>` }),
      });
      const corpo = await resp.text();
      if (!resp.ok) {
        console.error(`[email] Resend recusou (HTTP ${resp.status}): ${corpo}`);
        return { enviado: false, provedor, erro: `resend ${resp.status}: ${corpo}` };
      }
      console.log(`[email] Resend OK para ${to}: ${corpo}`);
      return { enviado: true, provedor };
    }

    // SMTP
    console.log(`[email] Enviando via SMTP (${process.env.EMAIL_HOST}) para ${to} (de: ${from})...`);
    await getTransporter().sendMail({ from, to, subject: assunto, text: texto, html: html || `<p>${texto}</p>` });
    console.log(`[email] SMTP OK para ${to}.`);
    return { enviado: true, provedor };
  } catch (e) {
    console.error(`[email] Falha ao enviar via ${provedor} para ${to}:`, e.message);
    return { enviado: false, provedor, erro: e.message };
  }
}

/**
 * Envia o e-mail de recuperação. Sem provedor configurado, registra o link no
 * console e devolve { enviado: false } — o fluxo segue normalmente.
 */
async function enviarEmailRecuperacao(email, link) {
  if (!provedorEmail()) {
    console.log(`[auth] Sem provedor de e-mail. Link de recuperação para ${email}: ${link}`);
    return { enviado: false, provedor: null };
  }
  return enviarEmailBruto(
    email,
    "Recuperação de senha — Passando Caso",
    `Recebemos um pedido para redefinir sua senha.\n\n` +
      `Acesse: ${link}\n\nO link expira em 1 hora. Se você não solicitou, ignore este e-mail.`,
    `<p>Recebemos um pedido para redefinir sua senha.</p>` +
      `<p><a href="${link}">Clique aqui para redefinir</a> (o link expira em 1 hora).</p>` +
      `<p>Se você não solicitou, ignore este e-mail.</p>`,
  );
}

/** Envio genérico de e-mail (best-effort). */
async function enviarEmail(to, assunto, texto, html) {
  return enviarEmailBruto(to, assunto, texto, html);
}

module.exports = {
  ehAdmin,
  enviarEmail,
  hashSenha,
  conferirSenha,
  gerarToken,
  verificarToken,
  gerarResetToken,
  resetExpiraEm,
  usuarioPublico,
  autenticar,
  exigirAdmin,
  enviarEmailRecuperacao,
};
