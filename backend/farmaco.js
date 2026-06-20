/**
 * Segurança farmacológica (Fase 3) — interações, posologia de referência e
 * ajuste de dose renal (TFG por CKD-EPI 2021).
 *
 * Posicionamento regulatório: TUDO é informativo. As interações NUNCA bloqueiam
 * o cadastro de nenhum medicamento; os escores/doses são REFERÊNCIA (RENAME/
 * ANVISA/SBN). O app só consulta — o médico decide sempre. A linguagem evita
 * verbos de comando ("considere/prescreva/reduza"); usa "identificado/calculado/
 * referência".
 */

const express = require("express");

const auth = require("./auth");
const db = require("./db");
const ontologia = require("./ontologia");

const router = express.Router();
router.use(auth.autenticar); // exige login

const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Resolve um texto livre de medicamento para o termo canônico da ontologia
 * (ex.: "marevan 5mg" → "Varfarina"). Cai no próprio texto se não reconhecer.
 */
async function resolverMedicamento(texto) {
  try {
    const termo = await ontologia.buscarTermo(texto, "medicacao");
    if (termo) return { canonico: termo.termo, norm: normalizar(termo.termo), termo };
  } catch {
    // best-effort
  }
  const limpo = String(texto || "").trim();
  return { canonico: limpo, norm: normalizar(limpo), termo: null };
}

/**
 * POST /api/farmaco/interacoes
 * Body: { medicamentos: ['Varfarina', 'AAS', ...] }
 * Resolve cada medicamento (nome exato OU sinônimo via termos_clinicos) para o
 * termo canônico e devolve as interações encontradas entre os pares presentes.
 * Informativo — não bloqueia nada.
 */
router.post("/farmaco/interacoes", async (req, res) => {
  const lista = Array.isArray((req.body || {}).medicamentos) ? req.body.medicamentos : null;
  if (!lista) {
    return res.status(400).json({ erro: "Campo obrigatório: medicamentos (array)." });
  }
  try {
    // Resolve e deduplica por nome canônico normalizado.
    const resolvidos = [];
    const vistos = new Set();
    for (const m of lista) {
      const r = await resolverMedicamento(m);
      if (!r.norm || vistos.has(r.norm)) continue;
      vistos.add(r.norm);
      resolvidos.push(r);
    }
    if (resolvidos.length < 2) return res.json({ interacoes: [] });

    const normSet = resolvidos.map((r) => r.norm);
    // Busca todas as interações em que AMBOS os lados estão na lista presente.
    const r = await db.query(
      `SELECT medicamento_a, medicamento_b, severidade, descricao, mecanismo, conduta_recomendada, fonte
         FROM interacoes_medicamentosas
        WHERE ativo
          AND lower(medicamento_a) = ANY($1)
          AND lower(medicamento_b) = ANY($1)`,
      [normSet],
    );
    // Mapeia o nome normalizado de volta para o nome exibido pelo usuário/ontologia.
    const exibir = new Map(resolvidos.map((x) => [x.norm, x.canonico]));
    const interacoes = r.rows.map((row) => ({
      medicamentoA: exibir.get(normalizar(row.medicamento_a)) || row.medicamento_a,
      medicamentoB: exibir.get(normalizar(row.medicamento_b)) || row.medicamento_b,
      severidade: row.severidade,
      descricao: row.descricao,
      mecanismo: row.mecanismo || null,
      condutaRecomendada: row.conduta_recomendada || null,
      fonte: row.fonte || "ANVISA/Micromedex",
    }));
    res.json({ interacoes });
  } catch (e) {
    console.error("Erro em POST /api/farmaco/interacoes:", e);
    res.status(500).json({ erro: e.message || "Falha ao analisar interações." });
  }
});

/**
 * GET /api/farmaco/posologia/:medicamento
 * Posologia de referência (RENAME) do medicamento resolvido pela ontologia.
 * Inclui o ajuste renal de referência (quando houver) para a UI cruzar com a TFG.
 */
router.get("/farmaco/posologia/:medicamento", async (req, res) => {
  try {
    const { termo } = await resolverMedicamento(req.params.medicamento);
    if (!termo) return res.json({ encontrado: false });

    // Ajuste renal de referência (best-effort) pelo nome canônico.
    let ajusteRenal = null;
    try {
      const a = await db.query(
        "SELECT tfg_min, tfg_corte, recomendacao, fonte FROM ajuste_renal WHERE lower(medicamento) = $1 LIMIT 1",
        [normalizar(termo.termo)],
      );
      if (a.rows[0]) {
        ajusteRenal = {
          tfgMin: a.rows[0].tfg_min != null ? Number(a.rows[0].tfg_min) : null,
          tfgCorte: a.rows[0].tfg_corte != null ? Number(a.rows[0].tfg_corte) : null,
          recomendacao: a.rows[0].recomendacao || null,
          fonte: a.rows[0].fonte || "ANVISA/SBN",
        };
      }
    } catch {
      // best-effort
    }

    const temDose =
      termo.dose_usual || termo.dose_min || termo.dose_max || termo.intervalo_usual;
    res.json({
      encontrado: !!(temDose || ajusteRenal),
      medicamento: termo.termo,
      classe: termo.classe_farmacologica || null,
      doseUsual: termo.dose_usual || null,
      doseMin: termo.dose_min || null,
      doseMax: termo.dose_max || null,
      vias: termo.vias_administracao || null,
      intervalo: termo.intervalo_usual || null,
      observacoes: termo.observacoes_dose || null,
      ajusteRenal,
      fonte: "RENAME",
    });
  } catch (e) {
    console.error("Erro em GET /api/farmaco/posologia:", e);
    res.status(500).json({ erro: e.message || "Falha ao buscar posologia." });
  }
});

/** Estágio KDIGO da DRC a partir da TFG (mL/min/1,73m²). */
function estadioTFG(tfg) {
  if (tfg >= 90) return { estadio: "G1", descricao: "Normal ou elevada" };
  if (tfg >= 60) return { estadio: "G2", descricao: "Redução leve" };
  if (tfg >= 45) return { estadio: "G3a", descricao: "Redução leve a moderada" };
  if (tfg >= 30) return { estadio: "G3b", descricao: "Redução moderada a grave" };
  if (tfg >= 15) return { estadio: "G4", descricao: "Redução grave" };
  return { estadio: "G5", descricao: "Falência renal" };
}

/**
 * POST /api/farmaco/tfg
 * Body: { creatinina, idade, sexo, peso }
 * Calcula a TFG estimada pela CKD-EPI 2021 (sem coeficiente de raça). `peso` é
 * aceito por compatibilidade (a CKD-EPI não o utiliza).
 * Retorna: { tfg, estadio, descricao }.
 */
router.post("/farmaco/tfg", async (req, res) => {
  const b = req.body || {};
  const scr = Number(String(b.creatinina ?? "").toString().replace(",", "."));
  const idade = Number(b.idade);
  const sexo = String(b.sexo || "").toUpperCase().startsWith("F") ? "F" : "M";
  if (!Number.isFinite(scr) || scr <= 0 || !Number.isFinite(idade) || idade <= 0) {
    return res.status(400).json({ erro: "Dados insuficientes para calcular (creatinina e idade)." });
  }
  // CKD-EPI 2021 (creatinina), independente de raça.
  const feminino = sexo === "F";
  const kappa = feminino ? 0.7 : 0.9;
  const alpha = feminino ? -0.241 : -0.302;
  const min = Math.min(scr / kappa, 1);
  const max = Math.max(scr / kappa, 1);
  let tfg =
    142 *
    Math.pow(min, alpha) *
    Math.pow(max, -1.2) *
    Math.pow(0.9938, idade) *
    (feminino ? 1.012 : 1);
  tfg = Math.round(tfg);
  const { estadio, descricao } = estadioTFG(tfg);
  res.json({ tfg, estadio, descricao, fonte: "CKD-EPI 2021 · KDIGO" });
});

module.exports = router;
