/**
 * Design system — Tema claro clínico.
 * Tokens compartilhados pelas telas do app (lista de pacientes e detalhe).
 */

export const ClinicalColors = {
  background: "#F8FAFB",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  primary: "#1A6B8A", // azul clínico — botões/ações/links/destaques
  buttonPrimary: "#1A6B8A",
  accent: "#0E7A5A", // verde esmeralda — Passar o Caso / destaques
  text: "#0F2D52", // azul escuro — títulos e texto principal
  textMuted: "#64748B",
  textOnPrimary: "#FFFFFF", // texto sobre superfícies coloridas (botões/badges)
  chevron: "#94A3B8", // chevron das seções e separadores da lista
  warning: "#B45309", // âmbar — indicador de pendências
  warningBg: "#FEF3C7",
} as const;

/** Status de fluxo do round (ordem de prioridade = ordem de exibição). */
export type StatusType =
  | "naoVisitado"
  | "visitado"
  | "revisar"
  | "pendente"
  | "altaProvavel"
  | "altaRealizada";

export const StatusColors: Record<
  StatusType,
  { label: string; bg: string; text: string }
> = {
  naoVisitado: { label: "Não visitado", bg: "#FEE2E2", text: "#991B1B" },
  visitado: { label: "Visitado", bg: "#FEF9C3", text: "#854D0E" },
  revisar: { label: "Revisar", bg: "#FFEDD5", text: "#9A3412" },
  pendente: { label: "Pendente", bg: "#EDE9FE", text: "#6B21A8" },
  altaProvavel: { label: "Alta provável", bg: "#DCFCE7", text: "#166534" },
  altaRealizada: { label: "Alta realizada", bg: "#F1F5F9", text: "#475569" },
};

/** Avaliação subjetiva do estado clínico atual do paciente. */
export type StatusClinico = "melhora" | "estavel" | "piora" | "critico";

export const StatusClinicoColors: Record<
  StatusClinico,
  { label: string; bg: string; text: string }
> = {
  melhora: { label: "Melhora clínica", bg: "#DCFCE7", text: "#166534" },
  estavel: { label: "Estável", bg: "#DBEAFE", text: "#1E40AF" },
  piora: { label: "Em piora", bg: "#FFEDD5", text: "#9A3412" },
  critico: { label: "Crítico", bg: "#FEE2E2", text: "#991B1B" },
};

/** Prioridade compartilhada por problemas ativos e pendências. */
export type Prioridade = "alta" | "media" | "baixa";

export const PrioridadeColors: Record<
  Prioridade,
  { label: string; bg: string; text: string; border: string }
> = {
  alta: { label: "Alta", bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
  media: { label: "Média", bg: "#FEF9C3", text: "#854D0E", border: "#FDE047" },
  baixa: { label: "Baixa", bg: "#DCFCE7", text: "#166534", border: "#86EFAC" },
};

export const Radius = {
  card: 12,
  badge: 8,
} as const;

export const BorderWidth = {
  hairline: 0.5,
} as const;
