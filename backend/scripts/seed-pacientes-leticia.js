/**
 * SEED — os mesmos 15 pacientes do Junior, agora na conta da Letícia, hospital
 * Unimed. Reaproveita os dados/builders de seed-pacientes.js.
 *
 * Diferenças em relação ao seed do Junior:
 *  - NÃO cria nem altera o usuário (usa a Letícia existente; não toca senha/nome).
 *  - Usa o hospital "Unimed" da Letícia (acha ou cria).
 *  - Usa prontuários distintos (099xxxx → 098xxxx) para não colidir com os do
 *    Junior (a PK de pacientes é o prontuário; IDs iguais seriam ignorados pelo
 *    ON CONFLICT DO NOTHING e ficariam vinculados ao Junior).
 *
 * Rodar (a partir da RAIZ do repo, p/ o dotenv achar o .env com DATABASE_URL):
 *   node backend/scripts/seed-pacientes-leticia.js
 */

require("dotenv").config();
const crypto = require("crypto");

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ DATABASE_URL ausente. Rode a partir da raiz do repo (node backend/scripts/" +
      "seed-pacientes-leticia.js) ou defina a URL pública do Postgres do Railway.",
  );
  process.exit(1);
}

const db = require("../db");
const { PAC, construir } = require("./seed-pacientes");

const EMAIL_LETICIA = "lets_966@hotmail.com";
const HOSPITAL = { nome: "Unimed", cidade: "Criciúma" };

async function main() {
  // 1) Usuário da Letícia (existente — não cria, não altera credenciais).
  const u = await db.query(
    "SELECT id, nome FROM usuarios WHERE email = $1",
    [EMAIL_LETICIA],
  );
  if (!u.rows[0]) {
    console.error(`✗ Usuário não encontrado para o email: ${EMAIL_LETICIA}`);
    await db.pool.end();
    process.exit(1);
  }
  const medicoId = u.rows[0].id;
  console.log(`Usuário: ${u.rows[0].nome} (id: ${medicoId})`);

  // 2) Hospital Unimed (acha ou cria) vinculado à Letícia.
  let hospitalId;
  const existente = await db.query(
    "SELECT id FROM hospitais WHERE medico_id = $1 AND nome ILIKE 'Unimed' LIMIT 1",
    [medicoId],
  );
  if (existente.rows[0]) {
    hospitalId = existente.rows[0].id;
    console.log(`Hospital: ${HOSPITAL.nome} (id: ${hospitalId}) — já existia`);
  } else {
    hospitalId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hospitais (id, medico_id, nome, cidade, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [hospitalId, medicoId, HOSPITAL.nome, HOSPITAL.cidade],
    );
    console.log(`Hospital: ${HOSPITAL.nome} (id: ${hospitalId}) — criado`);
  }

  // 3) Pacientes + evolucoes_diarias, com prontuários distintos.
  let totalPac = 0;
  let totalSnap = 0;
  for (const base of PAC) {
    const p = { ...base, pront: base.pront.replace(/^099/, "098") };
    const { dados, snapshots } = construir(p, hospitalId);
    await db.query(
      `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [dados.id, medicoId, hospitalId, dados.dataEntrada, dados],
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
  console.error("Falha no seed da Letícia:", e);
  process.exit(1);
});
