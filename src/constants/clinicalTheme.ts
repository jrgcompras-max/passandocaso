/**
 * Design system — estilo iOS / Apple Health.
 * Tokens compartilhados pelas telas e componentes do app.
 */

export const ClinicalColors = {
  background: "#F2F2F7", // cinza de fundo do iOS (não branco puro)
  surface: "#FFFFFF", // cards e superfícies
  border: "#E5E5EA", // separadores 0.5px
  primary: "#007AFF", // azul iOS — botões/links/ativo
  buttonPrimary: "#007AFF",
  accent: "#34C759", // verde iOS — sucesso/evoluído
  text: "#000000", // texto primário
  textSecondary: "#3C3C43", // corpo/detalhe
  textMuted: "#8E8E93", // terciário/placeholder/label
  textOnPrimary: "#FFFFFF",
  chevron: "#C7C7CC", // chevrons e detalhes inativos
  danger: "#FF3B30", // vermelho iOS — excluir/alerta
  warning: "#FF9500", // laranja iOS — atenção/pendências
  warningBg: "#FFF3E0",
} as const;

/** Status de fluxo do round (ordem de prioridade = ordem de exibição). */
export type StatusType =
  | "naoVisitado"
  | "visitado"
  | "evoluido"
  | "revisar"
  | "pendente"
  | "altaProvavel"
  | "altaRealizada";

export const StatusColors: Record<
  StatusType,
  { label: string; bg: string; text: string }
> = {
  naoVisitado: { label: "Não visitado", bg: "#FFE5E5", text: "#FF3B30" },
  visitado: { label: "Visitado", bg: "#FFF3E0", text: "#FF9500" },
  evoluido: { label: "Evoluído", bg: "#E0F2FE", text: "#0369A1" },
  revisar: { label: "Revisar", bg: "#F3E5FF", text: "#AF52DE" },
  pendente: { label: "Pendente", bg: "#F3E5FF", text: "#AF52DE" },
  altaProvavel: { label: "Alta provável", bg: "#E5F7EE", text: "#34C759" },
  altaRealizada: { label: "Alta realizada", bg: "#F2F2F7", text: "#8E8E93" },
};

/** Avaliação subjetiva do estado clínico atual do paciente. */
export type StatusClinico = "melhora" | "estavel" | "piora" | "critico";

export const StatusClinicoColors: Record<
  StatusClinico,
  { label: string; bg: string; text: string }
> = {
  melhora: { label: "Melhora clínica", bg: "#E5F7EE", text: "#34C759" },
  estavel: { label: "Estável", bg: "#E5F0FF", text: "#007AFF" },
  piora: { label: "Em piora", bg: "#FFF3E0", text: "#FF9500" },
  critico: { label: "Crítico", bg: "#FFE5E5", text: "#FF3B30" },
};

/** Prioridade compartilhada por problemas ativos e pendências. */
export type Prioridade = "alta" | "media" | "baixa";

export const PrioridadeColors: Record<
  Prioridade,
  { label: string; bg: string; text: string; border: string }
> = {
  alta: { label: "Alta", bg: "#FFE5E5", text: "#FF3B30", border: "#FFD0CE" },
  media: { label: "Média", bg: "#FFF3E0", text: "#FF9500", border: "#FFE2BF" },
  baixa: { label: "Baixa", bg: "#E5F7EE", text: "#34C759", border: "#C9EFD8" },
};

export const Radius = {
  card: 16,
  badge: 8,
  pill: 20,
} as const;

export const BorderWidth = {
  hairline: 0.5,
} as const;
