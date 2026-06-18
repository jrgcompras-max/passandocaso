import {
  DISPOSITIVOS,
  OPC_CONSCIENCIA,
  OPC_ORIENTACAO,
  rotuloDe,
} from "@/constants/evolucao";
import {
  type Anotacao,
  type Paciente,
  type ProblemaStatus,
  type SecaoId,
} from "@/types/paciente";

import { diaDeInternacao } from "./datas";
import { agruparPorExame, TENDENCIA_INFO } from "./lab";
import { fraseSinaisVitais } from "./sinaisVitais";

const PROBLEMA_STATUS_LABEL: Record<ProblemaStatus, string> = {
  ativo: "Ativo",
  resolvendo: "Resolvendo",
  resolvido: "Resolvido",
};

/** Converte o conteúdo extraído (JSON de blocos ou texto) em linhas legíveis. */
function extraidoParaLinhas(extraido: string): string[] {
  const t = (extraido || "").trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const blocos = JSON.parse(t) as { titulo?: string; itens: string[] }[];
      if (Array.isArray(blocos)) {
        return blocos
          .map((b) => {
            const itens = (b.itens ?? []).map((i) => String(i).trim()).filter(Boolean);
            if (!itens.length) return "";
            return b.titulo ? `${b.titulo}: ${itens.join("; ")}` : itens.join("; ");
          })
          .filter(Boolean);
      }
    } catch {
      // cai para texto puro
    }
  }
  return [t];
}

/** Normaliza anotações (lista nova ou string legada) em textos. */
function anotacoesParaTextos(valor: unknown): string[] {
  if (Array.isArray(valor)) {
    return (valor as Anotacao[]).map((a) => a.texto.trim()).filter(Boolean);
  }
  if (typeof valor === "string" && valor.trim()) return [valor.trim()];
  return [];
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". */
function dataBR(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Conteúdo extraído + anotações de uma seção foto. */
function secaoLinhas(paciente: Paciente, id: SecaoId): string[] {
  const s = paciente.secoes?.[id];
  const linhas = extraidoParaLinhas(s?.extraido ?? "");
  const anots = anotacoesParaTextos(s?.anotacoes);
  if (anots.length) linhas.push(`Anotações: ${anots.join("; ")}`);
  return linhas;
}

/** Medicamentos classificados como antibiótico pela IA → texto da prescrição. */
function antibioticoterapiaLinhas(paciente: Paciente): string[] {
  return (paciente.medicamentos ?? [])
    .filter((m) => /antibi|\batb\b/i.test(m.classe || ""))
    .map((m) => (m.texto || "").trim())
    .filter(Boolean);
}

/** Exame físico = sinais vitais + achados da evolução beira-leito. */
function exameFisicoLinhas(paciente: Paciente, hoje: string): string[] {
  const linhas: string[] = [];
  const frase = fraseSinaisVitais(paciente.sinaisVitais?.[hoje]);
  if (frase) linhas.push(frase);
  const evo = paciente.evolucoes?.[hoje];
  if (evo) {
    if (evo.nivelConsciencia)
      linhas.push(`Nível de consciência: ${rotuloDe(OPC_CONSCIENCIA, evo.nivelConsciencia)}`);
    if (evo.orientacao)
      linhas.push(`Orientação: ${rotuloDe(OPC_ORIENTACAO, evo.orientacao)}`);
    if (evo.estadoGeral.trim()) linhas.push(`Estado geral: ${evo.estadoGeral.trim()}`);
    if (evo.dispositivos.length) {
      const disp = DISPOSITIVOS.filter((d) => evo.dispositivos.includes(d)).map((d) => {
        const obs = (evo.dispositivosObs[d] ?? "").trim();
        return obs ? `${d} (${obs})` : d;
      });
      linhas.push(`Invasões/dispositivos: ${disp.join("; ")}`);
    }
    if (evo.exameFisico.trim()) linhas.push(`Exame físico: ${evo.exameFisico.trim()}`);
  }
  return linhas;
}

/** Exames laboratoriais como série temporal por exame com tendência. */
function laboratorioLinhas(paciente: Paciente): string[] {
  return agruparPorExame(paciente.resultadosLab ?? []).map((s) => {
    const seq = s.pontos
      .map((p) => `${p.valor} (${dataBR(p.data).slice(0, 5)})`)
      .join(" → ");
    const tend = s.tendencia ? ` ${TENDENCIA_INFO[s.tendencia].icone}` : "";
    return `${s.exame}: ${seq}${tend}`;
  });
}

/** Problemas ativos: "título — status — conduta". */
function problemasLinhas(paciente: Paciente): string[] {
  return (paciente.problemas ?? []).map((p) => {
    const partes = [p.titulo.trim(), PROBLEMA_STATUS_LABEL[p.status] ?? p.status];
    if (p.conduta?.trim()) partes.push(p.conduta.trim());
    return partes.join(" — ");
  });
}

/** Junta título + linhas num bloco; retorna null se não houver conteúdo. */
function bloco(titulo: string, linhas: (string | undefined)[]): string | null {
  const ls = linhas.map((l) => (l || "").trim()).filter(Boolean);
  return ls.length ? [titulo, ...ls].join("\n") : null;
}

/**
 * Monta deterministicamente o texto de passagem de caso na estrutura clínica
 * padronizada. Não interpreta nem adiciona conteúdo — apenas organiza o que a
 * médica já validou. Seções vazias são omitidas.
 */
export function montarTextoEvolucao(paciente: Paciente, hoje: string): string {
  const dia = diaDeInternacao(paciente.dataEntrada);
  const identificacao = [
    paciente.nomeCompleto || "Sem nome",
    paciente.idade != null ? `${paciente.idade} anos` : null,
    paciente.leito ? `Leito ${paciente.leito}` : null,
    paciente.setor || null,
    dia != null ? `Dia ${dia} de internação` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocos = [
    bloco("IDENTIFICAÇÃO", [identificacao]),
    // Apenas o diagnóstico principal, limpo e objetivo (não o motivo/sintomas).
    bloco("MOTIVO DA INTERNAÇÃO", [paciente.diagnosticoPrincipal]),
    bloco("ANTIBIOTICOTERAPIA EM USO", antibioticoterapiaLinhas(paciente)),
    bloco("COMORBIDADES E MUC", secaoLinhas(paciente, "comorbidadesMedicacoes")),
    bloco("HDA — HISTÓRIA DA DOENÇA ATUAL", secaoLinhas(paciente, "historia")),
    bloco("EXAME FÍSICO", exameFisicoLinhas(paciente, hoje)),
    bloco("EXAMES LABORATORIAIS", laboratorioLinhas(paciente)),
    bloco("EXAMES DE IMAGEM", secaoLinhas(paciente, "imagem")),
    bloco("PROBLEMAS ATIVOS", problemasLinhas(paciente)),
    bloco("CONDUTA", [paciente.evolucoes?.[hoje]?.condutaDoDia]),
  ].filter(Boolean);

  return blocos.join("\n\n");
}
