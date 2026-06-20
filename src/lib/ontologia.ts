import { apiFetch } from "./sessao";

/**
 * Cliente da ontologia clínica. As referências vêm de bases oficiais (LOINC)
 * semeadas no backend — o app só consulta, nunca cria referências próprias.
 */

export type ReferenciaLab = {
  encontrado: boolean;
  termo?: string;
  unidade?: string | null;
  refMin?: number | null;
  refMax?: number | null;
  contexto?: string | null;
  fonte?: string | null;
  loinc?: string | null;
};

// Cache em memória por sessão (chave: lab normalizado + sexo).
const cache = new Map<string, ReferenciaLab>();

export async function buscarReferencia(
  lab: string,
  sexo?: "M" | "F" | null,
): Promise<ReferenciaLab> {
  const chave = `${lab.trim().toLowerCase()}|${sexo || ""}`;
  const emCache = cache.get(chave);
  if (emCache) return emCache;
  try {
    const q = sexo ? `?sexo=${sexo}` : "";
    const r = await apiFetch(
      `/api/ontologia/referencia/${encodeURIComponent(lab.trim())}${q}`,
    );
    if (!r.ok) return { encontrado: false };
    const j = (await r.json()) as ReferenciaLab;
    cache.set(chave, j);
    return j;
  } catch {
    return { encontrado: false };
  }
}

/** Primeiro número de um texto ("2,3 mg/dL" → 2.3). */
export function valorNumerico(v: string): number | null {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export type StatusRef = "normal" | "fora" | "atencao";

/** Compara um valor com a referência. atencao = muito fora (>2x / <½). */
export function statusReferencia(
  valor: number | null,
  ref: ReferenciaLab,
): StatusRef {
  if (valor == null || !ref.encontrado) return "normal";
  const { refMin, refMax } = ref;
  if (refMin == null && refMax == null) return "normal";
  const acimaMax = refMax != null && valor > refMax;
  const abaixoMin = refMin != null && valor < refMin;
  if (!acimaMax && !abaixoMin) return "normal";
  const muito =
    (refMax != null && refMax > 0 && valor > refMax * 2) ||
    (refMin != null && refMin > 0 && valor < refMin / 2);
  return muito ? "atencao" : "fora";
}

/** Texto curto da faixa de referência: "0.7–1.2 mg/dL". */
export function textoReferencia(ref: ReferenciaLab): string {
  if (!ref.encontrado) return "";
  const { refMin, refMax, unidade } = ref;
  const u = unidade ? ` ${unidade}` : "";
  if (refMin != null && refMax != null) return `ref: ${refMin}–${refMax}${u}`;
  if (refMax != null) return `ref: <${refMax}${u}`;
  if (refMin != null) return `ref: >${refMin}${u}`;
  return "";
}
