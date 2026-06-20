/**
 * SEED — Medicamentos registrados na ANVISA (dados abertos) → termos_clinicos.
 *
 * Fonte: ANVISA, "Medicamentos registrados no Brasil" (dados abertos).
 *   CSV: https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
 *   (separador ';', aspas '"', encoding latin1/ISO-8859-1)
 *
 * A API CKAN datastore_search desse host está fora do ar (404), então a fonte
 * primária é o CSV. Pode-se apontar para um CSV local via RENAME_CSV=/caminho.
 *
 * Filtra SITUACAO_REGISTRO 'Ativo'/'Válido' e TIPO_PRODUTO 'MEDICAMENTO'. Para
 * cada princípio ativo (dedup por nome normalizado), faz UPSERT (ON CONFLICT DO
 * NOTHING — não sobrescreve os medicamentos curados com posologia).
 *
 * Rodar a partir de backend/ (o .env está na raiz):
 *   cd ~/Documents/passandocaso/backend
 *   node scripts/seed-rename.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const fs = require("fs");
const { Readable } = require("stream");
const csv = require("csv-parser");

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Garanta o .env na raiz do repo.");
  process.exit(1);
}

const db = require("../db");

const CSV_URL =
  process.env.RENAME_CSV_URL ||
  "https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv";
const CSV_LOCAL = process.env.RENAME_CSV || ""; // opcional: arquivo já baixado

const BATCH = 100;

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapeia a classe terapêutica da ANVISA para a subcategoria do app. */
function subcategoriaDe(classe) {
  const c = normalizar(classe);
  if (!c) return null;
  if (/antibiot|antimicro/.test(c)) return "antibiotico";
  if (/antifung/.test(c)) return "antifungico";
  if (/anticoagul/.test(c)) return "anticoagulante";
  if (/corticoid|glucocort/.test(c)) return "corticoide";
  if (/hipoglicemi|antidiabet/.test(c)) return "hipoglicemiante";
  if (/anti-?hipertens/.test(c)) return "antihipertensivo";
  if (/diuret/.test(c)) return "diuretico";
  if (/analgesi/.test(c)) return "analgesico";
  return classe.trim(); // mantém a classe original
}

const SITUACOES_OK = new Set(["ativo", "valido"]);

/** Lê o CSV como texto latin1 (do arquivo local ou por download). */
async function lerCsvTexto() {
  if (CSV_LOCAL) {
    if (!fs.existsSync(CSV_LOCAL)) throw new Error(`CSV local não encontrado: ${CSV_LOCAL}`);
    console.log(`Lendo CSV local: ${CSV_LOCAL}`);
    return fs.readFileSync(CSV_LOCAL).toString("latin1");
  }
  console.log(`Baixando ${CSV_URL} ...`);
  // Obs.: o host da ANVISA costuma servir cadeia de certificado incompleta (sem o
  // intermediário), o que pode fazer o fetch do Node falhar com
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE. Nesse caso, baixe o arquivo com um cliente
  // que use a CA do sistema (ex.: `curl -o medicamentos.csv <URL>`) e rode com
  // RENAME_CSV=/caminho/medicamentos.csv — sem desabilitar a verificação TLS.
  const r = await fetch(CSV_URL, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Download ANVISA HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString("latin1"); // ANVISA usa ISO-8859-1
}

async function inserirLote(linhas) {
  if (!linhas.length) return 0;
  const valores = [];
  const params = [];
  linhas.forEach((l, i) => {
    const b = i * 5;
    valores.push(
      `($${b + 1}, $${b + 2}, 'medicacao', $${b + 3}, 'ANVISA_RENAME', $${b + 4}, $${b + 5}, TRUE)`,
    );
    params.push(l.termo, l.termoNorm, l.subcategoria, l.sinonimos, l.classe);
  });
  const r = await db.query(
    `INSERT INTO termos_clinicos
       (termo, termo_normalizado, categoria, subcategoria, fonte, sinonimos, classe_farmacologica, ativo)
     VALUES ${valores.join(", ")}
     ON CONFLICT DO NOTHING`,
    params,
  );
  return r.rowCount;
}

async function main() {
  await db.initDB();
  const texto = await lerCsvTexto();
  console.log("Processando registros...");
  const inicio = Date.now();

  let lidas = 0;
  let validas = 0;
  let inseridas = 0;
  const vistos = new Set(); // dedupe por princípio ativo normalizado
  let lote = [];

  const stream = Readable.from(texto).pipe(csv({ separator: ";" }));

  for await (const row of stream) {
    lidas++;
    const tipo = String(row.TIPO_PRODUTO || "").toUpperCase();
    const situacao = normalizar(row.SITUACAO_REGISTRO);
    if (!tipo.includes("MEDICAMENTO")) continue;
    if (!SITUACOES_OK.has(situacao)) continue;

    const principio = String(row.PRINCIPIO_ATIVO || "").trim();
    if (!principio) continue; // sem princípio ativo não há o que indexar
    const termoNorm = normalizar(principio);
    if (termoNorm.length < 3 || vistos.has(termoNorm)) continue;
    vistos.add(termoNorm);

    const nomeProduto = String(row.NOME_PRODUTO || "").trim();
    const classe = String(row.CLASSE_TERAPEUTICA || "").trim();
    lote.push({
      termo: principio.slice(0, 300),
      termoNorm,
      subcategoria: subcategoriaDe(classe),
      classe: classe ? classe.slice(0, 200) : null,
      sinonimos: [nomeProduto, principio].filter(Boolean).map((s) => s.slice(0, 200)),
    });
    validas++;

    if (lote.length >= BATCH) {
      stream.pause();
      inseridas += await inserirLote(lote);
      lote = [];
      if (validas % 1000 === 0) console.log(`[${validas}] princípios processados (${inseridas} novos)...`);
      stream.resume();
    }
  }
  if (lote.length) inseridas += await inserirLote(lote);

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `\nANVISA/RENAME: ${inseridas} princípios novos (${validas} válidos de ${lidas} linhas) em ${seg}s.`,
  );
  const tot = await db.query(
    "SELECT COUNT(*)::int n FROM termos_clinicos WHERE categoria = 'medicacao' AND ativo",
  );
  console.log(`Total de medicamentos ativos na ontologia: ${tot.rows[0].n}.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed ANVISA/RENAME:", e);
  process.exit(1);
});
