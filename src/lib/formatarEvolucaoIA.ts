import { API_URL } from "@/constants/api";

/**
 * Passo de formatação (híbrido): envia o texto já montado ao backend, que pede
 * ao Claude para apenas PADRONIZAR a redação (sem adicionar/interpretar nada).
 * A chave da Anthropic fica só no servidor.
 *
 * Em qualquer falha (rede, backend, resposta vazia), devolve o texto original —
 * a médica nunca fica sem o resultado.
 */
export async function formatarEvolucaoIA(texto: string): Promise<string> {
  if (!texto.trim()) return texto;

  try {
    const response = await fetch(`${API_URL}/api/formatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });

    if (!response.ok) {
      console.log("Formatação: HTTP", response.status);
      return texto;
    }

    const data = await response.json();
    return typeof data?.texto === "string" && data.texto.trim()
      ? data.texto.trim()
      : texto;
  } catch (e) {
    console.log("Formatação falhou, usando texto bruto:", e);
    return texto;
  }
}
