import { type ResultadoLab } from "@/types/paciente";

export type Tendencia = "queda" | "alta" | "estavel";

/** Uma série temporal de um exame: pontos ordenados por data + tendência. */
export type ExameSerie = {
  exame: string;
  pontos: ResultadoLab[];
  tendencia: Tendencia | null;
};

/** Ícone, cor e rótulo de cada tendência. */
export const TENDENCIA_INFO: Record<
  Tendencia,
  { icone: string; cor: string; rotulo: string }
> = {
  queda: { icone: "↓", cor: "#166534", rotulo: "em queda" },
  alta: { icone: "↑", cor: "#991B1B", rotulo: "em elevação" },
  estavel: { icone: "→", cor: "#64748B", rotulo: "estável" },
};

/** Extrai o primeiro número de um valor (aceita vírgula decimal). */
function num(v: string): number | null {
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Tendência comparando o primeiro e o último valor (limiar de 5%). */
function calcularTendencia(pontos: ResultadoLab[]): Tendencia | null {
  const nums = pontos
    .map((p) => num(p.valor))
    .filter((n): n is number => n != null);
  if (nums.length < 2) return null;
  const primeiro = nums[0];
  const ultimo = nums[nums.length - 1];
  const limiar = Math.abs(primeiro) * 0.05;
  if (ultimo < primeiro - limiar) return "queda";
  if (ultimo > primeiro + limiar) return "alta";
  return "estavel";
}

/** Agrupa resultados por exame, ordena por data (asc) e calcula a tendência. */
export function agruparPorExame(resultados: ResultadoLab[]): ExameSerie[] {
  const mapa = new Map<string, ResultadoLab[]>();
  for (const r of resultados) {
    const chave = r.exame.trim();
    if (!chave) continue;
    const lista = mapa.get(chave) ?? [];
    lista.push(r);
    mapa.set(chave, lista);
  }
  const series: ExameSerie[] = [];
  mapa.forEach((lista, exame) => {
    const pontos = [...lista].sort((a, b) => a.data.localeCompare(b.data));
    series.push({ exame, pontos, tendencia: calcularTendencia(pontos) });
  });
  return series.sort((a, b) => a.exame.localeCompare(b.exame));
}
