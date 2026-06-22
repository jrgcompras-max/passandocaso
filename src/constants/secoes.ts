import { type SecaoId } from "@/types/paciente";

/** Uma seção clínica baseada em foto/extração. */
export type SecaoConfig = {
  id: SecaoId;
  titulo: string;
  instrucao: string;
  /** Exibir conteúdo como linhas com bullet (medicações) em vez de chips. */
  medicacao?: boolean;
  /** Exibir conteúdo como TEXTO dissertativo (parágrafo), sem chips/bullets. */
  prosa?: boolean;
};

/**
 * Definição interna de cada seção de extração por foto:
 *  - `escopo`: o que PERTENCE àquela seção (frase curta).
 *  - `especifico`: como organizar/estruturar a saída daquela seção.
 *
 * A instrução final é montada por `montarInstrucao`, que prefixa um bloco de
 * ISOLAMENTO listando TODAS as outras seções e mandando ignorá-las. Como a foto
 * costuma pegar uma página inteira do prontuário (com várias seções), dar ao
 * modelo a taxonomia completa + a lista de exclusão é a forma mais robusta de
 * evitar que ele misture conteúdo (ex.: comorbidades/MUC vazando para a HDA).
 */
type SecaoDef = {
  id: SecaoId;
  titulo: string;
  escopo: string;
  especifico: string;
  medicacao?: boolean;
  prosa?: boolean;
};

const DEFS: SecaoDef[] = [
  {
    id: "comorbidades",
    titulo: "Comorbidades",
    escopo: "as comorbidades/doenças crônicas de base do paciente, prévias à internação",
    especifico:
      "Liste UMA comorbidade/doença crônica por item (ex.: HAS, DM2, DPOC, DRC). " +
      "NÃO inclua medicações (de uso contínuo ou hospitalares), motivo/história da internação atual, exames nem prescrição.",
  },
  {
    id: "medicacoesUsoContinuo",
    titulo: "Medicações de Uso Contínuo (MUC)",
    medicacao: true,
    escopo: "as medicações de uso contínuo (MUC) que o paciente já usava em casa antes da internação",
    especifico:
      "Liste UMA medicação com sua dose/posologia por item (ex.: 'Losartana 50 mg/dia'). " +
      "NÃO inclua medicamentos iniciados nesta internação (prescrição hospitalar), comorbidades, história nem exames.",
  },
  {
    id: "historia",
    titulo: "História da Doença Atual",
    prosa: true,
    escopo: "a história da doença atual (HDA): o relato do quadro que motivou a internação",
    especifico:
      "Devolva a HDA como UM TEXTO DISSERTATIVO em parágrafo corrido (não em tópicos/itens isolados). " +
      "Aplique apenas correção de gramática, concordância e pontuação; preserve o conteúdo. " +
      "NÃO inclua listas de comorbidades crônicas, medicações de uso contínuo, exames, exame físico nem prescrição.",
  },
  {
    id: "examesLaboratoriais",
    titulo: "Exames Laboratoriais",
    escopo: "os resultados de exames laboratoriais (sangue, urina, líquor, etc.)",
    especifico:
      "Agrupe por painel/sistema (ex.: 'Hemograma', 'Função renal', 'Eletrólitos', 'Função hepática', 'Coagulação', 'Gasometria', 'Marcadores'), " +
      "cada exame com valor e unidade como um item. NÃO inclua laudos de exames de imagem. " +
      "Reconheça abreviações laboratoriais, inclusive as de função hepática: " +
      "FA = Fosfatase Alcalina, GGT = Gama-GT, BD/BI = bilirrubina direta/indireta, BT = bilirrubina total, ALB = albumina, TGO/TGP = transaminases. " +
      "ATENÇÃO: 'FA' seguido de um valor é Fosfatase Alcalina (um EXAME laboratorial) — NÃO é fibrilação atrial nem sinal vital; inclua-o normalmente.",
  },
  {
    id: "imagem",
    titulo: "Imagem",
    escopo: "os laudos de exames de imagem (raio-X, tomografia, ressonância, ultrassom, etc.)",
    especifico:
      "Use um bloco por exame, com o título sendo o NOME do exame (ex.: 'TC de crânio', 'RM de abdome', 'RX de tórax') " +
      "e cada achado do laudo como um item. NÃO inclua valores de exames laboratoriais.",
  },
  {
    id: "prescricaoHospitalar",
    titulo: "Prescrição Hospitalar",
    medicacao: true,
    escopo: "os medicamentos da prescrição hospitalar ATUAL (em uso durante esta internação)",
    especifico:
      "Agrupe por classe (ex.: 'Antibióticos', 'Antifúngicos', 'Corticoides', 'Analgesia', 'Sintomáticos'), " +
      "cada medicamento com dose, via e posologia como um item. NÃO inclua as medicações de uso contínuo prévias do paciente.",
  },
  {
    id: "sinaisVitaisIntercorrencias",
    titulo: "Sinais Vitais e Intercorrências",
    escopo: "os sinais vitais e as intercorrências do dia",
    especifico:
      "Use dois blocos: 'Sinais vitais' (PA, FC, FR, Tax, SatO2, etc., um por item) e 'Intercorrências' (uma por item). " +
      "NÃO inclua exames laboratoriais: em especial, 'FA' (Fosfatase Alcalina) é um exame de função hepática e pertence aos Exames Laboratoriais, não aos sinais vitais.",
  },
];

/** Monta a instrução final com o bloco de isolamento (taxonomia + exclusão). */
function montarInstrucao(def: SecaoDef): string {
  const outras = DEFS.filter((d) => d.id !== def.id)
    .map((d) => `"${d.titulo}" (${d.escopo})`)
    .join("; ");
  return (
    "Esta é UMA seção de um prontuário. A foto pode conter VÁRIAS seções ao mesmo tempo, " +
    "mas você deve extrair SOMENTE o conteúdo desta seção: " +
    `${def.escopo}. ` +
    "IGNORE COMPLETAMENTE qualquer informação que pertença às outras seções, mesmo que apareça na foto — " +
    `são elas: ${outras}. ` +
    "Se um dado não pertencer claramente a ESTA seção, NÃO o inclua de forma alguma. " +
    def.especifico
  );
}

/**
 * Seções clínicas expansíveis, na ordem oficial de exibição (e de geração do
 * texto de evolução). `medicacao: true` força linhas com bullet.
 */
export const SECOES: SecaoConfig[] = DEFS.map((d) => ({
  id: d.id,
  titulo: d.titulo,
  medicacao: d.medicacao,
  prosa: d.prosa,
  instrucao: montarInstrucao(d),
}));
