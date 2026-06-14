import { type O2Modo, type SinaisVitaisDia } from "@/types/paciente";

/** Registro de sinais vitais vazio (um dia novo). */
export const SV_VAZIO: SinaisVitaisDia = {
  temp: "",
  paSist: "",
  paDiast: "",
  fc: "",
  fr: "",
  sato2: "",
  glicemia: "",
  diurese: "",
  o2: null,
  intercorrencias: "",
};

/** Opções de oxigenoterapia (chips). */
export const O2_OPCOES: { valor: O2Modo; rotulo: string }[] = [
  { valor: "ar", rotulo: "Ar ambiente" },
  { valor: "cateter", rotulo: "Cateter" },
  { valor: "mascara", rotulo: "Máscara" },
  { valor: "vm", rotulo: "VM" },
];

/** Trecho de frase por modo de O2. */
const O2_FRASE: Record<O2Modo, string> = {
  ar: "em ar ambiente",
  cateter: "em cateter de O2",
  mascara: "em máscara de O2",
  vm: "em ventilação mecânica",
};

/** Extrai a parte numérica de um valor digitado (aceita vírgula decimal). */
function num(v: string): number | null {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** true se nenhum campo de sinais vitais foi preenchido. */
export function svVazio(sv?: SinaisVitaisDia | null): boolean {
  if (!sv) return true;
  return !(
    sv.temp ||
    sv.paSist ||
    sv.paDiast ||
    sv.fc ||
    sv.fr ||
    sv.sato2 ||
    sv.glicemia ||
    sv.diurese ||
    sv.o2 ||
    sv.intercorrencias
  );
}

/**
 * Monta uma frase clínica automática a partir dos sinais vitais estruturados.
 * Ex.: "Paciente afebril (Tax 36,5°C), hemodinamicamente estável (PA 120/80,
 * FC 78), em ar ambiente com SatO2 96%."
 */
export function fraseSinaisVitais(sv?: SinaisVitaisDia | null): string {
  if (!sv) return "";
  const partes: string[] = [];

  if (sv.temp.trim()) {
    const t = num(sv.temp);
    const q = t != null ? (t < 37.8 ? "afebril" : "febril") : null;
    partes.push(q ? `${q} (Tax ${sv.temp.trim()}°C)` : `Tax ${sv.temp.trim()}°C`);
  }

  const hemo: string[] = [];
  if (sv.paSist.trim() && sv.paDiast.trim())
    hemo.push(`PA ${sv.paSist.trim()}/${sv.paDiast.trim()}`);
  if (sv.fc.trim()) hemo.push(`FC ${sv.fc.trim()}`);
  if (hemo.length) {
    const sist = num(sv.paSist);
    const fc = num(sv.fc);
    const estavel =
      sist != null && sist >= 90 && (fc == null || (fc >= 50 && fc <= 100));
    partes.push(
      `${estavel ? "hemodinamicamente estável " : ""}(${hemo.join(", ")})`.trim(),
    );
  }

  if (sv.fr.trim()) partes.push(`FR ${sv.fr.trim()} irpm`);

  const o2: string[] = [];
  if (sv.o2) o2.push(O2_FRASE[sv.o2]);
  if (sv.sato2.trim()) o2.push(`SatO2 ${sv.sato2.trim()}%`);
  if (o2.length) partes.push(o2.join(" com "));

  if (sv.glicemia.trim()) partes.push(`glicemia ${sv.glicemia.trim()} mg/dL`);
  if (sv.diurese.trim()) partes.push(`diurese ${sv.diurese.trim()} mL/24h`);

  if (!partes.length) return "";
  return `Paciente ${partes.join(", ")}.`;
}
