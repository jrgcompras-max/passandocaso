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

/**
 * Ordem clínica canônica dos labs (BUG 8): hemograma → eletrólitos → função
 * renal → inflamatório → glicemia → hepático → coagulação → lactato →
 * gasometria → enzimas → outros. Fonte ÚNICA usada em todas as telas. Casa por
 * sigla OU nome completo. `ordemLab` retorna o índice (menor = primeiro).
 */
const ORDEM_LAB: RegExp[] = [
  /\bhb\b|hemoglob/i,
  /\bht\b|hemat[oó]cr/i,
  /\blt\b|leuc[oó]/i,
  /\bplaq\b|\bplt\b|plaquet/i,
  /hem[aá]cias|eritr[oó]cit/i,
  /\bhcm\b/i,
  /\bchcm\b/i,
  /\bvcm\b/i,
  /\brdw\b/i,
  /\bbast/i,
  /\bseg\b|segment/i,
  /\blinf/i,
  /\bmon[oó]/i,
  /\beos/i,
  /\bbas[oó]f/i,
  /\bna\b|s[oó]dio/i,
  /\bk\b|pot[aá]ssio/i,
  /\bcl\b|cloreto/i,
  /\bmg\b|magn[eé]sio/i,
  /\bur?\b|ur[eé]ia/i,
  /\bcr\b|creatin/i,
  /\btfg\b|filtra[çc]|clearance/i,
  /\bpcr\b|prote[ií]na c/i,
  /\bvhs\b|hemossed/i,
  /glic|glucose/i,
  /hba1c|glicada/i,
  /\btgo\b|aspartato|\bast\b/i,
  /\btgp\b|alanina|\balt\b/i,
  /\bfa\b|fosfatase/i,
  /\bggt\b|gama/i,
  /\bbt\b|bilirrubina t/i,
  /\bbd\b|bilirrubina d/i,
  /\bbi\b|bilirrubina i/i,
  /\balb/i,
  /\binr\b|rni/i,
  /\btap\b|protromb/i,
  /\bttpa\b|tromboplastina/i,
  /lactato/i,
  /\bph\b/i,
  /pco2/i,
  /\bpo2\b/i,
  /hco3|bicarbon/i,
  /\bsato2\b|satura[çc]/i,
  /\bldh\b|desidrogenase/i,
  /\bcpk\b|\bck\b/i,
];
export function ordemLab(nome: string): number {
  const t = (nome || "").trim();
  const i = ORDEM_LAB.findIndex((re) => re.test(t));
  return i === -1 ? ORDEM_LAB.length : i;
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

/**
 * Unidade PADRÃO de cada lab, por sigla canônica (saída de `abreviarLab`).
 * Fonte ÚNICA. Usada para decidir, no scan, se a unidade lida é a do sistema
 * (guarda só o número) ou diferente (cria estrutura própria, sem converter).
 */
const UNIDADE_PADRAO: Record<string, string> = {
  Hb: "g/dL", Ht: "%", LT: "/mm³", Plaq: "/mm³", Bast: "/mm³", Seg: "/mm³",
  Linf: "/mm³", "Monó": "/mm³", Eos: "/mm³", "Basóf": "/mm³", Hemácias: "milhões/mm³",
  VCM: "fL", HCM: "pg", CHCM: "g/dL", RDW: "%",
  Na: "mEq/L", K: "mEq/L", Cl: "mEq/L", Mg: "mg/dL", Ca: "mg/dL",
  U: "mg/dL", Cr: "mg/dL", TFG: "mL/min/1,73m²",
  PCR: "mg/L", VHS: "mm/h",
  Glic: "mg/dL", HbA1c: "%",
  TGO: "U/L", TGP: "U/L", FA: "U/L", GGT: "U/L",
  BT: "mg/dL", BD: "mg/dL", BI: "mg/dL", Alb: "g/dL",
  INR: "", TAP: "segundos", TTPA: "segundos",
  Lactato: "mmol/L", LDH: "U/L",
  HCO3: "mEq/L", SatO2: "%",
};

/** Unidade padrão do lab (por sigla canônica) ou null se não cadastrado. */
export function unidadePadraoLab(codigo: string): string | null {
  const c = (codigo || "").trim();
  return Object.prototype.hasOwnProperty.call(UNIDADE_PADRAO, c)
    ? UNIDADE_PADRAO[c]
    : null;
}

/** Normaliza uma unidade p/ comparação (caixa, espaços, µ→u, ³→3, ²→2). */
function normUnidade(u: string): string {
  return (u || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/µ|μ/g, "u")
    .replace(/³/g, "3")
    .replace(/²/g, "2");
}

/** Duas unidades são a mesma? (comparação tolerante; NÃO converte valores). */
export function mesmaUnidade(a: string, b: string): boolean {
  return normUnidade(a) === normUnidade(b);
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
