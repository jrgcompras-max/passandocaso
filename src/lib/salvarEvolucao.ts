import { API_URL, MEDICO_ID } from "@/constants/api";

import { hojeISO } from "./datas";

/**
 * Salva a evolução gerada no backend (rota /api/evolucao/salvar), para que o
 * companion web do desktop consiga exibi-la. Usa o medicoId fixo temporário até
 * existir autenticação real. Não lança — devolve true/false.
 */
export async function salvarEvolucao(params: {
  pacienteId: string;
  nome: string;
  texto: string;
}): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/evolucao/salvar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        medicoId: MEDICO_ID,
        data: hojeISO(),
        pacienteId: params.pacienteId,
        nome: params.nome,
        texto: params.texto,
      }),
    });
    return response.ok;
  } catch (e) {
    console.log("Falha ao salvar evolução no backend:", e);
    return false;
  }
}
