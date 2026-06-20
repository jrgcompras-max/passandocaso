/**
 * SEED — Importa o LOINC 2.82 (LoincTableCore.csv) para termos_clinicos.
 *
 * Lê o CSV LOCAL do Mac em streaming (arquivo ~25 MB, ~90 mil linhas) e faz
 * UPSERT no PostgreSQL do Railway via DATABASE_URL do .env. Filtra apenas
 * exames laboratoriais quantitativos e ativos das classes de interesse
 * (~15 mil termos), enriquecendo a ontologia de exames já semeada à mão.
 *
 * Posicionamento regulatório: importa SOMENTE nomenclatura oficial do LOINC
 * (códigos + nomes). Não cria faixas de referência próprias — essas continuam
 * vindo do seed curado (seed-ontologia.js).
 *
 * Observação: o LoincTableCore.csv NÃO traz a coluna de unidade
 * (EXAMPLE_UCUM_UNITS fica em outra tabela do pacote LOINC); por isso a unidade
 * é importada como NULL quando ausente.
 *
 * Pré-requisitos:
 *   npm install csv-parser   (já feito)
 *   arquivo local em ~/Downloads/Loinc_2.82/LoincTableCore/LoincTableCore.csv
 *
 * Rodar a partir de backend/ (o .env com DATABASE_URL está na raiz do repo):
 *   cd ~/Documents/passandocaso/backend
 *   node scripts/seed-loinc-csv.js
 *
 * O CSV não vai para o git (Loinc_2.82/ está no .gitignore).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const fs = require("fs");
const os = require("os");
const path = require("path");
const csv = require("csv-parser");

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Garanta o .env na raiz do repo.");
  process.exit(1);
}

const db = require("../db");

// Caminho do CSV local (expande o ~ para o HOME do usuário).
const CSV_PATH =
  process.env.LOINC_CSV ||
  path.join(os.homedir(), "Downloads/Loinc_2.82/LoincTableCore/LoincTableCore.csv");

// Classes do LOINC que interessam à clínica médica (match por substring no CLASS).
const CLASSES_OK = ["CHEM", "HEM/BC", "COAG", "MICRO", "SER", "UA", "DRUG/TOX", "CARD", "HEP", "ALLERGY"];

const BATCH = 100;

/** Normaliza: minúsculas, sem acentos, espaços colapsados. */
function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Decide se a linha do LOINC deve ser importada. */
function relevante(row) {
  const classe = String(row.CLASS || "").toUpperCase();
  const escala = String(row.SCALE_TYP || "").trim();
  const status = String(row.STATUS || "").trim().toUpperCase();
  if (escala !== "Qn") return false;
  if (status !== "ACTIVE") return false;
  return CLASSES_OK.some((c) => classe.includes(c));
}

/**
 * Insere um lote de até BATCH linhas com um único INSERT multi-row.
 * ON CONFLICT DO NOTHING ignora termos já presentes (do seed curado ou de lotes
 * anteriores). Linhas: [termo, termo_normalizado, subcategoria, unidade, loinc].
 */
async function inserirLote(linhas) {
  if (!linhas.length) return 0;
  const valores = [];
  const params = [];
  linhas.forEach((l, i) => {
    const b = i * 5;
    // categoria fixa 'exame_lab', fonte 'LOINC_2.82', sinonimos = [termo, termo_normalizado], ativo TRUE.
    valores.push(
      `($${b + 1}, $${b + 2}, 'exame_lab', $${b + 3}, $${b + 4}, $${b + 5}, 'LOINC_2.82', ARRAY[$${b + 1}, $${b + 2}], TRUE)`,
    );
    params.push(l.termo, l.termoNorm, l.subcategoria, l.unidade, l.loinc);
  });
  const r = await db.query(
    `INSERT INTO termos_clinicos
       (termo, termo_normalizado, categoria, subcategoria, unidade, loinc, fonte, sinonimos, ativo)
     VALUES ${valores.join(", ")}
     ON CONFLICT DO NOTHING`,
    params,
  );
  return r.rowCount;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`✗ CSV não encontrado: ${CSV_PATH}`);
    console.error("  Ajuste o caminho ou defina LOINC_CSV=/caminho/para/LoincTableCore.csv");
    process.exit(1);
  }

  await db.initDB(); // garante a tabela termos_clinicos (idempotente)
  console.log(`Lendo ${CSV_PATH} ...`);
  const inicio = Date.now();

  let lidas = 0; // linhas do CSV percorridas
  let filtradas = 0; // linhas que passaram no filtro (após dedupe interno)
  let inseridas = 0; // efetivamente inseridas (excl. conflitos)
  const vistos = new Set(); // dedupe por termo_normalizado dentro desta importação
  let lote = [];

  const stream = fs.createReadStream(CSV_PATH).pipe(csv());

  for await (const row of stream) {
    lidas++;
    if (!relevante(row)) continue;

    const loinc = String(row.LOINC_NUM || "").trim();
    const longo = String(row.LONG_COMMON_NAME || "").trim();
    const termoNorm = normalizar(longo);
    if (!loinc || !termoNorm) continue;
    // Dedupe pela chave do índice único (termo_normalizado, categoria, contexto).
    if (vistos.has(termoNorm)) continue;
    vistos.add(termoNorm);

    lote.push({
      termo: (String(row.SHORTNAME || "").trim() || longo).slice(0, 200),
      termoNorm,
      subcategoria: String(row.CLASS || "").trim() || null,
      unidade: String(row.EXAMPLE_UCUM_UNITS || "").trim() || null, // ausente no Core → NULL
      loinc,
    });
    filtradas++;

    if (lote.length >= BATCH) {
      // Backpressure: pausa o stream enquanto grava o lote no banco.
      stream.pause();
      inseridas += await inserirLote(lote);
      lote = [];
      console.log(`[${filtradas}/~15000] termos processados (${inseridas} novos)...`);
      stream.resume();
    }
  }

  if (lote.length) inseridas += await inserirLote(lote);

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `\nLOINC importado: ${inseridas} termos novos (${filtradas} relevantes de ${lidas} linhas) em ${seg}s.`,
  );
  const tot = await db.query(
    "SELECT COUNT(*)::int n FROM termos_clinicos WHERE categoria = 'exame_lab' AND ativo",
  );
  console.log(`Total de exames laboratoriais ativos na ontologia: ${tot.rows[0].n}.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha na importação do LOINC:", e);
  process.exit(1);
});
