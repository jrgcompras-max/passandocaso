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
 */
export const SECOES: SecaoConfig[] = [
  {
    id: "comorbidadesMedicacoes",
    titulo: "Comorbidades e MUC",
    instrucao:
      "Extraia desta tela de prontuário as comorbidades/doenças de base e as medicações de uso contínuo. " +
      "Use dois blocos: 'Comorbidades' (uma doença por item) e 'Medicações de uso contínuo' (uma medicação com dose/posologia por item).",
  },
  {
    id: "historia",
    titulo: "História da Doença Atual",
    instrucao:
      "Extraia a história clínica desta tela de prontuário. " +
      "Use blocos como 'Motivo da internação', 'História da doença atual' e 'Antecedentes', cada fato relevante como um item.",
  },
  {
    id: "examesLaboratoriais",
    titulo: "Exames Laboratoriais",
    instrucao:
      "Extraia os resultados de exames laboratoriais desta tela de prontuário. " +
      "Agrupe por painel/sistema (ex.: 'Hemograma', 'Função renal', 'Eletrólitos', 'Função hepática', 'Coagulação', 'Gasometria', 'Marcadores'), " +
      "cada exame com valor e unidade como um item.",
  },
  {
    id: "imagem",
    titulo: "Imagem",
    instrucao:
      "Extraia os achados de exames de imagem (raio-x, tomografia, ultrassom, etc.) desta tela de prontuário. " +
      "Use um bloco por exame (ex.: 'Raio-X de tórax', 'TC de crânio'), com cada achado como um item.",
  },
  {
    id: "prescricaoHospitalar",
    titulo: "Prescrição Hospitalar",
    medicacao: true,
    instrucao:
      "Extraia os medicamentos em uso no hospital desta tela de prescrição. " +
      "Agrupe por classe (ex.: 'Antibióticos', 'Antifúngicos', 'Corticoides', 'Analgesia', 'Sintomáticos'), " +
      "cada medicamento com dose, via e posologia como um item.",
  },
  {
    id: "sinaisVitaisIntercorrencias",
    titulo: "Sinais Vitais e Intercorrências",
    instrucao:
      "Extraia desta tela de prontuário os sinais vitais e as intercorrências. " +
      "Use dois blocos: 'Sinais vitais' (PA, FC, FR, Tax, SatO2, etc., um por item) e 'Intercorrências' (uma por item).",
  },
];
