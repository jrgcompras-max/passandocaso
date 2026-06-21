/**
 * FONTE DE VERDADE — Passar o Caso (visual rico, fica no app; NÃO é copiado).
 *
 * Define a ESTRUTURA, ORDEM e REGRAS VISUAIS dos cards. A tela RN
 * (app: Passar o Caso) DEVE seguir exatamente esta ordem e estes estilos.
 * Não vai para sistemas externos: sem botão "Copiar".
 */

// Subtítulo automático: "Nome abreviado · Idade · Leito · D+".
const SUBTITULO = "nomeAbreviado · idade · leito · D{dia}";

// Ordem canônica dos cards.
const ORDEM = [
  { chave: "hda", label: "HDA", tipo: "linha" },
  { chave: "atual", label: "Atual", tipo: "lista-bullet-azul" },
  { chave: "comorbidades", label: "Comorbidades", tipo: "chips" },
  { chave: "muc", label: "MUC", tipo: "chips" },
  { chave: "ssvvAlterados", label: "Sinais vitais alterados", tipo: "badges-vermelho" },
  { chave: "exameFisico", label: "Exame físico", tipo: "chips-marcados" },
  { chave: "labsAlterados", label: "Labs alterados", tipo: "labs-seta" },
  { chave: "antibioticos", label: "Antibióticos", tipo: "badge-atb" },
  { chave: "avaliacao", label: "Avaliação", tipo: "lista-bullet-azul" },
  { chave: "conduta", label: "Conduta proposta", tipo: "numerada" },
  { chave: "escores", label: "Escores", tipo: "escores", soSeToggle: true },
];

const REGRAS = [
  "Só aparecem cards com conteúdo (sem seções vazias).",
  "Sinais vitais: SÓ os fora do normal, em badges vermelhos.",
  "Exame físico: só os chips marcados pelo médico.",
  "Labs: só fora do normal, com seta ↑/↓.",
  "Antibióticos: só se houver ATB cadastrado; badge ATB + nome + D+.",
  'Conduta SEMPRE "Conduta proposta" (round = discutir/validar), numerada.',
  "Escores: só se o toggle de escores estiver ativado (default deste botão: OFF).",
];

// Tokens visuais (React Native).
const VISUAL = {
  cardBg: "#FFFFFF",
  cardBorder: "#E5E5EA", // 0.5px
  espacoEntreCards: 6,
  sectionLabel: { size: 11, uppercase: true, cor: "#8E8E93" },
  bulletAzul: "#007AFF",
  ssvvBadge: { bg: "#FCEBEB", texto: "#A32D2D" },
  labAlto: "#A32D2D", // vermelho
  labBaixo: "#1A6B8A", // azul
  atbBadge: { bg: "#FFEDE6", texto: "#C2410C", label: "ATB" },
};

module.exports = { SUBTITULO, ORDEM, REGRAS, VISUAL };
