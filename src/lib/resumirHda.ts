import { apiFetch } from "./sessao";

/** Normaliza para comparação: minúsculas, sem acentos. */
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Palavras genéricas/conectivas que NÃO contam como "termo clínico inventado".
const GENERICAS = new Set([
  "paciente",
  "internado",
  "internada",
  "internacao",
  "interna",
  "quadro",
  "apresenta",
  "apresentando",
  "apresentou",
  "refere",
  "historia",
  "doenca",
  "atual",
  "devido",
  "desde",
  "evolui",
  "evolucao",
  "associado",
  "associada",
  "queixa",
  "queixas",
  "iniciado",
  "iniciou",
  "relata",
]);

/**
 * Valida o resumo contra a HDA original (BUG 7): cada termo clínico relevante do
 * resumo (palavra com ≥5 letras, não genérica) precisa aparecer na HDA original
 * (comparação por radical, tolerando flexão). Se algum termo não existir no
 * original, o resumo "inventou" informação → inválido.
 */
function resumoFiel(resumo: string, original: string): boolean {
  const orig = norm(original);
  const palavras = norm(resumo)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !GENERICAS.has(w));
  return palavras.every((w) => orig.includes(w.slice(0, Math.max(5, w.length - 2))));
}

/**
 * Resume a HDA em UMA linha de contexto para o Passar o Caso, via backend
 * (/api/formatar). NUNCA inventa: o prompt proíbe inferência e há validação —
 * se o resumo contiver termo ausente na HDA original, retorna null e o chamador
 * usa o texto original (sem resumo automático). HDA vazia → null.
 */
export async function resumirHdaUmaLinha(texto: string): Promise<string | null> {
  const t = (texto || "").trim();
  if (!t) return null;
  const instrucao =
    "Resuma em UMA linha a HDA abaixo. " +
    "Use APENAS as informações presentes no texto. " +
    "NUNCA adicione, infira ou complete informações que não estejam " +
    "explicitamente escritas. " +
    "Se a HDA for curta, o resumo pode ser igualmente curto. " +
    "Se não houver HDA registrada, retorne vazio. " +
    "Responda SOMENTE com a frase, sem rótulos, aspas ou marcações.";
  try {
    const r = await apiFetch("/api/formatar", {
      method: "POST",
      body: JSON.stringify({ texto: t, instrucao }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const resp = String(data?.texto || "").replace(/\s+/g, " ").trim();
    if (!resp) return null;
    // Validação anti-invenção: termo do resumo ausente na HDA → descarta.
    if (!resumoFiel(resp, t)) return null;
    return resp;
  } catch {
    return null;
  }
}
