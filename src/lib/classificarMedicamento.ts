import { apiFetch } from "./sessao";

/**
 * Classifica a CLASSE FARMACOLÓGICA de um medicamento (texto livre) via backend
 * (/api/formatar com instrução). Retorna a classe em 1-2 palavras (ex.:
 * "Antibiótico", "Diurético") ou null em falha. Nunca retorna "Outro".
 */
export async function classificarMedicamento(
  texto: string,
): Promise<string | null> {
  const instrucao =
    "Você é farmacologista. Para o medicamento informado, responda APENAS com a " +
    "sua CLASSE FARMACOLÓGICA em 1 a 2 palavras (ex.: Antibiótico, Antifúngico, " +
    "Anticoagulante, Corticoide, Diurético, Analgésico, Antiemético, Protetor gástrico, " +
    "Hipoglicemiante, Anti-hipertensivo). Sempre identifique uma classe específica; " +
    "NUNCA responda 'Outro' nem frases — só o nome da classe.";
  try {
    const r = await apiFetch("/api/formatar", {
      method: "POST",
      body: JSON.stringify({ texto, instrucao }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const resp = String(data?.texto || "").trim().split(/[\n.]/)[0].trim();
    return resp || null;
  } catch {
    return null;
  }
}
