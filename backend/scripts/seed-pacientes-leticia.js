/**
 * SEED — os mesmos 15 pacientes do Junior, agora na conta da Letícia, hospital
 * Unimed. Reaproveita os dados/builders de seed-pacientes.js.
 *
 * Diferenças em relação ao seed do Junior:
 *  - NÃO cria nem altera o usuário (usa a Letícia existente; não toca senha/nome).
 *  - Usa o hospital "Unimed" que a Letícia já cadastrou (acha pelo nome; não cria).
 *  - Usa prontuários distintos (099xxxx → 098xxxx) para não colidir com os do
 *    Junior (a PK de pacientes é o prontuário; IDs iguais seriam ignorados pelo
 *    ON CONFLICT DO NOTHING e ficariam vinculados ao Junior).
 *
 * Rodar (a partir da RAIZ do repo, p/ o dotenv achar o .env com DATABASE_URL):
 *   node backend/scripts/seed-pacientes-leticia.js
 */

require("dotenv").config();
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
// Prefixo dos prontuários desta conta. Mantemos distinto do Junior (099) e do
// primeiro seed da Letícia (098, que ficou "fantasma" no cache do app apontando
// para um hospital deletado). 097 nunca foi visto pelo cache → entra como novo.
const PRONT_PREFIX = "097";

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

  // 2) Hospital Unimed da Letícia (já cadastrado por ela no app). Acha pelo nome
  //    — NÃO cria, para não gerar um hospital duplicado/errado.
  const hosp = await db.query(
    "SELECT id, nome FROM hospitais WHERE medico_id = $1 AND nome ILIKE '%unimed%' ORDER BY nome LIMIT 1",
    [medicoId],
  );
  if (!hosp.rows[0]) {
    console.error("✗ Hospital 'Unimed' não encontrado para a Letícia. Cadastre-o no app primeiro.");
    const todos = await db.query(
      "SELECT id, nome, cidade FROM hospitais WHERE medico_id = $1 ORDER BY nome",
      [medicoId],
    );
    console.error("Hospitais da Letícia (debug):");
    for (const h of todos.rows) console.error(`  - ${h.nome} | ${h.cidade || "—"} | id: ${h.id}`);
    await db.pool.end();
    process.exit(1);
  }
  const hospitalId = hosp.rows[0].id;
  console.log(`Hospital: ${hosp.rows[0].nome} (id: ${hospitalId})`);

  // 3) Pacientes + evolucoes_diarias, com prontuários distintos.
  let totalPac = 0;
  let totalSnap = 0;
  for (const base of PAC) {
    const p = { ...base, pront: base.pront.replace(/^099/, PRONT_PREFIX) };
    const { dados, snapshots } = construir(p, hospitalId);
    await db.query(
      `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE
         SET medico_id = EXCLUDED.medico_id,
             hospital_id = EXCLUDED.hospital_id,
             dados = EXCLUDED.dados,
             updated_at = NOW()`,
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
