/**
 * SEED — Diagnósticos mais comuns da clínica médica via CID-11 (OMS).
 *
 * Para cada termo, consulta a API CID-11 da OMS (em português) e faz cache
 * permanente em termos_clinicos (categoria='diagnostico', fonte='CID11').
 *
 * Requer as credenciais OAuth2 no .env (raiz do repo): ClientId / ClientSecret.
 * Requer DATABASE_URL (Postgres do Railway).
 *
 * Rodar a partir da raiz do repo:
 *   node backend/scripts/seed-cid11.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Rode a partir da raiz do repo.");
  process.exit(1);
}

const db = require("../db");
const icd11 = require("../icd11");
const ontologia = require("../ontologia");

const DIAGNOSTICOS = [
  "hipertensao", "diabetes mellitus tipo 2", "insuficiencia cardiaca",
  "pneumonia", "sepse", "infeccao urinaria", "avc", "dpoc",
  "cirrose", "fibrilacao atrial", "tvp", "tep", "ira",
  "pancreatite", "anemia", "hipotireoidismo", "neoplasia",
  "meningite", "endocardite", "pielonefrite",
  "hipertensao portal", "ascite", "encefalopatia hepatica",
  "sindrome coronariana aguda", "iam", "angina",
  "insuficiencia renal cronica", "sindrome nefrotica",
  "hepatite", "colangite", "colecistite",
  "obstrucao intestinal", "peritonite", "apendicite",
  "tromboembolismo pulmonar", "derrame pleural",
  "derrame pericardico", "tamponamento cardiaco",
  "acidente vascular cerebral isquemico", "hemorragia subaracnoidea",
  "meningite bacteriana", "encefalite",
  "diabetes tipo 1", "cetoacidose diabetica",
  "hipoglicemia", "hiperglicemia hiperosmolar",
  "hipercalemia", "hipocalemia", "hiponatremia", "hipernatremia",
  "alcalose metabolica", "acidose metabolica",
  "choque septico", "choque cardiogenico", "choque hipovolemico",
  "insuficiencia respiratoria", "sindrome do desconforto respiratorio",
  "edema agudo de pulmao", "broncoespasmo",
  "tuberculose", "covid", "influenza",
  "infeccao por hiv", "candidemia", "aspergilose",
  "linfoma", "leucemia", "mieloma multiplo",
  "artrite reumatoide", "lupus eritematoso sistemico",
  "vasculite", "esclerodermia",
  "doenca de crohn", "retocolite ulcerativa",
  "sangramento digestivo alto", "sangramento digestivo baixo",
  "varizes esofagianas", "sindrome hepatorrenal",
  "trombose venosa profunda", "embolia pulmonar",
  "endocardite infecciosa", "miocardite", "pericardite",
  "arritmia", "bloqueio atrioventricular",
  "anemia falciforme", "trombocitopenia",
  "coagulacao intravascular disseminada",
  "rabdomiolise", "miopatia", "neuropatia",
  "delirium", "demencia", "epilepsia",
  "fratura", "osteomielite", "artrite septica",
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await db.initDB();
  if (!icd11.temCredenciais()) {
    console.error("✗ Credenciais CID-11 ausentes no .env (ClientId/ClientSecret).");
    await db.pool.end();
    process.exit(1);
  }

  let ok = 0;
  let semResultado = 0;
  let falhas = 0;
  const total = DIAGNOSTICOS.length;

  for (let i = 0; i < total; i++) {
    const termo = DIAGNOSTICOS[i];
    try {
      const r = await icd11.buscarCid11(termo);
      if (r && (r.cid11 || r.titulo)) {
        await ontologia.salvarDiagnosticoCid11(termo, r);
        ok++;
        console.log(`[${i + 1}/${total}] ${termo} → ${r.cid11 || "—"} · ${r.titulo}`);
      } else {
        semResultado++;
        console.log(`[${i + 1}/${total}] ${termo} → sem resultado`);
      }
    } catch (e) {
      falhas++;
      console.warn(`[${i + 1}/${total}] ${termo} → falha: ${e.message}`);
    }
    await dormir(250); // educado com a API da OMS
  }

  console.log(
    `\nCID-11: ${ok} diagnósticos salvos, ${semResultado} sem resultado, ${falhas} falhas (de ${total}).`,
  );
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed CID-11:", e);
  process.exit(1);
});
