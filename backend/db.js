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
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      plano TEXT NOT NULL DEFAULT 'trial',
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      trial_inicio TIMESTAMP NOT NULL DEFAULT NOW(),
      trial_fim TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
      reset_token TEXT,
      reset_token_exp TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
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
  // CNES do hospital — chave para identificar "mesmo hospital" entre usuários.
  await pool.query(
    "ALTER TABLE hospitais ADD COLUMN IF NOT EXISTS cnes TEXT;",
  );

  // === FASE 2 — Rede clínica colaborativa ===
  // Perfil profissional (colunas idempotentes em usuarios).
  const colsUsuarios = [
    "categoria TEXT DEFAULT 'medico'",
    "especialidade TEXT",
    "subespecialidade TEXT",
    "crm TEXT",
    "foto_url TEXT",
    "ano_residencia INTEGER",
    "instituicao_formacao TEXT",
    "push_token TEXT",
    "nome_exibicao TEXT",
    "onboarding_completo BOOLEAN DEFAULT FALSE",
    "especialidade_definida BOOLEAN DEFAULT FALSE",
  ];
  for (const col of colsUsuarios) {
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ${col};`);
  }

  // NOTA: usuarios.id é TEXT (uuid). As FKs de usuário usam TEXT (não INTEGER).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conexoes_profissionais (
      id SERIAL PRIMARY KEY,
      solicitante_id TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
      destinatario_id TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
      hospital_cnes TEXT,
      hospital_nome TEXT,
      status TEXT DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(solicitante_id, destinatario_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos_clinicos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      hospital_cnes TEXT,
      hospital_nome TEXT,
      especialidade TEXT,
      codigo TEXT UNIQUE NOT NULL,
      criado_por TEXT REFERENCES usuarios(id),
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membros_grupo (
      id SERIAL PRIMARY KEY,
      grupo_id INTEGER REFERENCES grupos_clinicos(id) ON DELETE CASCADE,
      usuario_id TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
      papel TEXT DEFAULT 'membro',
      entrou_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(grupo_id, usuario_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS passagens_plantao (
      id SERIAL PRIMARY KEY,
      remetente_id TEXT REFERENCES usuarios(id),
      destinatario_id TEXT REFERENCES usuarios(id),
      grupo_id INTEGER REFERENCES grupos_clinicos(id),
      hospital_cnes TEXT,
      hospital_nome TEXT,
      pacientes JSONB NOT NULL,
      resumo_pacientes JSONB,
      mensagem TEXT,
      status TEXT DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW(),
      aceito_em TIMESTAMP,
      expira_em TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS convites_externos (
      id SERIAL PRIMARY KEY,
      convidante_id TEXT REFERENCES usuarios(id),
      email_convidado TEXT NOT NULL,
      hospital_cnes TEXT,
      hospital_nome TEXT,
      token TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW(),
      expira_em TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
    );
  `);

  console.log("PostgreSQL — tabelas verificadas/criadas.");
}

/** Atalho para consultas parametrizadas. */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, initDB, query };
