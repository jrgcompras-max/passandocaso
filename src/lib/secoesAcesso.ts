import { type SecaoGrid } from "@/components/HubPaciente";

import { apiFetch } from "./sessao";

/**
 * Aprendizado de acesso às seções da ficha (redesign hub).
 *
 * Registra quantas vezes cada seção é aberta por usuário e, APÓS 7 dias de uso,
 * reordena a grade pelas mais acessadas e destaca as 2 primeiras. Antes disso,
 * mantém a ordem padrão sem destaques (para não embaralhar a tela cedo demais).
 */
export type AcessoSecao = {
  secao: string;
  contagem: number;
  ultima_abertura: string;
  criado_em: string;
};

const ORDEM_PADRAO: SecaoGrid[] = [
  "clinico",
  "labs",
  "imagem",
  "prescricao",
  "evolucao",
  "beiraLeito",
];
const DIAS_PARA_APRENDER = 7;

/** Registra (best-effort) que o usuário abriu uma seção. Não bloqueia a UI. */
export async function registrarAcessoSecao(secao: SecaoGrid): Promise<void> {
  try {
    await apiFetch("/api/secoes/acesso", {
      method: "POST",
      body: JSON.stringify({ secao }),
    });
  } catch {
    // best-effort — a navegação não pode depender disso
  }
}

/** Carrega os acessos do usuário (vazio em caso de falha). */
export async function carregarAcessosSecao(): Promise<AcessoSecao[]> {
  try {
    const r = await apiFetch("/api/secoes/acesso");
    const dados = await r.json().catch(() => ({}));
    return Array.isArray(dados?.acessos) ? dados.acessos : [];
  } catch {
    return [];
  }
}

/**
 * Calcula a ordem da grade e as 2 seções em destaque a partir dos acessos.
 * Só reordena/destaca após 7 dias do primeiro acesso registrado.
 */
export function ordenarSecoes(acessos: AcessoSecao[]): {
  ordem: SecaoGrid[];
  destaques: SecaoGrid[];
} {
  if (!acessos.length) return { ordem: ORDEM_PADRAO, destaques: [] };

  const primeiro = acessos
    .map((a) => new Date(a.criado_em).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)[0];
  const diasDeUso = primeiro ? (Date.now() - primeiro) / 86_400_000 : 0;
  if (diasDeUso < DIAS_PARA_APRENDER) {
    return { ordem: ORDEM_PADRAO, destaques: [] };
  }

  const cont = new Map<string, number>();
  for (const a of acessos) cont.set(a.secao, a.contagem);
  // Ordena pela contagem (desc), mantendo a ordem padrão como desempate estável.
  const ordem = [...ORDEM_PADRAO].sort(
    (a, b) => (cont.get(b) ?? 0) - (cont.get(a) ?? 0),
  );
  const destaques = ordem.filter((s) => (cont.get(s) ?? 0) > 0).slice(0, 2);
  return { ordem, destaques };
}
