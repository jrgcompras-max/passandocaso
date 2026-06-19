import {
  OPC_CONSCIENCIA,
  OPC_ORIENTACAO,
  rotuloDe,
} from "@/constants/evolucao";
import {
  type Anotacao,
  type Paciente,
  type SecaoId,
} from "@/types/paciente";

import { agruparPorExame } from "./lab";

type Bloco = { titulo: string; itens: string[] };

/** Interpreta o conteúdo extraído (JSON de blocos ou texto) em blocos. */
function parseBlocos(extraido: string | undefined): Bloco[] {
  const t = (extraido || "").trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const v = JSON.parse(t) as Bloco[];
      if (Array.isArray(v)) {
        return v.map((b) => ({
          titulo: b.titulo || "",
          itens: (b.itens || []).map((i) => String(i).trim()).filter(Boolean),
        }));
      }
    } catch {
      // texto puro
    }
  }
  return [{ titulo: "", itens: [t] }];
}

/** Linhas legíveis de uma seção foto (extração + anotações). */
function secaoLinhas(p: Paciente, id: SecaoId): string[] {
  const sec = p.secoes?.[id];
  const linhas = parseBlocos(sec?.extraido)
    .map((b) =>
      b.itens.length ? (b.titulo ? `${b.titulo}: ${b.itens.join("; ")}` : b.itens.join("; ")) : "",
    )
    .filter(Boolean);
  const anots = ((sec?.anotacoes as Anotacao[]) || [])
    .map((a) => (a.texto || "").trim())
    .filter(Boolean);
  return [...linhas, ...anots];
}

/** Comorbidades e medicações de uso contínuo (foto + anotações classificadas). */
function comorbidadesMUC(p: Paciente): { comorb: string[]; muc: string[] } {
  const sec = p.secoes?.comorbidadesMedicacoes;
  const comorb: string[] = [];
  const muc: string[] = [];
  for (const b of parseBlocos(sec?.extraido)) {
    (/medica|muc/i.test(b.titulo) ? muc : comorb).push(...b.itens);
  }
  for (const a of (sec?.anotacoes as Anotacao[]) || []) {
    const t = (a.texto || "").trim();
    if (t) (a.categoria === "medicacao" ? muc : comorb).push(t);
  }
  return { comorb, muc };
}

/** Antibióticos da prescrição (medicamentos classificados como antibiótico). */
function antibioticos(p: Paciente): string[] {
  return (p.medicamentos || [])
    .filter((m) => /antibi|\batb\b/i.test(m.classe || ""))
    .map((m) => (m.texto || "").trim())
    .filter(Boolean);
}

/** Culturas pendentes (pendências não-feitas que mencionam cultura). */
function culturasPendentes(p: Paciente): string[] {
  return (p.pendencias || [])
    .filter((x) => !x.feito && /cultura|hemocult|urocult/i.test(x.descricao || ""))
    .map((x) => x.descricao.trim());
}

/** Linha compacta dos exames laboratoriais (valor mais recente por exame). */
function laboratorioLinha(p: Paciente): string {
  return agruparPorExame(p.resultadosLab || [])
    .map((s) => `${s.exame} ${s.pontos[s.pontos.length - 1].valor}`)
    .join(" / ");
}

/**
 * Gera o texto do "Passar o Caso" no formato "Evolução Médica". Sem cabeçalho de
 * identificação (já está no título da tela) e sem assinatura. Linhas sem
 * conteúdo são omitidas (salvo os padrões "nega"/"---"/"--" do modelo).
 */
export function montarTextoEvolucao(paciente: Paciente, hoje: string): string {
  const evo = paciente.evolucoes?.[hoje];
  const sv = paciente.sinaisVitais?.[hoje];

  // — Atual: diagnóstico principal + problemas ativos, um por linha —
  const ativos = (paciente.problemas || [])
    .filter((x) => x.status === "ativo")
    .map((x) => x.titulo.trim())
    .filter(Boolean);
  const atual = [paciente.diagnosticoPrincipal?.trim(), ...ativos].filter(Boolean);
  const blocoAtual = atual.length ? `- Atual: ${atual.join("\n")}` : null;

  // — Antibióticos / Culturais (com padrões -- / ---) —
  const atb = antibioticos(paciente);
  const culturas = culturasPendentes(paciente);
  const blocoTrat = [
    `- Antibióticos: ${atb.length ? atb.join(", ") : "--"}`,
    `- Culturais: ${culturas.length ? culturas.join(", ") : "---"}`,
  ].join("\n");

  // — Comorbidades / MUC / Alergias —
  const { comorb, muc } = comorbidadesMUC(paciente);
  const blocoComorb = [
    `* Comorbidades: ${comorb.length ? comorb.join(", ") : "nega"}`,
    `* MUC: ${muc.length ? muc.join(", ") : "nega"}`,
    `* Alergias: --`,
  ].join("\n");

  // — HMA —
  const hda = secaoLinhas(paciente, "historia");
  const hma = hda.length ? `*HMA: ${hda.join(" ")}` : null;

  // — Subjetivo —
  const s = evo?.estadoGeral?.trim() ? `*S: ${evo.estadoGeral.trim()}` : null;

  // — Sinais vitais (omite campos vazios; some se não houver nenhum) —
  const ssvvPartes = [
    sv?.paSist && sv?.paDiast ? `PA ${sv.paSist}/${sv.paDiast}` : null,
    sv?.fc ? `FC ${sv.fc}` : null,
    sv?.fr ? `FR ${sv.fr}` : null,
    sv?.sato2 ? `SatO2 ${sv.sato2}` : null,
    sv?.temp ? `Tax ${sv.temp}` : null,
  ].filter(Boolean);
  const ssvv = ssvvPartes.length ? `SSVV: ${ssvvPartes.join(" | ")}` : null;

  // — Objetivo: estado geral + consciência/orientação (minúsculas) + aparelhos —
  const oPrimeira = [
    evo?.estadoGeral?.trim() || null,
    rotuloDe(OPC_CONSCIENCIA, evo?.nivelConsciencia ?? null).toLowerCase() || null,
    rotuloDe(OPC_ORIENTACAO, evo?.orientacao ?? null).toLowerCase() || null,
  ].filter(Boolean).join(", ");
  const oCorpo = [
    evo?.neurologico?.trim() || null,
    evo?.cardiovascular?.trim() ? `AC ${evo.cardiovascular.trim()}` : null,
    evo?.respiratorio?.trim() ? `AP ${evo.respiratorio.trim()}` : null,
    evo?.abdominal?.trim() ? `Abdome ${evo.abdominal.trim()}` : null,
    evo?.mmii?.trim() ? `MMII ${evo.mmii.trim()}` : null,
    evo?.extremidades?.trim() ? `Extremidades ${evo.extremidades.trim()}` : null,
  ].filter(Boolean);
  const o =
    oPrimeira || oCorpo.length ? [`*O: ${oPrimeira}`.trim(), ...oCorpo].join("\n") : null;

  // — Exames —
  const lab = laboratorioLinha(paciente);
  const exames = lab ? `Exames laboratoriais:\n${lab}` : null;
  const img = secaoLinhas(paciente, "imagem");
  const imagem = img.length ? `Exames de imagem:\n${img.join("\n")}` : null;

  // — Avaliação (problemas ativos, um por linha) / Plano (conduta do dia) —
  const a = ativos.length ? `*A: ${ativos.join("\n")}` : null;
  const plano = evo?.condutaDoDia?.trim() ? `*P: ${evo.condutaDoDia.trim()}` : null;

  return [
    "                    Evolução Médica",
    blocoAtual,
    blocoTrat,
    blocoComorb,
    hma,
    s,
    ssvv,
    o,
    exames,
    imagem,
    a,
    plano,
  ]
    .filter(Boolean)
    .join("\n\n");
}
