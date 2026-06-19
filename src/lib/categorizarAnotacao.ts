import { apiFetch } from "./sessao";

/**
 * Classifica uma anotação em uma das categorias informadas, usando o backend
 * (/api/formatar com instrução de classificação). Retorna a chave da categoria
 * reconhecida ou null em falha/sem correspondência. Best-effort.
 */
export async function categorizarAnotacao(
  texto: string,
  chaves: string[],
): Promise<string | null> {
  const instrucao =
    "Você é um classificador clínico. Classifique o texto a seguir em EXATAMENTE UMA " +
    `destas categorias: ${chaves.join(", ")}. ` +
    "Responda SOMENTE com a palavra-chave da categoria escolhida, em minúsculas, sem mais nada.";
  try {
    const r = await apiFetch("/api/formatar", {
      method: "POST",
      body: JSON.stringify({ texto, instrucao }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const resp = String(data?.texto || "").toLowerCase();
    return chaves.find((c) => resp.includes(c.toLowerCase())) ?? null;
  } catch {
    return null;
  }
}
