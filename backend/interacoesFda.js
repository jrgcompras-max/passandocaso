/**
 * Interações medicamentosas dinâmicas (Fase 3) — OpenFDA + Anthropic, com cache.
 *
 * Fluxo: nome comercial/BR → DCI/INN (ontologia/RENAME) → OpenFDA Drug Label
 * (campo drug_interactions, domínio público CC0) → parse com a Anthropic API →
 * cache permanente em interacoes_medicamentosas. Camada que COMPLEMENTA as
 * interações curadas já semeadas (mesma tabela).
 *
 * Chave de cache: medicamento_a/b = INN normalizado (PT), par ordenado. Cache
 * NEGATIVO (par sem interação ou sem dado na FDA) é gravado com ativo=FALSE para
 * não reconsultar. O OpenFDA usa o INN em INGLÊS, então mantemos um mapa PT→EN
 * dos fármacos mais comuns; fora dele, tenta-se o próprio nome.
 *
 * Regulatório: informativo, nunca bloqueia o cadastro. Fonte citada (U.S. FDA).
 */

const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const ontologia = require("./ontologia");
const { parseJsonIASeguro } = require("./iaJson");

const OPENFDA_URL = "https://api.fda.gov/drug/label.json";

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// DCI/INN português → inglês (generic_name da OpenFDA), p/ os fármacos curados.
const INN_PT_EN = {
  metformina: "metformin", gliclazida: "gliclazide", empagliflozina: "empagliflozin",
  dapagliflozina: "dapagliflozin", losartana: "losartan", valsartana: "valsartan",
  enalapril: "enalapril", captopril: "captopril", anlodipino: "amlodipine",
  hidroclorotiazida: "hydrochlorothiazide", furosemida: "furosemide",
  espironolactona: "spironolactone", carvedilol: "carvedilol", metoprolol: "metoprolol",
  atenolol: "atenolol", propranolol: "propranolol", atorvastatina: "atorvastatin",
  sinvastatina: "simvastatin", rosuvastatina: "rosuvastatin", aas: "aspirin",
  clopidogrel: "clopidogrel", varfarina: "warfarin", enoxaparina: "enoxaparin",
  heparina: "heparin", rivaroxabana: "rivaroxaban", apixabana: "apixaban",
  dabigatrana: "dabigatran", amiodarona: "amiodarone", digoxina: "digoxin",
  omeprazol: "omeprazole", pantoprazol: "pantoprazole", esomeprazol: "esomeprazole",
  ondansetrona: "ondansetron", metoclopramida: "metoclopramide", paracetamol: "acetaminophen",
  tramadol: "tramadol", "codeina": "codeine", morfina: "morphine", fentanil: "fentanyl",
  dexametasona: "dexamethasone", metilprednisolona: "methylprednisolone",
  prednisona: "prednisone", hidrocortisona: "hydrocortisone", ceftriaxona: "ceftriaxone",
  cefepime: "cefepime", cefalexina: "cephalexin", amoxicilina: "amoxicillin",
  "amoxicilina-clavulanato": "amoxicillin clavulanate", azitromicina: "azithromycin",
  claritromicina: "clarithromycin", ciprofloxacino: "ciprofloxacin",
  levofloxacino: "levofloxacin", "piperacilina-tazobactam": "piperacillin tazobactam",
  imipenem: "imipenem", "meropenem": "meropenem", "ertapenem": "ertapenem",
  vancomicina: "vancomycin", teicoplanina: "teicoplanin", oxacilina: "oxacillin",
  metronidazol: "metronidazole", clindamicina: "clindamycin", gentamicina: "gentamicin",
  "sulfametoxazol-trimetoprima": "sulfamethoxazole trimethoprim",
  fluconazol: "fluconazole", "anfotericina b": "amphotericin b", micafungina: "micafungin",
  voriconazol: "voriconazole", levotiroxina: "levothyroxine", salbutamol: "albuterol",
  budesonida: "budesonide", lactulose: "lactulose", aripiprazol: "aripiprazole",
  quetiapina: "quetiapine", haloperidol: "haloperidol", venlafaxina: "venlafaxine",
  sertralina: "sertraline", escitalopram: "escitalopram", alprazolam: "alprazolam",
  clonazepam: "clonazepam", pregabalina: "pregabalin",
};

/** Resolve um texto livre de medicamento para { pt, en } (INN normalizado). */
async function resolverINN(nome) {
  let canonico = String(nome || "").trim();
  try {
    const t = await ontologia.buscarTermo(nome, "medicacao");
    if (t) canonico = t.termo;
  } catch {
    // fallback: usa o próprio nome
  }
  const pt = normalizar(canonico);
  return { pt, en: INN_PT_EN[pt] || pt };
}

/** Consulta o campo drug_interactions da OpenFDA para um INN (inglês). */
async function consultarOpenFDA(innEn) {
  try {
    const url = `${OPENFDA_URL}?search=openfda.generic_name:%22${encodeURIComponent(innEn)}%22&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const data = await r.json();
    const di = data.results?.[0]?.drug_interactions;
    if (!di) return null;
    const texto = Array.isArray(di) ? di.join("\n") : String(di);
    return texto.slice(0, 12_000); // limita o prompt
  } catch {
    return null;
  }
}

/** Extrai a interação A×B do texto bruto da FDA via Anthropic (JSON em PT). */
async function parsearComIA(a, b, textoFda) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const msg = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system:
      "Você é um sistema de extração de dados farmacológicos. Retorne APENAS JSON válido, sem markdown, sem texto extra.",
    messages: [
      {
        role: "user",
        content:
          `Analise o texto de interações medicamentosas (bula FDA, em inglês) e extraia a interação ` +
          `específica entre "${a.pt}" (${a.en}) e "${b.pt}" (${b.en}).\n\nTEXTO FDA:\n${textoFda}\n\n` +
          `Retorne JSON exatamente neste formato:\n` +
          `{"encontrada": true/false, "severidade": "grave"|"moderada"|"leve"|"desconhecida", ` +
          `"mecanismo": "mecanismo em português", "descricao": "descrição clínica em português", ` +
          `"conduta": "manejo em português"}\n` +
          `Se a interação entre os dois não for mencionada, retorne {"encontrada": false}.`,
      },
    ],
  });
  const bloco = msg.content.find((c) => c.type === "text");
  const parsed = bloco ? parseJsonIASeguro(bloco.text, "interacoesFda") : null;
  return parsed && parsed.encontrada ? parsed : null;
}

/** Grava cache negativo (par checado, sem interação relevante) — não reconsulta. */
async function gravarNegativo(a, b) {
  await db.query(
    `INSERT INTO interacoes_medicamentosas (medicamento_a, medicamento_b, severidade, fonte, ativo)
     VALUES ($1,$2,'desconhecida','openfda', FALSE)
     ON CONFLICT (medicamento_a, medicamento_b) DO NOTHING`,
    [a, b],
  );
}

/**
 * Busca a interação do par no cache; em miss, consulta OpenFDA + IA e cacheia.
 * Retorna a linha da interação (ativa) ou null.
 */
async function buscarOuConsultar(a, b) {
  // Par ordenado (idempotência do índice único).
  const [pa, pb] = a.pt <= b.pt ? [a, b] : [b, a];

  const cache = await db.query(
    `SELECT * FROM interacoes_medicamentosas
      WHERE (medicamento_a = $1 AND medicamento_b = $2)
         OR (medicamento_a = $2 AND medicamento_b = $1)
      LIMIT 1`,
    [pa.pt, pb.pt],
  );
  if (cache.rows.length) {
    const row = cache.rows[0];
    return row.ativo ? row : null; // ativo=false → negativo cacheado
  }

  // Miss: tenta a bula de A; se vazia, a de B.
  let texto = await consultarOpenFDA(pa.en);
  if (!texto) texto = await consultarOpenFDA(pb.en);
  if (!texto) {
    await gravarNegativo(pa.pt, pb.pt);
    return null;
  }

  let estruturado = null;
  try {
    estruturado = await parsearComIA(pa, pb, texto);
  } catch (e) {
    console.error(`IA interações (${pa.pt}×${pb.pt}) falhou:`, e.message);
  }
  if (!estruturado) {
    await gravarNegativo(pa.pt, pb.pt);
    return null;
  }

  const ins = await db.query(
    `INSERT INTO interacoes_medicamentosas
       (medicamento_a, medicamento_b, severidade, mecanismo, descricao, conduta_recomendada,
        fonte, texto_bruto_fda, ativo, revisado_em)
     VALUES ($1,$2,$3,$4,$5,$6,'openfda',$7, TRUE, NOW())
     ON CONFLICT (medicamento_a, medicamento_b) DO UPDATE SET
       severidade = EXCLUDED.severidade, mecanismo = EXCLUDED.mecanismo,
       descricao = EXCLUDED.descricao, conduta_recomendada = EXCLUDED.conduta_recomendada,
       fonte = 'openfda', texto_bruto_fda = EXCLUDED.texto_bruto_fda, ativo = TRUE, revisado_em = NOW()
     RETURNING *`,
    [pa.pt, pb.pt, estruturado.severidade || "desconhecida", estruturado.mecanismo || null,
      estruturado.descricao || null, estruturado.conduta || null, texto.slice(0, 8000)],
  );
  return ins.rows[0];
}

function gerarPares(lista) {
  const pares = [];
  for (let i = 0; i < lista.length; i++)
    for (let j = i + 1; j < lista.length; j++) pares.push([lista[i], lista[j]]);
  return pares;
}

/**
 * Verifica interações entre uma lista de medicamentos (resolve INN, gera pares,
 * consulta cache/OpenFDA/IA). Sequencial para respeitar o rate limit da OpenFDA.
 */
async function verificarInteracoes(medicamentos) {
  const lista = (medicamentos || []).map((m) => String(m || "").trim()).filter(Boolean);
  if (lista.length < 2) return [];

  // Resolve e deduplica por INN PT.
  const inns = [];
  const vistos = new Set();
  for (const nome of lista) {
    const r = await resolverINN(nome);
    if (!r.pt || vistos.has(r.pt)) continue;
    vistos.add(r.pt);
    inns.push(r);
  }

  const resultados = [];
  for (const [a, b] of gerarPares(inns)) {
    const row = await buscarOuConsultar(a, b);
    if (row) {
      resultados.push({
        medicamentoA: row.medicamento_a,
        medicamentoB: row.medicamento_b,
        severidade: row.severidade,
        descricao: row.descricao,
        mecanismo: row.mecanismo || null,
        conduta: row.conduta_recomendada || null,
        fonte: row.fonte || "openfda",
      });
    }
  }
  return resultados;
}

/** Enriquece o cache em background (não bloqueia; best-effort). */
function verificarEmBackground(medicamentos) {
  Promise.resolve()
    .then(() => verificarInteracoes(medicamentos))
    .catch((e) => console.error("Enriquecimento de interações falhou:", e.message));
}

module.exports = { verificarInteracoes, verificarEmBackground, resolverINN };
