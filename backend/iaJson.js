/**
 * Parsing robusto de JSON vindo da Anthropic API.
 *
 * O modelo às vezes embrulha o JSON em cercas markdown (```json ... ```) ou
 * acrescenta uma frase antes/depois. JSON.parse no texto bruto quebra. Este
 * helper remove as cercas, isola o objeto/array e parseia com try/catch,
 * registrando o texto bruto quando falha (para depuração) em vez de derrubar
 * a requisição com um erro genérico.
 */

class ErroJsonIA extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroJsonIA";
    this.ehParseIA = true; // marcador para o chamador devolver erro amigável
  }
}

/** Remove cercas markdown (```json / ```) e espaços ao redor. */
function limparCercas(texto) {
  return String(texto || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Extrai e parseia um JSON (objeto ou array) de uma resposta da IA, tolerando
 * cercas markdown e texto ao redor. Lança ErroJsonIA (com o bruto logado) se
 * não conseguir parsear.
 *
 * @param {string} textoBruto  texto da resposta do modelo
 * @param {string} contexto    rótulo para o log (ex.: "extract:examesLab")
 */
function parseJsonIA(textoBruto, contexto = "IA") {
  const limpo = limparCercas(textoBruto);
  // Isola do primeiro objeto/array até o último fechamento (tolera texto extra).
  const match = limpo.match(/[[{][\s\S]*[\]}]/);
  const candidato = match ? match[0] : limpo;
  try {
    return JSON.parse(candidato);
  } catch (e) {
    console.error(
      `[parseJsonIA:${contexto}] Falha ao parsear JSON da IA: ${e.message}\n` +
        `--- RAW INÍCIO ---\n${String(textoBruto || "").slice(0, 4000)}\n--- RAW FIM ---`,
    );
    throw new ErroJsonIA("Resposta da IA não pôde ser interpretada como JSON.");
  }
}

/** Versão que NÃO lança: devolve null em vez de erro (para fluxos best-effort). */
function parseJsonIASeguro(textoBruto, contexto = "IA") {
  try {
    return parseJsonIA(textoBruto, contexto);
  } catch {
    return null;
  }
}

module.exports = { parseJsonIA, parseJsonIASeguro, ErroJsonIA };
