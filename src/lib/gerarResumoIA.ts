import { API_URL } from "@/constants/api";

/**
 * Pede ao backend (/api/resumo) um resumo executivo do paciente a partir dos
 * dados já preenchidos. A chave da Anthropic fica só no servidor. Lança erro em
 * falha (o chamador exibe a mensagem).
 */
export async function gerarResumoIA(dados: string): Promise<string> {
  const response = await fetch(`${API_URL}/api/resumo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dados }),
  });

  if (!response.ok) {
    const texto = await response.text();
    throw new Error(`Backend retornou ${response.status}: ${texto}`);
  }

  const data = await response.json();
  if (typeof data?.resumo !== "string" || !data.resumo.trim()) {
    throw new Error("Resposta de resumo vazia do backend.");
  }
  return data.resumo.trim();
}
