/**
 * FONTE DE VERDADE — Evolução Médica (texto puro, vai para o Tasy).
 *
 * Texto puro: apenas - * | / espaços e quebras de linha. Sem emoji, sem markdown.
 * Não alterar a estrutura/regras sem instrução explícita do produto.
 * O gerador (app: src/lib/gerarEvolucao.ts) DEVE seguir exatamente esta ordem
 * e estas regras — nunca gerar livre. Espelhe aqui qualquer mudança de formato.
 */

const TITULO = "                    Evolução Médica";

// Ordem canônica das seções do texto.
const ORDEM = [
  "atual", // - Atual: diagnóstico principal + outros problemas ativos
  "trat", // - Antibióticos / - Culturais
  "comorb", // * Comorbidades / * MUC / * Alergias
  "hda", // *HDA: história da doença atual (texto corrido)
  "s", // *S: consciência + queixas
  "ssvv", // SSVV: PA | FC | FR | SatO2 | Tax (só se preenchido)
  "o", // *O: exame físico
  "labs", // Exames laboratoriais: linha compacta separada por /
  "imagem", // Exames de imagem: um por linha
  "a", // *A: hipóteses diagnósticas
  "p", // *P: condutas
];

const REGRAS = [
  '"Evolução Médica" centralizado no topo, sem negrito.',
  "Sem identificação do paciente no texto. Sem assinatura.",
  "Comorbidades e MUC em blocos separados.",
  "ATB só aparece se houver cadastrado; senão --. Culturais: --- quando vazio.",
  "SSVV só aparece se preenchido.",
  "Labs em linha compacta, separados por /.",
  "Imagem: cada exame em linha própria.",
  "Sem linhas separadoras entre seções. Sem títulos em maiúsculas.",
  'Sem "Checo exames"/"Checo TC".',
];

/** Indenta linhas de continuação para alinhar sob um prefixo (ex.: "- Atual: "). */
function alinhar(itens, prefixo) {
  if (!itens.length) return "";
  const pad = " ".repeat(prefixo.length);
  return prefixo + itens.map((t, i) => (i === 0 ? t : pad + t)).join("\n");
}

/**
 * Monta o texto final a partir das seções já extraídas. `s` é um objeto com:
 * atualItens[], antibioticos, culturais, comorbidades, muc, alergias, hda,
 * subjetivo, ssvv, oCorpo[], labsLinha, imagemLinhas[], avaliacao[], plano[].
 */
function montar(s) {
  const blocoAtual = (s.atualItens && s.atualItens.length)
    ? alinhar(s.atualItens, "- Atual: ")
    : null;

  const blocoTrat = [
    `- Antibióticos: ${s.antibioticos && s.antibioticos.length ? s.antibioticos.join(", ") : "--"}`,
    `- Culturais: ${s.culturais && s.culturais.length ? s.culturais.join(", ") : "---"}`,
  ].join("\n");

  const blocoComorb = [
    `* Comorbidades: ${s.comorbidades && s.comorbidades.length ? s.comorbidades.join(", ") : "nega"}`,
    `* MUC: ${s.muc && s.muc.length ? s.muc.join(", ") : "nega"}`,
    `* Alergias: ${s.alergias && s.alergias.length ? s.alergias.join(", ") : "--"}`,
  ].join("\n");

  const hda = s.hda && s.hda.trim() ? `*HDA: ${s.hda.trim()}` : null;
  const subj = s.subjetivo && s.subjetivo.trim() ? `*S: ${s.subjetivo.trim()}` : null;
  const ssvv = s.ssvv && s.ssvv.trim() ? `SSVV: ${s.ssvv.trim()}` : null;
  const o = s.oCorpo && s.oCorpo.length ? `*O: ${s.oCorpo.join("\n")}` : null;
  const labs = s.labsLinha && s.labsLinha.trim()
    ? `Exames laboratoriais:\n${s.labsLinha.trim()}`
    : null;
  const imagem = s.imagemLinhas && s.imagemLinhas.length
    ? `Exames de imagem:\n${s.imagemLinhas.join("\n")}`
    : null;
  const a = s.avaliacao && s.avaliacao.length ? alinhar(s.avaliacao, "*A: ") : null;
  const p = s.plano && s.plano.length ? alinhar(s.plano, "*P: ") : null;

  const porChave = { atual: blocoAtual, trat: blocoTrat, comorb: blocoComorb, hda, s: subj, ssvv, o, labs, imagem, a, p };
  return [TITULO, ...ORDEM.map((k) => porChave[k])].filter(Boolean).join("\n\n");
}

module.exports = { TITULO, ORDEM, REGRAS, alinhar, montar };
