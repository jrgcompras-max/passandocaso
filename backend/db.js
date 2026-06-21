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
    "features_ativas JSONB DEFAULT '{}'::jsonb",
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

  // === FASE 3 — Evolução temporal (snapshot diário por paciente) ===
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evolucoes_diarias (
      id SERIAL PRIMARY KEY,
      paciente_id TEXT NOT NULL,
      medico_id TEXT NOT NULL,
      data DATE NOT NULL DEFAULT CURRENT_DATE,
      sinais_vitais JSONB,
      exames_laboratoriais JSONB,
      exames_imagem TEXT,
      evolucao_beira_leito JSONB,
      conduta TEXT,
      problemas_ativos JSONB,
      passou_caso TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE(paciente_id, medico_id, data)
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_evolucoes_paciente ON evolucoes_diarias(paciente_id, data DESC);",
  );

  // === FASE 3 — Ontologia clínica (termos normalizados + referências) ===
  await pool.query(`
    CREATE TABLE IF NOT EXISTS termos_clinicos (
      id SERIAL PRIMARY KEY,
      termo TEXT NOT NULL,
      termo_normalizado TEXT NOT NULL,
      categoria TEXT NOT NULL,
      subcategoria TEXT,
      classe_farmacologica TEXT,
      unidade TEXT,
      valor_ref_min NUMERIC,
      valor_ref_max NUMERIC,
      valor_ref_contexto TEXT,
      cid10 TEXT,
      cid11 TEXT,
      loinc TEXT,
      sinonimos TEXT[],
      fonte TEXT,
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_termos_termo ON termos_clinicos USING gin(sinonimos);",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_termos_categoria ON termos_clinicos(categoria);",
  );
  // Unicidade para upsert idempotente do seed e do feedback loop.
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_termos_unico ON termos_clinicos(termo_normalizado, categoria, COALESCE(valor_ref_contexto, ''));",
  );

  // === FASE 3 — Segurança farmacológica ===

  // Posologia de referência (RENAME/bulas) — colunas opcionais em termos_clinicos.
  // ALTER ... IF NOT EXISTS é idempotente; só preenchidas para categoria='medicacao'.
  await pool.query(`
    ALTER TABLE termos_clinicos
      ADD COLUMN IF NOT EXISTS dose_min TEXT,
      ADD COLUMN IF NOT EXISTS dose_max TEXT,
      ADD COLUMN IF NOT EXISTS dose_usual TEXT,
      ADD COLUMN IF NOT EXISTS vias_administracao TEXT[],
      ADD COLUMN IF NOT EXISTS intervalo_usual TEXT,
      ADD COLUMN IF NOT EXISTS observacoes_dose TEXT;
  `);

  // Interações medicamentosas (par A×B). Informativa — nunca bloqueia cadastro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interacoes_medicamentosas (
      id SERIAL PRIMARY KEY,
      medicamento_a TEXT NOT NULL,
      medicamento_b TEXT NOT NULL,
      severidade TEXT NOT NULL,
      descricao TEXT NOT NULL,
      mecanismo TEXT,
      conduta_recomendada TEXT,
      fonte TEXT DEFAULT 'ANVISA/Micromedex',
      ativo BOOLEAN DEFAULT TRUE
    );
  `);
  // Unicidade do par (normalizado a montante no seed) para upsert idempotente.
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_interacoes_par ON interacoes_medicamentosas(medicamento_a, medicamento_b);",
  );
  // Camada OpenFDA+IA: texto bruto da FDA (auditoria) + carimbo de revisão.
  // descricao passa a ser nullable (cache negativo de pares sem interação).
  await pool.query(`
    ALTER TABLE interacoes_medicamentosas
      ADD COLUMN IF NOT EXISTS texto_bruto_fda TEXT,
      ADD COLUMN IF NOT EXISTS revisado_em TIMESTAMPTZ DEFAULT NOW(),
      ALTER COLUMN descricao DROP NOT NULL;
  `);

  // Ajuste de dose renal por TFG (faixas e recomendação descritiva).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ajuste_renal (
      id SERIAL PRIMARY KEY,
      medicamento TEXT NOT NULL,
      tfg_min NUMERIC,
      tfg_corte NUMERIC,
      recomendacao TEXT,
      fonte TEXT DEFAULT 'ANVISA/SBN'
    );
  `);
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ajuste_renal_med ON ajuste_renal(medicamento);",
  );

  // === FASE 3 — Escores clínicos automáticos (persistência + histórico) ===
  // Observação: pacientes.id e usuarios.id são TEXT neste schema, então
  // paciente_id/calculado_por são TEXT (mantendo as FKs). O PK usa UUID via
  // pgcrypto (gen_random_uuid).
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS escores_clinicos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      paciente_id TEXT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
      tipo VARCHAR(30) NOT NULL,
      valor_total INTEGER NOT NULL,
      classificacao VARCHAR(80),
      detalhes JSONB NOT NULL,
      fonte VARCHAR(20) DEFAULT 'auto',
      campos_faltantes TEXT[],
      calculado_em TIMESTAMPTZ DEFAULT NOW(),
      calculado_por TEXT REFERENCES usuarios(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_escores_paciente ON escores_clinicos(paciente_id, tipo, calculado_em DESC);",
  );

  console.log("PostgreSQL — tabelas verificadas/criadas.");
}

/** Atalho para consultas parametrizadas. */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, initDB, query };
