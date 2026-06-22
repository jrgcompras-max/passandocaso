/**
 * Ontologia clínica — consultas à tabela termos_clinicos.
 *
 * Posicionamento regulatório: o app NUNCA cria referências próprias — só
 * consulta bases oficiais (LOINC/CID-10/RENAME) já semeadas. Termos não
 * reconhecidos entram com fonte='novo'/ativo=false para revisão (feedback loop).
 */

const db = require("./db");

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai a parte "nome" de um item ("Creatinina: 2,3 mg/dL" → "creatinina"). */
function nomeDoItem(texto) {
  let t = String(texto || "");
  const dois = t.indexOf(":");
  if (dois >= 0) t = t.slice(0, dois);
  // Corta no primeiro número (valores) se não houve ":".
  else t = t.replace(/\d.*$/, "");
  return normalizar(t);
}

/**
 * Busca um termo na ontologia por nome normalizado ou sinônimo. Aceita categoria
 * opcional para restringir. Retorna a linha (ou null).
 */
async function buscarTermo(texto, categoria) {
  const q = nomeDoItem(texto);
  if (!q || q.length < 2) return null;
  const params = [q];
  let filtroCat = "";
  if (categoria) {
    params.push(categoria);
    filtroCat = ` AND categoria = $${params.length}`;
  }
  const r = await db.query(
    `SELECT * FROM termos_clinicos
      WHERE ativo${filtroCat}
        AND (
          termo_normalizado = $1
          OR EXISTS (SELECT 1 FROM unnest(sinonimos) s WHERE lower(s) = $1)
          OR ($1 LIKE termo_normalizado || '%')
        )
      ORDER BY (termo_normalizado = $1) DESC, length(termo_normalizado) ASC
      LIMIT 1`,
    params,
  );
  return r.rows[0] || null;
}

/** Referência laboratorial por nome, ajustada por sexo quando houver contexto. */
async function referenciaLab(lab, sexo) {
  const q = nomeDoItem(lab);
  if (!q) return null;
  const r = await db.query(
    `SELECT * FROM termos_clinicos
      WHERE ativo AND categoria = 'exame_lab'
        AND (
          termo_normalizado = $1
          OR EXISTS (SELECT 1 FROM unnest(sinonimos) s WHERE lower(s) = $1)
        )`,
    [q],
  );
  if (!r.rows.length) return null;
  const sx = sexo === "M" ? "masculino" : sexo === "F" ? "feminino" : null;
  const linha =
    (sx && r.rows.find((x) => x.valor_ref_contexto === sx)) ||
    r.rows.find((x) => !x.valor_ref_contexto) ||
    r.rows[0];
  return {
    termo: linha.termo,
    unidade: linha.unidade,
    refMin: linha.valor_ref_min != null ? Number(linha.valor_ref_min) : null,
    refMax: linha.valor_ref_max != null ? Number(linha.valor_ref_max) : null,
    contexto: linha.valor_ref_contexto || null,
    fonte: linha.fonte || "LOINC",
    loinc: linha.loinc || null,
  };
}

/** Categoria-alvo de cada seção do app. */
function categoriaDaSecao(secao, tituloBloco) {
  if (secao === "examesLaboratoriais") return "exame_lab";
  if (secao === "imagem") return "exame_imagem";
  if (secao === "prescricaoHospitalar") return "medicacao";
  if (secao === "comorbidadesMedicacoes") {
    return /medica|muc/i.test(tituloBloco || "") ? "medicacao" : "comorbidade";
  }
  return null;
}

/** Registra um termo desconhecido para revisão futura (best-effort). */
async function registrarNovo(nome, categoria) {
  const norm = normalizar(nome);
  if (!norm || norm.length < 3 || /^\d/.test(norm)) return;
  try {
    await db.query(
      `INSERT INTO termos_clinicos
         (termo, termo_normalizado, categoria, sinonimos, fonte, ativo)
       VALUES ($1,$2,$3,$4,'novo', FALSE)
       ON CONFLICT (termo_normalizado, categoria, COALESCE(valor_ref_contexto, '')) DO NOTHING`,
      [nome.trim().slice(0, 120), norm, categoria, [nome.trim().slice(0, 120)]],
    );
  } catch {
    // feedback loop é best-effort
  }
}

/**
 * Valida/enriquece os blocos extraídos com a ontologia. NÃO altera o texto dos
 * itens (não-destrutivo); devolve um resumo `validacao` e alimenta o feedback
 * loop com os termos não reconhecidos.
 */
async function validarComOntologia(blocos, secao) {
  const validacao = [];
  if (!Array.isArray(blocos)) return validacao;
  for (const b of blocos) {
    const categoria = categoriaDaSecao(secao, b?.titulo);
    if (!categoria) continue;
    for (const item of b?.itens || []) {
      const texto = String(item || "").trim();
      if (!texto) continue;
      let termo = null;
      try {
        termo = await buscarTermo(texto, categoria);
      } catch {
        termo = null;
      }
      if (termo) {
        validacao.push({
          original: texto,
          normalizado: termo.termo,
          categoria: termo.categoria,
          subcategoria: termo.subcategoria || null,
          classe: termo.classe_farmacologica || null,
          unidade: termo.unidade || null,
          refMin: termo.valor_ref_min != null ? Number(termo.valor_ref_min) : null,
          refMax: termo.valor_ref_max != null ? Number(termo.valor_ref_max) : null,
          cid10: termo.cid10 || null,
          loinc: termo.loinc || null,
          fonte: termo.fonte || null,
          validado: true,
        });
      } else {
        validacao.push({ original: texto, categoria, validado: false });
        await registrarNovo(nomeDoItem(texto) ? texto.split(":")[0] : texto, categoria);
      }
    }
  }
  return validacao;
}

/**
 * Cache permanente de um diagnóstico vindo da CID-11 (OMS). Upsert em
 * termos_clinicos com categoria='diagnostico'. O termo de busca e o título
 * oficial entram como sinônimos para futuras buscas. Best-effort.
 */
async function salvarDiagnosticoCid11(termoBusca, resultado) {
  const titulo = (resultado?.titulo || termoBusca || "").trim().slice(0, 200);
  if (!titulo) return;
  const norm = normalizar(titulo);
  const sinonimos = [...new Set([titulo, String(termoBusca || "").trim()].filter(Boolean))];
  try {
    await db.query(
      `INSERT INTO termos_clinicos
         (termo, termo_normalizado, categoria, cid11, sinonimos, fonte, ativo)
       VALUES ($1,$2,'diagnostico',$3,$4,'CID11', TRUE)
       ON CONFLICT (termo_normalizado, categoria, COALESCE(valor_ref_contexto, '')) DO UPDATE
         SET cid11 = COALESCE(EXCLUDED.cid11, termos_clinicos.cid11),
             ativo = TRUE`,
      [titulo, norm, resultado?.cid11 || null, sinonimos],
    );
  } catch (e) {
    console.error("Cache CID-11 falhou:", e.message);
  }
}

// Categoria-alvo de cada seção (o que PODE permanecer). Itens reconhecidos numa
// categoria CONFLITANTE são removidos como anomalia (misrouting do scan).
const CATEGORIA_ESPERADA = {
  prescricaoHospitalar: "medicacao",
  medicacoesUsoContinuo: "medicacao",
  comorbidades: "comorbidade",
  examesLaboratoriais: "exame_lab",
  imagem: "exame_imagem",
};
const CATEGORIAS_FORTES = ["comorbidade", "medicacao", "exame_lab", "exame_imagem"];

// Palavras-chave de diagnóstico/comorbidade (abreviações e termos que a ontologia
// pode não casar exatamente, ex.: "DRC dialítico", "DM"). Complementa a ontologia.
const KW_COMORBIDADE =
  /\b(drc|irc|dm1|dm2|dm|has|hass|icc|ic|dpoc|avc|ave|ait|tep|tvp|hiv|les|iam|dac|dap|hpb|drge|nash|dhgna)\b|diabet|hipertens|cirrose|hepatopat|nefropat|cardiopat|neoplasi|c[âa]ncer|carcinom|insufici[êe]ncia (cardiac|renal|hepat|coronar)|demenci|alzheimer|parkinson|epileps|dialit|dialis|tabagism|etilism|obesidad|dislipidemi|hipotireoid|hipertireoid/i;

async function buscarTermoSeguro(texto, categoria) {
  try {
    return await buscarTermo(texto, categoria);
  } catch {
    return null;
  }
}

/**
 * O item PERTENCE à categoria esperada da seção? Resolve abreviações ambíguas:
 * "FA 140" nos labs casa Fosfatase Alcalina (exame_lab) — não deve ser tratado
 * como Fibrilação Atrial (comorbidade). Se pertence à esperada, nunca é anomalia.
 */
async function pertenceEsperada(texto, esperada) {
  if (!esperada) return false;
  return !!(await buscarTermoSeguro(texto, esperada));
}

/**
 * Categoria conflitante detectada para um item numa seção (ou null se OK).
 * Usa a ontologia e, para diagnósticos na Prescrição/MUC, também palavras-chave.
 */
function categoriaConflitante(texto, termo, esperada) {
  if (esperada === "medicacao") {
    // Medicação reconhecida nunca é anomalia (precede a heurística de keyword).
    if (termo && termo.categoria === "medicacao") return null;
    if ((termo && termo.categoria === "comorbidade") || KW_COMORBIDADE.test(texto)) {
      return "comorbidade";
    }
    if (termo && termo.categoria !== "medicacao" && CATEGORIAS_FORTES.includes(termo.categoria)) {
      return termo.categoria;
    }
    return null;
  }
  if (esperada === "comorbidade") {
    if (termo && termo.categoria === "comorbidade") return null;
    if (termo && termo.categoria === "medicacao") return "medicacao";
    return null;
  }
  // labs/imagem: conflito por categoria forte reconhecida.
  if (termo && termo.categoria && termo.categoria !== esperada && CATEGORIAS_FORTES.includes(termo.categoria)) {
    return termo.categoria;
  }
  return null;
}

/**
 * Remove dos `blocos` os itens cuja categoria (na ontologia) CONFLITA com a
 * seção — ex.: comorbidade ("DRC", "HAS") extraída para a Prescrição. Itens não
 * reconhecidos permanecem. Devolve { blocos, anomalias }. Best-effort.
 */
async function sanitizarSecao(blocos, secao) {
  const esperada = CATEGORIA_ESPERADA[secao];
  if (!esperada || !Array.isArray(blocos)) return { blocos, anomalias: [] };
  const anomalias = [];
  const limpos = [];
  for (const b of blocos) {
    const itens = [];
    for (const item of b?.itens || []) {
      const texto = String(item || "").trim();
      if (!texto) continue;
      // Se o item pertence à categoria esperada, nunca é anomalia (ex.: "FA" lab).
      const termo = await buscarTermoSeguro(texto);
      const conflito = (await pertenceEsperada(texto, esperada))
        ? null
        : categoriaConflitante(texto, termo, esperada);
      if (conflito) {
        anomalias.push({ item: texto, categoriaDetectada: conflito, esperada, secao });
      } else {
        itens.push(item);
      }
    }
    if (itens.length) limpos.push({ ...b, itens });
  }
  return { blocos: limpos, anomalias };
}

/**
 * Sanitiza os CAMPOS ESTRUTURADOS da extração (consumidos por mapeamento direto
 * no app), removendo itens misroteados antes de derivar os blocos. Devolve a
 * lista de anomalias. Best-effort.
 */
async function sanitizarEstruturado(dados, secao) {
  const anomalias = [];
  if (!dados || typeof dados !== "object") return anomalias;
  const nomeDe = (m) => (typeof m === "string" ? m : m && m.nome) || "";

  const filtrar = async (lista, esperada, campoNome) => {
    const limpos = [];
    for (const it of lista) {
      const texto = campoNome ? nomeDe(it) : String(it || "");
      const termo = await buscarTermoSeguro(texto);
      const conflito = (await pertenceEsperada(texto, esperada))
        ? null
        : categoriaConflitante(texto, termo, esperada);
      if (conflito) anomalias.push({ item: texto, categoriaDetectada: conflito, esperada, secao });
      else limpos.push(it);
    }
    return limpos;
  };

  if (secao === "prescricaoHospitalar" && Array.isArray(dados.medicamentos)) {
    dados.medicamentos = await filtrar(dados.medicamentos, "medicacao", true);
  }
  if (secao === "medicacoesUsoContinuo" && Array.isArray(dados.medicacoesUsoContinuo)) {
    dados.medicacoesUsoContinuo = await filtrar(dados.medicacoesUsoContinuo, "medicacao", true);
  }
  if (secao === "comorbidades" && Array.isArray(dados.comorbidades)) {
    dados.comorbidades = await filtrar(dados.comorbidades, "comorbidade", false);
  }

  return anomalias;
}

module.exports = {
  normalizar,
  buscarTermo,
  referenciaLab,
  validarComOntologia,
  salvarDiagnosticoCid11,
  sanitizarSecao,
  sanitizarEstruturado,
};
