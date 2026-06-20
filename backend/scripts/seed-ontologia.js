/**
 * SEED — Ontologia clínica (termos normalizados, classes e referências).
 *
 * Conjunto curado dos termos mais comuns da clínica médica brasileira, com
 * foco em precisão das REFERÊNCIAS laboratoriais (LOINC + faixas) e classes
 * de medicamentos. É uma FUNDAÇÃO extensível: termos novos detectados na
 * extração entram com fonte='novo'/ativo=false para revisão (feedback loop).
 *
 * Rodar a partir da RAIZ do repo (p/ o dotenv achar o .env com DATABASE_URL):
 *   node backend/scripts/seed-ontologia.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ DATABASE_URL ausente. Rode a partir da raiz do repo (node backend/scripts/" +
      "seed-ontologia.js) apontando para o Postgres do Railway.",
  );
  process.exit(1);
}

const db = require("../db");

/** Normaliza: minúsculas, sem acentos, espaços colapsados. */
function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── COMORBIDADES (CID-10) ───────────────────────────────────────────────────
const COMORBIDADES = [
  ["Hipertensão Arterial Sistêmica", "I10", ["HAS", "hipertensão", "pressão alta", "hipertensao"]],
  ["Diabetes Mellitus tipo 2", "E11", ["DM2", "diabetes tipo 2", "diabetes mellitus 2"]],
  ["Diabetes Mellitus tipo 1", "E10", ["DM1", "diabetes tipo 1"]],
  ["Insuficiência Cardíaca Congestiva", "I50", ["ICC", "insuficiência cardíaca", "IC", "ICFER", "ICFEP"]],
  ["Doença Pulmonar Obstrutiva Crônica", "J44", ["DPOC", "enfisema", "bronquite crônica"]],
  ["Fibrilação Atrial", "I48", ["FA", "fibrilacao atrial", "fibrilação"]],
  ["Doença Renal Crônica", "N18", ["IRC", "DRC", "insuficiência renal crônica", "doença renal crônica"]],
  ["Hipotireoidismo", "E03", ["hipotireoidismo"]],
  ["Hipertireoidismo", "E05", ["hipertireoidismo"]],
  ["Dislipidemia", "E78", ["dislipidemia", "colesterol alto", "hipercolesterolemia"]],
  ["Obesidade", "E66", ["obesidade", "obeso"]],
  ["Acidente Vascular Cerebral prévio", "I64", ["AVE", "AVC", "AVC prévio", "AVE prévio", "derrame"]],
  ["Tromboembolismo Pulmonar prévio", "I26", ["TEP", "TEP prévio", "embolia pulmonar"]],
  ["Trombose Venosa Profunda prévia", "I80", ["TVP", "TVP prévia", "trombose"]],
  ["Cirrose hepática", "K74", ["cirrose", "cirrose hepática"]],
  ["Hepatite C crônica", "B18.2", ["hepatite C", "HCV"]],
  ["Hepatite B crônica", "B18.1", ["hepatite B", "HBV"]],
  ["Infecção pelo HIV", "B24", ["HIV", "AIDS", "SIDA"]],
  ["Neoplasia maligna", "C80", ["neoplasia", "câncer", "ca", "tumor maligno"]],
  ["Asma", "J45", ["asma", "asmático"]],
  ["Epilepsia", "G40", ["epilepsia", "convulsão"]],
  ["Doença de Parkinson", "G20", ["parkinson"]],
  ["Demência", "F03", ["demência", "alzheimer"]],
  ["Transtorno depressivo", "F32", ["depressão", "transtorno depressivo", "TDM"]],
  ["Transtorno de ansiedade", "F41", ["ansiedade", "TAG"]],
  ["Insuficiência Coronariana", "I25", ["DAC", "doença arterial coronariana", "insuficiência coronariana"]],
  ["Infarto Agudo do Miocárdio prévio", "I25.2", ["IAM prévio", "infarto prévio"]],
  ["Doença Arterial Periférica", "I73.9", ["DAP", "doença arterial periférica"]],
  ["Anemia", "D64", ["anemia", "anêmico"]],
  ["Hiperplasia Prostática Benigna", "N40", ["HPB", "hiperplasia prostática"]],
  ["Gota", "M10", ["gota", "hiperuricemia"]],
  ["Artrite Reumatoide", "M06", ["artrite reumatoide", "AR"]],
  ["Lúpus Eritematoso Sistêmico", "M32", ["LES", "lúpus"]],
  ["Hipotireoidismo subclínico", "E03.9", ["hipotireoidismo subclínico"]],
  ["Osteoporose", "M81", ["osteoporose"]],
  ["Tabagismo", "F17", ["tabagismo", "tabagista", "fumante"]],
  ["Etilismo", "F10", ["etilismo", "alcoolismo", "etilista"]],
  ["Esteatose hepática", "K76.0", ["esteatose", "esteatose hepática", "DHGNA"]],
  ["Refluxo gastroesofágico", "K21", ["DRGE", "refluxo"]],
  ["Glaucoma", "H40", ["glaucoma"]],
];

// ── EXAMES LABORATORIAIS (LOINC + referências) ──────────────────────────────
// [nome, loinc, unidade, refMin, refMax, contexto?, sinonimos]
const LABS = [
  ["Hemoglobina", "718-7", "g/dL", 13, 17, "masculino", ["Hb", "hemoglobina"]],
  ["Hemoglobina", "718-7", "g/dL", 12, 16, "feminino", ["Hb", "hemoglobina"]],
  ["Hematócrito", "20570-8", "%", 40, 52, "masculino", ["Ht", "hematócrito", "hematocrito"]],
  ["Hematócrito", "20570-8", "%", 36, 47, "feminino", ["Ht", "hematócrito", "hematocrito"]],
  ["Leucócitos", "6690-2", "/mm³", 4000, 10000, null, ["leucócitos", "leucocitos", "LT", "global de leucócitos"]],
  ["Plaquetas", "777-3", "/mm³", 150000, 400000, null, ["plaquetas", "plaq", "PLT"]],
  ["Proteína C Reativa", "1988-5", "mg/L", 0, 5, null, ["PCR", "proteína C reativa", "proteina c reativa"]],
  ["Creatinina", "2160-0", "mg/dL", 0.7, 1.2, "masculino", ["creatinina", "cr", "creat"]],
  ["Creatinina", "2160-0", "mg/dL", 0.5, 1.0, "feminino", ["creatinina", "cr", "creat"]],
  ["Ureia", "3091-6", "mg/dL", 10, 50, null, ["ureia", "uréia", "U"]],
  ["Sódio", "2951-2", "mEq/L", 135, 145, null, ["sódio", "sodio", "Na"]],
  ["Potássio", "2823-3", "mEq/L", 3.5, 5.0, null, ["potássio", "potassio", "K"]],
  ["Cloreto", "2075-0", "mEq/L", 98, 107, null, ["cloreto", "Cl"]],
  ["Magnésio", "2601-3", "mg/dL", 1.7, 2.4, null, ["magnésio", "magnesio", "Mg"]],
  ["Cálcio total", "17861-6", "mg/dL", 8.5, 10.5, null, ["cálcio", "calcio", "Ca"]],
  ["Cálcio iônico", "1995-0", "mmol/L", 1.1, 1.35, null, ["cálcio iônico", "calcio ionico", "Ca++"]],
  ["Fósforo", "2777-1", "mg/dL", 2.5, 4.5, null, ["fósforo", "fosforo", "P"]],
  ["AST/TGO", "1920-8", "U/L", 0, 40, null, ["TGO", "AST", "transaminase oxalacética"]],
  ["ALT/TGP", "1742-6", "U/L", 0, 41, null, ["TGP", "ALT", "transaminase pirúvica"]],
  ["Gama-GT", "2324-2", "U/L", 8, 61, null, ["GGT", "gama GT", "gama-glutamil"]],
  ["Fosfatase Alcalina", "6768-6", "U/L", 40, 129, null, ["FA", "fosfatase alcalina"]],
  ["Bilirrubina total", "1975-2", "mg/dL", 0.3, 1.2, null, ["bilirrubina total", "BT", "bilirrubina"]],
  ["Bilirrubina direta", "1968-7", "mg/dL", 0, 0.3, null, ["bilirrubina direta", "BD"]],
  ["Albumina", "1751-7", "g/dL", 3.5, 5.0, null, ["albumina"]],
  ["Amilase", "1798-8", "U/L", 28, 100, null, ["amilase"]],
  ["Lipase", "3040-3", "U/L", 13, 60, null, ["lipase"]],
  ["Glicemia de jejum", "2345-7", "mg/dL", 70, 99, null, ["glicemia", "glicose", "glicemia de jejum"]],
  ["Hemoglobina glicada", "4548-4", "%", 0, 5.7, null, ["HbA1c", "hemoglobina glicada", "glicada"]],
  ["INR", "6301-6", "", 0.8, 1.2, null, ["INR", "RNI", "TAP INR"]],
  ["TTPA", "3173-2", "seg", 25, 35, null, ["TTPA", "TTPa", "tempo de tromboplastina"]],
  ["Troponina", "6598-7", "ng/mL", 0, 0.04, null, ["troponina", "TnI", "TnT"]],
  ["CK-MB", "13969-1", "ng/mL", 0, 5, null, ["CKMB", "CK-MB"]],
  ["CPK", "2157-6", "U/L", 26, 192, null, ["CPK", "CK", "creatinofosfoquinase"]],
  ["BNP", "30604-8", "pg/mL", 0, 100, null, ["BNP"]],
  ["NT-proBNP", "33762-6", "pg/mL", 0, 125, null, ["NT-proBNP", "proBNP"]],
  ["Procalcitonina", "75241-0", "ng/mL", 0, 0.5, null, ["procalcitonina", "PCT"]],
  ["D-dímero", "48065-7", "ng/mL", 0, 500, null, ["D-dímero", "d dimero", "dimero"]],
  ["Lactato", "2524-7", "mmol/L", 0.5, 2.2, null, ["lactato"]],
  ["TSH", "3016-3", "µUI/mL", 0.4, 4.5, null, ["TSH"]],
  ["T4 livre", "3024-7", "ng/dL", 0.9, 1.7, null, ["T4 livre", "T4L"]],
  ["Ferritina", "2276-4", "ng/mL", 30, 400, null, ["ferritina"]],
  ["VHS", "4537-7", "mm/h", 0, 20, null, ["VHS", "velocidade de hemossedimentação"]],
  ["Ácido úrico", "3084-1", "mg/dL", 3.4, 7.0, null, ["ácido úrico", "acido urico"]],
  ["Bicarbonato", "1963-8", "mEq/L", 22, 26, null, ["bicarbonato", "HCO3"]],
  ["pH arterial", "2744-1", "", 7.35, 7.45, null, ["pH", "pH arterial"]],
  ["pCO2", "2019-8", "mmHg", 35, 45, null, ["pCO2", "PCO2"]],
  ["pO2", "2703-7", "mmHg", 80, 100, null, ["pO2", "PO2"]],
  ["Colesterol total", "2093-3", "mg/dL", 0, 190, null, ["colesterol total", "CT"]],
  ["LDL", "2089-1", "mg/dL", 0, 130, null, ["LDL", "LDL-c"]],
  ["HDL", "2085-9", "mg/dL", 40, 60, null, ["HDL", "HDL-c"]],
  ["Triglicerídeos", "2571-8", "mg/dL", 0, 150, null, ["triglicerídeos", "triglicerides", "TG"]],
];

// ── MEDICAMENTOS (classe / subclasse) ───────────────────────────────────────
// [nome, subcategoria, classe_farmacologica, sinonimos]
const MEDS = [
  ["Metformina", "hipoglicemiante", "biguanida", ["metformina", "glifage"]],
  ["Insulina NPH", "hipoglicemiante", "insulina", ["NPH", "insulina NPH"]],
  ["Insulina Regular", "hipoglicemiante", "insulina", ["insulina regular", "regular"]],
  ["Gliclazida", "hipoglicemiante", "sulfonilureia", ["gliclazida"]],
  ["Empagliflozina", "hipoglicemiante", "iSGLT2", ["empagliflozina", "jardiance"]],
  ["Dapagliflozina", "hipoglicemiante", "iSGLT2", ["dapagliflozina", "forxiga"]],
  ["Losartana", "antihipertensivo", "BRA", ["losartana"]],
  ["Valsartana", "antihipertensivo", "BRA", ["valsartana"]],
  ["Enalapril", "antihipertensivo", "IECA", ["enalapril"]],
  ["Captopril", "antihipertensivo", "IECA", ["captopril"]],
  ["Anlodipino", "antihipertensivo", "bloqueador de canal de cálcio", ["anlodipino", "amlodipina"]],
  ["Hidroclorotiazida", "diuretico", "tiazídico", ["hidroclorotiazida", "HCTZ"]],
  ["Furosemida", "diuretico", "diurético de alça", ["furosemida", "lasix"]],
  ["Espironolactona", "diuretico", "poupador de potássio", ["espironolactona", "aldactone"]],
  ["Carvedilol", "betabloqueador", "betabloqueador", ["carvedilol"]],
  ["Metoprolol", "betabloqueador", "betabloqueador", ["metoprolol", "succinato de metoprolol"]],
  ["Atenolol", "betabloqueador", "betabloqueador", ["atenolol"]],
  ["Propranolol", "betabloqueador", "betabloqueador", ["propranolol"]],
  ["Atorvastatina", "estatina", "estatina", ["atorvastatina"]],
  ["Sinvastatina", "estatina", "estatina", ["sinvastatina"]],
  ["Rosuvastatina", "estatina", "estatina", ["rosuvastatina"]],
  ["AAS", "antiagregante", "antiagregante plaquetário", ["AAS", "aspirina", "ácido acetilsalicílico"]],
  ["Clopidogrel", "antiagregante", "antiagregante plaquetário", ["clopidogrel", "plavix"]],
  ["Varfarina", "anticoagulante", "antagonista da vitamina K", ["varfarina", "marevan"]],
  ["Enoxaparina", "anticoagulante", "HBPM", ["enoxaparina", "clexane"]],
  ["Heparina", "anticoagulante", "heparina não fracionada", ["heparina", "HNF"]],
  ["Rivaroxabana", "anticoagulante", "DOAC", ["rivaroxabana", "xarelto"]],
  ["Apixabana", "anticoagulante", "DOAC", ["apixabana", "eliquis"]],
  ["Dabigatrana", "anticoagulante", "DOAC", ["dabigatrana", "pradaxa"]],
  ["Amiodarona", "antiarritmico", "antiarrítmico", ["amiodarona"]],
  ["Digoxina", "cardiotonico", "glicosídeo cardíaco", ["digoxina"]],
  ["Omeprazol", "protetor_gastrico", "IBP", ["omeprazol"]],
  ["Pantoprazol", "protetor_gastrico", "IBP", ["pantoprazol"]],
  ["Esomeprazol", "protetor_gastrico", "IBP", ["esomeprazol"]],
  ["Ondansetrona", "antiemetico", "antagonista 5-HT3", ["ondansetrona", "vonau"]],
  ["Metoclopramida", "antiemetico", "procinético", ["metoclopramida", "plasil"]],
  ["Bromoprida", "antiemetico", "procinético", ["bromoprida", "digesan"]],
  ["Dipirona", "analgesico", "analgésico não opioide", ["dipirona", "novalgina"]],
  ["Paracetamol", "analgesico", "analgésico não opioide", ["paracetamol", "tylenol"]],
  ["Tramadol", "analgesico", "opioide fraco", ["tramadol"]],
  ["Codeína", "analgesico", "opioide fraco", ["codeína", "codeina"]],
  ["Morfina", "analgesico", "opioide forte", ["morfina"]],
  ["Fentanil", "analgesico", "opioide forte", ["fentanil", "fentanila"]],
  ["Dexametasona", "corticoide", "corticosteroide", ["dexametasona", "decadron"]],
  ["Metilprednisolona", "corticoide", "corticosteroide", ["metilprednisolona", "solumedrol"]],
  ["Prednisona", "corticoide", "corticosteroide", ["prednisona"]],
  ["Hidrocortisona", "corticoide", "corticosteroide", ["hidrocortisona"]],
  ["Ceftriaxona", "antibiotico", "cefalosporina 3ª geração", ["ceftriaxona", "rocefin"]],
  ["Cefepime", "antibiotico", "cefalosporina 4ª geração", ["cefepime", "cefepima"]],
  ["Cefalexina", "antibiotico", "cefalosporina 1ª geração", ["cefalexina"]],
  ["Amoxicilina", "antibiotico", "penicilina", ["amoxicilina"]],
  ["Amoxicilina-Clavulanato", "antibiotico", "penicilina + inibidor de β-lactamase", ["amoxicilina-clavulanato", "clavulin"]],
  ["Ampicilina-Sulbactam", "antibiotico", "penicilina + inibidor de β-lactamase", ["ampicilina-sulbactam", "unasyn"]],
  ["Azitromicina", "antibiotico", "macrolídeo", ["azitromicina"]],
  ["Claritromicina", "antibiotico", "macrolídeo", ["claritromicina"]],
  ["Ciprofloxacino", "antibiotico", "fluoroquinolona", ["ciprofloxacino", "cipro"]],
  ["Levofloxacino", "antibiotico", "fluoroquinolona", ["levofloxacino"]],
  ["Piperacilina-Tazobactam", "antibiotico", "penicilina antipseudomonas", ["piperacilina-tazobactam", "tazocin"]],
  ["Imipenem", "antibiotico", "carbapenêmico", ["imipenem"]],
  ["Meropeném", "antibiotico", "carbapenêmico", ["meropeném", "meropenem"]],
  ["Ertapeném", "antibiotico", "carbapenêmico", ["ertapeném", "ertapenem"]],
  ["Vancomicina", "antibiotico", "glicopeptídeo", ["vancomicina"]],
  ["Teicoplanina", "antibiotico", "glicopeptídeo", ["teicoplanina"]],
  ["Oxacilina", "antibiotico", "penicilina antiestafilocócica", ["oxacilina"]],
  ["Metronidazol", "antibiotico", "nitroimidazol", ["metronidazol", "flagyl"]],
  ["Clindamicina", "antibiotico", "lincosamida", ["clindamicina"]],
  ["Gentamicina", "antibiotico", "aminoglicosídeo", ["gentamicina"]],
  ["Sulfametoxazol-Trimetoprima", "antibiotico", "sulfonamida", ["sulfametoxazol-trimetoprima", "bactrim", "SMX-TMP"]],
  ["Polimixina B", "antibiotico", "polimixina", ["polimixina B", "polimixina"]],
  ["Fluconazol", "antifungico", "azol", ["fluconazol"]],
  ["Anfotericina B", "antifungico", "polieno", ["anfotericina B", "anfotericina"]],
  ["Micafungina", "antifungico", "equinocandina", ["micafungina"]],
  ["Voriconazol", "antifungico", "azol", ["voriconazol"]],
  ["Levotiroxina", "hormonio", "hormônio tireoidiano", ["levotiroxina", "puran", "T4"]],
  ["Salbutamol", "broncodilatador", "β2-agonista de curta ação", ["salbutamol", "aerolin"]],
  ["Brometo de ipratrópio", "broncodilatador", "anticolinérgico", ["brometo de ipratrópio", "atrovent"]],
  ["Budesonida", "corticoide_inalatorio", "corticosteroide inalatório", ["budesonida"]],
  ["Tramadol", "analgesico", "opioide fraco", ["tramadol"]],
  ["Lactulose", "laxativo", "laxante osmótico", ["lactulose"]],
  ["Aripiprazol", "antipsicotico", "antipsicótico atípico", ["aripiprazol"]],
  ["Quetiapina", "antipsicotico", "antipsicótico atípico", ["quetiapina"]],
  ["Haloperidol", "antipsicotico", "antipsicótico típico", ["haloperidol", "haldol"]],
  ["Venlafaxina", "antidepressivo", "IRSN", ["venlafaxina"]],
  ["Sertralina", "antidepressivo", "ISRS", ["sertralina"]],
  ["Escitalopram", "antidepressivo", "ISRS", ["escitalopram"]],
  ["Alprazolam", "ansiolitico", "benzodiazepínico", ["alprazolam", "frontal"]],
  ["Clonazepam", "ansiolitico", "benzodiazepínico", ["clonazepam", "rivotril"]],
  ["Pregabalina", "anticonvulsivante", "análogo do GABA", ["pregabalina", "lyrica"]],
];

// ── EXAMES DE IMAGEM ────────────────────────────────────────────────────────
// [nome, sinonimos]
const IMAGENS = [
  ["TC de crânio", ["TC de crânio", "tomografia de crânio", "TC crânio"]],
  ["RM de crânio", ["RM de crânio", "ressonância de crânio", "RNM crânio"]],
  ["TC de tórax", ["TC de tórax", "tomografia de tórax"]],
  ["RX de tórax", ["RX de tórax", "radiografia de tórax", "raio-x de tórax", "raio x torax"]],
  ["TC de abdome", ["TC de abdome", "tomografia de abdome", "TC abdome total"]],
  ["RM de abdome", ["RM de abdome", "ressonância de abdome"]],
  ["USG de abdome", ["USG de abdome", "ultrassom de abdome", "ultrassonografia abdominal"]],
  ["USG de rins e vias urinárias", ["USG de rins", "ultrassom renal", "USG vias urinárias"]],
  ["Ecocardiograma transtorácico", ["ecocardiograma", "ECO", "ecocardiograma transtorácico"]],
  ["Eletrocardiograma", ["ECG", "eletrocardiograma", "EKG"]],
  ["Doppler venoso de membros inferiores", ["doppler venoso", "doppler de MMII", "eco doppler venoso"]],
  ["Doppler arterial de membros inferiores", ["doppler arterial", "doppler arterial de MMII"]],
  ["Angiotomografia de tórax", ["angio TC de tórax", "angiotomografia pulmonar", "angioTC"]],
  ["Cintilografia pulmonar", ["cintilografia pulmonar", "cintilografia V/Q"]],
  ["TC de pelve", ["TC de pelve", "tomografia de pelve"]],
  ["RX de abdome", ["RX de abdome", "radiografia de abdome", "abdome agudo"]],
  ["USG de tireoide", ["USG de tireoide", "ultrassom de tireoide"]],
  ["Endoscopia digestiva alta", ["EDA", "endoscopia digestiva alta", "endoscopia"]],
  ["Colonoscopia", ["colonoscopia"]],
  ["Mamografia", ["mamografia"]],
];

async function inserir(linhas) {
  let n = 0;
  for (const l of linhas) {
    const r = await db.query(
      `INSERT INTO termos_clinicos
         (termo, termo_normalizado, categoria, subcategoria, classe_farmacologica,
          unidade, valor_ref_min, valor_ref_max, valor_ref_contexto, cid10, loinc, sinonimos, fonte, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, TRUE)
       ON CONFLICT (termo_normalizado, categoria, COALESCE(valor_ref_contexto, '')) DO NOTHING`,
      l,
    );
    n += r.rowCount;
  }
  return n;
}

async function main() {
  await db.initDB(); // garante a tabela termos_clinicos (idempotente)
  const linhas = [];
  for (const [termo, cid10, sin] of COMORBIDADES) {
    linhas.push([termo, normalizar(termo), "comorbidade", null, null, null, null, null, null, cid10, null, sin, "CID10"]);
  }
  for (const [termo, loinc, unidade, min, max, ctx, sin] of LABS) {
    linhas.push([termo, normalizar(termo), "exame_lab", null, null, unidade, min, max, ctx, null, loinc, sin, "LOINC"]);
  }
  for (const [termo, sub, classe, sin] of MEDS) {
    linhas.push([termo, normalizar(termo), "medicacao", sub, classe, null, null, null, null, null, null, sin, "RENAME"]);
  }
  for (const [termo, sin] of IMAGENS) {
    linhas.push([termo, normalizar(termo), "exame_imagem", null, null, null, null, null, null, null, null, sin, "curado"]);
  }

  const inseridos = await inserir(linhas);
  const tot = await db.query("SELECT categoria, COUNT(*)::int n FROM termos_clinicos WHERE ativo GROUP BY categoria ORDER BY categoria");
  console.log(`Ontologia: ${inseridos} novos termos inseridos (de ${linhas.length} no seed).`);
  console.log("Total por categoria:", JSON.stringify(tot.rows));
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed da ontologia:", e);
  process.exit(1);
});
