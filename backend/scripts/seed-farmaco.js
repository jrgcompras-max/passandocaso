/**
 * SEED — Segurança farmacológica (Fase 3).
 *
 *  • interacoes_medicamentosas: pares mais comuns na clínica médica.
 *  • posologia de referência (RENAME): preenche dose/vias/intervalo nos
 *    medicamentos já cadastrados em termos_clinicos.
 *  • ajuste_renal: medicamentos que requerem ajuste por TFG.
 *
 * Conteúdo é REFERÊNCIA informativa (ANVISA/RENAME/SBN/Micromedex). Linguagem
 * neutra (sem "prescreva/considere/reduza"). Idempotente (upsert).
 *
 * Rodar a partir da raiz do repo:
 *   node backend/scripts/seed-farmaco.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Rode a partir da raiz do repo.");
  process.exit(1);
}

const db = require("../db");

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── INTERAÇÕES ──────────────────────────────────────────────────────────────
// [medicamentoA, medicamentoB, severidade, descricao, mecanismo, condutaRef]
// severidade: leve | moderada | grave. Nomes batem com os termos da ontologia.
const INTERACOES = [
  // Anticoagulação / sangramento
  ["Varfarina", "AAS", "grave", "Risco de sangramento aumentado", "Anticoagulação + antiagregação (efeito antitrombótico aditivo)", "Monitorização de sinais de sangramento e INR"],
  ["Varfarina", "Clopidogrel", "grave", "Risco de sangramento aumentado", "Dupla inibição da hemostasia", "Monitorização de sangramento e INR"],
  ["Varfarina", "Amoxicilina", "moderada", "Potencializa a anticoagulação", "Alteração da flora intestinal produtora de vitamina K", "Monitorização de INR"],
  ["Varfarina", "Metronidazol", "grave", "Aumento importante do INR", "Inibição do metabolismo (CYP2C9) da varfarina", "Monitorização de INR"],
  ["Varfarina", "Ciprofloxacino", "moderada", "Aumento do INR", "Inibição enzimática e alteração da flora intestinal", "Monitorização de INR"],
  ["Varfarina", "Sulfametoxazol-Trimetoprima", "grave", "Aumento importante do INR", "Inibição do CYP2C9", "Monitorização de INR"],
  ["Varfarina", "Fluconazol", "grave", "Aumento do INR", "Inibição do CYP2C9", "Monitorização de INR"],
  ["Varfarina", "Amiodarona", "grave", "Aumento do INR", "Inibição do metabolismo da varfarina", "Monitorização de INR"],
  ["Varfarina", "Azitromicina", "moderada", "Aumento do INR", "Alteração da flora e inibição enzimática", "Monitorização de INR"],
  ["Enoxaparina", "AAS", "moderada", "Risco de sangramento aumentado", "Anticoagulação + antiagregação aditivas", "Monitorização de sangramento"],
  ["Enoxaparina", "Clopidogrel", "moderada", "Risco de sangramento aumentado", "Efeito antitrombótico aditivo", "Monitorização de sangramento"],
  ["Heparina", "AAS", "moderada", "Risco de sangramento aumentado", "Anticoagulação + antiagregação", "Monitorização de sangramento"],
  ["Heparina", "Clopidogrel", "moderada", "Risco de sangramento aumentado", "Efeito antitrombótico aditivo", "Monitorização de sangramento"],
  ["AAS", "Clopidogrel", "moderada", "Risco de sangramento (dupla antiagregação)", "Inibição plaquetária por duas vias", "Monitorização de sangramento"],
  ["Rivaroxabana", "AAS", "grave", "Risco de sangramento aumentado", "Anticoagulante + antiagregante", "Monitorização de sangramento"],
  ["Apixabana", "AAS", "grave", "Risco de sangramento aumentado", "Anticoagulante + antiagregante", "Monitorização de sangramento"],
  ["Enoxaparina", "Heparina", "grave", "Risco de sangramento (anticoagulação duplicada)", "Sobreposição de anticoagulantes", "Monitorização de sangramento"],

  // Eletrólitos / função renal (SRAA, potássio)
  ["Enalapril", "Espironolactona", "moderada", "Hipercalemia", "Redução da excreção renal de potássio", "Monitorização de potássio e função renal"],
  ["Captopril", "Espironolactona", "moderada", "Hipercalemia", "Redução da excreção renal de potássio", "Monitorização de potássio e função renal"],
  ["Losartana", "Espironolactona", "moderada", "Hipercalemia", "Redução da excreção renal de potássio", "Monitorização de potássio e função renal"],
  ["Valsartana", "Espironolactona", "moderada", "Hipercalemia", "Redução da excreção renal de potássio", "Monitorização de potássio e função renal"],
  ["Enalapril", "Losartana", "moderada", "Hipercalemia e piora da função renal", "Duplo bloqueio do sistema renina-angiotensina", "Monitorização de potássio e creatinina"],
  ["Espironolactona", "Sulfametoxazol-Trimetoprima", "moderada", "Hipercalemia", "Redução da excreção de potássio", "Monitorização de potássio"],
  ["Enalapril", "Sulfametoxazol-Trimetoprima", "moderada", "Hipercalemia", "Redução da excreção de potássio", "Monitorização de potássio"],

  // Digoxina
  ["Digoxina", "Amiodarona", "grave", "Toxicidade digitálica", "Amiodarona eleva os níveis séricos de digoxina", "Monitorização de digoxinemia e ECG"],
  ["Digoxina", "Furosemida", "moderada", "Hipocalemia potencializa a toxicidade digitálica", "Perda renal de potássio pela furosemida", "Monitorização de potássio"],
  ["Digoxina", "Hidroclorotiazida", "moderada", "Hipocalemia potencializa a toxicidade digitálica", "Perda renal de potássio", "Monitorização de potássio"],
  ["Digoxina", "Espironolactona", "moderada", "Alteração dos níveis de digoxina", "Interferência na secreção tubular renal", "Monitorização de digoxinemia"],
  ["Digoxina", "Claritromicina", "grave", "Toxicidade digitálica", "Inibição da glicoproteína-P eleva a digoxina", "Monitorização de digoxinemia"],

  // Prolongamento de QT
  ["Haloperidol", "Amiodarona", "grave", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Haloperidol", "Ondansetrona", "moderada", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Amiodarona", "Levofloxacino", "grave", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Amiodarona", "Ciprofloxacino", "moderada", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Amiodarona", "Azitromicina", "grave", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Amiodarona", "Quetiapina", "moderada", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Haloperidol", "Azitromicina", "moderada", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],
  ["Amiodarona", "Ondansetrona", "moderada", "Prolongamento do intervalo QT", "Efeito aditivo sobre o QT", "Monitorização de ECG (QTc)"],

  // Serotoninérgicas
  ["Tramadol", "Sertralina", "grave", "Risco de síndrome serotoninérgica", "Efeito serotoninérgico aditivo + limiar convulsivo reduzido", "Monitorização de sinais serotoninérgicos"],
  ["Tramadol", "Escitalopram", "grave", "Risco de síndrome serotoninérgica", "Efeito serotoninérgico aditivo", "Monitorização de sinais serotoninérgicos"],
  ["Tramadol", "Venlafaxina", "grave", "Risco de síndrome serotoninérgica", "Efeito serotoninérgico aditivo", "Monitorização de sinais serotoninérgicos"],
  ["Sertralina", "Venlafaxina", "moderada", "Risco de síndrome serotoninérgica", "Efeito serotoninérgico aditivo", "Monitorização de sinais serotoninérgicos"],
  ["Fentanil", "Sertralina", "moderada", "Risco de síndrome serotoninérgica", "Efeito serotoninérgico aditivo", "Monitorização de sinais serotoninérgicos"],

  // Depressão respiratória / SNC
  ["Morfina", "Clonazepam", "grave", "Depressão respiratória", "Depressão aditiva do SNC", "Monitorização respiratória"],
  ["Morfina", "Alprazolam", "grave", "Depressão respiratória", "Depressão aditiva do SNC", "Monitorização respiratória"],
  ["Fentanil", "Clonazepam", "grave", "Depressão respiratória", "Depressão aditiva do SNC", "Monitorização respiratória"],
  ["Tramadol", "Clonazepam", "moderada", "Depressão do SNC", "Sedação aditiva", "Monitorização do nível de consciência"],
  ["Morfina", "Pregabalina", "moderada", "Depressão do SNC e respiratória", "Sedação aditiva", "Monitorização respiratória"],

  // Miopatia (estatinas)
  ["Sinvastatina", "Amiodarona", "moderada", "Risco de miopatia/rabdomiólise", "Inibição do metabolismo da sinvastatina", "Monitorização de CPK e sintomas musculares"],
  ["Sinvastatina", "Claritromicina", "grave", "Risco de miopatia/rabdomiólise", "Inibição potente do CYP3A4", "Monitorização de CPK e sintomas musculares"],
  ["Sinvastatina", "Ciprofloxacino", "moderada", "Risco de miopatia", "Redução do metabolismo da sinvastatina", "Monitorização de CPK"],
  ["Atorvastatina", "Claritromicina", "moderada", "Risco de miopatia", "Inibição do CYP3A4", "Monitorização de CPK"],
  ["Sinvastatina", "Fluconazol", "moderada", "Risco de miopatia", "Inibição enzimática do metabolismo da sinvastatina", "Monitorização de CPK"],

  // Tendinopatia (fluoroquinolona + corticoide)
  ["Ciprofloxacino", "Prednisona", "moderada", "Risco de ruptura tendínea", "Efeito aditivo sobre o tendão", "Monitorização de dor tendínea"],
  ["Levofloxacino", "Prednisona", "moderada", "Risco de ruptura tendínea", "Efeito aditivo sobre o tendão", "Monitorização de dor tendínea"],
  ["Ciprofloxacino", "Dexametasona", "moderada", "Risco de ruptura tendínea", "Efeito aditivo sobre o tendão", "Monitorização de dor tendínea"],

  // Acidose lática / metformina
  ["Metformina", "Furosemida", "moderada", "Risco de acidose lática", "Desidratação/piora de função renal reduz a depuração da metformina", "Monitorização de função renal"],
  ["Metformina", "Contraste iodado", "grave", "Risco de acidose lática", "Nefrotoxicidade do contraste reduz a depuração da metformina", "Monitorização de função renal"],

  // Mascaramento de hipoglicemia (betabloqueador)
  ["Insulina Regular", "Propranolol", "moderada", "Mascaramento dos sinais de hipoglicemia", "Bloqueio dos sintomas adrenérgicos da hipoglicemia", "Monitorização glicêmica"],
  ["Insulina NPH", "Propranolol", "moderada", "Mascaramento dos sinais de hipoglicemia", "Bloqueio dos sintomas adrenérgicos da hipoglicemia", "Monitorização glicêmica"],
  ["Insulina Regular", "Carvedilol", "moderada", "Mascaramento dos sinais de hipoglicemia", "Bloqueio dos sintomas adrenérgicos da hipoglicemia", "Monitorização glicêmica"],
  ["Gliclazida", "Propranolol", "moderada", "Mascaramento dos sinais de hipoglicemia", "Bloqueio dos sintomas adrenérgicos da hipoglicemia", "Monitorização glicêmica"],

  // Antiagregante x IBP
  ["Clopidogrel", "Omeprazol", "moderada", "Redução do efeito antiagregante do clopidogrel", "Inibição do CYP2C19 reduz a ativação do clopidogrel", "Monitorização clínica"],
  ["Clopidogrel", "Esomeprazol", "moderada", "Redução do efeito antiagregante do clopidogrel", "Inibição do CYP2C19 reduz a ativação do clopidogrel", "Monitorização clínica"],
];

// ── POSOLOGIA DE REFERÊNCIA (adulto, RENAME/bula) ───────────────────────────
// nome canônico -> { u: doseUsual, min, max, vias:[], int: intervalo, obs }
const POSOLOGIA = {
  // Hipoglicemiantes
  Metformina: { u: "500-850 mg", min: "500 mg", max: "2550 mg/dia", vias: ["VO"], int: "2-3x/dia", obs: "Suspender se TFG < 30; cautela com contraste iodado" },
  "Insulina NPH": { u: "0,1-0,5 UI/kg", vias: ["SC"], int: "1-2x/dia", obs: "Titular pela glicemia" },
  "Insulina Regular": { u: "conforme glicemia (HGT)", vias: ["SC", "EV"], int: "esquema/bolus", obs: "EV em emergências (CAD/EHH)" },
  Gliclazida: { u: "30-120 mg", min: "30 mg", max: "120 mg/dia", vias: ["VO"], int: "1x/dia (MR)", obs: "Risco de hipoglicemia" },
  Empagliflozina: { u: "10-25 mg", min: "10 mg", max: "25 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Eficácia glicêmica reduzida com TFG baixa" },
  Dapagliflozina: { u: "10 mg", vias: ["VO"], int: "1x/dia", obs: "Avaliar função renal" },
  // Anti-hipertensivos
  Losartana: { u: "50-100 mg", min: "25 mg", max: "100 mg/dia", vias: ["VO"], int: "1-2x/dia" },
  Valsartana: { u: "80-320 mg", min: "40 mg", max: "320 mg/dia", vias: ["VO"], int: "1x/dia" },
  Enalapril: { u: "5-20 mg", min: "2,5 mg", max: "40 mg/dia", vias: ["VO"], int: "1-2x/dia", obs: "Monitorar potássio e função renal" },
  Captopril: { u: "25-50 mg", min: "12,5 mg", max: "150 mg/dia", vias: ["VO"], int: "2-3x/dia" },
  Anlodipino: { u: "5-10 mg", min: "2,5 mg", max: "10 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Edema de membros inferiores dose-dependente" },
  Hidroclorotiazida: { u: "25 mg", min: "12,5 mg", max: "50 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Risco de hiponatremia e hipocalemia" },
  Furosemida: { u: "20-40 mg", min: "20 mg", max: "variável", vias: ["VO", "EV", "IM"], int: "1-2x/dia ou conforme diurese", obs: "Monitorar potássio e função renal" },
  Espironolactona: { u: "25-50 mg", min: "12,5 mg", max: "100 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Risco de hipercalemia" },
  Carvedilol: { u: "6,25-25 mg", min: "3,125 mg", max: "50 mg/dia", vias: ["VO"], int: "12/12h" },
  Metoprolol: { u: "25-100 mg", min: "12,5 mg", max: "200 mg/dia", vias: ["VO", "EV"], int: "1-2x/dia (succinato 1x)" },
  Atenolol: { u: "25-100 mg", min: "25 mg", max: "100 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Ajuste renal se TFG baixa" },
  Propranolol: { u: "40-160 mg", min: "10 mg", max: "320 mg/dia", vias: ["VO"], int: "2-3x/dia" },
  // Estatinas
  Atorvastatina: { u: "10-80 mg", min: "10 mg", max: "80 mg/dia", vias: ["VO"], int: "1x/dia (noite)" },
  Sinvastatina: { u: "20-40 mg", min: "10 mg", max: "40 mg/dia", vias: ["VO"], int: "1x/dia (noite)", obs: "Evitar 80 mg; cautela com inibidores do CYP3A4" },
  Rosuvastatina: { u: "10-20 mg", min: "5 mg", max: "40 mg/dia", vias: ["VO"], int: "1x/dia" },
  // Antitrombóticos
  AAS: { u: "100 mg", min: "75 mg", max: "300 mg/dia", vias: ["VO"], int: "1x/dia" },
  Clopidogrel: { u: "75 mg", vias: ["VO"], int: "1x/dia", obs: "Ataque de 300-600 mg quando indicado" },
  Varfarina: { u: "2,5-5 mg", vias: ["VO"], int: "1x/dia", obs: "Titular pelo INR (alvo 2-3)" },
  Enoxaparina: { u: "1 mg/kg 12/12h ou 1,5 mg/kg/dia", vias: ["SC"], int: "12/12h ou 1x/dia", obs: "Ajuste se TFG < 30" },
  Heparina: { u: "conforme protocolo/peso", vias: ["EV", "SC"], int: "infusão contínua ou 8/8-12/12h", obs: "Monitorar TTPA" },
  Rivaroxabana: { u: "15-20 mg", min: "15 mg", max: "20 mg/dia", vias: ["VO"], int: "1x/dia", obs: "Ajuste renal; tomar com alimento" },
  Apixabana: { u: "5 mg", min: "2,5 mg", max: "5 mg", vias: ["VO"], int: "12/12h", obs: "Reduzir conforme critérios (idade/peso/Cr)" },
  Dabigatrana: { u: "110-150 mg", vias: ["VO"], int: "12/12h", obs: "Contraindicada se TFG < 30" },
  // Cardiovasculares
  Amiodarona: { u: "200 mg (manutenção)", vias: ["VO", "EV"], int: "1x/dia (após ataque)", obs: "Risco de prolongamento de QT" },
  Digoxina: { u: "0,125-0,25 mg", vias: ["VO", "EV"], int: "1x/dia", obs: "Janela terapêutica estreita; ajuste renal" },
  // Gástricos
  Omeprazol: { u: "20-40 mg", min: "20 mg", max: "40 mg/dia", vias: ["VO", "EV"], int: "1-2x/dia" },
  Pantoprazol: { u: "40 mg", min: "20 mg", max: "80 mg/dia", vias: ["VO", "EV"], int: "1-2x/dia" },
  Esomeprazol: { u: "20-40 mg", vias: ["VO", "EV"], int: "1x/dia" },
  Ondansetrona: { u: "4-8 mg", min: "4 mg", max: "24 mg/dia", vias: ["VO", "EV"], int: "8/8h", obs: "Prolongamento de QT em doses altas" },
  Metoclopramida: { u: "10 mg", max: "30 mg/dia", vias: ["VO", "EV", "IM"], int: "8/8h", obs: "Evitar se TFG < 40; risco extrapiramidal" },
  Bromoprida: { u: "10 mg", vias: ["VO", "EV", "IM"], int: "8/8h" },
  // Analgésicos
  Dipirona: { u: "500 mg-1 g", max: "4 g/dia", vias: ["VO", "EV", "IM"], int: "6/6h" },
  Paracetamol: { u: "500 mg-1 g", max: "3-4 g/dia", vias: ["VO", "EV"], int: "6/6h", obs: "Reduzir em hepatopatia" },
  Tramadol: { u: "50-100 mg", max: "400 mg/dia", vias: ["VO", "EV", "IM"], int: "6/6-8/8h", obs: "Risco serotoninérgico e convulsivo" },
  Codeína: { u: "30-60 mg", max: "240 mg/dia", vias: ["VO"], int: "4/4-6/6h" },
  Morfina: { u: "2-10 mg (titular)", vias: ["EV", "SC", "VO"], int: "4/4h ou conforme dor", obs: "Depressão respiratória; ajuste renal" },
  Fentanil: { u: "25-100 mcg (titular)", vias: ["EV"], int: "conforme protocolo/infusão" },
  // Corticoides
  Dexametasona: { u: "4-10 mg", vias: ["VO", "EV", "IM"], int: "conforme indicação" },
  Metilprednisolona: { u: "40-125 mg", vias: ["EV", "IM"], int: "conforme indicação" },
  Prednisona: { u: "20-60 mg", vias: ["VO"], int: "1x/dia" },
  Hidrocortisona: { u: "100-200 mg", vias: ["EV", "IM"], int: "6/6-8/8h" },
  // Antibióticos
  Ceftriaxona: { u: "1-2 g", min: "1 g", max: "4 g/dia", vias: ["EV", "IM"], int: "12/12h ou 24/24h" },
  Cefepime: { u: "1-2 g", vias: ["EV"], int: "8/8h ou 12/12h", obs: "Ajuste renal por TFG" },
  Cefalexina: { u: "500 mg", max: "4 g/dia", vias: ["VO"], int: "6/6h" },
  Amoxicilina: { u: "500 mg-1 g", vias: ["VO"], int: "8/8h" },
  "Amoxicilina-Clavulanato": { u: "875/125 mg", vias: ["VO", "EV"], int: "12/12h ou 8/8h" },
  "Ampicilina-Sulbactam": { u: "1,5-3 g", vias: ["EV", "IM"], int: "6/6h" },
  Azitromicina: { u: "500 mg", vias: ["VO", "EV"], int: "1x/dia", obs: "Curso de 3-5 dias" },
  Claritromicina: { u: "500 mg", vias: ["VO", "EV"], int: "12/12h", obs: "Inibidor potente do CYP3A4" },
  Ciprofloxacino: { u: "400 mg (EV) / 500 mg (VO)", vias: ["VO", "EV"], int: "12/12h", obs: "Ajuste se TFG < 30; risco tendíneo" },
  Levofloxacino: { u: "500-750 mg", vias: ["VO", "EV"], int: "24/24h", obs: "Ajuste renal por TFG" },
  "Piperacilina-Tazobactam": { u: "4,5 g", vias: ["EV"], int: "6/6h ou 8/8h", obs: "Ajuste renal por TFG" },
  Imipenem: { u: "500 mg-1 g", vias: ["EV"], int: "6/6h ou 8/8h", obs: "Ajuste renal por TFG" },
  Meropeném: { u: "1-2 g", vias: ["EV"], int: "8/8h", obs: "Ajuste renal por TFG" },
  Ertapeném: { u: "1 g", vias: ["EV", "IM"], int: "24/24h", obs: "Ajuste se TFG < 30" },
  Vancomicina: { u: "15-20 mg/kg", vias: ["EV"], int: "8/8h ou 12/12h", obs: "Ajuste renal obrigatório; monitorar vancocinemia" },
  Teicoplanina: { u: "6-12 mg/kg", vias: ["EV", "IM"], int: "24/24h (após ataque)", obs: "Ajuste renal" },
  Oxacilina: { u: "1-2 g", vias: ["EV"], int: "4/4h ou 6/6h" },
  Metronidazol: { u: "500 mg", vias: ["VO", "EV"], int: "8/8h" },
  Clindamicina: { u: "600-900 mg", vias: ["EV", "VO"], int: "8/8h" },
  Gentamicina: { u: "3-5 mg/kg/dia", vias: ["EV", "IM"], int: "24/24h", obs: "Nefro/ototóxica; ajuste renal e nível sérico" },
  "Sulfametoxazol-Trimetoprima": { u: "800/160 mg", vias: ["VO", "EV"], int: "12/12h", obs: "Ajuste renal; risco de hipercalemia" },
  "Polimixina B": { u: "15.000-25.000 UI/kg/dia", vias: ["EV"], int: "12/12h", obs: "Nefrotóxica" },
  // Antifúngicos
  Fluconazol: { u: "100-400 mg", vias: ["VO", "EV"], int: "24/24h", obs: "Ajuste renal; inibidor enzimático" },
  "Anfotericina B": { u: "convencional 0,5-1 mg/kg/dia", vias: ["EV"], int: "24/24h", obs: "Nefrotóxica; monitorar eletrólitos" },
  Micafungina: { u: "100 mg", vias: ["EV"], int: "24/24h" },
  Voriconazol: { u: "4 mg/kg (manutenção)", vias: ["VO", "EV"], int: "12/12h", obs: "Múltiplas interações (CYP)" },
  // Endócrino / respiratório
  Levotiroxina: { u: "1,6 mcg/kg/dia", vias: ["VO"], int: "1x/dia (jejum)" },
  Salbutamol: { u: "100-200 mcg (inalatório)", vias: ["INAL"], int: "conforme necessidade / 4/4-6/6h" },
  "Brometo de ipratrópio": { u: "20-40 mcg (inalatório)", vias: ["INAL"], int: "6/6h" },
  Budesonida: { u: "200-400 mcg (inalatória)", vias: ["INAL"], int: "12/12h" },
  // Diversos
  Lactulose: { u: "15-30 mL", vias: ["VO"], int: "1-3x/dia", obs: "Titular por evacuações (encefalopatia)" },
  Aripiprazol: { u: "10-15 mg", max: "30 mg/dia", vias: ["VO"], int: "1x/dia" },
  Quetiapina: { u: "25-300 mg", vias: ["VO"], int: "1-2x/dia", obs: "Prolongamento de QT" },
  Haloperidol: { u: "0,5-5 mg", vias: ["VO", "EV", "IM"], int: "conforme indicação", obs: "Prolongamento de QT" },
  Venlafaxina: { u: "75-225 mg", vias: ["VO"], int: "1x/dia (XR)" },
  Sertralina: { u: "50-200 mg", vias: ["VO"], int: "1x/dia" },
  Escitalopram: { u: "10-20 mg", vias: ["VO"], int: "1x/dia", obs: "Prolongamento de QT em doses altas" },
  Alprazolam: { u: "0,25-1 mg", vias: ["VO"], int: "conforme indicação", obs: "Depressão do SNC" },
  Clonazepam: { u: "0,5-2 mg", vias: ["VO"], int: "conforme indicação", obs: "Depressão do SNC" },
  Pregabalina: { u: "75-300 mg", vias: ["VO"], int: "12/12h", obs: "Ajuste renal por TFG" },
};

// ── AJUSTE RENAL (por TFG) ──────────────────────────────────────────────────
// [medicamento, tfg_min (sem ajuste acima disso), tfg_corte (abaixo: ajuste/contra), recomendacao]
const AJUSTE = [
  ["Metformina", 30, 30, "Contraindicada se TFG < 30; reavaliar dose se TFG 30-45"],
  ["Enoxaparina", 30, 30, "Ajuste de dose se TFG < 30 (1 mg/kg 1x/dia)"],
  ["Vancomicina", null, 60, "Ajuste obrigatório por TFG e vancocinemia"],
  ["Ciprofloxacino", 30, 30, "Reduzir dose se TFG < 30"],
  ["Levofloxacino", 50, 50, "Ajuste de dose/intervalo se TFG < 50"],
  ["Gabapentina", 60, 60, "Ajuste progressivo conforme TFG"],
  ["Pregabalina", 60, 60, "Ajuste progressivo conforme TFG"],
  ["Alopurinol", 60, 60, "Reduzir dose se TFG < 60"],
  ["Metoclopramida", 40, 40, "Evitar/uso cauteloso se TFG < 40"],
  ["Cefepime", 60, 60, "Ajuste de dose/intervalo por TFG"],
  ["Meropeném", 50, 50, "Ajuste de dose se TFG < 50"],
  ["Imipenem", 70, 70, "Ajuste de dose por TFG"],
  ["Ertapeném", 30, 30, "Reduzir dose se TFG < 30"],
  ["Piperacilina-Tazobactam", 40, 40, "Ajuste de dose/intervalo se TFG < 40"],
  ["Gentamicina", 60, 60, "Ajuste por TFG e nível sérico"],
  ["Sulfametoxazol-Trimetoprima", 30, 30, "Ajuste se TFG < 30; evitar se TFG < 15"],
  ["Fluconazol", 50, 50, "Reduzir dose à metade se TFG < 50"],
  ["Dabigatrana", 30, 30, "Contraindicada se TFG < 30"],
  ["Rivaroxabana", 30, 30, "Cautela/ajuste se TFG 15-50; evitar se TFG < 15"],
  ["Apixabana", 25, 30, "Critérios de redução; cautela se TFG < 25"],
  ["Digoxina", 50, 50, "Reduzir dose e monitorar nível se TFG < 50"],
  ["Atenolol", 35, 35, "Ajuste de dose se TFG < 35"],
  ["Espironolactona", 30, 30, "Evitar se TFG < 30 (risco de hipercalemia)"],
  ["Enalapril", null, 30, "Monitorar função renal/potássio; cautela se TFG < 30"],
  ["Morfina", 30, 30, "Acúmulo de metabólitos; reduzir/espaçar se TFG < 30"],
  ["Codeína", 30, 30, "Reduzir dose se TFG < 30"],
  ["Aciclovir", 50, 50, "Ajuste de dose/intervalo por TFG"],
  ["Colchicina", 30, 30, "Reduzir dose se TFG < 30"],
  ["Tenofovir", 50, 50, "Ajuste de intervalo por TFG"],
  ["Hidroclorotiazida", 30, 30, "Eficácia reduzida se TFG < 30"],
];

async function seedInteracoes() {
  let n = 0;
  for (const [a, b, sev, desc, mec, cond] of INTERACOES) {
    // Par normalizado e ordenado (idempotência do índice único).
    const [na, nb] = [normalizar(a), normalizar(b)].sort();
    const r = await db.query(
      `INSERT INTO interacoes_medicamentosas
         (medicamento_a, medicamento_b, severidade, descricao, mecanismo, conduta_recomendada, fonte, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,'ANVISA/Micromedex', TRUE)
       ON CONFLICT (medicamento_a, medicamento_b) DO UPDATE
         SET severidade = EXCLUDED.severidade, descricao = EXCLUDED.descricao,
             mecanismo = EXCLUDED.mecanismo, conduta_recomendada = EXCLUDED.conduta_recomendada,
             ativo = TRUE`,
      [na, nb, sev, desc, mec, cond],
    );
    n += r.rowCount;
  }
  return n;
}

async function seedPosologia() {
  let ok = 0;
  const semMatch = [];
  for (const [nome, p] of Object.entries(POSOLOGIA)) {
    const r = await db.query(
      `UPDATE termos_clinicos
          SET dose_usual = $1, dose_min = $2, dose_max = $3,
              vias_administracao = $4, intervalo_usual = $5, observacoes_dose = $6
        WHERE categoria = 'medicacao' AND termo_normalizado = $7`,
      [p.u || null, p.min || null, p.max || null, p.vias || null, p.int || null, p.obs || null, normalizar(nome)],
    );
    if (r.rowCount > 0) ok += r.rowCount;
    else semMatch.push(nome);
  }
  if (semMatch.length) console.warn("  ⚠ Posologia sem termo correspondente:", semMatch.join(", "));
  return ok;
}

async function seedAjuste() {
  let n = 0;
  for (const [med, tmin, tcorte, rec] of AJUSTE) {
    const r = await db.query(
      `INSERT INTO ajuste_renal (medicamento, tfg_min, tfg_corte, recomendacao, fonte)
       VALUES ($1,$2,$3,$4,'ANVISA/SBN')
       ON CONFLICT (medicamento) DO UPDATE
         SET tfg_min = EXCLUDED.tfg_min, tfg_corte = EXCLUDED.tfg_corte,
             recomendacao = EXCLUDED.recomendacao`,
      [normalizar(med), tmin, tcorte, rec],
    );
    n += r.rowCount;
  }
  return n;
}

async function main() {
  await db.initDB();
  const i = await seedInteracoes();
  const p = await seedPosologia();
  const a = await seedAjuste();
  console.log(`Interações: ${INTERACOES.length} no seed (${i} inseridas/atualizadas).`);
  console.log(`Posologia: ${p} medicamentos com dose de referência preenchida.`);
  console.log(`Ajuste renal: ${AJUSTE.length} no seed (${a} inseridos/atualizados).`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed farmacológico:", e);
  process.exit(1);
});
