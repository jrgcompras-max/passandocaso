import { apiFetch } from "./sessao";

/**
 * Resume a HDA em UMA linha de contexto clínico para o Passar o Caso, via backend
 * (/api/formatar com instrução). O texto completo permanece intacto na ficha.
 * Ex.: "Internada por pneumonia comunitária com suspeita de sepse de foco
 * pulmonar." Retorna null em falha (o chamador usa o resumo local como fallback).
 */
export async function resumirHdaUmaLinha(texto: string): Promise<string | null> {
  const t = (texto || "").trim();
  if (!t) return null;
  const instrucao =
    "Você recebe a História da Doença Atual (HDA) de um paciente internado. " +
    "Resuma em UMA ÚNICA FRASE curta o motivo da internação e o ponto-chave da " +
    "evolução, em estilo telegráfico de passagem de plantão. " +
    "REGRAS: use apenas o que está no texto; não invente; máximo ~20 palavras; " +
    "responda SOMENTE com a frase, sem rótulos, aspas ou marcações.";
  try {
    const r = await apiFetch("/api/formatar", {
      method: "POST",
      body: JSON.stringify({ texto: t, instrucao }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const resp = String(data?.texto || "").replace(/\s+/g, " ").trim();
    return resp || null;
  } catch {
    return null;
  }
}
