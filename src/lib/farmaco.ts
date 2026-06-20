import { apiFetch } from "./sessao";

/**
 * Cliente de segurança farmacológica (Fase 3). Consulta o backend para
 * interações, posologia de referência e TFG (CKD-EPI). Tudo é INFORMATIVO —
 * nunca bloqueia o cadastro de medicamentos. Falhas de rede degradam em silêncio
 * (retornam vazio) para não atrapalhar o fluxo clínico.
 */

export type Severidade = "leve" | "moderada" | "grave" | "desconhecida";

export type Interacao = {
  medicamentoA: string;
  medicamentoB: string;
  severidade: Severidade;
  descricao: string;
  mecanismo?: string | null;
  condutaRecomendada?: string | null;
  fonte: string;
};

export type AjusteRenal = {
  tfgMin: number | null;
  tfgCorte: number | null;
  recomendacao: string | null;
  fonte: string;
};

export type Posologia = {
  encontrado: boolean;
  medicamento?: string;
  classe?: string | null;
  doseUsual?: string | null;
  doseMin?: string | null;
  doseMax?: string | null;
  vias?: string[] | null;
  intervalo?: string | null;
  observacoes?: string | null;
  ajusteRenal?: AjusteRenal | null;
  fonte?: string;
};

export type TFG = {
  tfg: number;
  estadio: string;
  descricao: string;
  fonte: string;
};

/** Interações entre os medicamentos da prescrição (texto livre é resolvido no backend). */
export async function buscarInteracoes(medicamentos: string[]): Promise<Interacao[]> {
  const lista = medicamentos.map((m) => m.trim()).filter(Boolean);
  if (lista.length < 2) return [];
  try {
    const r = await apiFetch("/api/farmaco/interacoes", {
      method: "POST",
      body: JSON.stringify({ medicamentos: lista }),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { interacoes?: Interacao[] };
    return Array.isArray(j.interacoes) ? j.interacoes : [];
  } catch {
    return [];
  }
}

// Cache em memória por sessão (posologia muda raramente).
const cachePosologia = new Map<string, Posologia>();

/** Posologia de referência (RENAME) de um medicamento. */
export async function buscarPosologia(medicamento: string): Promise<Posologia> {
  const chave = medicamento.trim().toLowerCase();
  if (!chave) return { encontrado: false };
  const emCache = cachePosologia.get(chave);
  if (emCache) return emCache;
  try {
    const r = await apiFetch(`/api/farmaco/posologia/${encodeURIComponent(medicamento.trim())}`);
    if (!r.ok) return { encontrado: false };
    const j = (await r.json()) as Posologia;
    cachePosologia.set(chave, j);
    return j;
  } catch {
    return { encontrado: false };
  }
}

/** TFG estimada (CKD-EPI 2021). Retorna null se faltarem dados ou em falha. */
export async function calcularTFG(input: {
  creatinina: number | string;
  idade: number;
  sexo?: string | null;
  peso?: number;
}): Promise<TFG | null> {
  try {
    const r = await apiFetch("/api/farmaco/tfg", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!r.ok) return null;
    return (await r.json()) as TFG;
  } catch {
    return null;
  }
}

/** Texto compacto da posologia: "Dose usual: 1-2 g EV 12/12h". */
export function textoPosologia(p: Posologia): string {
  if (!p.encontrado) return "";
  const partes = [
    p.doseUsual,
    p.vias && p.vias.length ? p.vias.join("/") : null,
    p.intervalo,
  ].filter(Boolean);
  return partes.length ? `Dose usual: ${partes.join(" ")}` : "";
}
