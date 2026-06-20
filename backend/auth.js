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

// --- E-mail (nodemailer, com fallback "sem e-mail") ---
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

/**
 * Envia o e-mail de recuperação. Sem SMTP configurado, apenas registra o link no
 * console e devolve { enviado: false } — o fluxo segue normalmente.
 */
async function enviarEmailRecuperacao(email, link) {
  const t = getTransporter();
  if (!t) {
    console.log(`[auth] SMTP não configurado. Link de recuperação para ${email}: ${link}`);
    return { enviado: false };
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || `Passando Caso <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Recuperação de senha — Passando Caso",
    text:
      `Recebemos um pedido para redefinir sua senha.\n\n` +
      `Acesse: ${link}\n\nO link expira em 1 hora. Se você não solicitou, ignore este e-mail.`,
    html:
      `<p>Recebemos um pedido para redefinir sua senha.</p>` +
      `<p><a href="${link}">Clique aqui para redefinir</a> (o link expira em 1 hora).</p>` +
      `<p>Se você não solicitou, ignore este e-mail.</p>`,
  });
  return { enviado: true };
}

/** Envio genérico de e-mail (best-effort). Sem SMTP, registra no console. */
async function enviarEmail(to, assunto, texto, html) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email] (sem SMTP) Para ${to} — ${assunto}: ${texto}`);
    return { enviado: false };
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || `Passando Caso <${process.env.EMAIL_USER}>`,
    to,
    subject: assunto,
    text: texto,
    html: html || `<p>${texto}</p>`,
  });
  return { enviado: true };
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
