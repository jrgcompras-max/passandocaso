/**
 * SEED — 3 pacientes no hospital "Geral" da Letícia, para testes.
 * Com sexo (referências por sexo) e labs por dia (histórico temporal + alertas).
 *
 * Rodar a partir da RAIZ do repo:
 *   node backend/scripts/seed-leticia-geral.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Rode a partir da raiz do repo.");
  process.exit(1);
}

const db = require("../db");

const EMAIL_LETICIA = "lets_966@hotmail.com";
const HOSPITAL_ID = "geral";

const UNID = {
  Cr: "mg/dL", PCR: "mg/L", LT: "/mm³", Hb: "g/dL", Na: "mEq/L",
  K: "mEq/L", Ureia: "mg/dL", Plaq: "/mm³",
};
const val = (k, v) => (UNID[k] ? `${v} ${UNID[k]}` : String(v));

function isoMenosDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SV_VAZIO = {
  temp: "", paSist: "", paDiast: "", fc: "", fr: "", sato2: "",
  glicemia: "", diurese: "", o2: null, intercorrencias: "",
};
const EVOLUCAO_BASE = {
  nivelConsciencia: null, orientacao: null, estadoGeral: "", alimentacao: null,
  diurese: null, evacuacao: null, dispositivos: [], dispositivosObs: {},
  exameFisico: "", condutaDoDia: "",
};

const PACIENTES = [
  {
    pront: "0950001", nome: "Helena V. P.", idade: 68, sexo: "F", leito: "12",
    status: "visitado", clinico: "melhora",
    diag: "Pneumonia comunitária",
    conduta: "Antibioticoterapia, oxigenoterapia, fisioterapia respiratória.",
    problemas: [["Pneumonia", "alta"], ["Anemia", "media"]],
    dias: [
      { PCR: 180, Hb: 10.4, LT: 16000, Na: 138 },
      { PCR: 150, Hb: 10.2, LT: 14000, Na: 137 },
      { PCR: 110, Hb: 10.0, LT: 11000, Na: 138 },
      { PCR: 70, Hb: 10.1, LT: 9000, Na: 139 },
      { PCR: 40, Hb: 10.3, LT: 8000, Na: 140 },
      { PCR: 18, Hb: 10.5, LT: 7500, Na: 140 },
    ],
  },
  {
    pront: "0950002", nome: "Rui A. M.", idade: 59, sexo: "M", leito: "8",
    status: "revisar", clinico: "estavel",
    diag: "Injúria renal aguda",
    conduta: "Hidratação, suspensão de nefrotóxicos, controle de potássio.",
    problemas: [["IRA", "alta"], ["Hipercalemia", "alta"]],
    dias: [
      { Cr: 1.4, K: 5.0, Ureia: 80, Hb: 12.8 },
      { Cr: 2.1, K: 5.3, Ureia: 110, Hb: 12.6 },
      { Cr: 2.6, K: 5.1, Ureia: 130, Hb: 12.4 },
      { Cr: 2.2, K: 4.8, Ureia: 100, Hb: 12.5 },
      { Cr: 1.7, K: 4.5, Ureia: 70, Hb: 12.7 },
    ],
  },
  {
    pront: "0950003", nome: "Sofia L. T.", idade: 74, sexo: "F", leito: "20",
    status: "pendente", clinico: "melhora",
    diag: "Hiponatremia sintomática",
    conduta: "Restrição hídrica, reposição cautelosa de sódio.",
    problemas: [["Hiponatremia", "alta"]],
    dias: [
      { Na: 123, K: 3.4, Cr: 1.1, Hb: 11.8 },
      { Na: 121, K: 3.6, Cr: 1.1, Hb: 11.7 },
      { Na: 124, K: 3.8, Cr: 1.0, Hb: 11.8 },
      { Na: 127, K: 4.0, Cr: 1.0, Hb: 11.9 },
      { Na: 130, K: 4.1, Cr: 0.9, Hb: 12.0 },
      { Na: 133, K: 4.2, Cr: 0.9, Hb: 12.0 },
      { Na: 135, K: 4.3, Cr: 0.9, Hb: 12.1 },
    ],
  },
];

function construir(p, medicoId) {
  const N = p.dias.length;
  const datas = [];
  for (let i = N - 1; i >= 0; i--) datas.push(isoMenosDias(i));
  const hoje = datas[N - 1];

  const problemas = p.problemas.map((t, idx) => ({
    id: `${p.pront}-prob-${idx}`,
    titulo: t[0], prioridade: t[1], status: "ativo", observacao: "", conduta: "",
  }));

  const resultadosLab = [];
  datas.forEach((data, i) => {
    for (const [k, v] of Object.entries(p.dias[i])) {
      resultadosLab.push({ id: `${p.pront}-${k}-${i}`, exame: k, data, valor: val(k, v) });
    }
  });

  const dados = {
    id: p.pront, nomeCompleto: p.nome, idade: p.idade, sexo: p.sexo,
    leito: p.leito, setor: "Clínica Médica", dataEntrada: datas[0],
    numeroProntuario: p.pront, status: p.status, hospitalId: HOSPITAL_ID,
    diagnosticoPrincipal: p.diag, motivoInternacao: p.diag, statusClinico: p.clinico,
    resumoRapido: `${p.diag} · D${N}`,
    problemas, pendencias: [], medicamentos: [], resultadosLab,
    sinaisVitais: { [hoje]: { ...SV_VAZIO } },
    evolucoes: { [hoje]: { ...EVOLUCAO_BASE, condutaDoDia: p.conduta } },
    diasAcompanhamento: datas,
    dadosClinicos: { motivoInternacao: p.diag, comorbidades: "", examesRecentes: "", sinaisVitais: "", intercorrencias: "" },
    secoes: {},
  };

  const snapshots = datas.map((data, i) => {
    const labs = {};
    for (const [k, v] of Object.entries(p.dias[i])) labs[k] = val(k, v);
    return { data, exames_laboratoriais: labs, conduta: p.conduta, problemas_ativos: problemas.map((x) => x.titulo) };
  });

  return { dados, snapshots };
}

async function main() {
  await db.initDB();
  const u = await db.query("SELECT id, nome FROM usuarios WHERE email = $1", [EMAIL_LETICIA]);
  if (!u.rows[0]) {
    console.error(`✗ Usuário não encontrado: ${EMAIL_LETICIA}`);
    await db.pool.end();
    process.exit(1);
  }
  const medicoId = u.rows[0].id;
  console.log(`Usuário: ${u.rows[0].nome} (id: ${medicoId}) · hospital: ${HOSPITAL_ID}`);

  let totalSnap = 0;
  for (const p of PACIENTES) {
    const { dados, snapshots } = construir(p, medicoId);
    await db.query(
      `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (id) DO UPDATE
         SET medico_id = EXCLUDED.medico_id, hospital_id = EXCLUDED.hospital_id,
             dados = EXCLUDED.dados, updated_at = NOW()`,
      [dados.id, medicoId, HOSPITAL_ID, dados.dataEntrada, dados],
    );
    for (const s of snapshots) {
      const r = await db.query(
        `INSERT INTO evolucoes_diarias
           (paciente_id, medico_id, data, exames_laboratoriais, conduta, problemas_ativos)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (paciente_id, medico_id, data) DO UPDATE
           SET exames_laboratoriais = EXCLUDED.exames_laboratoriais`,
        [dados.id, medicoId, s.data, JSON.stringify(s.exames_laboratoriais), s.conduta, JSON.stringify(s.problemas_ativos)],
      );
      totalSnap += r.rowCount;
    }
    console.log(`  • ${p.nome} (${p.sexo}, D${p.dias.length}, ${p.status})`);
  }
  console.log(`\nConcluído: ${PACIENTES.length} pacientes no Geral, ${totalSnap} snapshots.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed Geral:", e);
  process.exit(1);
});
