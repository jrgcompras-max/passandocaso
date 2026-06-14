import {
  DISPOSITIVOS,
  OPC_ALIMENTACAO,
  OPC_CONSCIENCIA,
  OPC_DIURESE,
  OPC_EVACUACAO,
  OPC_ORIENTACAO,
  rotuloDe,
} from "@/constants/evolucao";
import { SECOES } from "@/constants/secoes";
import {
  type Anotacao,
  type EvolucaoBeiraLeito,
  type Paciente,
  type SecaoId,
} from "@/types/paciente";

import { diaDeInternacao } from "./datas";
import { agruparPorExame, TENDENCIA_INFO } from "./lab";
import { fraseSinaisVitais } from "./sinaisVitais";

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

/** Monta o bloco de texto da evolução beira-leito de um dia, se houver algo. */
function blocoEvolucao(evo: EvolucaoBeiraLeito | undefined): string[] {
  if (!evo) return [];
  const linhas: string[] = [];

  if (evo.estadoGeral.trim()) linhas.push(`Estado geral: ${evo.estadoGeral.trim()}`);
  if (evo.nivelConsciencia) {
    linhas.push(`Nível de consciência: ${rotuloDe(OPC_CONSCIENCIA, evo.nivelConsciencia)}`);
  }
  if (evo.orientacao) {
    linhas.push(`Orientação: ${rotuloDe(OPC_ORIENTACAO, evo.orientacao)}`);
  }

  const elim = [
    evo.alimentacao && `Alimentação: ${rotuloDe(OPC_ALIMENTACAO, evo.alimentacao)}`,
    evo.diurese && `Diurese: ${rotuloDe(OPC_DIURESE, evo.diurese)}`,
    evo.evacuacao && `Evacuação: ${rotuloDe(OPC_EVACUACAO, evo.evacuacao)}`,
  ].filter(Boolean);
  if (elim.length) linhas.push(elim.join(" | "));

  if (evo.dispositivos.length) {
    const disp = DISPOSITIVOS.filter((d) => evo.dispositivos.includes(d)).map((d) => {
      const obs = (evo.dispositivosObs[d] ?? "").trim();
      return obs ? `${d} (${obs})` : d;
    });
    linhas.push(`Dispositivos: ${disp.join("; ")}`);
  }

  if (evo.exameFisico.trim()) linhas.push(`Exame físico: ${evo.exameFisico.trim()}`);
  if (evo.condutaDoDia.trim()) linhas.push(`Conduta do dia: ${evo.condutaDoDia.trim()}`);

  return linhas;
}

/**
 * Linhas estruturadas (Fase 2) que entram nas seções correspondentes do texto:
 * sinais vitais viram a frase clínica automática; exames laboratoriais viram a
 * evolução temporal por exame com tendência.
 */
function extrasEstruturados(
  secao: SecaoId,
  paciente: Paciente,
  hoje: string,
): string[] {
  if (secao === "sinaisVitaisIntercorrencias") {
    const sv = paciente.sinaisVitais?.[hoje];
    const linhas: string[] = [];
    const frase = fraseSinaisVitais(sv);
    if (frase) linhas.push(frase);
    if (sv?.intercorrencias?.trim())
      linhas.push(`Intercorrências: ${sv.intercorrencias.trim()}`);
    return linhas;
  }
  if (secao === "examesLaboratoriais") {
    return agruparPorExame(paciente.resultadosLab ?? []).map((s) => {
      const seq = s.pontos
        .map((p) => `${p.valor} (${dataBR(p.data).slice(0, 5)})`)
        .join(" → ");
      const tend = s.tendencia ? ` ${TENDENCIA_INFO[s.tendencia].icone}` : "";
      return `${s.exame}: ${seq}${tend}`;
    });
  }
  return [];
}

/**
 * Monta deterministicamente o texto de passagem de caso a partir de tudo que a
 * médica já validou. Não interpreta nem adiciona conteúdo clínico — apenas
 * organiza e formata. Seções/campos vazios são omitidos.
 */
export function montarTextoEvolucao(paciente: Paciente, hoje: string): string {
  const partes: string[] = [];

  // Cabeçalho
  const ident: string[] = [`PASSAGEM DE CASO — ${paciente.nomeCompleto || "Sem nome"}`];
  const linha2 = [
    paciente.numeroProntuario && `Prontuário ${paciente.numeroProntuario}`,
    paciente.idade != null && `${paciente.idade} anos`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (linha2) ident.push(linha2);
  const linha3 = [
    paciente.leito && `Leito ${paciente.leito}`,
    paciente.setor,
  ]
    .filter(Boolean)
    .join(" · ");
  if (linha3) ident.push(linha3);
  const dia = diaDeInternacao(paciente.dataEntrada);
  if (dia != null) ident.push(`Dia ${dia} de internação`);
  partes.push(ident.join("\n"));

  // Seções (extração validada + anotações + dados estruturados da Fase 2)
  for (const secao of SECOES) {
    const dadosSecao = paciente.secoes?.[secao.id as SecaoId];
    const linhas = extraidoParaLinhas(dadosSecao?.extraido ?? "");
    const anotacoes = anotacoesParaTextos(dadosSecao?.anotacoes);
    const extras = extrasEstruturados(secao.id as SecaoId, paciente, hoje);
    if (!linhas.length && !anotacoes.length && !extras.length) continue;

    const bloco = [secao.titulo.toUpperCase()];
    bloco.push(...linhas, ...extras);
    if (anotacoes.length) {
      bloco.push(`Anotações: ${anotacoes.join("; ")}`);
    }
    partes.push(bloco.join("\n"));
  }

  // Evolução beira-leito do dia
  const evoLinhas = blocoEvolucao(paciente.evolucoes?.[hoje]);
  if (evoLinhas.length) {
    partes.push([`EVOLUÇÃO BEIRA-LEITO — ${dataBR(hoje)}`, ...evoLinhas].join("\n"));
  }

  return partes.join("\n\n");
}
