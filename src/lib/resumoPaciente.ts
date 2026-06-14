import { diaDeInternacao } from "@/lib/datas";
import { agruparPorExame, TENDENCIA_INFO } from "@/lib/lab";
import { fraseSinaisVitais } from "@/lib/sinaisVitais";
import { type Paciente } from "@/types/paciente";

/**
 * Reúne, em texto, os dados já preenchidos do paciente para alimentar a geração
 * do resumo executivo pela IA (lib gerarResumoIA). Não interpreta nada — só
 * organiza o que existe.
 */
export function montarDadosParaResumo(paciente: Paciente, hoje: string): string {
  const linhas: string[] = [];
  linhas.push(`Nome: ${paciente.nomeCompleto}`);
  if (paciente.idade != null) linhas.push(`Idade: ${paciente.idade} anos`);
  const dia = diaDeInternacao(paciente.dataEntrada);
  if (dia != null) linhas.push(`Dia de internação: D${dia}`);
  if (paciente.diagnosticoPrincipal)
    linhas.push(`Diagnóstico principal: ${paciente.diagnosticoPrincipal}`);
  if (paciente.motivoInternacao)
    linhas.push(`Motivo da internação: ${paciente.motivoInternacao}`);
  if (paciente.statusClinico)
    linhas.push(`Status clínico atual: ${paciente.statusClinico}`);

  const problemas = paciente.problemas ?? [];
  if (problemas.length) {
    linhas.push("Problemas ativos:");
    for (const p of problemas) {
      const conduta = p.conduta?.trim() ? ` — conduta: ${p.conduta.trim()}` : "";
      linhas.push(`- ${p.titulo} (${p.status}, prioridade ${p.prioridade})${conduta}`);
    }
  }

  const series = agruparPorExame(paciente.resultadosLab ?? []);
  if (series.length) {
    linhas.push("Exames laboratoriais (evolução):");
    for (const s of series) {
      const seq = s.pontos.map((p) => p.valor).join(" → ");
      const tend = s.tendencia ? ` (${TENDENCIA_INFO[s.tendencia].rotulo})` : "";
      linhas.push(`- ${s.exame}: ${seq}${tend}`);
    }
  }

  const frase = fraseSinaisVitais(paciente.sinaisVitais?.[hoje]);
  if (frase) linhas.push(`Sinais vitais de hoje: ${frase}`);

  const evo = paciente.evolucoes?.[hoje];
  if (evo?.condutaDoDia?.trim())
    linhas.push(`Conduta do dia: ${evo.condutaDoDia.trim()}`);

  return linhas.join("\n");
}
