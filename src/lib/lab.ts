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

/**
 * Abreviações clínicas (nome completo OU sigla → sigla) para exibição compacta
 * dos labs em TODAS as telas (Resultados por data, timeline, Passar o Caso, modal).
 * Fonte ÚNICA — não duplicar em outros arquivos. Ordem importa: termos de LÍQUOR
 * (LCR) e bilirrubinas direta/indireta vêm ANTES das regras genéricas.
 */
const LAB_ABREV: { re: RegExp; abbr: string }[] = [
  // Líquor (LCR) — antes de glic/prot/lactato genéricos.
  { re: /glic.*lcr|lcr.*glic/i, abbr: "Glic LCR" },
  { re: /lactato.*lcr|lcr.*lactato/i, abbr: "Lactato LCR" },
  { re: /prote[ií]na?s?.*lcr|lcr.*prote[ií]/i, abbr: "Prot LCR" },
  { re: /c[eé]lulas?\s*nuclead.*lcr|cel\s*nuc.*lcr/i, abbr: "Cel Nuc LCR" },
  { re: /eritr[oó]citos?.*lcr|eritr.*lcr/i, abbr: "Eritr LCR" },
  { re: /cloret.*lcr|clor.*lcr/i, abbr: "Clor LCR" },
  { re: /bacterioscop.*lcr|bact.*lcr/i, abbr: "Bact LCR" },
  { re: /fungos?.*lcr|lcr.*fungos?/i, abbr: "Fungos LCR" },
  // Hemograma.
  { re: /hemoglob|^hb$/i, abbr: "Hb" },
  { re: /hemat[oó]cr|^ht$/i, abbr: "Ht" },
  { re: /^hcm$|hemoglobina corpuscular m[eé]dia/i, abbr: "HCM" },
  { re: /^chcm$|concentra[çc].*hemoglob/i, abbr: "CHCM" },
  { re: /^vcm$|volume corpuscular m[eé]dio/i, abbr: "VCM" },
  { re: /^rdw$/i, abbr: "RDW" },
  { re: /hem[aá]cias|eritr[oó]citos/i, abbr: "Hemácias" },
  { re: /leuc[oó]|^lt$/i, abbr: "LT" },
  { re: /bast[õo]|^bast/i, abbr: "Bast" },
  { re: /segment|^seg$/i, abbr: "Seg" },
  { re: /linf[oó]cit|^linf$/i, abbr: "Linf" },
  { re: /mon[oó]cit|^mon[oó]$/i, abbr: "Monó" },
  { re: /eosin[oó]f|^eos$/i, abbr: "Eos" },
  { re: /bas[oó]f|^bas[oó]f$/i, abbr: "Basóf" },
  { re: /plaquet|^plaq$|^plt$/i, abbr: "Plaq" },
  // Bioquímica / hemostasia.
  { re: /prote[ií]na c|^pcr$/i, abbr: "PCR" },
  { re: /creatin|^cr$/i, abbr: "Cr" },
  { re: /ur[eé]ia|^u$/i, abbr: "U" },
  { re: /pot[aá]ssio|^k$/i, abbr: "K" },
  { re: /s[oó]dio|^na$/i, abbr: "Na" },
  { re: /magn[eé]sio|^mg$/i, abbr: "Mg" },
  { re: /lactato/i, abbr: "Lactato" },
  { re: /bilirrubina\s*d|^bd$/i, abbr: "BD" },
  { re: /bilirrubina\s*i|^bi$/i, abbr: "BI" },
  { re: /bilirrubina|^bt$/i, abbr: "BT" },
  { re: /aspartato|^tgo$|^ast$/i, abbr: "TGO" },
  { re: /alanina|^tgp$|^alt$/i, abbr: "TGP" },
  { re: /fosfatase|^fa$/i, abbr: "FA" },
  { re: /gama|^ggt$/i, abbr: "GGT" },
  { re: /albumin|^alb$/i, abbr: "Alb" },
  { re: /^inr$|rni/i, abbr: "INR" },
  { re: /atividade de protromb|^tap$/i, abbr: "TAP" },
  { re: /^ttpa$|tromboplastina/i, abbr: "TTPA" },
  { re: /filtra[çc]|^tfg$/i, abbr: "TFG" },
  { re: /hemossedimenta|^vhs$/i, abbr: "VHS" },
  { re: /desidrogenase l|^ldh$/i, abbr: "LDH" },
  { re: /glic/i, abbr: "Glic" },
];

/** Abrevia o nome do exame para exibição compacta (fonte única). */
export function abreviarLab(nome: string): string {
  const n = (nome || "").trim();
  return LAB_ABREV.find((a) => a.re.test(n))?.abbr ?? n;
}

/** Grupos de labs, na ordem de exibição. */
export const GRUPOS_LAB = [
  "HEMOGRAMA",
  "BIOQUÍMICA",
  "GASOMETRIA",
  "LÍQUOR",
  "URINA",
  "CULTURAS",
  "OUTROS",
] as const;
export type GrupoLab = (typeof GRUPOS_LAB)[number];

// Classificadores por grupo (testados na ordem; LÍQUOR/CULTURAS antes dos genéricos).
const GRUPO_RE: { grupo: GrupoLab; re: RegExp }[] = [
  { grupo: "LÍQUOR", re: /lcr|l[ií]quor/i },
  { grupo: "CULTURAS", re: /cultura|hemocult|urocult|^hmc$|^urc$|swab/i },
  { grupo: "GASOMETRIA", re: /gasometr|^ph$|pco2|^po2$|hco3|bicarbonat|excesso de base|^be$|^sato2$/i },
  { grupo: "URINA", re: /urina|^eas$|sum[aá]rio urin|urin[aá]ri|leucocit[uú]ria|hemat[uú]ria/i },
  {
    grupo: "HEMOGRAMA",
    re: /hemoglob|^hb$|hemat[oó]cr|^ht$|^hcm$|^chcm$|^vcm$|^rdw$|hem[aá]cias|eritr[oó]cit|leuc[oó]|^lt$|bast|segment|^seg$|linf[oó]|^linf$|mon[oó]cit|^mon[oó]$|eosin|^eos$|bas[oó]f|plaquet|^plaq$|^plt$/i,
  },
  {
    grupo: "BIOQUÍMICA",
    re: /prote[ií]na c|^pcr$|creatin|^cr$|ur[eé]ia|^u$|pot[aá]ssio|^k$|s[oó]dio|^na$|magn[eé]sio|^mg$|lactato|bilirrubina|^bd$|^bi$|^bt$|aspartato|^tgo$|^ast$|alanina|^tgp$|^alt$|fosfatase|^fa$|gama|^ggt$|albumin|^alb$|^inr$|rni|protromb|^tap$|^ttpa$|tromboplastina|filtra[çc]|^tfg$|hemossedimenta|^vhs$|desidrogenase|^ldh$|glic|c[aá]lcio|^ca$|f[oó]sforo|amilase|lipase|^cpk$|troponina/i,
  },
];

/** Classifica um exame em um grupo clínico (HEMOGRAMA/BIOQUÍMICA/LÍQUOR/...). */
export function grupoLab(nome: string): GrupoLab {
  const n = (nome || "").trim();
  return GRUPO_RE.find((g) => g.re.test(n))?.grupo ?? "OUTROS";
}

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
