import { type ResultadoLab } from "@/types/paciente";

import { hojeISO } from "./datas";
import { apiFetch } from "./sessao";

/**
 * Extração de LABS em múltiplos passos (BUGS 10+11). Chama o pipeline do backend
 * (/api/extract-labs), que inventaria as datas da tabela de laboratório e extrai
 * UMA chamada por data — assim nenhuma data é perdida em tabelas densas (antes a
 * extração única importava só a mais recente). O resultado popula `resultadosLab`
 * (estrutura única dos labs), alimentando "Resultados por data" e o Passar o Caso.
 */

export type ExameExtraido = { nome: string; valor: string; unidade?: string | null };
export type LabPorData = { data: string | null; exames: ExameExtraido[] };
export type LabGap = { tipo: string; data: string | null; detalhe: string };
export type ResultadoExtracaoLabs = {
  porData: LabPorData[];
  datas: string[];
  gaps: LabGap[];
};

export async function extrairLabsMultiData(
  base64: string,
): Promise<ResultadoExtracaoLabs> {
  const response = await apiFetch("/api/extract-labs", {
    method: "POST",
    body: JSON.stringify({ imagemBase64: base64 }),
  });
  const texto = await response.text();
  if (!response.ok) {
    throw new Error(`Backend retornou status ${response.status}: ${texto}`);
  }
  try {
    const j = JSON.parse(texto);
    return {
      porData: Array.isArray(j.porData) ? j.porData : [],
      datas: Array.isArray(j.datas) ? j.datas : [],
      gaps: Array.isArray(j.gaps) ? j.gaps : [],
    };
  } catch {
    throw new Error(`Resposta inválida do backend:\n${texto}`);
  }
}

/** Converte "DD/MM" (ou "DD/MM/AAAA") para ISO YYYY-MM-DD; null → hoje. */
function ddmmParaISO(data: string | null): string {
  if (!data) return hojeISO();
  const m = data.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return hojeISO();
  const dia = m[1].padStart(2, "0");
  const mes = m[2].padStart(2, "0");
  const ano = m[3]
    ? m[3].length === 2
      ? `20${m[3]}`
      : m[3]
    : hojeISO().slice(0, 4);
  return `${ano}-${mes}-${dia}`;
}

let seq = 0;
function gerarId(): string {
  return `lab-${Date.now()}-${seq++}`;
}

/**
 * Funde os labs extraídos (por data) na lista `resultadosLab` existente, sem
 * duplicar (mesma combinação exame+data). Retorna a lista completa atualizada.
 */
export function mesclarResultadosLab(
  porData: LabPorData[],
  existentes: ResultadoLab[],
): ResultadoLab[] {
  const out = [...existentes];
  const chave = (exame: string, data: string) =>
    `${exame.trim().toLowerCase()}|${data.slice(0, 10)}`;
  const vistos = new Set(existentes.map((r) => chave(r.exame, r.data)));
  for (const { data, exames } of porData) {
    const iso = ddmmParaISO(data);
    for (const e of exames) {
      if (!e?.nome || e.valor == null || String(e.valor).trim() === "") continue;
      const k = chave(e.nome, iso);
      if (vistos.has(k)) continue;
      vistos.add(k);
      const valor = e.unidade
        ? `${String(e.valor).trim()} ${e.unidade}`
        : String(e.valor).trim();
      out.push({ id: gerarId(), exame: e.nome.trim(), data: iso, valor });
    }
  }
  return out;
}
