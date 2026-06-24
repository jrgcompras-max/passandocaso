import { apiFetch } from "./sessao";

/**
 * Referências laboratoriais (ABIM 2026): cache local das faixas de normalidade
 * e classificação síncrona de um valor (baixo/normal/alto → seta/cor). A fonte
 * é a tabela `labs_referencia` no backend (GET /api/labs/referencia). Carrega
 * uma vez e classifica offline a partir do cache.
 */

export const DISCLAIMER_ABIM =
  "Valores de referência: ABIM 2026. Interprete sempre com o contexto clínico.";

export type RefLab = {
  codigo: string;
  nome: string;
  sexo: "M" | "F" | "ambos";
  valorMin: number | null;
  valorMax: number | null;
  unidade: string;
  fonte: string;
};

export type ClassificacaoLab = {
  status: "baixo" | "normal" | "alto" | "sem_referencia";
  seta: "↑" | "↓" | "→";
  cor: string;
};

// Cores em hex. Alto = vermelho, baixo = azul, normal = preto (cor padrão do
// texto — antes era cinza, confundia com o azul do "baixo"; BUG 3). Sem
// referência = cinza (estado neutro "não interpretado").
const COR = { alto: "#A32D2D", baixo: "#1A6B8A", normal: "#000000", cinza: "#64748B" };
const SEM_REF: ClassificacaoLab = { status: "sem_referencia", seta: "→", cor: COR.cinza };

let cache: RefLab[] | null = null;
let carregando: Promise<RefLab[]> | null = null;

/** Carrega (uma vez) e cacheia as referências. Best-effort: falha → cache vazio. */
export async function carregarReferencias(): Promise<RefLab[]> {
  if (cache) return cache;
  if (!carregando) {
    carregando = (async () => {
      try {
        const r = await apiFetch("/api/labs/referencia");
        if (!r.ok) return (cache = []);
        const j = await r.json();
        return (cache = Array.isArray(j?.referencias) ? j.referencias : []);
      } catch {
        return (cache = []);
      }
    })();
  }
  return carregando;
}

const numero = (v: string): number | null => {
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

/**
 * Classifica um valor usando o cache já carregado (síncrono, p/ exibição).
 * `codigo` aceita sigla (Hb) OU nome (Hemoglobina). Retorna "sem_referencia"
 * se o cache não estiver carregado ou não houver faixa para o exame/valor.
 */
export function classificarLabSync(
  codigo: string,
  valor: string,
  sexo?: "M" | "F" | null,
  idade?: number | null,
): ClassificacaoLab {
  // Tabela ABIM é de adultos: pediátrico (idade conhecida < 18) não interpreta.
  if (idade != null && idade < 18) return SEM_REF;
  if (!cache || !cache.length) return SEM_REF;
  const chave = (codigo || "").trim().toLowerCase();
  if (!chave) return SEM_REF;
  const sx = sexo === "M" || sexo === "F" ? sexo : "ambos";
  const cand = cache.filter(
    (r) => r.codigo.toLowerCase() === chave || r.nome.toLowerCase() === chave,
  );
  if (!cand.length) return SEM_REF;
  // Se a referência é específica por sexo e o sexo do paciente é desconhecido
  // (sx = 'ambos' mas não há linha 'ambos'), NÃO interpreta — sem seta/cor.
  const ref =
    cand.find((r) => r.sexo === sx) || cand.find((r) => r.sexo === "ambos");
  if (!ref) return SEM_REF;
  const v = numero(valor);
  if (v == null) return SEM_REF;
  if (ref.valorMin != null && v < ref.valorMin)
    return { status: "baixo", seta: "↓", cor: COR.baixo };
  if (ref.valorMax != null && v > ref.valorMax)
    return { status: "alto", seta: "↑", cor: COR.alto };
  return { status: "normal", seta: "→", cor: COR.normal };
}
