import { type StatusType } from "@/constants/clinicalTheme";

/** Dados extraídos do cabeçalho do prontuário (sistema Tasy). */
export type CabecalhoProntuario = {
  nomeCompleto: string;
  idade: number | null;
  /** Número do leito — preenchido manualmente (não aparece na foto do sistema). */
  leito: string;
  /** Setor/unidade — extraído da foto do cabeçalho pela IA. */
  setor: string;
  dataEntrada: string;
  numeroProntuario: string;
};

/** Dados clínicos extraídos durante a visita (formato legado, antes das seções). */
export type DadosClinicos = {
  motivoInternacao: string;
  comorbidades: string;
  examesRecentes: string;
  sinaisVitais: string;
  intercorrencias: string;
};

/** Identificadores estáveis das seções clínicas expansíveis do prontuário. */
export type SecaoId =
  | "identificacao"
  | "comorbidadesHistoria"
  | "comorbidadesMedicacoes"
  | "historia"
  | "examesLaboratoriais"
  | "prescricaoHospitalar"
  | "imagem"
  | "sinaisVitaisIntercorrencias";

/** Uma anotação livre do usuário dentro de uma seção. */
export type Anotacao = {
  /** Identificador estável (timestamp da criação). */
  id: string;
  /** Texto da anotação. */
  texto: string;
  /** Horário da criação no formato HH:MM (local). */
  horario: string;
};

/** Conteúdo de uma seção: lista de anotações do usuário + texto extraído pela IA. */
export type SecaoClinica = {
  /** Anotações livres digitadas pelo usuário (mais recentes primeiro). */
  anotacoes: Anotacao[];
  /** Conteúdo extraído pela IA a partir da foto da seção. */
  extraido: string;
};

/**
 * Evolução beira-leito de UM dia — formulário estruturado preenchido no leito,
 * 100% manual (sem foto). Guardada por data (cada dia tem a sua).
 */
export type EvolucaoBeiraLeito = {
  /** "lucido" | "torporoso" | "comatoso" | null */
  nivelConsciencia: string | null;
  /** "orientado" | "desorientado" | null */
  orientacao: string | null;
  estadoGeral: string;
  /** "viaOral" | "sne" | "npt" | "jejum" | null */
  alimentacao: string | null;
  /** "presente" | "ausente" | "sondaVesical" | null */
  diurese: string | null;
  /** "presente" | "ausente" | null */
  evacuacao: string | null;
  /** Dispositivos/invasões marcados (rótulos). */
  dispositivos: string[];
  /** Observação livre por dispositivo marcado (rótulo → texto). */
  dispositivosObs: Record<string, string>;
  exameFisico: string;
  condutaDoDia: string;
};

/**
 * Paciente acompanhado. A identidade é o número do prontuário, o que permite
 * vincular o mesmo paciente entre dias diferentes de acompanhamento.
 */
export type Paciente = CabecalhoProntuario & {
  /** Identidade estável entre dias (= numeroProntuario, ou fallback gerado). */
  id: string;
  status: StatusType;
  /** Datas (YYYY-MM-DD) em que o paciente foi fotografado/acompanhado. */
  diasAcompanhamento: string[];
  /** Dados clínicos da visita (formato legado); null até a primeira extração. */
  dadosClinicos: DadosClinicos | null;
  /**
   * Seções clínicas (anotações + extração por foto, por seção).
   * Pode faltar em registros antigos salvos antes das seções.
   */
  secoes?: Partial<Record<SecaoId, SecaoClinica>>;
  /** Evolução beira-leito por data (YYYY-MM-DD). */
  evolucoes?: Record<string, EvolucaoBeiraLeito>;
};
