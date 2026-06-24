import { type Medicamento } from "@/types/paciente";

import { hojeISO } from "./datas";

/**
 * D+ dinâmico dos medicamentos (BUG 7). O dia de uso (D4, D5…) é digitado no
 * texto livre, mas deve AVANÇAR sozinho a cada dia. Para isso ancoramos a data
 * de início (`dataInicio`) quando o D+ é informado e recalculamos o dia atual na
 * exibição: D+ = hoje - dataInicio + 1. Se o médico digita "D4" hoje, a data de
 * início é retroativa: dataInicio = hoje - (4 - 1).
 */

const RE_DIA = /\bD\s*(\d{1,3})(\s*\/\s*(\d{1,3}))?/i;

/** Extrai o D+ do texto: { dia, total? } (total = planejado, ex.: D5/7). */
export function parseDiaUso(texto: string): { dia: number; total: number | null; bruto: string } | null {
  const m = (texto || "").match(RE_DIA);
  if (!m) return null;
  return { dia: Number(m[1]), total: m[3] ? Number(m[3]) : null, bruto: m[0] };
}

function isoMaisDias(iso: string, delta: number): string {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, mo - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Data de início retroativa para um "D{dia}" informado em `hoje`. */
export function inicioRetroativo(dia: number, hoje = hojeISO()): string {
  return isoMaisDias(hoje, -(dia - 1));
}

/** Dia de uso atual (D+) a partir da data de início. Mínimo 1. */
export function diaAtual(dataInicio: string, hoje = hojeISO()): number {
  const [y1, m1, d1] = dataInicio.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = hoje.slice(0, 10).split("-").map(Number);
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.max(1, Math.floor((b - a) / 86_400_000) + 1);
}

/**
 * Ancora a `dataInicio` de cada medicamento que tem D+ no texto. Idempotente:
 * - sem D+ → remove âncora;
 * - com D+ e sem âncora → cria (retroativa a hoje);
 * - com D+ e âncora cujo dia de hoje difere do digitado → re-ancora (o médico
 *   editou o D+ manualmente).
 */
export function ancorarDiaUso(meds: Medicamento[], hoje = hojeISO()): Medicamento[] {
  return meds.map((m) => {
    const p = parseDiaUso(m.texto);
    if (!p) return m.dataInicio ? { ...m, dataInicio: undefined } : m;
    if (!m.dataInicio || diaAtual(m.dataInicio, hoje) !== p.dia) {
      return { ...m, dataInicio: inicioRetroativo(p.dia, hoje) };
    }
    return m;
  });
}

/**
 * Texto do medicamento com o D+ recalculado para hoje (mantém o /total). Quando
 * não há D+ ou âncora, devolve o texto original.
 */
export function textoComDiaAtual(m: Medicamento, hoje = hojeISO()): string {
  const p = parseDiaUso(m.texto);
  if (!p || !m.dataInicio) return m.texto;
  const dia = diaAtual(m.dataInicio, hoje);
  const novoDmais = `D${dia}${p.total != null ? `/${p.total}` : ""}`;
  return m.texto.replace(RE_DIA, novoDmais);
}
