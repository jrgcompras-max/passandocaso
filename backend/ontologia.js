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

module.exports = {
  normalizar,
  buscarTermo,
  referenciaLab,
  validarComOntologia,
};
