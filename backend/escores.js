/**
 * Escores clínicos automáticos (Fase 3) — cálculo no backend + persistência.
 *
 * Calcula CURB-65, SOFA, Child-Pugh e CHA2DS2-VASc a partir do JSONB
 * `pacientes.dados` (mesma estrutura que o app mantém). Persiste em
 * escores_clinicos para histórico temporal. Recalcula em background quando a
 * ficha é sincronizada.
 *
 * Posicionamento regulatório: os escores são CALCULADOS, não interpretados.
 * Cada escore traz o número, a classificação DA ESCALA e a fonte; campos
 * ausentes entram em `campos_faltantes`. Não sugere conduta.
 */

const express = require("express");
const auth = require("./auth");
const db = require("./db");

// ── helpers de extração ─────────────────────────────────────────────────────

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Data mais recente registrada na ficha (sinais vitais/evoluções/dias). */
function dataMaisRecente(dados) {
  const datas = [
    ...Object.keys(dados.sinaisVitais || {}),
    ...Object.keys(dados.evolucoes || {}),
    ...(Array.isArray(dados.diasAcompanhamento) ? dados.diasAcompanhamento : []),
  ].filter(Boolean);
  if (!datas.length) return null;
  return datas.sort().slice(-1)[0];
}

/** Valor numérico mais recente de um exame (por sinônimos do nome). */
function labMaisRecente(dados, sinonimos) {
  const alvos = sinonimos.map(normalizar);
  const cand = (dados.resultadosLab || []).filter((r) => {
    const e = normalizar(r.exame);
    return alvos.some((a) => e === a || e.startsWith(a + " ") || e.startsWith(a));
  });
  if (!cand.length) return null;
  cand.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  return num(cand[0].valor);
}

function blocosItens(extraido, soComorb) {
  if (!extraido) return [];
  try {
    const blocos = JSON.parse(extraido);
    if (!Array.isArray(blocos)) return [String(extraido)];
    const out = [];
    for (const b of blocos) {
      if (!soComorb || !/medica|muc/i.test(b.titulo || "")) out.push(...(b.itens || []));
    }
    return out;
  } catch {
    return [String(extraido)];
  }
}

function textoComorbidades(dados) {
  const partes = [];
  if (dados.dadosClinicos && dados.dadosClinicos.comorbidades) {
    partes.push(dados.dadosClinicos.comorbidades);
  }
  partes.push(...blocosItens(dados.secoes?.comorbidades?.extraido, false));
  partes.push(...blocosItens(dados.secoes?.comorbidadesMedicacoes?.extraido, true));
  for (const p of dados.problemas || []) partes.push(p.titulo);
  return normalizar(partes.join(" | "));
}

const temTermo = (txt, termos) => termos.some((t) => txt.includes(normalizar(t)));

function temVasopressor(dados) {
  const re = /noradrenalina|norepinefrina|vasopressina|dobutamina|dopamina|adrenalina|epinefrina/i;
  return (dados.medicamentos || []).some((m) => re.test(m.texto || ""));
}

const faixaTercos = (p, m1, m2) => (p >= m2 ? "alto" : p >= m1 ? "medio" : "baixo");

/** Monta o objeto padrão de um escore. */
function escore(tipo, nome, opts) {
  return {
    tipo,
    nome,
    calculavel: opts.calculavel,
    valorTotal: opts.valorTotal,
    maxPontos: opts.maxPontos,
    faixa: opts.faixa,
    classificacao: opts.classificacao,
    fonte: "CKD/escala",
    fonteOrigem: "auto",
    criterios: opts.criterios,
    camposFaltantes: opts.camposFaltantes,
    referencia: opts.referencia,
  };
}

// ── CURB-65 ─────────────────────────────────────────────────────────────────

function calcularCurb65(dados, hoje) {
  const sv = dados.sinaisVitais?.[hoje] || {};
  const evo = dados.evolucoes?.[hoje] || {};
  const faltam = [];

  const fr = num(sv.fr);
  const paSist = num(sv.paSist);
  const paDiast = num(sv.paDiast);
  const calculavel = fr != null && (paSist != null || paDiast != null) && dados.idade != null;

  const temConsc = !!(evo.nivelConsciencia || evo.orientacao);
  const confusao =
    (evo.nivelConsciencia != null && evo.nivelConsciencia !== "lucido") ||
    evo.orientacao === "desorientado";
  if (!temConsc) faltam.push("nível de consciência");

  const ureia = labMaisRecente(dados, ["ureia", "uréia", "u"]);
  if (ureia == null) faltam.push("ureia");
  const idade = dados.idade ?? null;

  const criterios = [
    { label: "Confusão mental", pontos: confusao ? 1 : 0, marcado: confusao, fonte: temConsc ? "auto" : "faltante" },
    { label: "Ureia > 43 mg/dL", pontos: ureia != null && ureia > 43 ? 1 : 0, marcado: ureia != null && ureia > 43, fonte: ureia == null ? "faltante" : "auto" },
    { label: "FR ≥ 30 irpm", pontos: fr != null && fr >= 30 ? 1 : 0, marcado: fr != null && fr >= 30, fonte: fr == null ? "faltante" : "auto" },
    { label: "PAS < 90 ou PAD ≤ 60", pontos: (paSist != null && paSist < 90) || (paDiast != null && paDiast <= 60) ? 1 : 0, marcado: (paSist != null && paSist < 90) || (paDiast != null && paDiast <= 60), fonte: paSist == null && paDiast == null ? "faltante" : "auto" },
    { label: "Idade ≥ 65 anos", pontos: idade != null && idade >= 65 ? 1 : 0, marcado: idade != null && idade >= 65, fonte: idade == null ? "faltante" : "auto" },
  ];
  const total = criterios.reduce((s, c) => s + c.pontos, 0);
  const classificacao = total >= 3 ? "Alto risco" : total === 2 ? "Risco intermediário" : "Baixo risco";

  return escore("CURB65", "CURB-65", {
    calculavel, valorTotal: total, maxPontos: 5, faixa: faixaTercos(total, 2, 3),
    classificacao, criterios, camposFaltantes: faltam,
    referencia: "Lim et al., Thorax 2003 · BTS",
  });
}

// ── SOFA ────────────────────────────────────────────────────────────────────

function sofaRespPorSato2(s) {
  if (s >= 97) return 0;
  if (s >= 93) return 1;
  if (s >= 88) return 2;
  return 3;
}

function calcularSofa(dados, hoje) {
  const sv = dados.sinaisVitais?.[hoje] || {};
  const evo = dados.evolucoes?.[hoje] || {};
  const faltam = [];
  const criterios = [];

  const sato2 = num(sv.sato2);
  const respDisp = sato2 != null;
  const respPts = respDisp ? sofaRespPorSato2(sato2) : 0;
  if (!respDisp) faltam.push("SatO2");
  criterios.push({ label: "Respiratório (PaO2/FiO2 est.)", pontos: respPts, marcado: respPts > 0, fonte: respDisp ? "auto" : "faltante" });

  const plaq = labMaisRecente(dados, ["plaquetas", "plaq", "plt"]);
  let coagPts = 0;
  if (plaq != null) {
    const k = plaq / 1000;
    coagPts = k < 20 ? 4 : k < 50 ? 3 : k < 100 ? 2 : k < 150 ? 1 : 0;
  } else faltam.push("plaquetas");
  criterios.push({ label: "Coagulação (plaquetas)", pontos: coagPts, marcado: coagPts > 0, fonte: plaq == null ? "faltante" : "auto" });

  const bt = labMaisRecente(dados, ["bilirrubina total", "bt", "bilirrubina"]);
  let hepPts = 0;
  if (bt != null) hepPts = bt >= 12 ? 4 : bt >= 6 ? 3 : bt >= 2 ? 2 : bt >= 1.2 ? 1 : 0;
  else faltam.push("bilirrubina");
  criterios.push({ label: "Hepático (bilirrubina)", pontos: hepPts, marcado: hepPts > 0, fonte: bt == null ? "faltante" : "auto" });

  const paSist = num(sv.paSist);
  const paDiast = num(sv.paDiast);
  const pam = paSist != null && paDiast != null ? (paSist + 2 * paDiast) / 3 : null;
  const vaso = temVasopressor(dados);
  const cardioDisp = pam != null || vaso;
  let cardioPts = 0;
  if (vaso) cardioPts = 3;
  else if (pam != null) cardioPts = pam < 70 ? 1 : 0;
  else faltam.push("pressão arterial");
  criterios.push({ label: "Cardiovascular (PAM)", pontos: cardioPts, marcado: cardioPts > 0, fonte: cardioDisp ? "auto" : "faltante" });

  const nc = evo.nivelConsciencia || null;
  let sncPts = 0;
  if (nc === "torporoso") sncPts = 2;
  else if (nc === "comatoso") sncPts = 4;
  else if (nc === "lucido") sncPts = 0;
  else faltam.push("nível de consciência");
  criterios.push({ label: "Neurológico (consciência)", pontos: sncPts, marcado: sncPts > 0, fonte: nc == null ? "faltante" : "auto" });

  const cr = labMaisRecente(dados, ["creatinina", "cr", "creat"]);
  let renalPts = 0;
  if (cr != null) renalPts = cr >= 5 ? 4 : cr >= 3.5 ? 3 : cr >= 2 ? 2 : cr >= 1.2 ? 1 : 0;
  else faltam.push("creatinina");
  criterios.push({ label: "Renal (creatinina)", pontos: renalPts, marcado: renalPts > 0, fonte: cr == null ? "faltante" : "auto" });

  const avaliados = criterios.filter((c) => c.fonte !== "faltante").length;
  const calculavel = respDisp && cardioDisp && cr != null && avaliados >= 3;
  const total = criterios.reduce((s, c) => s + c.pontos, 0);
  const classBase = total >= 10 ? "Disfunção orgânica grave" : total >= 6 ? "Disfunção orgânica moderada" : "Disfunção orgânica leve";

  return escore("SOFA", "SOFA", {
    calculavel, valorTotal: total, maxPontos: 24, faixa: faixaTercos(total, 6, 10),
    classificacao: `${classBase} · ${avaliados}/6 sistemas`, criterios, camposFaltantes: faltam,
    referencia: "Vincent et al., Intensive Care Med 1996",
  });
}

// ── Child-Pugh ──────────────────────────────────────────────────────────────

function calcularChildPugh(dados, hoje) {
  const evo = dados.evolucoes?.[hoje] || {};
  const faltam = [];

  const bt = labMaisRecente(dados, ["bilirrubina total", "bt", "bilirrubina"]);
  const alb = labMaisRecente(dados, ["albumina"]);
  const inr = labMaisRecente(dados, ["inr", "rni"]);
  if (bt == null) faltam.push("bilirrubina");
  if (alb == null) faltam.push("albumina");
  if (inr == null) faltam.push("INR");

  const textoAbd = normalizar([evo.abdominal, evo.estadoGeral, evo.exameFisico].filter(Boolean).join(" "));
  const asciteGrave = /ascite (volumosa|tensa|de grande|importante|3\+|grau iii)/.test(textoAbd);
  const asciteLeve = !asciteGrave && /ascite/.test(textoAbd);
  const nc = evo.nivelConsciencia || null;

  const ptBili = bt == null ? 0 : bt < 2 ? 1 : bt <= 3 ? 2 : 3;
  const ptAlb = alb == null ? 0 : alb > 3.5 ? 1 : alb >= 2.8 ? 2 : 3;
  const ptInr = inr == null ? 0 : inr < 1.7 ? 1 : inr <= 2.3 ? 2 : 3;
  const ptAsc = asciteGrave ? 3 : asciteLeve ? 2 : 1;
  const ptEnc = nc === "comatoso" ? 3 : nc === "torporoso" ? 2 : 1;

  const criterios = [
    { label: "Bilirrubina total", pontos: ptBili, marcado: ptBili > 1, fonte: bt == null ? "faltante" : "auto" },
    { label: "Albumina", pontos: ptAlb, marcado: ptAlb > 1, fonte: alb == null ? "faltante" : "auto" },
    { label: "INR", pontos: ptInr, marcado: ptInr > 1, fonte: inr == null ? "faltante" : "auto" },
    { label: "Ascite", pontos: ptAsc, marcado: ptAsc > 1, fonte: "auto" },
    { label: "Encefalopatia", pontos: ptEnc, marcado: ptEnc > 1, fonte: "auto" },
  ];
  const calculavel = bt != null && alb != null && inr != null;
  const total = criterios.reduce((s, c) => s + c.pontos, 0);
  const classe = total >= 10 ? "C" : total >= 7 ? "B" : "A";

  return escore("CHILD_PUGH", "Child-Pugh", {
    calculavel, valorTotal: total, maxPontos: 15,
    faixa: classe === "A" ? "baixo" : classe === "B" ? "medio" : "alto",
    classificacao: `Classe ${classe}`, criterios, camposFaltantes: faltam,
    referencia: "Pugh et al., 1973",
  });
}

// ── CHA2DS2-VASc ────────────────────────────────────────────────────────────

function calcularChadsvasc(dados) {
  const faltam = [];
  const txt = textoComorbidades(dados);
  const idade = dados.idade ?? null;
  const sexo = dados.sexo ?? null;
  if (idade == null) faltam.push("idade");
  if (!sexo) faltam.push("sexo");

  const icc = temTermo(txt, ["insuficiencia cardiaca", "icc", "icfer", "icfep", "fração de ejeção"]);
  const has = temTermo(txt, ["hipertens", "has", "pressao alta"]);
  const dm = temTermo(txt, ["diabetes", "dm2", "dm1", "dm "]);
  const avc = temTermo(txt, ["avc", "ave", "ait", "isquemia cerebral", "embolia", "tromboembol"]);
  const vasc = temTermo(txt, ["doenca arterial", "dac", "iam", "infarto", "coronar", "dap", "aterosclerose"]);
  const ptIdade = idade != null && idade >= 75 ? 2 : idade != null && idade >= 65 ? 1 : 0;
  const ptSexo = sexo === "F" ? 1 : 0;

  const criterios = [
    { label: "ICC/disfunção VE", pontos: icc ? 1 : 0, marcado: icc, fonte: "auto" },
    { label: "Hipertensão", pontos: has ? 1 : 0, marcado: has, fonte: "auto" },
    { label: "Idade ≥75 (2) / 65-74 (1)", pontos: ptIdade, marcado: ptIdade > 0, fonte: idade == null ? "faltante" : "auto" },
    { label: "Diabetes", pontos: dm ? 1 : 0, marcado: dm, fonte: "auto" },
    { label: "AVC/AIT/tromboembolismo", pontos: avc ? 2 : 0, marcado: avc, fonte: "auto" },
    { label: "Doença vascular", pontos: vasc ? 1 : 0, marcado: vasc, fonte: "auto" },
    { label: "Sexo feminino", pontos: ptSexo, marcado: ptSexo > 0, fonte: sexo ? "auto" : "faltante" },
  ];
  const calculavel = idade != null && !!sexo;
  const total = criterios.reduce((s, c) => s + c.pontos, 0);
  const classificacao = total >= 2 ? "Alto risco tromboembólico" : total === 1 ? "Risco intermediário" : "Baixo risco tromboembólico";

  return escore("CHA2DS2_VASC", "CHA₂DS₂-VASc", {
    calculavel, valorTotal: total, maxPontos: 9, faixa: faixaTercos(total, 1, 2),
    classificacao, criterios, camposFaltantes: faltam,
    referencia: "Lip et al., Chest 2010 · ESC",
  });
}

/** Calcula os 4 escores a partir do JSONB da ficha. */
function calcularTodos(dados) {
  const hoje = dataMaisRecente(dados);
  return [
    calcularCurb65(dados, hoje),
    calcularSofa(dados, hoje),
    calcularChildPugh(dados, hoje),
    calcularChadsvasc(dados),
  ];
}

/** Persiste os escores CALCULÁVEIS de um paciente (uma linha por tipo). */
async function persistirEscores(pacienteId, dados, medicoId) {
  const escores = calcularTodos(dados).filter((e) => e.calculavel);
  for (const e of escores) {
    const fonte = e.camposFaltantes.length ? "misto" : "auto";
    await db.query(
      `INSERT INTO escores_clinicos
         (paciente_id, tipo, valor_total, classificacao, detalhes, fonte, campos_faltantes, calculado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        pacienteId, e.tipo, e.valorTotal, e.classificacao,
        JSON.stringify({ criterios: e.criterios, maxPontos: e.maxPontos, faixa: e.faixa, referencia: e.referencia }),
        fonte, e.camposFaltantes, medicoId || null,
      ],
    );
  }
  return escores.length;
}

/** Recalcula e persiste em background (não lança — best-effort). */
function recalcularEmBackground(pacienteId, dados, medicoId) {
  Promise.resolve()
    .then(() => persistirEscores(pacienteId, dados, medicoId))
    .catch((e) => console.error(`Recálculo de escores (${pacienteId}) falhou:`, e.message));
}

// ── Rotas ───────────────────────────────────────────────────────────────────

const router = express.Router();
router.use(auth.autenticar);

/** Garante que o paciente pertence ao usuário; devolve a linha (dados) ou null. */
async function carregarPaciente(pacienteId, medicoId) {
  const r = await db.query(
    "SELECT dados FROM pacientes WHERE id = $1 AND medico_id = $2",
    [pacienteId, medicoId],
  );
  return r.rows[0] ? r.rows[0].dados : null;
}

/** Últimos escores de cada tipo. */
router.get("/pacientes/:id/escores", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT DISTINCT ON (tipo) tipo, valor_total, classificacao, detalhes, fonte,
              campos_faltantes, calculado_em
         FROM escores_clinicos
        WHERE paciente_id = $1
        ORDER BY tipo, calculado_em DESC`,
      [req.params.id],
    );
    res.json({ escores: r.rows });
  } catch (e) {
    console.error("Erro GET /escores:", e);
    res.status(500).json({ erro: e.message || "Falha ao listar escores." });
  }
});

/** Recalcula todos os escores automaticamente a partir da ficha e persiste. */
router.post("/pacientes/:id/escores/calcular", async (req, res) => {
  try {
    const dados = await carregarPaciente(req.params.id, req.usuario.id);
    if (!dados) return res.status(404).json({ erro: "Paciente não encontrado." });
    const calculados = calcularTodos(dados);
    await persistirEscores(req.params.id, dados, req.usuario.id);
    res.json({ escores: calculados });
  } catch (e) {
    console.error("Erro POST /escores/calcular:", e);
    res.status(500).json({ erro: e.message || "Falha ao calcular escores." });
  }
});

/** Salva um escore com dados manuais/mistos (informados pelo app). */
router.post("/pacientes/:id/escores/:tipo", async (req, res) => {
  const b = req.body || {};
  if (b.valorTotal == null) return res.status(400).json({ erro: "valorTotal obrigatório." });
  try {
    const dono = await carregarPaciente(req.params.id, req.usuario.id);
    if (!dono) return res.status(404).json({ erro: "Paciente não encontrado." });
    const r = await db.query(
      `INSERT INTO escores_clinicos
         (paciente_id, tipo, valor_total, classificacao, detalhes, fonte, campos_faltantes, calculado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, calculado_em`,
      [
        req.params.id, req.params.tipo, Number(b.valorTotal), b.classificacao || null,
        JSON.stringify(b.detalhes || {}), b.fonte || "manual",
        Array.isArray(b.camposFaltantes) ? b.camposFaltantes : [], req.usuario.id,
      ],
    );
    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    console.error("Erro POST /escores/:tipo:", e);
    res.status(500).json({ erro: e.message || "Falha ao salvar escore." });
  }
});

/** Evolução temporal de um escore (mais antigo → mais recente). */
router.get("/pacientes/:id/escores/:tipo/historico", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT valor_total, classificacao, fonte, campos_faltantes, calculado_em
         FROM escores_clinicos
        WHERE paciente_id = $1 AND tipo = $2
        ORDER BY calculado_em ASC`,
      [req.params.id, req.params.tipo],
    );
    res.json({ tipo: req.params.tipo, historico: r.rows });
  } catch (e) {
    console.error("Erro GET /escores/historico:", e);
    res.status(500).json({ erro: e.message || "Falha ao buscar histórico." });
  }
});

module.exports = { router, calcularTodos, persistirEscores, recalcularEmBackground };
