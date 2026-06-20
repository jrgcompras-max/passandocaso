import AsyncStorage from "@react-native-async-storage/async-storage";

import { hojeISO } from "./datas";
import { apiFetch } from "./sessao";

/**
 * MÓDULO DE ALERTAS DE TENDÊNCIA LABORATORIAL
 *
 * Detecta padrões nos dados laboratoriais inseridos ao longo da internação.
 * Conformidade ANVISA: os alertas são puramente DESCRITIVOS — nunca sugerem
 * conduta. Linguagem passiva ("em elevação", "em redução"); o app DESCREVE,
 * jamais PRESCREVE.
 *
 * A lógica também existe em backend/alertasTendencia.js (CommonJS). Ao alterar
 * os parâmetros ou o algoritmo aqui, replique lá — a análise roda no servidor.
 */

type Direcao = "subida" | "descida" | "ambos";

type ParametroLab = {
  /** Rótulo curto exibido no badge (ex.: "Cr"). */
  label: string;
  /** Nome por extenso para o detalhe (ex.: "Creatinina"). */
  nome: string;
  /** Direção considerada preocupante. */
  direcaoAlerta: Direcao;
  /** Variação absoluta (entre extremos do trecho) que dispara o alerta. */
  variacaoSignificativa: number;
  /** Mínimo de registros com valor para analisar. */
  diasMinimos: number;
  /** Reconhece o exame pelo nome livre digitado pelo usuário. */
  matcher: RegExp;
};

const LABS_MONITORADOS: Record<string, ParametroLab> = {
  creatinina: {
    label: "Cr",
    nome: "Creatinina",
    direcaoAlerta: "subida",
    variacaoSignificativa: 0.2,
    diasMinimos: 2,
    matcher: /creat|^cr\b/i,
  },
  pcr: {
    label: "PCR",
    nome: "PCR",
    direcaoAlerta: "subida",
    variacaoSignificativa: 20,
    diasMinimos: 2,
    matcher: /\bpcr\b|prote[ií]na c reativa/i,
  },
  leucocitos: {
    label: "LT",
    nome: "Leucócitos",
    direcaoAlerta: "subida",
    variacaoSignificativa: 2000,
    diasMinimos: 2,
    matcher: /leuc|^lt\b|gl[oó]bulos brancos/i,
  },
  hemoglobina: {
    label: "Hb",
    nome: "Hemoglobina",
    direcaoAlerta: "descida",
    variacaoSignificativa: 1.0,
    diasMinimos: 2,
    matcher: /hemoglob|^hb\b/i,
  },
  plaquetas: {
    label: "Plaq",
    nome: "Plaquetas",
    direcaoAlerta: "descida",
    variacaoSignificativa: 50000,
    diasMinimos: 2,
    matcher: /plaq|^plt\b/i,
  },
  sodio: {
    label: "Na",
    nome: "Sódio",
    direcaoAlerta: "ambos",
    variacaoSignificativa: 5,
    diasMinimos: 2,
    matcher: /s[oó]dio|^na\+?\b/i,
  },
  potassio: {
    label: "K",
    nome: "Potássio",
    direcaoAlerta: "ambos",
    variacaoSignificativa: 0.5,
    diasMinimos: 2,
    matcher: /pot[aá]ssio|^k\+?\b/i,
  },
};

export type AlertaTendencia = {
  lab: string;
  label: string;
  nome: string;
  tendencia: "subida" | "descida" | "estavel";
  diasConsecutivos: number;
  valorAtual: number;
  valorAnterior: number;
  variacao: number;
  severidade: "atencao" | "alerta";
  /** Trecho consecutivo de valores (numéricos), para o detalhe "0.9 → 1.1 → 1.4". */
  valores: number[];
  /** Unidade detectada no último valor (ex.: "mg/dL"), se houver. */
  unidade?: string;
};

/** Um registro diário com os exames laboratoriais (mapa exame → valor textual). */
type RegistroLab = {
  data: string;
  exames_laboratoriais: Record<string, string> | null;
};

/** Extrai o primeiro número de um valor (aceita vírgula decimal). */
function num(v: string): number | null {
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Tenta extrair a unidade após o número (ex.: "1,4 mg/dL" → "mg/dL"). */
function unidade(v: string): string | undefined {
  const m = String(v).match(/[\d.,]+\s*([a-zµμ/%]+(?:\/[a-zµμ³]+)?)/i);
  return m ? m[1] : undefined;
}

/** Para um lab, monta a série numérica (em ordem de data) a partir dos registros. */
function serieDoLab(registros: RegistroLab[], p: ParametroLab) {
  const pontos: { valor: number; texto: string }[] = [];
  for (const reg of registros) {
    const labs = reg.exames_laboratoriais;
    if (!labs) continue;
    const chave = Object.keys(labs).find((k) => p.matcher.test(k.trim()));
    if (!chave) continue;
    const bruto = labs[chave];
    const n = num(bruto);
    if (n == null) continue;
    pontos.push({ valor: n, texto: bruto });
  }
  return pontos;
}

/**
 * Conta o trecho consecutivo, a partir do fim, em que os valores se movem numa
 * única direção. Retorna null se o último passo for estável ou contrário à
 * direção monitorada.
 */
function trechoFinal(
  valores: number[],
  dir: Direcao,
): { direcao: "subida" | "descida"; inicio: number } | null {
  const n = valores.length;
  if (n < 2) return null;
  const ultimoPasso = valores[n - 1] - valores[n - 2];
  if (ultimoPasso === 0) return null;
  const direcao: "subida" | "descida" = ultimoPasso > 0 ? "subida" : "descida";
  if (dir !== "ambos" && dir !== direcao) return null;
  let i = n - 1;
  while (i - 1 >= 0) {
    const passo = valores[i] - valores[i - 1];
    const segue = direcao === "subida" ? passo > 0 : passo < 0;
    if (!segue) break;
    i--;
  }
  return { direcao, inicio: i };
}

/**
 * Analisa as tendências laboratoriais de um conjunto de registros diários.
 * Recebe os registros de evolucoes_diarias (qualquer ordem) e devolve os
 * alertas detectados. Não infere dados: só analisa o que foi inserido.
 */
export function analisarTendencias(registros: RegistroLab[]): AlertaTendencia[] {
  const ordenados = [...registros].sort((a, b) =>
    a.data.localeCompare(b.data),
  );
  const alertas: AlertaTendencia[] = [];

  for (const [lab, p] of Object.entries(LABS_MONITORADOS)) {
    const pontos = serieDoLab(ordenados, p);
    if (pontos.length < p.diasMinimos) continue;

    const valores = pontos.map((x) => x.valor);
    const trecho = trechoFinal(valores, p.direcaoAlerta);
    if (!trecho) continue;

    const run = valores.slice(trecho.inicio);
    if (run.length < p.diasMinimos) continue;

    const variacao = Math.abs(run[run.length - 1] - run[0]);
    if (variacao < p.variacaoSignificativa) continue;

    alertas.push({
      lab,
      label: p.label,
      nome: p.nome,
      tendencia: trecho.direcao,
      diasConsecutivos: run.length,
      valorAtual: run[run.length - 1],
      valorAnterior: run[run.length - 2],
      variacao: Math.round(variacao * 1000) / 1000,
      severidade: run.length >= 3 ? "alerta" : "atencao",
      valores: run,
      unidade: unidade(pontos[pontos.length - 1].texto),
    });
  }

  // Alertas mais severos primeiro.
  return alertas.sort((a, b) =>
    a.severidade === b.severidade
      ? b.diasConsecutivos - a.diasConsecutivos
      : a.severidade === "alerta"
        ? -1
        : 1,
  );
}

/** Seta exibida no badge (dobrada quando a tendência é mais longa). */
export function setaAlerta(a: AlertaTendencia): string {
  const base = a.tendencia === "subida" ? "↑" : "↓";
  return a.severidade === "alerta" ? base + base : base;
}

/** Frase descritiva (passiva, conforme ANVISA) para o detalhe do paciente. */
export function descreverAlerta(a: AlertaTendencia): string {
  const mov = a.tendencia === "subida" ? "em elevação" : "em redução";
  return `${a.nome} ${mov} por ${a.diasConsecutivos} dias consecutivos`;
}

/** Série formatada "0.9 → 1.1 → 1.4 mg/dL" para o detalhe. */
export function serieFormatada(a: AlertaTendencia): string {
  const seq = a.valores.map((v) => String(v)).join(" → ");
  return a.unidade ? `${seq} ${a.unidade}` : seq;
}

// ── Busca + cache (client) ────────────────────────────────────────────────

const chaveCache = (pacienteId: string) =>
  `@passandocaso/alertas_${pacienteId}_${hojeISO()}`;

/**
 * Busca os alertas de um paciente. Usa cache do dia (expira à meia-noite, pois
 * a chave inclui a data). Falha silenciosa: offline → cache ou lista vazia,
 * nunca exibe erro.
 */
export async function buscarAlertas(
  pacienteId: string,
  forcar = false,
): Promise<AlertaTendencia[]> {
  const chave = chaveCache(pacienteId);
  if (!forcar) {
    try {
      const raw = await AsyncStorage.getItem(chave);
      if (raw) return JSON.parse(raw) as AlertaTendencia[];
    } catch {
      // ignora cache corrompido
    }
  }
  try {
    const r = await apiFetch(
      `/api/alertas/${encodeURIComponent(pacienteId)}`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    const alertas = Array.isArray(j?.alertas)
      ? (j.alertas as AlertaTendencia[])
      : [];
    AsyncStorage.setItem(chave, JSON.stringify(alertas)).catch(() => {});
    return alertas;
  } catch {
    return [];
  }
}

/** Remove o cache do dia (chamar após salvar novos dados laboratoriais). */
export async function invalidarAlertas(pacienteId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(chaveCache(pacienteId));
  } catch {
    // best-effort
  }
}
