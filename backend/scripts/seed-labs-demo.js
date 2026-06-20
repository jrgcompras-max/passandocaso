/**
 * SEED — 2 pacientes demo focados em histórico temporal de labs + referências
 * da ontologia (LOINC). Vinculados à conta do Junior, hospital Unimed.
 *
 * Rodar a partir da RAIZ do repo (p/ o dotenv achar o .env com DATABASE_URL):
 *   node backend/scripts/seed-labs-demo.js
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ DATABASE_URL ausente. Rode a partir da raiz do repo (node backend/scripts/seed-labs-demo.js).",
  );
  process.exit(1);
}

const db = require("../db");

const EMAIL_JUNIOR = "jrg_compras@hotmail.com";

// Unidades por lab (casam com a ontologia/LOINC e os matchers de alerta).
const UNID = {
  Cr: "mg/dL", PCR: "mg/L", LT: "/mm³", Hb: "g/dL", Na: "mEq/L",
  K: "mEq/L", BT: "mg/dL", Albumina: "g/dL",
};

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

// dias[i] = { Cr, PCR, ... } do Dia (i+1); Dia 1 = mais antigo, último = hoje.
const PACIENTES = [
  {
    pront: "0960001", nome: "Diana M. C.", idade: 54, leito: "UTI-2",
    status: "visitado", clinico: "melhora",
    diag: "Sepse de foco pulmonar + IRA",
    conduta: "Antibioticoterapia guiada, hidratação, controle de função renal.",
    problemas: [["Sepse", "alta"], ["IRA", "alta"]],
    dias: [
      { Cr: 3.8, PCR: 280, LT: 22000, Hb: 10.2, Na: 138, K: 5.1 },
      { Cr: 4.2, PCR: 310, LT: 25000, Hb: 10.0, Na: 136, K: 5.4 },
      { Cr: 4.5, PCR: 290, LT: 21000, Hb: 9.8, Na: 135, K: 5.2 },
      { Cr: 3.9, PCR: 240, LT: 17000, Hb: 9.6, Na: 136, K: 4.9 },
      { Cr: 3.2, PCR: 180, LT: 13000, Hb: 9.5, Na: 137, K: 4.6 },
      { Cr: 2.4, PCR: 120, LT: 10000, Hb: 9.6, Na: 138, K: 4.3 },
      { Cr: 1.8, PCR: 65, LT: 8500, Hb: 9.8, Na: 139, K: 4.1 },
      { Cr: 1.2, PCR: 30, LT: 7200, Hb: 10.0, Na: 140, K: 4.0 },
    ],
  },
  {
    pront: "0960002", nome: "Marcos T. R.", idade: 63, leito: "C4",
    status: "pendente", clinico: "melhora",
    diag: "Cirrose Child C + Hiponatremia + Encefalopatia",
    conduta: "Restrição hídrica, lactulose, reposição cautelosa de eletrólitos.",
    problemas: [["Cirrose Child C", "alta"], ["Hiponatremia", "alta"], ["Encefalopatia hepática", "media"]],
    dias: [
      { Na: 122, K: 3.1, Cr: 1.8, Hb: 9.0, BT: 8.2, Albumina: 2.0, PCR: 45 },
      { Na: 120, K: 2.9, Cr: 2.0, Hb: 8.8, BT: 9.1, Albumina: 1.9, PCR: 42 },
      { Na: 119, K: 3.2, Cr: 2.2, Hb: 8.7, BT: 8.8, Albumina: 1.9, PCR: 38 },
      { Na: 121, K: 3.5, Cr: 2.0, Hb: 8.8, BT: 8.5, Albumina: 2.0, PCR: 35 },
      { Na: 124, K: 3.6, Cr: 1.8, Hb: 8.9, BT: 7.9, Albumina: 2.1, PCR: 30 },
      { Na: 127, K: 3.8, Cr: 1.6, Hb: 9.0, BT: 7.2, Albumina: 2.2, PCR: 25 },
      { Na: 130, K: 4.0, Cr: 1.4, Hb: 9.2, BT: 6.8, Albumina: 2.3, PCR: 20 },
      { Na: 132, K: 4.1, Cr: 1.3, Hb: 9.3, BT: 6.5, Albumina: 2.3, PCR: 16 },
      { Na: 134, K: 4.2, Cr: 1.2, Hb: 9.4, BT: 6.2, Albumina: 2.4, PCR: 12 },
      { Na: 136, K: 4.3, Cr: 1.1, Hb: 9.5, BT: 5.8, Albumina: 2.5, PCR: 9 },
    ],
  },
];

const val = (k, v) => (UNID[k] ? `${v} ${UNID[k]}` : String(v));

function construir(p, medicoId, hospitalId) {
  const N = p.dias.length;
  const datas = [];
  for (let i = N - 1; i >= 0; i--) datas.push(isoMenosDias(i)); // asc, último = hoje
  const hoje = datas[N - 1];
  const setor = /UTI/i.test(p.leito) ? "UTI" : "Clínica Médica";

  const problemas = p.problemas.map((t, idx) => ({
    id: `${p.pront}-prob-${idx}`,
    titulo: t[0], prioridade: t[1], status: "ativo", observacao: "", conduta: "",
  }));

  const resultadosLab = [];
  datas.forEach((data, i) => {
    const d = p.dias[i];
    for (const [k, v] of Object.entries(d)) {
      resultadosLab.push({ id: `${p.pront}-${k}-${i}`, exame: k, data, valor: val(k, v) });
    }
  });

  const dados = {
    id: p.pront,
    nomeCompleto: p.nome,
    idade: p.idade,
    leito: p.leito,
    setor,
    dataEntrada: datas[0],
    numeroProntuario: p.pront,
    status: p.status,
    hospitalId,
    diagnosticoPrincipal: p.diag,
    motivoInternacao: p.diag,
    statusClinico: p.clinico,
    resumoRapido: `${p.diag} · D${N}`,
    problemas,
    pendencias: [],
    medicamentos: [],
    resultadosLab,
    sinaisVitais: { [hoje]: { ...SV_VAZIO } },
    evolucoes: { [hoje]: { ...EVOLUCAO_BASE, condutaDoDia: p.conduta } },
    diasAcompanhamento: datas,
    dadosClinicos: {
      motivoInternacao: p.diag, comorbidades: "", examesRecentes: "",
      sinaisVitais: "", intercorrencias: "",
    },
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

  const u = await db.query("SELECT id, nome FROM usuarios WHERE email = $1", [EMAIL_JUNIOR]);
  if (!u.rows[0]) {
    console.error(`✗ Usuário não encontrado: ${EMAIL_JUNIOR}`);
    await db.pool.end();
    process.exit(1);
  }
  const medicoId = u.rows[0].id;
  console.log(`Usuário: ${u.rows[0].nome} (id: ${medicoId})`);

  const h = await db.query(
    "SELECT id, nome FROM hospitais WHERE medico_id = $1 AND nome ILIKE '%unimed%' ORDER BY nome LIMIT 1",
    [medicoId],
  );
  if (!h.rows[0]) {
    console.error("✗ Hospital 'Unimed' não encontrado para o Junior.");
    await db.pool.end();
    process.exit(1);
  }
  const hospitalId = h.rows[0].id;
  console.log(`Hospital: ${h.rows[0].nome} (id: ${hospitalId})`);

  let totalSnap = 0;
  for (const p of PACIENTES) {
    const { dados, snapshots } = construir(p, medicoId, hospitalId);
    await db.query(
      `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (id) DO UPDATE
         SET medico_id = EXCLUDED.medico_id, hospital_id = EXCLUDED.hospital_id,
             dados = EXCLUDED.dados, updated_at = NOW()`,
      [dados.id, medicoId, hospitalId, dados.dataEntrada, dados],
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
    console.log(`  • ${p.nome} (D${p.dias.length}, ${p.status}) — ${snapshots.length} dias de labs`);
  }

  console.log(`\nConcluído: ${PACIENTES.length} pacientes demo, ${totalSnap} snapshots.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha no seed de labs demo:", e);
  process.exit(1);
});
