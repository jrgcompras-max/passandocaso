import { apiFetch } from "./sessao";

/**
 * Aprendizado de chips do exame físico (Feature 2). Registra os termos digitados
 * no campo livre; a partir de 3 usos o termo vira chip pessoal. Falhas degradam
 * em silêncio (não atrapalham o preenchimento).
 */

export type ChipPessoal = { texto: string; uso_count: number; fixado: boolean };

/** Registra termos livres digitados numa seção do exame. */
export async function logTermos(secao: string, termos: string[], texto?: string): Promise<void> {
  const lista = termos.map((t) => t.trim()).filter(Boolean);
  if (!secao || !lista.length) return;
  try {
    await apiFetch("/api/chips/log", {
      method: "POST",
      body: JSON.stringify({ secao, termos: lista, texto }),
    });
  } catch {
    // best-effort
  }
}

/** Chips pessoais do usuário, por seção. */
export async function listarPessoais(): Promise<Record<string, ChipPessoal[]>> {
  try {
    const r = await apiFetch("/api/chips/pessoais");
    if (!r.ok) return {};
    const j = (await r.json()) as { chips?: Record<string, ChipPessoal[]> };
    return j.chips || {};
  } catch {
    return {};
  }
}

export async function fixarChip(secao: string, texto: string, fixado: boolean): Promise<void> {
  try {
    await apiFetch("/api/chips/pessoal", {
      method: "PUT",
      body: JSON.stringify({ secao, texto, fixado }),
    });
  } catch {
    // best-effort
  }
}

export async function removerChip(secao: string, texto: string): Promise<void> {
  try {
    await apiFetch("/api/chips/pessoal", {
      method: "DELETE",
      body: JSON.stringify({ secao, texto }),
    });
  } catch {
    // best-effort
  }
}
