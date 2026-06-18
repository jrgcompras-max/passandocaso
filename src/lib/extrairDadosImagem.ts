import { API_URL } from "@/constants/api";

/**
 * Envia uma imagem (base64 JPEG) + instrução ao backend proxy, que chama o
 * modelo de visão da Anthropic e devolve o JSON já extraído. A chave da API
 * fica apenas no servidor — nunca no app.
 *
 * A URL do backend é fixa em produção (ver API_URL em @/constants/api).
 *
 * Lança Error com mensagem legível em caso de falha de rede, HTTP não-ok ou
 * resposta inválida — o chamador trata a UI.
 */
export async function extrairDadosImagem<T>(
  base64: string,
  instrucao: string,
): Promise<T> {
  const response = await fetch(`${API_URL}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagemBase64: base64, instrucao }),
  });

  const respostaTexto = await response.text();

  if (!response.ok) {
    throw new Error(
      `Backend retornou status ${response.status}: ${respostaTexto}`,
    );
  }

  try {
    return JSON.parse(respostaTexto) as T;
  } catch {
    throw new Error(`Resposta inválida do backend:\n${respostaTexto}`);
  }
}
