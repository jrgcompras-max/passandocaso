/**
 * SEED — 15 pacientes clínicos para testes.
 *
 * Cria/atualiza o usuário de teste, vincula o hospital e popula 15 pacientes
 * com evolucoes_diarias ricas (séries de sinais vitais e exames laboratoriais)
 * para exercitar a evolução temporal e os alertas de tendência.
 *
 * Rodar (aponte para o banco do Railway — use a connection string PÚBLICA, a
 * interna *.railway.internal só funciona dentro do Railway):
 *   cd backend
 *   DATABASE_URL="postgresql://...proxy.rlwy.net:PORTA/railway" node scripts/seed-pacientes.js
 *
 * A URL pública está no Railway → serviço Postgres → aba Variables
 * (DATABASE_PUBLIC_URL) ou em Connect → Public Network.
 *
 * Idempotente: usuário e hospital fazem upsert (cria ou atualiza); pacientes e
 * evolucoes_diarias usam ON CONFLICT DO NOTHING (não duplicam). Para reseedar do
 * zero, remova antes os pacientes do médico no banco.
 */

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

exigirDatabaseUrl();

const db = require("../db");

/** Valida DATABASE_URL com mensagens claras (ausente / placeholder / formato). */
function exigirDatabaseUrl() {
  const url = process.env.DATABASE_URL || "";
  const dica =
    "Forma mais robusta: adicione a linha em backend/.env (o dotenv lê sem o shell\n" +
    "  interferir) e rode `node scripts/seed-pacientes.js`:\n" +
    "    DATABASE_URL=postgresql://USUARIO:SENHA@HOST.proxy.rlwy.net:PORTA/railway\n" +
    "  Ou na linha de comando use ASPAS SIMPLES (evita expansão de $ pelo shell):\n" +
    "    DATABASE_URL='postgresql://...proxy.rlwy.net:PORTA/railway' node scripts/seed-pacientes.js\n" +
    "  (URL pública em Railway → Postgres → Variables → DATABASE_PUBLIC_URL)";
  if (!url) {
    console.error(`✗ DATABASE_URL ausente.\n  ${dica}`);
    process.exit(1);
  }
  if (url.includes("${") || url.includes("{{")) {
    console.error(
      `✗ DATABASE_URL contém um placeholder não resolvido (ex.: \${{...}}).\n` +
        `  Copie o VALOR já resolvido, não a referência da variável.\n  ${dica}`,
    );
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\/.+@.+\/.+/i.test(url)) {
    console.error(
      "✗ DATABASE_URL com formato inválido. Esperado:\n" +
        "    postgresql://USUARIO:SENHA@HOST:PORTA/BANCO\n" +
        "  Se a senha tem caracteres especiais ($ @ # &), use aspas simples ou o .env.\n" +
        `  ${dica}`,
    );
    process.exit(1);
  }
}

// ── Configuração do usuário/hospital de teste ───────────────────────────────
const USUARIO = {
  nome: "Junior Guilherme",
  email: "jrg_compras@hotmail.com",
  senha: "Safracore@2024",
  categoria: "medico",
  especialidade: "clinica_medica",
};
const HOSPITAL = {
  id: "hosp-hnsc",
  nome: "Hospital Nossa Sra. Conceição",
  cidade: "Tubarão",
  // CNES do estabelecimento — ajuste se necessário.
  cnes: "2376825",
};

// Unidades por exame (usadas para formatar o valor no banco).
const UNID = {
  Cr: "mg/dL", PCR: "mg/L", Hb: "g/dL", LT: "/mm³", Na: "mEq/L",
  K: "mEq/L", Plaq: "/mm³", Amilase: "U/L", Bilirrubina: "mg/dL",
  Albumina: "g/dL", HCO3: "mEq/L", PCO2: "mmHg", pH: "",
};

// ── Helpers de data ─────────────────────────────────────────────────────────
function isoMenosDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
/** Datas (ISO, asc) do dia da entrada (D1) até hoje (D{dias}). */
function datasInternacao(dias) {
  const out = [];
  for (let i = dias - 1; i >= 0; i--) out.push(isoMenosDias(i));
  return out;
}
/** Valor de uma série (alinhada ao FIM) para o dia índice i de N dias. */
function noDia(serie, i, N) {
  if (!serie || !serie.length) return undefined;
  const inicio = N - serie.length;
  return i >= inicio ? serie[i - inicio] : undefined;
}
function val(v, unidade) {
  return unidade ? `${v} ${unidade}` : String(v);
}

// ── Dados dos 15 pacientes ──────────────────────────────────────────────────
// pa: ["sist/diast", ...]; labs: chaves reconhecidas pelos alertas (Cr, PCR,
// Hb, LT, Na, K, Plaq) + extras (Amilase, Bilirrubina, ...). Séries alinham ao
// fim (o último valor = hoje).
const PAC = [
  {
    pront: "0990001", nome: "Carlos E. L.", idade: 67, leito: "C1", dias: 15,
    status: "visitado", clinico: "melhora",
    diag: "Descompensação de insuficiência cardíaca",
    comorb: ["ICC FEr", "HAS", "FA permanente"],
    muc: ["Carvedilol 12,5mg 2x/dia", "Espironolactona 25mg", "Varfarina"],
    problemas: [["ICC descompensada", "alta"], ["Anemia crônica", "media"]],
    pendencias: [["Ecocardiograma pendente", "alta"], ["Ajuste de anticoagulação", "media"]],
    conduta: "Furosemida IV → oral, dieta hipossódica, balanço hídrico.",
    pa: ["160/100", "150/95", "145/90", "140/88", "138/85", "135/82", "130/80"],
    fc: [95, 92, 88, 85, 82, 80, 78],
    sato2: [92, 93, 94, 95, 96, 96, 97],
    labs: {
      Hb: [9.2, 9.0, 8.8, 8.9, 9.1, 9.3, 9.5],
      PCR: [45, 38, 30, 22, 15, 10, 8],
      Cr: [1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.9],
    },
  },
  {
    pront: "0990002", nome: "João C. M.", idade: 58, leito: "UTI-3", dias: 8,
    status: "visitado", clinico: "melhora",
    diag: "Sepse de foco urinário + IRA",
    comorb: ["DM2", "HAS", "Nefrolitíase de repetição"],
    muc: ["Metformina 850mg 2x/dia", "Losartana 50mg"],
    atb: ["Ceftriaxona 1g EV 1x/dia D5/8"],
    problemas: [["Sepse", "alta"], ["IRA", "alta"], ["DM2 descompensado", "media"]],
    pendencias: [["Urocultura de controle", "media"], ["Reavaliar função renal", "alta"]],
    conduta: "Antibioticoterapia guiada por cultura, hidratação, controle de diurese.",
    pa: ["80/50", "90/60", "100/65", "110/70", "120/75", "118/74", "120/78"],
    fc: [120, 115, 108, 98, 88, 82, 78],
    temp: [39.2, 38.8, 38.2, 37.8, 37.2, 36.8, 36.5],
    labs: {
      Cr: [3.2, 3.8, 4.1, 3.9, 3.2, 2.4, 1.8],
      PCR: [280, 310, 290, 220, 150, 90, 45],
      LT: [18000, 22000, 19000, 15000, 11000, 8500, 7200],
    },
  },
  {
    pront: "0990003", nome: "Maria G. B. R.", idade: 72, leito: "306-4", dias: 14,
    status: "visitado", clinico: "melhora",
    diag: "Pneumonia comunitária grave",
    comorb: ["DPOC", "Tabagismo (ex)", "HAS"],
    muc: ["Brometo de ipratrópio", "Budesonida inalatória", "Enalapril 10mg"],
    atb: ["Amoxicilina-Clavulanato 875mg 12/12h D10/14"],
    problemas: [["Pneumonia", "alta"], ["DPOC exacerbado", "media"]],
    pendencias: [["RX de tórax de controle", "media"]],
    conduta: "Antibioticoterapia, oxigenoterapia, fisioterapia respiratória.",
    sato2: [84, 86, 88, 90, 91, 93, 94, 95, 96, 96],
    temp: [39.5, 39.1, 38.6, 38.0, 37.5, 37.2, 36.9, 36.7],
    fr: [28, 26, 24, 22, 20, 18, 18, 16],
    labs: {
      PCR: [180, 195, 210, 185, 150, 110, 75, 40, 20, 12],
      Hb: [11.2, 11.0, 10.8, 10.9, 11.0, 11.2],
    },
  },
  {
    pront: "0990004", nome: "Ana P. F.", idade: 45, leito: "B2", dias: 7,
    status: "visitado", clinico: "melhora",
    diag: "TVP de membro inferior direito + TEP",
    comorb: ["Obesidade", "ACO em uso"],
    muc: ["Anticoncepcional oral (suspenso)"],
    extras: [
      { texto: "Enoxaparina 80mg SC 12/12h", classe: "Anticoagulante" },
      { texto: "Rivaroxabana 15mg 2x/dia", classe: "Anticoagulante" },
    ],
    problemas: [["TEP", "alta"], ["TVP MID", "alta"], ["Obesidade", "baixa"]],
    pendencias: [["Programar transição para anticoagulante oral", "media"]],
    conduta: "Anticoagulação plena, deambulação progressiva, meia elástica.",
    sato2: [91, 92, 94, 95, 96, 97, 97],
    fc: [110, 105, 98, 92, 86, 82, 80],
    labs: { Cr: [0.8, 0.8, 0.9, 0.8, 0.8, 0.8, 0.8] },
  },
  {
    pront: "0990005", nome: "Jaime R. S.", idade: 60, leito: "301-1", dias: 12,
    status: "revisar", clinico: "estavel",
    diag: "Cirrose hepática Child C descompensada + Ascite volumosa",
    comorb: ["Cirrose alcoólica", "HAS", "Insônia"],
    muc: ["TARV (HIV+)", "Espironolactona", "Furosemida"],
    atb: ["Ceftriaxona profilática PBE D3/12"],
    problemas: [["Ascite", "alta"], ["Encefalopatia hepática leve", "alta"], ["HIV", "media"]],
    pendencias: [["Paracentese diagnóstica/alívio", "alta"], ["Controle de eletrólitos", "media"]],
    conduta: "Paracentese de alívio, lactulose, restrição hídrica e de sódio.",
    pa: ["100/65", "98/62", "102/68", "105/70", "108/72", "110/70"],
    labs: {
      Cr: [1.2, 1.4, 1.6, 1.8, 1.9, 1.7, 1.5],
      Na: [128, 126, 125, 127, 129, 130, 132],
      Bilirrubina: [8.2, 9.1, 8.8, 8.5, 7.9, 7.2],
      Albumina: [2.1, 2.0, 2.1, 2.2, 2.3],
    },
  },
  {
    pront: "0990006", nome: "Roberto S. N.", idade: 71, leito: "D1", dias: 5,
    status: "revisar", clinico: "melhora",
    diag: "AVC isquêmico em território da ACM esquerda",
    comorb: ["HAS", "DM2", "FA", "Dislipidemia"],
    muc: ["AAS 100mg", "Atorvastatina 40mg", "Metformina 500mg"],
    problemas: [["AVC", "alta"], ["Disfagia", "alta"], ["FA", "media"]],
    pendencias: [["Avaliação da fonoaudiologia", "alta"], ["Profilaxia de TVP", "media"]],
    conduta: "Controle pressórico gradual, profilaxia de TVP, fonoaudiologia.",
    pa: ["185/110", "170/100", "158/95", "145/88", "138/85"],
    glicemia: [280, 240, 195, 160, 140],
    glasgow: [12, 13, 13, 14, 14],
    labs: { PCR: [25, 35, 42, 38, 30] },
  },
  {
    pront: "0990007", nome: "Francisca A. S.", idade: 55, leito: "A4", dias: 4,
    status: "revisar", clinico: "melhora",
    diag: "Cetoacidose diabética",
    comorb: ["DM2", "HAS", "Obesidade mórbida"],
    muc: ["Insulina NPH + Regular (ajuste)", "Metformina (suspensa)"],
    atb: ["Ampicilina-Sulbactam 3g EV 8/8h D2/4"],
    problemas: [["CAD", "alta"], ["Hipocalemia", "alta"], ["Infecção de pé diabético", "media"]],
    pendencias: [["Reposição de potássio", "alta"], ["Curativo do pé diabético", "media"]],
    conduta: "Insulinoterapia EV, reposição de potássio, hidratação vigorosa.",
    glicemia: [485, 380, 240, 145],
    labs: {
      K: [6.2, 3.8, 3.2, 3.9],
      pH: [7.18, 7.25, 7.32, 7.38],
      Cr: [1.8, 1.5, 1.2, 1.0],
      HCO3: [10, 14, 18, 22],
    },
  },
  {
    pront: "0990008", nome: "Pedro H. M.", idade: 68, leito: "B5", dias: 6,
    status: "revisar", clinico: "melhora",
    diag: "Exacerbação grave de DPOC",
    comorb: ["DPOC GOLD IV", "Tabagismo ativo", "HAS"],
    muc: ["Teofilina", "Salbutamol inalatório", "Brometo de ipratrópio"],
    atb: ["Azitromicina 500mg 1x/dia D4/6"],
    extras: [{ texto: "Metilprednisolona 40mg EV", classe: "Corticoide" }],
    problemas: [["DPOC exacerbado", "alta"], ["Insuficiência respiratória", "alta"]],
    pendencias: [["Desmame de corticoide", "media"], ["Reavaliar VNI", "media"]],
    conduta: "Broncodilatador, corticoide, VNI conforme necessidade.",
    sato2: [82, 85, 87, 89, 91, 92],
    fr: [32, 30, 28, 26, 24, 22],
    labs: {
      PCO2: [58, 55, 52, 49, 46, 44],
      PCR: [95, 88, 72, 55, 38, 22],
    },
  },
  {
    pront: "0990009", nome: "Luciana F. T.", idade: 42, leito: "UTI-1", dias: 21,
    status: "pendente", clinico: "estavel",
    diag: "Endocardite infecciosa em valva mitral",
    comorb: ["Cardiopatia reumática", "HAS"],
    muc: ["Furosemida", "Digoxina"],
    atb: ["Oxacilina 2g EV 4/4h D18/42", "Gentamicina D1/14"],
    problemas: [["Endocardite infecciosa", "alta"], ["Anemia", "media"], ["Nefrotoxicidade", "media"]],
    pendencias: [["Ecocardiograma seriado", "alta"], ["Monitorar função renal", "alta"]],
    conduta: "Antibioticoterapia prolongada, controle de função renal, eco seriado.",
    temp: [38.8, 38.5, 38.0, 37.8, 37.5, 37.2, 36.9],
    labs: {
      Hb: [11.0, 10.5, 10.2, 9.8, 9.5, 9.2, 9.0, 9.1, 9.3],
      PCR: [210, 195, 180, 155, 120, 90, 65, 45, 28, 15],
      Cr: [1.1, 1.2, 1.4, 1.6, 1.4, 1.2, 1.0, 0.9],
    },
  },
  {
    pront: "0990010", nome: "Beatriz O. C.", idade: 71, leito: "306-2", dias: 9,
    status: "pendente", clinico: "piora",
    diag: "Massa pélvica — provável neoplasia ovariana",
    comorb: ["Nega comorbidades"],
    muc: ["Nega"],
    problemas: [["Massa pélvica", "alta"], ["Ascite neoplásica", "alta"], ["Derrame pleural paraneoplásico", "alta"]],
    pendencias: [["Dosagem de CA-125", "alta"], ["Estadiamento por imagem", "alta"]],
    conduta: "Investigação oncológica, marcadores tumorais, estadiamento.",
    labs: {
      Hb: [10.5, 10.2, 9.8, 9.5, 9.2, 9.0, 8.8, 8.6, 8.5],
      Na: [132, 130, 129, 128, 127, 128, 129],
      Plaq: [490000, 510000, 530000, 520000, 490000],
      PCR: [95.3, 88, 75, 68, 60],
    },
  },
  {
    pront: "0990011", nome: "Antônio M. V.", idade: 63, leito: "UTI-2", dias: 3,
    status: "pendente", clinico: "estavel",
    diag: "IAM com supra de ST em parede anterior",
    comorb: ["HAS", "DM2", "Tabagismo", "Dislipidemia"],
    muc: ["AAS 100mg", "Clopidogrel 75mg", "Atorvastatina 80mg", "Metoprolol"],
    problemas: [["IAM", "alta"], ["ICC Killip II", "alta"], ["DM2", "media"]],
    pendencias: [["Ecocardiograma pós-IAM", "alta"], ["Reabilitação cardíaca", "media"]],
    conduta: "Dupla antiagregação, estatina de alta potência, monitorização contínua.",
    pa: ["100/65", "110/70", "118/75"],
    fc: [105, 95, 85],
    glicemia: [245, 190, 155],
    intercNote: "Troponina elevada na admissão, em queda.",
    labs: { Cr: [1.3, 1.5, 1.7] },
  },
  {
    pront: "0990012", nome: "Sônia R. B.", idade: 48, leito: "C3", dias: 10,
    status: "pendente", clinico: "melhora",
    diag: "Pancreatite aguda grave biliar",
    comorb: ["Colelitíase", "Obesidade", "HAS"],
    muc: ["Enalapril 10mg"],
    atb: ["Imipenem 500mg EV 6/6h D5/10"],
    problemas: [["Pancreatite grave", "alta"], ["Íleo paralítico", "media"]],
    pendencias: [["Programar colecistectomia", "media"], ["Reintrodução de dieta", "media"]],
    conduta: "Jejum, hidratação vigorosa, analgesia, antibioticoterapia.",
    labs: {
      PCR: [320, 380, 410, 390, 350, 280, 200, 140, 85, 45],
      Cr: [2.1, 2.4, 2.8, 2.5, 2.1, 1.7, 1.3, 1.0],
      Amilase: [1850, 1420, 980, 650, 380, 220, 120],
      Hb: [13.2, 12.8, 12.1, 11.8, 11.5, 11.8, 12.0],
    },
  },
  {
    pront: "0990013", nome: "Gabriel L. S.", idade: 22, leito: "D4", dias: 5,
    status: "naoVisitado", clinico: "melhora",
    diag: "Meningite bacteriana (provável pneumocócica)",
    comorb: ["Nega"],
    muc: ["Nega"],
    atb: ["Ceftriaxona 2g EV 12/12h D5", "Dexametasona D1/4"],
    problemas: [["Meningite bacteriana", "alta"], ["Rebaixamento de consciência", "alta"]],
    pendencias: [["Isolamento respiratório", "alta"], ["TC de crânio se piora", "media"]],
    conduta: "Antibioticoterapia, dexametasona, isolamento respiratório.",
    temp: [39.8, 39.2, 38.5, 37.9, 37.2],
    glasgow: [10, 11, 12, 13, 14],
    labs: {
      PCR: [180, 165, 130, 85, 40],
      LT: [22000, 19500, 15000, 11000, 8200],
      Na: [138, 135, 132, 134, 136],
    },
  },
  {
    pront: "0990014", nome: "Helena C. N.", idade: 76, leito: "A2", dias: 6,
    status: "naoVisitado", clinico: "estavel",
    diag: "IRA pós-contraste iodado",
    comorb: ["DM2", "HAS", "IRC prévia (Cr basal 1.4)"],
    muc: ["Insulina NPH", "Losartana (suspensa)", "Furosemida (suspensa)"],
    problemas: [["IRA", "alta"], ["Hipervolemia", "media"], ["DM2", "media"]],
    pendencias: [["Controle rigoroso de potássio", "alta"], ["Suspender nefrotóxicos", "alta"]],
    conduta: "Hidratação, suspensão de nefrotóxicos, controle de potássio e diurese.",
    intercNote: "Evolução de oligúria para poliúria a partir do dia 4.",
    labs: {
      Cr: [1.4, 2.2, 3.1, 3.8, 3.4, 2.8],
      K: [4.2, 4.8, 5.4, 5.8, 5.2, 4.6],
      Hb: [10.8, 10.5, 10.2, 10.0, 10.2, 10.5],
    },
  },
  {
    pront: "0990015", nome: "Cláudia M. R.", idade: 52, leito: "B3", dias: 8,
    status: "altaProvavel", clinico: "melhora",
    diag: "Pielonefrite complicada",
    comorb: ["DM2", "HAS"],
    muc: ["Metformina", "Enalapril"],
    atb: ["Ciprofloxacino 400mg EV 12/12h → oral D6/10"],
    problemas: [["Pielonefrite", "alta", "resolvendo"], ["DM2", "baixa"]],
    pendencias: [["Receita de alta", "media"], ["Orientações de seguimento", "baixa"]],
    conduta: "Antibioticoterapia oral, programar alta, orientações de seguimento.",
    temp: [39.1, 38.5, 37.9, 37.4, 36.9, 36.7, 36.6, 36.5],
    labs: {
      PCR: [145, 120, 95, 68, 42, 25, 14, 8],
      Cr: [1.6, 1.4, 1.2, 1.0, 0.9, 0.9, 0.9, 0.9],
      LT: [14500, 12000, 9500, 8000, 7200, 7000],
    },
  },
];

const SV_VAZIO = {
  temp: "", paSist: "", paDiast: "", fc: "", fr: "", sato2: "",
  glicemia: "", diurese: "", o2: null, intercorrencias: "",
};
const EVOLUCAO_BASE = {
  nivelConsciencia: null, orientacao: null, estadoGeral: "", alimentacao: null,
  diurese: null, evacuacao: null, dispositivos: [], dispositivosObs: {},
  exameFisico: "", condutaDoDia: "",
};

/** Monta sinais vitais de um dia a partir das séries do paciente. */
function sinaisDoDia(p, i, N) {
  const sv = { ...SV_VAZIO };
  const pa = noDia(p.pa, i, N);
  if (pa) {
    const [s, d] = pa.split("/");
    sv.paSist = s || "";
    sv.paDiast = d || "";
  }
  const fc = noDia(p.fc, i, N);
  if (fc != null) sv.fc = String(fc);
  const fr = noDia(p.fr, i, N);
  if (fr != null) sv.fr = String(fr);
  const sato2 = noDia(p.sato2, i, N);
  if (sato2 != null) sv.sato2 = String(sato2);
  const temp = noDia(p.temp, i, N);
  if (temp != null) sv.temp = String(temp);
  const glic = noDia(p.glicemia, i, N);
  if (glic != null) sv.glicemia = String(glic);
  const intercs = [];
  const g = noDia(p.glasgow, i, N);
  if (g != null) intercs.push(`Glasgow ${g}`);
  if (i === N - 1 && p.intercNote) intercs.push(p.intercNote);
  sv.intercorrencias = intercs.join(" · ");
  return sv;
}

/** Mapa exame→valor formatado dos labs de um dia. */
function labsDoDia(p, i, N) {
  const o = {};
  for (const [exame, serie] of Object.entries(p.labs || {})) {
    const v = noDia(serie, i, N);
    if (v != null) o[exame] = val(v, UNID[exame] || "");
  }
  return o;
}

/** Constrói o objeto Paciente (JSONB dados) + os snapshots diários. */
function construir(p, medicoId) {
  const N = p.dias;
  const datas = datasInternacao(N);
  const setor = /UTI/i.test(p.leito) ? "UTI" : "Clínica Médica";

  const problemas = (p.problemas || []).map((t, idx) => ({
    id: `${p.pront}-prob-${idx}`,
    titulo: t[0],
    prioridade: t[1],
    status: t[2] || "ativo",
    observacao: "",
    conduta: "",
  }));
  const pendencias = (p.pendencias || []).map((t, idx) => ({
    id: `${p.pront}-pend-${idx}`,
    descricao: t[0],
    prioridade: t[1],
    feito: false,
  }));
  const medicamentos = [
    ...(p.muc || []).map((t, idx) => ({ id: `${p.pront}-muc-${idx}`, texto: t, classe: "Uso contínuo" })),
    ...(p.atb || []).map((t, idx) => ({ id: `${p.pront}-atb-${idx}`, texto: t, classe: "Antibiótico" })),
    ...(p.extras || []).map((e, idx) => ({ id: `${p.pront}-ext-${idx}`, texto: e.texto, classe: e.classe })),
  ];

  // resultadosLab: toda a série, dia a dia, para a evolução temporal no app.
  const resultadosLab = [];
  for (const [exame, serie] of Object.entries(p.labs || {})) {
    for (let i = 0; i < N; i++) {
      const v = noDia(serie, i, N);
      if (v != null) {
        resultadosLab.push({
          id: `${p.pront}-${exame}-${i}`,
          exame,
          data: datas[i],
          valor: val(v, UNID[exame] || ""),
        });
      }
    }
  }

  const svHoje = sinaisDoDia(p, N - 1, N);
  const hoje = datas[N - 1];
  const evolucaoHoje = { ...EVOLUCAO_BASE, condutaDoDia: p.conduta };

  const dados = {
    id: p.pront,
    nomeCompleto: p.nome,
    idade: p.idade,
    leito: p.leito,
    setor,
    dataEntrada: datas[0],
    numeroProntuario: p.pront,
    status: p.status,
    hospitalId: HOSPITAL.id,
    diagnosticoPrincipal: p.diag,
    motivoInternacao: p.diag,
    statusClinico: p.clinico,
    resumoRapido: `${p.diag} · D${N}`,
    problemas,
    pendencias,
    medicamentos,
    resultadosLab,
    sinaisVitais: { [hoje]: svHoje },
    evolucoes: { [hoje]: evolucaoHoje },
    diasAcompanhamento: datas,
    dadosClinicos: {
      motivoInternacao: p.diag,
      comorbidades: (p.comorb || []).join(", "),
      examesRecentes: "",
      sinaisVitais: "",
      intercorrencias: "",
    },
    secoes: {
      comorbidadesMedicacoes: {
        anotacoes: [],
        extraido:
          `Comorbidades: ${(p.comorb || []).join(", ") || "—"}\n` +
          `MUC: ${(p.muc || []).join(", ") || "—"}`,
      },
    },
  };

  // Snapshots diários (evolucoes_diarias).
  const snapshots = datas.map((data, i) => ({
    data,
    sinais_vitais: sinaisDoDia(p, i, N),
    exames_laboratoriais: labsDoDia(p, i, N),
    conduta: p.conduta,
    problemas_ativos: problemas.map((x) => x.titulo),
  }));

  return { dados, snapshots };
}

// ── Execução ────────────────────────────────────────────────────────────────
async function main() {
  // 1) Usuário (upsert por email).
  const senhaHash = await bcrypt.hash(USUARIO.senha, 10);
  const existente = await db.query("SELECT id FROM usuarios WHERE email = $1", [
    USUARIO.email,
  ]);
  let medicoId;
  if (existente.rows[0]) {
    medicoId = existente.rows[0].id;
    await db.query(
      `UPDATE usuarios
          SET nome = $1, senha_hash = $2, categoria = $3, especialidade = $4,
              nome_exibicao = $1, plano = 'trial',
              trial_inicio = NOW(),
              trial_fim = NOW() + INTERVAL '90 days'
        WHERE id = $5`,
      [USUARIO.nome, senhaHash, USUARIO.categoria, USUARIO.especialidade, medicoId],
    );
    console.log(`Usuário atualizado: ${USUARIO.email} (${medicoId})`);
  } else {
    medicoId = crypto.randomUUID();
    await db.query(
      `INSERT INTO usuarios
         (id, nome, email, senha_hash, categoria, especialidade, nome_exibicao, plano, trial_inicio, trial_fim)
       VALUES ($1, $2, $3, $4, $5, $6, $2, 'trial', NOW(), NOW() + INTERVAL '90 days')`,
      [medicoId, USUARIO.nome, USUARIO.email, senhaHash, USUARIO.categoria, USUARIO.especialidade],
    );
    console.log(`Usuário criado: ${USUARIO.email} (${medicoId})`);
  }

  // 2) Hospital (upsert).
  await db.query(
    `INSERT INTO hospitais (id, medico_id, nome, cidade, cnes, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome, cidade = EXCLUDED.cidade,
           cnes = COALESCE(EXCLUDED.cnes, hospitais.cnes), updated_at = NOW()`,
    [HOSPITAL.id, medicoId, HOSPITAL.nome, HOSPITAL.cidade, HOSPITAL.cnes],
  );
  console.log(`Hospital vinculado: ${HOSPITAL.nome} (CNES ${HOSPITAL.cnes})`);

  // 3) Pacientes + evolucoes_diarias.
  let totalPac = 0;
  let totalSnap = 0;
  for (const p of PAC) {
    const { dados, snapshots } = construir(p, medicoId);
    await db.query(
      `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [dados.id, medicoId, HOSPITAL.id, dados.dataEntrada, dados],
    );
    totalPac++;
    for (const s of snapshots) {
      const r = await db.query(
        `INSERT INTO evolucoes_diarias
           (paciente_id, medico_id, data, sinais_vitais, exames_laboratoriais, conduta, problemas_ativos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (paciente_id, medico_id, data) DO NOTHING`,
        [
          dados.id, medicoId, s.data,
          JSON.stringify(s.sinais_vitais),
          JSON.stringify(s.exames_laboratoriais),
          s.conduta,
          JSON.stringify(s.problemas_ativos),
        ],
      );
      totalSnap += r.rowCount;
    }
    console.log(`  • ${p.nome} (D${p.dias}, ${p.status}) — ${snapshots.length} snapshots`);
  }

  console.log(`\nConcluído: ${totalPac} pacientes, ${totalSnap} snapshots diários inseridos.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed:", e);
  process.exit(1);
});
