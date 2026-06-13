/**
 * Design system — Tema escuro clínico.
 * Tokens compartilhados pelas telas do app (lista de pacientes e detalhe).
 */

export const ClinicalColors = {
  background: "#0B1220",
  surface: "#121E30",
  border: "#1A2D44",
  primary: "#4A90C4",
  buttonPrimary: "#1A5FA8",
  text: "#F0F6FF",
  textMuted: "#5A7A99",
} as const;

export type StatusType = "pendente" | "visitado" | "discutido" | "evoluido";

export const StatusColors: Record<
  StatusType,
  { label: string; bg: string; text: string }
> = {
  pendente: { label: "Pendente", bg: "#3D1F1F", text: "#E07070" },
  visitado: { label: "Visitado", bg: "#2D2A10", text: "#D4B84A" },
  discutido: { label: "Discutido", bg: "#102A1F", text: "#4DB87A" },
  evoluido: { label: "Evoluído", bg: "#0F1E35", text: "#4A90C4" },
};

export const Radius = {
  card: 12,
  badge: 8,
} as const;

export const BorderWidth = {
  hairline: 0.5,
} as const;
