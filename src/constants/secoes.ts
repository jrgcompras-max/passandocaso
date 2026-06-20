import { type SecaoId } from "@/types/paciente";

/** Uma seção clínica baseada em foto/extração. */
export type SecaoConfig = {
  id: SecaoId;
  titulo: string;
  instrucao: string;
  /** Exibir conteúdo como linhas com bullet (medicações) em vez de chips. */
  medicacao?: boolean;
};

/**
 * Seções clínicas expansíveis, na ordem oficial de exibição (e de geração do
 * texto de evolução). `medicacao: true` força linhas com bullet.
 *
 * Cada instrução é ESTRITA: a IA deve extrair APENAS o conteúdo daquela seção e
 * ignorar tudo que pertença às outras (evita misturar HDA com comorbidades/MUC,
 * exames, etc. quando a foto pega trechos vizinhos do prontuário).
 */
export const SECOES: SecaoConfig[] = [
  {
    id: "comorbidadesMedicacoes",
    titulo: "Comorbidades e MUC",
    instrucao:
      "Extraia APENAS as comorbidades/doenças de base e as medicações de uso contínuo desta tela de prontuário. " +
      "Ignore completamente história da doença atual, exames laboratoriais, exames de imagem, sinais vitais, prescrição hospitalar e qualquer outra informação. " +
      "Use dois blocos: 'Comorbidades' (uma doença por item) e 'Medicações de uso contínuo' (uma medicação com dose/posologia por item).",
  },
  {
    id: "historia",
    titulo: "História da Doença Atual",
    instrucao:
      "Extraia APENAS a história clínica (motivo da internação, história da doença atual e antecedentes) desta tela de prontuário. " +
      "Ignore completamente comorbidades, medicações de uso contínuo, exames laboratoriais, exames de imagem, sinais vitais, prescrições e qualquer outra informação que pertença a outras seções. " +
      "Use blocos como 'Motivo da internação', 'História da doença atual' e 'Antecedentes', cada fato relevante como um item.",
  },
  {
    id: "examesLaboratoriais",
    titulo: "Exames Laboratoriais",
    instrucao:
      "Extraia APENAS os resultados de exames laboratoriais desta tela de prontuário. " +
      "Ignore completamente comorbidades, medicações, história clínica, exames de imagem, sinais vitais e prescrições. " +
      "Agrupe por painel/sistema (ex.: 'Hemograma', 'Função renal', 'Eletrólitos', 'Função hepática', 'Coagulação', 'Gasometria', 'Marcadores'), " +
      "cada exame com valor e unidade como um item.",
  },
  {
    id: "imagem",
    titulo: "Imagem",
    instrucao:
      "Extraia APENAS os laudos de exames de imagem (raio-x, tomografia, ressonância, ultrassom, etc.) desta tela de prontuário. " +
      "Ignore completamente comorbidades, medicações, história clínica, exames laboratoriais, sinais vitais e prescrições. " +
      "Use um bloco por exame, com o título sendo o NOME do exame (ex.: 'TC de crânio', 'RM de abdome', 'RX de tórax') e cada achado do laudo como um item.",
  },
  {
    id: "prescricaoHospitalar",
    titulo: "Prescrição Hospitalar",
    medicacao: true,
    instrucao:
      "Extraia APENAS os medicamentos em uso no hospital desta tela de prescrição. " +
      "Ignore completamente comorbidades, medicações de uso contínuo prévias, história clínica, exames laboratoriais, exames de imagem e sinais vitais. " +
      "Agrupe por classe (ex.: 'Antibióticos', 'Antifúngicos', 'Corticoides', 'Analgesia', 'Sintomáticos'), " +
      "cada medicamento com dose, via e posologia como um item.",
  },
  {
    id: "sinaisVitaisIntercorrencias",
    titulo: "Sinais Vitais e Intercorrências",
    instrucao:
      "Extraia APENAS os sinais vitais e as intercorrências desta tela de prontuário. " +
      "Ignore completamente comorbidades, medicações, história clínica, exames laboratoriais, exames de imagem e prescrições. " +
      "Use dois blocos: 'Sinais vitais' (PA, FC, FR, Tax, SatO2, etc., um por item) e 'Intercorrências' (uma por item).",
  },
];
