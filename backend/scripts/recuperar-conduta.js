/**
 * RECUPERAÇÃO (somente leitura) da Conduta do Dia perdida pelo lost-update.
 *
 * Procura a conduta de pacientes específicos da Letícia em TODAS as fontes onde
 * ela pode ter sobrevivido, mesmo que `pacientes.dados` já tenha sido
 * sobrescrito (sync upsert):
 *   1) pacientes.dados.evolucoes[data].condutaDoDia   (provável já vazio)
 *   2) evolucoes.texto                                 (texto gerado: *P: tem a conduta)
 *   3) evolucoes_diarias.conduta / .evolucao_beira_leito / .passou_caso (snapshot do dia)
 *
 * NÃO altera nada. Rodar onde houver DATABASE_URL (ex.: Railway):
 *   railway run node backend/scripts/recuperar-conduta.js
 * ou, com DATABASE_URL no backend/.env:
 *   node backend/scripts/recuperar-conduta.js [nome1 nome2 ...]
 *
 * Por padrão busca "sebasti" e "elzio". Filtra pelo usuário da Letícia.
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL ausente. Rode com `railway run ...` ou defina no backend/.env.");
  process.exit(1);
}

const db = require("../db");

const EMAIL_LETICIA = process.env.EMAIL_ALVO || "lets_966@hotmail.com";
const NOMES = process.argv.slice(2).length ? process.argv.slice(2) : ["sebasti", "elzio"];

function linha() {
  console.log("─".repeat(72));
}

async function main() {
  // 1) Usuário da Letícia.
  const u = await db.query(
    "SELECT id, nome, email FROM usuarios WHERE email = $1 OR nome ILIKE '%leticia%soares%' OR nome ILIKE '%leticia%'",
    [EMAIL_LETICIA],
  );
  if (!u.rows.length) {
    console.error(`✗ Usuário da Letícia não encontrado (email ${EMAIL_LETICIA}).`);
    process.exit(1);
  }
  if (u.rows.length > 1) {
    console.log("⚠ Mais de um usuário casou o filtro — usando o que bate o e-mail, se houver:");
    u.rows.forEach((r) => console.log(`   - ${r.id} · ${r.nome} · ${r.email}`));
  }
  const usuario = u.rows.find((r) => r.email === EMAIL_LETICIA) || u.rows[0];
  const medicoId = usuario.id;
  console.log(`Usuário: ${usuario.nome} · ${usuario.email} · id=${medicoId}`);

  // Filtro de nomes (ILIKE) — placeholders $2..$N.
  const like = NOMES.map((_, i) => `p.dados->>'nomeCompleto' ILIKE $${i + 2}`).join(" OR ");
  const params = [medicoId, ...NOMES.map((n) => `%${n}%`)];
  console.log(`Buscando pacientes: ${NOMES.join(", ")}`);
  linha();

  // FONTE 1 — pacientes.dados.evolucoes (estado atual, provavelmente já sobrescrito).
  const pac = await db.query(
    `SELECT p.id, p.dados->>'nomeCompleto' AS nome, p.dados->'evolucoes' AS evolucoes, p.updated_at
       FROM pacientes p
      WHERE p.medico_id = $1 AND (${like})`,
    params,
  );
  console.log(`FONTE 1 — pacientes.dados.evolucoes (estado atual): ${pac.rows.length} paciente(s)`);
  for (const r of pac.rows) {
    console.log(`\n  ▸ ${r.nome} (id=${r.id}, atualizado ${r.updated_at})`);
    const evo = r.evolucoes || {};
    const datas = Object.keys(evo);
    if (!datas.length) console.log("     (sem evoluções)");
    for (const d of datas) {
      const c = (evo[d] && evo[d].condutaDoDia) || "";
      console.log(`     ${d}: condutaDoDia = ${c ? JSON.stringify(c) : "(vazio)"}`);
    }
  }
  linha();

  // FONTE 2 — evolucoes.texto (texto gerado; a conduta vai no bloco *P:).
  const ev = await db.query(
    `SELECT e.paciente_id, p.dados->>'nomeCompleto' AS nome, e.data, e.texto, e.created_at
       FROM evolucoes e
       JOIN pacientes p ON p.id = e.paciente_id
      WHERE e.medico_id = $1 AND (${like})
      ORDER BY e.created_at DESC`,
    params,
  );
  console.log(`FONTE 2 — evolucoes.texto (texto gerado): ${ev.rows.length} registro(s)`);
  for (const r of ev.rows) {
    const plano = (r.texto.match(/\*P:[\s\S]*$/) || [])[0] || "(sem bloco *P:)";
    console.log(`\n  ▸ ${r.nome} · ${r.data} · salvo ${r.created_at}`);
    console.log(`     PLANO/CONDUTA:\n     ${plano.replace(/\n/g, "\n     ")}`);
  }
  linha();

  // FONTE 3 — evolucoes_diarias (snapshot do dia).
  const ed = await db.query(
    `SELECT ed.paciente_id, p.dados->>'nomeCompleto' AS nome, ed.data,
            ed.conduta, ed.evolucao_beira_leito->>'condutaDoDia' AS conduta_evo,
            ed.passou_caso, ed.criado_em
       FROM evolucoes_diarias ed
       JOIN pacientes p ON p.id = ed.paciente_id
      WHERE ed.medico_id = $1 AND (${like})
      ORDER BY ed.criado_em DESC`,
    params,
  );
  console.log(`FONTE 3 — evolucoes_diarias (snapshot): ${ed.rows.length} registro(s)`);
  for (const r of ed.rows) {
    console.log(`\n  ▸ ${r.nome} · ${r.data} · snapshot ${r.criado_em}`);
    console.log(`     conduta (coluna)        = ${r.conduta ? JSON.stringify(r.conduta) : "(vazio)"}`);
    console.log(`     condutaDoDia (evo json) = ${r.conduta_evo ? JSON.stringify(r.conduta_evo) : "(vazio)"}`);
    if (r.passou_caso) {
      const plano = (r.passou_caso.match(/(Conduta|Plano|\*P:)[\s\S]*$/i) || [])[0];
      if (plano) console.log(`     passou_caso (trecho)    = ${plano.slice(0, 400).replace(/\n/g, " ")}`);
    }
  }
  linha();
  console.log("Fim. (Nenhum dado foi alterado.)");
  await db.pool.end();
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
