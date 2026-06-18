import { type EvolucaoBeiraLeito } from "@/types/paciente";

export type Opcao = { valor: string; rotulo: string };

export const OPC_CONSCIENCIA: Opcao[] = [
  { valor: "lucido", rotulo: "Lúcido" },
  { valor: "torporoso", rotulo: "Torporoso" },
  { valor: "comatoso", rotulo: "Comatoso" },
];
export const OPC_ORIENTACAO: Opcao[] = [
  { valor: "orientado", rotulo: "Orientado" },
  { valor: "desorientado", rotulo: "Desorientado" },
];
export const OPC_ALIMENTACAO: Opcao[] = [
  { valor: "viaOral", rotulo: "Via oral" },
  { valor: "sne", rotulo: "SNE" },
  { valor: "npt", rotulo: "NPT" },
  { valor: "jejum", rotulo: "Jejum" },
];
export const OPC_DIURESE: Opcao[] = [
  { valor: "presente", rotulo: "Presente" },
  { valor: "ausente", rotulo: "Ausente" },
];
export const OPC_EVACUACAO: Opcao[] = [
  { valor: "presente", rotulo: "Presente" },
  { valor: "ausente", rotulo: "Ausente" },
];

export const DISPOSITIVOS = [
  "Acesso venoso periférico",
  "Acesso venoso central",
  "Sonda nasogástrica",
  "Sonda nasoenteral",
  "Sonda vesical",
  "Dreno",
  "Traqueostomia",
  "VM (ventilação mecânica)",
  "Diálise",
];

export const EVOLUCAO_VAZIA: EvolucaoBeiraLeito = {
  nivelConsciencia: null,
  orientacao: null,
  estadoGeral: "",
  alimentacao: null,
  diurese: null,
  evacuacao: null,
  dispositivos: [],
  dispositivosObs: {},
  exameFisico: "",
  condutaDoDia: "",
};

/** Converte o valor armazenado (ex.: "viaOral") no rótulo legível (ex.: "Via oral"). */
export function rotuloDe(opcoes: Opcao[], valor: string | null): string {
  if (!valor) return "";
  return opcoes.find((o) => o.valor === valor)?.rotulo ?? valor;
}
