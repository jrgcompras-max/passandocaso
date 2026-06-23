/**
 * SEED — Valores de referência laboratorial (ABIM 2026).
 *
 * Fonte pública: ABIM (American Board of Internal Medicine) — Laboratory
 * Reference Ranges, janeiro 2026. Popula a tabela `labs_referencia`.
 *
 * Idempotente: apaga as linhas da fonte "ABIM 2026" e reinsere. Rodar a partir
 * da RAIZ do repo (p/ o dotenv achar o .env com DATABASE_URL):
 *   node backend/scripts/seed-labs-referencia.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ DATABASE_URL ausente. Rode a partir da raiz do repo (node backend/scripts/seed-labs-referencia.js).",
  );
  process.exit(1);
}

const db = require("../db");

const FONTE = "ABIM 2026";

// [codigo, nome, sexo, valor_min, valor_max, unidade]
const REFERENCIAS = [
  // HEMOGRAMA
  ["Hb", "Hemoglobina", "F", 12.0, 16.0, "g/dL"],
  ["Hb", "Hemoglobina", "M", 13.5, 17.5, "g/dL"],
  ["Ht", "Hematócrito", "F", 36.0, 46.0, "%"],
  ["Ht", "Hematócrito", "M", 41.0, 53.0, "%"],
  ["LT", "Leucócitos", "ambos", 4500, 11000, "/mm³"],
  ["Plaq", "Plaquetas", "ambos", 150000, 400000, "/mm³"],
  ["Bast", "Bastões", "ambos", 0, 700, "/mm³"],
  ["Seg", "Segmentados", "ambos", 1800, 7700, "/mm³"],
  ["Linf", "Linfócitos", "ambos", 1200, 4950, "/mm³"],
  ["Monó", "Monócitos", "ambos", 0, 660, "/mm³"],
  ["Eos", "Eosinófilos", "ambos", 0, 330, "/mm³"],
  ["Basóf", "Basófilos", "ambos", 0, 110, "/mm³"],
  ["RDW", "RDW", "ambos", 11.5, 14.5, "%"],
  ["VCM", "VCM", "ambos", 80.0, 100.0, "fL"],
  ["HCM", "HCM", "ambos", 27.0, 33.0, "pg"],
  ["CHCM", "CHCM", "ambos", 32.0, 36.0, "g/dL"],
  // BIOQUÍMICA
  ["PCR", "Proteína C Reativa", "ambos", 0, 8.0, "mg/L"],
  ["Cr", "Creatinina", "F", 0.5, 1.1, "mg/dL"],
  ["Cr", "Creatinina", "M", 0.7, 1.3, "mg/dL"],
  ["U", "Ureia", "ambos", 15.0, 40.0, "mg/dL"],
  ["K", "Potássio", "ambos", 3.5, 5.0, "mEq/L"],
  ["Na", "Sódio", "ambos", 136.0, 145.0, "mEq/L"],
  ["Mg", "Magnésio", "ambos", 1.7, 2.2, "mg/dL"],
  ["Ca", "Cálcio", "ambos", 8.6, 10.2, "mg/dL"],
  ["Cl", "Cloretos", "ambos", 98.0, 106.0, "mEq/L"],
  ["Glic", "Glicemia", "ambos", 70.0, 99.0, "mg/dL"],
  // FUNÇÃO HEPÁTICA
  ["TGO", "TGO/AST", "ambos", 10.0, 40.0, "U/L"],
  ["TGP", "TGP/ALT", "ambos", 10.0, 40.0, "U/L"],
  ["FA", "Fosfatase Alcalina", "ambos", 30.0, 120.0, "U/L"],
  ["GGT", "GGT", "F", 7.0, 45.0, "U/L"],
  ["GGT", "GGT", "M", 10.0, 71.0, "U/L"],
  ["BT", "Bilirrubina Total", "ambos", 0.3, 1.0, "mg/dL"],
  ["BD", "Bilirrubina Direta", "ambos", 0.1, 0.3, "mg/dL"],
  ["BI", "Bilirrubina Indireta", "ambos", 0.2, 0.7, "mg/dL"],
  ["Alb", "Albumina", "ambos", 3.5, 5.5, "g/dL"],
  ["LDH", "LDH", "ambos", 100.0, 190.0, "U/L"],
  // COAGULAÇÃO
  ["INR", "INR", "ambos", 0.8, 1.2, ""],
  ["TAP", "TAP", "ambos", 11.0, 13.5, "segundos"],
  ["TTPA", "TTPA", "ambos", 25.0, 35.0, "segundos"],
  ["Fibr", "Fibrinogênio", "ambos", 200.0, 400.0, "mg/dL"],
  // OUTROS
  ["VHS", "VHS", "F", 0, 20.0, "mm/h"],
  ["VHS", "VHS", "M", 0, 15.0, "mm/h"],
  ["Lact", "Lactato", "ambos", 0.5, 2.2, "mmol/L"],
  ["AlfaFP", "Alfa-fetoproteína", "ambos", 0, 10.0, "ng/mL"],
  ["PCRus", "PCR ultrassensível", "ambos", 0, 3.0, "mg/L"],
  // GASOMETRIA
  ["pH", "pH arterial", "ambos", 7.38, 7.44, ""],
  ["PaCO2", "PaCO2", "ambos", 38.0, 42.0, "mmHg"],
  ["PaO2", "PaO2", "ambos", 75.0, 100.0, "mmHg"],
  ["HCO3", "Bicarbonato", "ambos", 23.0, 26.0, "mEq/L"],
  ["SatO2", "Saturação O2", "ambos", 95.0, 100.0, "%"],
  // LÍQUOR
  ["Glic LCR", "Glicose LCR", "ambos", 45.0, 80.0, "mg/dL"],
  ["Prot LCR", "Proteínas LCR", "ambos", 15.0, 45.0, "mg/dL"],
  ["Cel Nuc LCR", "Células LCR", "ambos", 0, 5.0, "/μL"],
];

async function main() {
  // Idempotente: remove as referências da mesma fonte antes de reinserir.
  await db.query("DELETE FROM labs_referencia WHERE fonte = $1", [FONTE]);

  for (const [codigo, nome, sexo, min, max, unidade] of REFERENCIAS) {
    await db.query(
      `INSERT INTO labs_referencia (codigo, nome, sexo, valor_min, valor_max, unidade, fonte)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [codigo, nome, sexo, min, max, unidade, FONTE],
    );
  }

  console.log(`✓ ${REFERENCIAS.length} referências (${FONTE}) inseridas.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Erro no seed:", e.message);
  process.exit(1);
});
