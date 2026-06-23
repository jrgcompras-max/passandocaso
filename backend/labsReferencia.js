/**
 * Serviço de classificação laboratorial pela tabela `labs_referencia`
 * (fonte ABIM 2026). Fornece a faixa de normalidade por exame e sexo e
 * classifica um valor em baixo/normal/alto (→ seta/cor).
 *
 * É a fonte de referência preferencial; quem chama /api/ontologia/referencia
 * usa o ABIM primeiro e cai no acervo LOINC (ontologia) apenas se não houver.
 */
const db = require("./db");

const SEM_REF = { status: "sem_referencia", seta: "→", cor: "cinza" };

const numero = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
};

/** Linha de referência por código (sigla) OU nome, ajustada por sexo. */
async function referenciaPorCodigo(codigo, sexo) {
  const chave = String(codigo || "").trim();
  if (!chave) return null;
  const sx = sexo === "M" || sexo === "F" ? sexo : "ambos";
  const r = await db.query(
    `SELECT codigo, nome, sexo, valor_min, valor_max, unidade, fonte
       FROM labs_referencia
      WHERE (lower(codigo) = lower($1) OR lower(nome) = lower($1))
        AND (sexo = $2 OR sexo = 'ambos')
      ORDER BY CASE WHEN sexo = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [chave, sx],
  );
  return r.rows[0] || null;
}

/**
 * Referência no MESMO formato de ontologia.referenciaLab (termo/unidade/refMin/
 * refMax/contexto/fonte), para o endpoint /api/ontologia/referencia consumir.
 */
async function referenciaLab(lab, sexo) {
  const row = await referenciaPorCodigo(lab, sexo);
  if (!row) return null;
  return {
    termo: row.nome,
    unidade: row.unidade,
    refMin: numero(row.valor_min),
    refMax: numero(row.valor_max),
    contexto: row.sexo === "ambos" ? null : row.sexo,
    fonte: row.fonte || "ABIM 2026",
    loinc: null,
  };
}

/** Classifica um valor: baixo/normal/alto → seta/cor (briefing, seção 3). */
async function classificarLab(codigo, valor, sexo) {
  const ref = await referenciaPorCodigo(codigo, sexo);
  if (!ref) return SEM_REF;
  const v = numero(valor);
  if (v == null) return SEM_REF;
  const min = numero(ref.valor_min);
  const max = numero(ref.valor_max);
  if (min != null && v < min) return { status: "baixo", seta: "↓", cor: "azul" };
  if (max != null && v > max) return { status: "alto", seta: "↑", cor: "vermelho" };
  return { status: "normal", seta: "→", cor: "cinza" };
}

/** Todas as referências (para o app cachear e classificar localmente/offline). */
async function listarReferencias() {
  const r = await db.query(
    `SELECT codigo, nome, sexo, valor_min, valor_max, unidade, fonte
       FROM labs_referencia ORDER BY codigo, sexo`,
  );
  return r.rows.map((x) => ({
    codigo: x.codigo,
    nome: x.nome,
    sexo: x.sexo,
    valorMin: numero(x.valor_min),
    valorMax: numero(x.valor_max),
    unidade: x.unidade,
    fonte: x.fonte,
  }));
}

module.exports = {
  referenciaPorCodigo,
  referenciaLab,
  classificarLab,
  listarReferencias,
};
