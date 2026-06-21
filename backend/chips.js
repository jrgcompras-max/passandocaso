/**
 * Aprendizado de chips do exame físico (Feature 2).
 *
 * Camada 1 (pessoal): cada termo que o médico digita no campo livre incrementa
 * um contador. A partir de 3 usos, vira "chip pessoal" e aparece junto aos
 * padrões da seção. O médico pode fixar ou remover.
 *
 * Camada 2 (global): quando um termo é usado por ≥5 médicos distintos OU ≥20
 * vezes no total, entra como CANDIDATO em chips_evolucao_global (ativo=false)
 * para revisão no admin.
 */

const express = require("express");
const auth = require("./auth");
const db = require("./db");

const router = express.Router();
router.use(auth.autenticar);

const USOS_PARA_CHIP_PESSOAL = 3;
const MEDICOS_PARA_GLOBAL = 5;
const USOS_PARA_GLOBAL = 20;

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Promove um termo a candidato global quando atinge o limiar (best-effort). */
async function avaliarGlobal(secao, texto) {
  const norm = normalizar(texto);
  const ag = await db.query(
    `SELECT COALESCE(SUM(uso_count),0)::int AS total,
            COUNT(DISTINCT usuario_id)::int AS medicos
       FROM chips_evolucao_pessoal
      WHERE secao = $1 AND texto_norm = $2 AND NOT removido`,
    [secao, norm],
  );
  const { total, medicos } = ag.rows[0] || { total: 0, medicos: 0 };
  if (medicos >= MEDICOS_PARA_GLOBAL || total >= USOS_PARA_GLOBAL) {
    await db.query(
      `INSERT INTO chips_evolucao_global (secao, texto, texto_norm, uso_total, medicos_distintos)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (secao, texto_norm) DO UPDATE
         SET uso_total = EXCLUDED.uso_total, medicos_distintos = EXCLUDED.medicos_distintos`,
      [secao, texto.trim(), norm, total, medicos],
    );
  }
}

/**
 * POST /api/chips/log — registra termos digitados no campo livre de uma seção.
 * Body: { secao, termos: string[], texto?: string }.
 */
router.post("/chips/log", async (req, res) => {
  const b = req.body || {};
  const secao = String(b.secao || "").trim();
  const termos = (Array.isArray(b.termos) ? b.termos : [])
    .map((t) => String(t || "").trim())
    .filter((t) => t.length >= 3 && t.length <= 120);
  if (!secao || !termos.length) return res.json({ ok: true, registrados: 0 });
  try {
    await db.query(
      `INSERT INTO texto_livre_log (usuario_id, secao, texto_digitado, termos_extraidos)
       VALUES ($1,$2,$3,$4)`,
      [req.usuario.id, secao, b.texto || termos.join(", "), JSON.stringify(termos)],
    );
    const vistos = new Set();
    for (const termo of termos) {
      const norm = normalizar(termo);
      if (!norm || vistos.has(norm)) continue;
      vistos.add(norm);
      await db.query(
        `INSERT INTO chips_evolucao_pessoal (usuario_id, secao, texto, texto_norm, uso_count)
         VALUES ($1,$2,$3,$4,1)
         ON CONFLICT (usuario_id, secao, texto_norm) DO UPDATE
           SET uso_count = chips_evolucao_pessoal.uso_count + 1, removido = FALSE`,
        [req.usuario.id, secao, termo, norm],
      );
      await avaliarGlobal(secao, termo);
    }
    res.json({ ok: true, registrados: vistos.size });
  } catch (e) {
    console.error("Erro POST /chips/log:", e);
    res.status(500).json({ erro: e.message || "Falha ao registrar." });
  }
});

/**
 * GET /api/chips/pessoais — chips pessoais do usuário (≥3 usos OU fixados, não
 * removidos), agrupados por seção: { secao: [{ texto, uso_count, fixado }] }.
 */
router.get("/chips/pessoais", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT secao, texto, uso_count, fixado
         FROM chips_evolucao_pessoal
        WHERE usuario_id = $1 AND NOT removido AND (uso_count >= $2 OR fixado)
        ORDER BY fixado DESC, uso_count DESC`,
      [req.usuario.id, USOS_PARA_CHIP_PESSOAL],
    );
    const porSecao = {};
    for (const row of r.rows) {
      (porSecao[row.secao] = porSecao[row.secao] || []).push({
        texto: row.texto,
        uso_count: row.uso_count,
        fixado: row.fixado,
      });
    }
    res.json({ chips: porSecao });
  } catch (e) {
    console.error("Erro GET /chips/pessoais:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar chips." });
  }
});

/** GET /api/chips/globais — chips globais ATIVOS (aprovados no admin), por seção. */
router.get("/chips/globais", async (_req, res) => {
  try {
    const r = await db.query(
      "SELECT secao, texto FROM chips_evolucao_global WHERE ativo ORDER BY uso_total DESC",
    );
    const porSecao = {};
    for (const row of r.rows) {
      (porSecao[row.secao] = porSecao[row.secao] || []).push(row.texto);
    }
    res.json({ chips: porSecao });
  } catch (e) {
    console.error("Erro GET /chips/globais:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar chips globais." });
  }
});

/** PUT /api/chips/pessoal — fixar/desafixar um chip pessoal. Body: { secao, texto, fixado }. */
router.put("/chips/pessoal", async (req, res) => {
  const b = req.body || {};
  const secao = String(b.secao || "").trim();
  const norm = normalizar(b.texto);
  if (!secao || !norm) return res.status(400).json({ erro: "secao e texto obrigatórios." });
  try {
    await db.query(
      `INSERT INTO chips_evolucao_pessoal (usuario_id, secao, texto, texto_norm, uso_count, fixado)
       VALUES ($1,$2,$3,$4,0,$5)
       ON CONFLICT (usuario_id, secao, texto_norm) DO UPDATE
         SET fixado = $5, removido = FALSE`,
      [req.usuario.id, secao, String(b.texto).trim(), norm, !!b.fixado],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/** DELETE /api/chips/pessoal — remove (oculta) um chip pessoal. Body: { secao, texto }. */
router.delete("/chips/pessoal", async (req, res) => {
  const b = req.body || {};
  const secao = String(b.secao || "").trim();
  const norm = normalizar(b.texto);
  if (!secao || !norm) return res.status(400).json({ erro: "secao e texto obrigatórios." });
  try {
    await db.query(
      `UPDATE chips_evolucao_pessoal SET removido = TRUE, fixado = FALSE
        WHERE usuario_id = $1 AND secao = $2 AND texto_norm = $3`,
      [req.usuario.id, secao, norm],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
