const crypto = require("crypto");
const express = require("express");

const auth = require("./auth");
const db = require("./db");
const { enviarPush } = require("./push");

const router = express.Router();
router.use(auth.autenticar); // todas as rotas da rede exigem login

// ---------- helpers ----------
const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function gerarCodigo() {
  const alf = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
  let c = "";
  for (let i = 0; i < 6; i++) c += alf[crypto.randomInt(alf.length)];
  return c;
}

/** Chave de identidade de um hospital: CNES quando houver, senão nome normalizado. */
function chaveHosp(h) {
  return h.cnes && h.cnes.trim() ? `c:${h.cnes.trim()}` : `n:${normalizar(h.nome)}`;
}

async function hospitaisDoUsuario(id) {
  const r = await db.query("SELECT cnes, nome FROM hospitais WHERE medico_id = $1", [id]);
  return r.rows;
}

/** True se os dois usuários compartilham ao menos um hospital (CNES ou nome). */
async function verificarHospitalComum(a, b) {
  const [ha, hb] = await Promise.all([hospitaisDoUsuario(a), hospitaisDoUsuario(b)]);
  const setB = new Set(hb.map(chaveHosp));
  return ha.some((h) => setB.has(chaveHosp(h)));
}

/** Projeção pública (rede) — nunca expõe email/CRM/senha na busca. */
function perfilBasico(u) {
  return {
    id: u.id,
    nome_exibicao: u.nome_exibicao || u.nome,
    categoria: u.categoria || "medico",
    especialidade: u.especialidade || null,
    foto_url: u.foto_url || null,
  };
}

async function pushParaUsuario(id, titulo, corpo, dados) {
  try {
    const r = await db.query("SELECT push_token FROM usuarios WHERE id = $1", [id]);
    const token = r.rows[0]?.push_token;
    if (token) await enviarPush(token, titulo, corpo, dados);
  } catch (e) {
    console.error("pushParaUsuario:", e.message);
  }
}

// ============ PERFIL E ONBOARDING ============

router.put("/perfil/atualizar", async (req, res) => {
  const b = req.body || {};
  const campos = [
    "categoria", "especialidade", "subespecialidade", "crm", "foto_url",
    "ano_residencia", "instituicao_formacao", "nome_exibicao",
  ];
  const sets = [];
  const valores = [];
  let i = 1;
  for (const c of campos) {
    if (b[c] !== undefined) {
      sets.push(`${c} = $${i++}`);
      valores.push(b[c]);
    }
  }
  if (!sets.length) return res.status(400).json({ erro: "Nada para atualizar." });
  sets.push("onboarding_completo = TRUE");
  valores.push(req.usuario.id);
  try {
    const r = await db.query(
      `UPDATE usuarios SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      valores,
    );
    res.json({ usuario: perfilBasico(r.rows[0]) });
  } catch (e) {
    console.error("Erro perfil/atualizar:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.put("/perfil/especialidade", async (req, res) => {
  const especialidade = String((req.body || {}).especialidade || "").trim();
  if (!especialidade) return res.status(400).json({ erro: "especialidade obrigatória." });
  try {
    await db.query(
      "UPDATE usuarios SET especialidade = $1, especialidade_definida = TRUE WHERE id = $2",
      [especialidade, req.usuario.id],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.put("/perfil/push-token", async (req, res) => {
  const token = String((req.body || {}).token || "").trim();
  try {
    await db.query("UPDATE usuarios SET push_token = $1 WHERE id = $2", [
      token || null,
      req.usuario.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============ BUSCA DE PROFISSIONAIS ============

router.get("/rede/buscar", async (req, res) => {
  const nome = String(req.query.nome || "").trim();
  const cnes = String(req.query.hospital_cnes || "").trim();
  const hospNome = String(req.query.hospital_nome || "").trim();
  if (nome.length < 2) return res.json({ profissionais: [] });
  try {
    const params = [req.usuario.id, `%${nome}%`];
    let where = "u.id <> $1 AND (u.nome ILIKE $2 OR u.nome_exibicao ILIKE $2)";

    // "Mesmo hospital": casa por CNES (preciso) OU, como fallback, pelo nome do
    // hospital — necessário quando um cadastrou via API do CNES e outro
    // manualmente (cnes null), senão ninguém se encontra.
    const hospConds = [];
    if (cnes) {
      params.push(cnes);
      hospConds.push(`(h.cnes IS NOT NULL AND h.cnes = $${params.length})`);
    }
    if (hospNome) {
      params.push(hospNome);
      hospConds.push(`(LOWER(BTRIM(h.nome)) = LOWER(BTRIM($${params.length})))`);
    }
    if (hospConds.length) {
      where += ` AND EXISTS (
        SELECT 1 FROM hospitais h
         WHERE h.medico_id = u.id AND (${hospConds.join(" OR ")})
      )`;
    }

    const r = await db.query(
      `SELECT DISTINCT u.id, u.nome, u.nome_exibicao, u.categoria, u.especialidade, u.foto_url
         FROM usuarios u WHERE ${where} LIMIT 25`,
      params,
    );
    res.json({ profissionais: r.rows.map(perfilBasico) });
  } catch (e) {
    console.error("Erro rede/buscar:", e);
    res.status(500).json({ erro: e.message });
  }
});

// ============ CONEXÕES ============

router.post("/rede/conectar", async (req, res) => {
  const destinatario = String((req.body || {}).destinatario_id || "");
  if (!destinatario || destinatario === req.usuario.id) {
    return res.status(400).json({ erro: "destinatario_id inválido." });
  }
  try {
    if (!(await verificarHospitalComum(req.usuario.id, destinatario))) {
      return res.status(403).json({ erro: "Conexão só entre profissionais do mesmo hospital." });
    }
    await db.query(
      `INSERT INTO conexoes_profissionais (solicitante_id, destinatario_id, status)
       VALUES ($1, $2, 'pendente')
       ON CONFLICT (solicitante_id, destinatario_id)
       DO UPDATE SET status = 'pendente', atualizado_em = NOW()`,
      [req.usuario.id, destinatario],
    );
    await pushParaUsuario(
      destinatario,
      "Nova solicitação de conexão",
      `${req.usuario.nome_exibicao || req.usuario.nome} quer se conectar com você.`,
      { tipo: "nova_solicitacao_conexao" },
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro rede/conectar:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.post("/rede/convidar-email", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const hospital_cnes = String((req.body || {}).hospital_cnes || "");
  const hospital_nome = String((req.body || {}).hospital_nome || "");
  if (!email) return res.status(400).json({ erro: "email obrigatório." });
  try {
    const existe = await db.query("SELECT id FROM usuarios WHERE email = $1", [email]);
    if (existe.rows.length) {
      const destino = existe.rows[0].id;
      await db.query(
        `INSERT INTO conexoes_profissionais (solicitante_id, destinatario_id, hospital_cnes, hospital_nome, status)
         VALUES ($1,$2,$3,$4,'pendente')
         ON CONFLICT (solicitante_id, destinatario_id) DO UPDATE SET status='pendente', atualizado_em=NOW()`,
        [req.usuario.id, destino, hospital_cnes, hospital_nome],
      );
      await pushParaUsuario(destino, "Nova solicitação de conexão",
        `${req.usuario.nome_exibicao || req.usuario.nome} quer se conectar com você.`,
        { tipo: "nova_solicitacao_conexao" });
      return res.json({ tipo: "conexao" });
    }
    const token = crypto.randomBytes(20).toString("hex");
    await db.query(
      `INSERT INTO convites_externos (convidante_id, email_convidado, hospital_cnes, hospital_nome, token)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.usuario.id, email, hospital_cnes, hospital_nome, token],
    );
    const nome = req.usuario.nome_exibicao || req.usuario.nome;
    const base = process.env.APP_WEB_URL || "https://app.passandocaso.com.br";
    await auth.enviarEmail(
      email,
      "Convite para o Passando Caso",
      `${nome} quer se conectar com você no Passando Caso. Crie sua conta e já entre conectado: ${base}/cadastro?convite=${token}`,
    );
    res.json({ tipo: "convite_externo" });
  } catch (e) {
    console.error("Erro rede/convidar-email:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/solicitacoes", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.id, c.criado_em, u.id AS uid, u.nome, u.nome_exibicao, u.categoria, u.especialidade, u.foto_url
         FROM conexoes_profissionais c
         JOIN usuarios u ON u.id = c.solicitante_id
        WHERE c.destinatario_id = $1 AND c.status = 'pendente'
        ORDER BY c.criado_em DESC`,
      [req.usuario.id],
    );
    res.json({
      solicitacoes: r.rows.map((row) => ({
        id: row.id,
        criado_em: row.criado_em,
        de: perfilBasico({ id: row.uid, nome: row.nome, nome_exibicao: row.nome_exibicao, categoria: row.categoria, especialidade: row.especialidade, foto_url: row.foto_url }),
      })),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.put("/rede/solicitacoes/:id", async (req, res) => {
  const { id } = req.params;
  const acao = String((req.body || {}).acao || "");
  const novo = acao === "aceitar" ? "aceito" : acao === "recusar" ? "recusado" : null;
  if (!novo) return res.status(400).json({ erro: "acao deve ser aceitar ou recusar." });
  try {
    const r = await db.query(
      `UPDATE conexoes_profissionais SET status = $1, atualizado_em = NOW()
        WHERE id = $2 AND destinatario_id = $3 AND status = 'pendente' RETURNING solicitante_id`,
      [novo, id, req.usuario.id],
    );
    if (!r.rows.length) return res.status(404).json({ erro: "Solicitação não encontrada." });
    if (novo === "aceito") {
      await pushParaUsuario(r.rows[0].solicitante_id, "Conexão aceita",
        `${req.usuario.nome_exibicao || req.usuario.nome} aceitou sua solicitação.`,
        { tipo: "solicitacao_aceita" });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/conexoes", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.id,
              u.id AS uid, u.nome, u.nome_exibicao, u.categoria, u.especialidade, u.foto_url
         FROM conexoes_profissionais c
         JOIN usuarios u ON u.id = CASE WHEN c.solicitante_id = $1 THEN c.destinatario_id ELSE c.solicitante_id END
        WHERE (c.solicitante_id = $1 OR c.destinatario_id = $1) AND c.status = 'aceito'
        ORDER BY c.atualizado_em DESC`,
      [req.usuario.id],
    );
    res.json({
      conexoes: r.rows.map((row) => ({
        conexaoId: row.id,
        ...perfilBasico({ id: row.uid, nome: row.nome, nome_exibicao: row.nome_exibicao, categoria: row.categoria, especialidade: row.especialidade, foto_url: row.foto_url }),
      })),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.delete("/rede/conexoes/:id", async (req, res) => {
  try {
    await db.query(
      `DELETE FROM conexoes_profissionais
        WHERE id = $1 AND (solicitante_id = $2 OR destinatario_id = $2)`,
      [req.params.id, req.usuario.id],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============ GRUPOS CLÍNICOS ============

router.post("/rede/grupos", async (req, res) => {
  const b = req.body || {};
  const nome = String(b.nome || "").trim();
  if (!nome) return res.status(400).json({ erro: "nome obrigatório." });
  try {
    let codigo = gerarCodigo();
    // garante unicidade (poucas tentativas)
    for (let t = 0; t < 5; t++) {
      const ex = await db.query("SELECT 1 FROM grupos_clinicos WHERE codigo = $1", [codigo]);
      if (!ex.rows.length) break;
      codigo = gerarCodigo();
    }
    const r = await db.query(
      `INSERT INTO grupos_clinicos (nome, descricao, hospital_cnes, hospital_nome, especialidade, codigo, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nome, b.descricao || null, b.hospital_cnes || null, b.hospital_nome || null, b.especialidade || null, codigo, req.usuario.id],
    );
    const grupo = r.rows[0];
    await db.query(
      "INSERT INTO membros_grupo (grupo_id, usuario_id, papel) VALUES ($1,$2,'admin')",
      [grupo.id, req.usuario.id],
    );
    res.status(201).json({ grupo });
  } catch (e) {
    console.error("Erro rede/grupos:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/grupos", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT g.*, (SELECT COUNT(*) FROM membros_grupo m WHERE m.grupo_id = g.id)::int AS membros
         FROM grupos_clinicos g
         JOIN membros_grupo mg ON mg.grupo_id = g.id
        WHERE mg.usuario_id = $1 AND g.ativo = TRUE
        ORDER BY g.criado_em DESC`,
      [req.usuario.id],
    );
    res.json({ grupos: r.rows });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post("/rede/grupos/entrar", async (req, res) => {
  const codigo = String((req.body || {}).codigo || "").trim().toUpperCase();
  if (!codigo) return res.status(400).json({ erro: "codigo obrigatório." });
  try {
    const r = await db.query("SELECT * FROM grupos_clinicos WHERE codigo = $1 AND ativo = TRUE", [codigo]);
    const grupo = r.rows[0];
    if (!grupo) return res.status(404).json({ erro: "Grupo não encontrado." });
    // valida hospital em comum (se o grupo tem CNES, o usuário precisa ter esse hospital).
    if (grupo.hospital_cnes) {
      const h = await db.query(
        "SELECT 1 FROM hospitais WHERE medico_id = $1 AND cnes = $2",
        [req.usuario.id, grupo.hospital_cnes],
      );
      if (!h.rows.length) {
        return res.status(403).json({ erro: "Este grupo é de um hospital onde você não está cadastrado." });
      }
    }
    await db.query(
      `INSERT INTO membros_grupo (grupo_id, usuario_id) VALUES ($1,$2)
       ON CONFLICT (grupo_id, usuario_id) DO NOTHING`,
      [grupo.id, req.usuario.id],
    );
    res.json({ ok: true, grupo });
  } catch (e) {
    console.error("Erro rede/grupos/entrar:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/grupos/:id/membros", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.nome, u.nome_exibicao, u.categoria, u.especialidade, u.foto_url, m.papel
         FROM membros_grupo m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.grupo_id = $1 ORDER BY m.papel DESC, m.entrou_em`,
      [req.params.id],
    );
    res.json({ membros: r.rows.map((row) => ({ ...perfilBasico(row), papel: row.papel })) });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.delete("/rede/grupos/:id/sair", async (req, res) => {
  try {
    await db.query("DELETE FROM membros_grupo WHERE grupo_id = $1 AND usuario_id = $2", [
      req.params.id,
      req.usuario.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/grupos/:id", async (req, res) => {
  try {
    const g = await db.query("SELECT * FROM grupos_clinicos WHERE id = $1", [req.params.id]);
    if (!g.rows.length) return res.status(404).json({ erro: "Grupo não encontrado." });
    const m = await db.query(
      `SELECT u.id, u.nome, u.nome_exibicao, u.categoria, u.especialidade, u.foto_url, mg.papel
         FROM membros_grupo mg JOIN usuarios u ON u.id = mg.usuario_id
        WHERE mg.grupo_id = $1 ORDER BY mg.papel DESC, mg.entrou_em`,
      [req.params.id],
    );
    res.json({ grupo: g.rows[0], membros: m.rows.map((row) => ({ ...perfilBasico(row), papel: row.papel })) });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ============ PASSAGEM DE PLANTÃO ============

/** Resumo seguro de um paciente (nome SEMPRE abreviado pelo cliente). */
function resumirPaciente(p) {
  const pend = Array.isArray(p.pendencias) ? p.pendencias.filter((x) => !x.feito).length : 0;
  const hoje = new Date().toISOString().slice(0, 10);
  const evo = p.evolucoes?.[hoje];
  return {
    id: p.id,
    nome: p.nomeAbreviado || p.nome || "Paciente",
    diagnostico: p.diagnosticoPrincipal || "",
    pendencias: pend,
    conduta: evo?.condutaDoDia || "",
  };
}

router.post("/rede/passagem", async (req, res) => {
  const b = req.body || {};
  const pacientes = Array.isArray(b.pacientes) ? b.pacientes : [];
  if (!pacientes.length) return res.status(400).json({ erro: "Nenhum paciente selecionado." });
  if (!b.destinatario_id && !b.grupo_id) {
    return res.status(400).json({ erro: "Informe destinatario_id ou grupo_id." });
  }
  try {
    // Validação de mesmo hospital (regra inviolável) para passagem direta.
    if (b.destinatario_id) {
      if (!(await verificarHospitalComum(req.usuario.id, b.destinatario_id))) {
        return res.status(403).json({
          erro: "Transferência só permitida entre profissionais do mesmo hospital",
        });
      }
    }
    const resumo = pacientes.map(resumirPaciente);
    const r = await db.query(
      `INSERT INTO passagens_plantao
         (remetente_id, destinatario_id, grupo_id, hospital_cnes, hospital_nome, pacientes, resumo_pacientes, mensagem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, criado_em, expira_em`,
      [
        req.usuario.id,
        b.destinatario_id || null,
        b.grupo_id || null,
        b.hospital_cnes || null,
        b.hospital_nome || null,
        JSON.stringify(pacientes),
        JSON.stringify(resumo),
        b.mensagem || null,
      ],
    );
    if (b.destinatario_id) {
      await pushParaUsuario(b.destinatario_id, "Passagem de plantão recebida",
        `${req.usuario.nome_exibicao || req.usuario.nome} quer te passar ${pacientes.length} paciente(s).`,
        { tipo: "passagem_recebida" });
    }
    res.status(201).json({ passagem: { id: r.rows[0].id, total: pacientes.length, resumo } });
  } catch (e) {
    console.error("Erro rede/passagem:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/passagem/recebidas", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT p.id, p.mensagem, p.resumo_pacientes, p.hospital_nome, p.criado_em, p.expira_em,
              u.nome, u.nome_exibicao, u.foto_url
         FROM passagens_plantao p JOIN usuarios u ON u.id = p.remetente_id
        WHERE p.destinatario_id = $1 AND p.status = 'pendente' AND p.expira_em > NOW()
        ORDER BY p.criado_em DESC`,
      [req.usuario.id],
    );
    res.json({
      passagens: r.rows.map((row) => ({
        id: row.id,
        de: row.nome_exibicao || row.nome,
        foto_url: row.foto_url,
        hospital: row.hospital_nome,
        mensagem: row.mensagem,
        resumo: row.resumo_pacientes,
        criado_em: row.criado_em,
        expira_em: row.expira_em,
      })),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get("/rede/passagem/enviadas", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, destinatario_id, grupo_id, status, resumo_pacientes, criado_em
         FROM passagens_plantao WHERE remetente_id = $1 ORDER BY criado_em DESC LIMIT 50`,
      [req.usuario.id],
    );
    res.json({ passagens: r.rows });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.put("/rede/passagem/:id/aceitar", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM passagens_plantao
        WHERE id = $1 AND destinatario_id = $2 AND status = 'pendente' AND expira_em > NOW()`,
      [req.params.id, req.usuario.id],
    );
    const pg = r.rows[0];
    if (!pg) return res.status(404).json({ erro: "Passagem não encontrada ou expirada." });

    // Hospital de destino dos pacientes recebidos. Prioridade:
    //  1) hospital ativo enviado pelo app (onde o médico está trabalhando agora),
    //     validado como pertencente ao destinatário;
    //  2) hospital do destinatário que casa por CNES com o da passagem;
    //  3) "geral".
    let destinoHosp = "geral";
    const pedido = String((req.body || {}).hospitalId || "").trim();
    if (pedido && pedido !== "geral") {
      const h = await db.query(
        "SELECT id FROM hospitais WHERE medico_id = $1 AND id = $2 LIMIT 1",
        [req.usuario.id, pedido],
      );
      if (h.rows[0]) destinoHosp = h.rows[0].id;
    } else if (pedido === "geral") {
      destinoHosp = "geral";
    }
    if (destinoHosp === "geral" && pg.hospital_cnes) {
      const h = await db.query(
        "SELECT id FROM hospitais WHERE medico_id = $1 AND cnes = $2 LIMIT 1",
        [req.usuario.id, pg.hospital_cnes],
      );
      if (h.rows[0]) destinoHosp = h.rows[0].id;
    }
    // Nome do remetente para a tag "recebido de".
    const rem = await db.query(
      "SELECT nome, nome_exibicao FROM usuarios WHERE id = $1",
      [pg.remetente_id],
    );
    const remNome = rem.rows[0]?.nome_exibicao || rem.rows[0]?.nome || "colega";

    const lista = Array.isArray(pg.pacientes) ? pg.pacientes : [];
    const hoje = new Date().toISOString().slice(0, 10);
    const importados = [];
    for (const p of lista) {
      if (!p || !p.id) continue;
      const dados = {
        ...p,
        hospitalId: destinoHosp,
        status: "naoVisitado",
        recebidoDe: { id: pg.remetente_id, nome: remNome },
      };
      await db.query(
        `INSERT INTO pacientes (id, medico_id, hospital_id, data_criacao, dados, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (id) DO UPDATE SET medico_id = EXCLUDED.medico_id, hospital_id = EXCLUDED.hospital_id, dados = EXCLUDED.dados, updated_at = NOW()`,
        [p.id, req.usuario.id, destinoHosp, hoje, dados],
      );
      importados.push(dados);
    }
    await db.query(
      "UPDATE passagens_plantao SET status = 'aceito', aceito_em = NOW() WHERE id = $1",
      [pg.id],
    );
    await pushParaUsuario(pg.remetente_id, "Passagem aceita",
      `${req.usuario.nome_exibicao || req.usuario.nome} aceitou sua passagem de pacientes.`,
      { tipo: "passagem_aceita" });
    res.json({
      ok: true,
      pacientes_importados: importados.length,
      hospitalId: destinoHosp,
      pacientes: importados,
    });
  } catch (e) {
    console.error("Erro passagem/aceitar:", e);
    res.status(500).json({ erro: e.message });
  }
});

router.put("/rede/passagem/:id/recusar", async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE passagens_plantao SET status = 'recusado'
        WHERE id = $1 AND destinatario_id = $2 AND status = 'pendente' RETURNING remetente_id`,
      [req.params.id, req.usuario.id],
    );
    if (!r.rows.length) return res.status(404).json({ erro: "Passagem não encontrada." });
    await pushParaUsuario(r.rows[0].remetente_id, "Passagem recusada",
      `${req.usuario.nome_exibicao || req.usuario.nome} recusou sua passagem.`,
      { tipo: "passagem_recusada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
