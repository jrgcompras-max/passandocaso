import { hojeISO } from "./datas";
import { apiFetch } from "./sessao";

/**
 * Salva a evolução gerada no backend (rota /api/evolucao/salvar), para que o
 * companion web do desktop consiga exibi-la. O médico é identificado pelo token
 * de sessão. Não lança — devolve true/false.
 */
export async function salvarEvolucao(params: {
  pacienteId: string;
  nome: string;
  texto: string;
}): Promise<boolean> {
  try {
    const response = await apiFetch("/api/evolucao/salvar", {
      method: "POST",
      body: JSON.stringify({
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
