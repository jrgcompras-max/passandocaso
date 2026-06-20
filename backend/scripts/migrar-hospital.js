/**
 * MIGRAÇÃO — move os pacientes da Letícia do "N. Sra. Conceição" para "Unimed".
 *
 * Atualiza tanto a coluna pacientes.hospital_id quanto o campo hospitalId dentro
 * do JSONB dados (o app filtra a lista por dados.hospitalId — atualizar só a
 * coluna não moveria os pacientes na tela).
 *
 * Rodar:
 *   cd backend && node scripts/migrar-hospital.js
 */

require("dotenv").config();
const crypto = require("crypto");
const db = require("../db");

const EMAIL_LETICIA = "leticiasoares655@gmail.com";

async function main() {
  // 1) Usuário da Letícia.
  const u = await db.query(
    "SELECT id, nome FROM usuarios WHERE email = $1",
    [EMAIL_LETICIA],
  );
  if (!u.rows[0]) {
    console.error(`✗ Usuário não encontrado para o email: ${EMAIL_LETICIA}`);
    await db.pool.end();
    process.exit(1);
  }
  const leticiaId = u.rows[0].id;
  console.log(`Usuário: ${u.rows[0].nome} (id: ${leticiaId})`);

  // 2) Hospital de origem (Conceição) vinculado à Letícia.
  const origem = await db.query(
    `SELECT id, nome FROM hospitais
      WHERE medico_id = $1
        AND (nome ILIKE '%Conceicao%' OR nome ILIKE '%Conceição%')
      ORDER BY nome
      LIMIT 1`,
    [leticiaId],
  );
  if (!origem.rows[0]) {
    console.error("✗ Hospital 'Conceição' não encontrado para a Letícia.");
    const todos = await db.query(
      "SELECT id, nome, cidade FROM hospitais WHERE medico_id = $1 ORDER BY nome",
      [leticiaId],
    );
    console.error("Hospitais da Letícia (debug):");
    if (todos.rows.length === 0) {
      console.error("  (nenhum hospital cadastrado)");
    } else {
      for (const h of todos.rows) {
        console.error(`  - ${h.nome} | ${h.cidade || "—"} | id: ${h.id}`);
      }
    }
    await db.pool.end();
    process.exit(1);
  }
  const conceicaoId = origem.rows[0].id;
  console.log(`Hospital origem: ${origem.rows[0].nome} (id: ${conceicaoId})`);

  // 3) Hospital de destino (Unimed) — usa o existente ou cria.
  let unimedId;
  const destinoExistente = await db.query(
    `SELECT id FROM hospitais
      WHERE medico_id = $1 AND nome ILIKE 'Unimed'
      LIMIT 1`,
    [leticiaId],
  );
  if (destinoExistente.rows[0]) {
    unimedId = destinoExistente.rows[0].id;
    console.log(`Hospital destino: Unimed (id: ${unimedId}) — já existia`);
  } else {
    unimedId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hospitais (id, medico_id, nome, cidade, updated_at)
         VALUES ($1, $2, 'Unimed', 'Criciúma', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [unimedId, leticiaId],
    );
    console.log(`Hospital destino: Unimed (id: ${unimedId}) — criado`);
  }

  // 4) Move os pacientes (coluna hospital_id + JSONB dados.hospitalId).
  const r = await db.query(
    `UPDATE pacientes
        SET hospital_id = $1,
            dados = jsonb_set(dados, '{hospitalId}', to_jsonb($1::text), true),
            updated_at = NOW()
      WHERE medico_id = $2
        AND COALESCE(hospital_id, 'geral') = $3
      RETURNING id`,
    [unimedId, leticiaId, conceicaoId],
  );
  console.log(`Pacientes migrados: ${r.rowCount}`);

  console.log("Migração concluída com sucesso ✓");
  await db.pool.end();
}

main().catch((e) => {
  console.error("Falha na migração:", e);
  process.exit(1);
});
