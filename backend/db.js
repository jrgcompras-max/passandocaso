const { Pool } = require("pg");

/**
 * Pool de conexões com o PostgreSQL. A connection string vem de
 * process.env.DATABASE_URL (definida pelo Railway/provedor). Em produção o SSL
 * é exigido pelo provedor; rejectUnauthorized: false aceita o certificado dele.
 */
const ehProducao = process.env.NODE_ENV === "production" || !!process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ehProducao ? { rejectUnauthorized: false } : false,
});

/** Cria as tabelas se ainda não existirem. Idempotente. */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pacientes (
      id TEXT PRIMARY KEY,
      medico_id TEXT NOT NULL,
      data_criacao DATE NOT NULL,
      dados JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evolucoes (
      id SERIAL PRIMARY KEY,
      paciente_id TEXT NOT NULL,
      medico_id TEXT NOT NULL,
      data DATE NOT NULL,
      texto TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hospitais (
      id TEXT PRIMARY KEY,
      medico_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      cidade TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Multi-hospital: associa cada paciente a um hospital (idempotente).
  await pool.query(
    "ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS hospital_id TEXT;",
  );
  console.log("PostgreSQL — tabelas verificadas/criadas.");
}

/** Atalho para consultas parametrizadas. */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, initDB, query };
