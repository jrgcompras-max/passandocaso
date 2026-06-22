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

import { limparDataEmTexto } from "./datas";
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

/**
 * Blocos dos exames de imagem: cada exame é um bloco "Nome (data):\nlaudo".
 * O nome+data ficam na primeira linha (data malformada é limpa) e o laudo na
 * linha seguinte. Anotações entram como blocos avulsos. Os blocos são separados
 * por linha em branco em `montarTextoEvolucao`.
 */
function imagemLinhas(p: Paciente): string[] {
  const sec = p.secoes?.imagem;
  const blocos = parseBlocos(sec?.extraido)
    .map((b) => {
      const nome = limparDataEmTexto((b.titulo || "").trim());
      const laudo = b.itens.join(". ").trim();
      if (!nome && !laudo) return "";
      if (nome && laudo) return `${nome}:\n${laudo}`;
      return nome || laudo;
    })
    .filter(Boolean);
  const anots = ((sec?.anotacoes as Anotacao[]) || [])
    .map((a) => (a.texto || "").trim())
    .filter(Boolean);
  return [...blocos, ...anots];
}

/** Comorbidades e medicações de uso contínuo (seções separadas + fallback combinado). */
function comorbidadesMUC(p: Paciente): { comorb: string[]; muc: string[] } {
  const comorb: string[] = [];
  const muc: string[] = [];

  // Seções separadas (formato novo).
  const secComorb = p.secoes?.comorbidades;
  for (const b of parseBlocos(secComorb?.extraido)) comorb.push(...b.itens);
  for (const a of (secComorb?.anotacoes as Anotacao[]) || []) {
    const t = (a.texto || "").trim();
    if (t) comorb.push(t);
  }
  const secMuc = p.secoes?.medicacoesUsoContinuo;
  for (const b of parseBlocos(secMuc?.extraido)) {
    if (!/alergia/i.test(b.titulo)) muc.push(...b.itens);
  }
  for (const a of (secMuc?.anotacoes as Anotacao[]) || []) {
    const t = (a.texto || "").trim();
    if (t) muc.push(t);
  }

  // Fallback: seção combinada antiga (comorbidadesMedicacoes).
  const sec = p.secoes?.comorbidadesMedicacoes;
  if (sec && !comorb.length && !muc.length) {
    for (const b of parseBlocos(sec.extraido)) {
      (/medica|muc/i.test(b.titulo) ? muc : comorb).push(...b.itens);
    }
    for (const a of (sec.anotacoes as Anotacao[]) || []) {
      const t = (a.texto || "").trim();
      if (t) (a.categoria === "medicacao" ? muc : comorb).push(t);
    }
  }
  return { comorb, muc };
}

const RE_ATB_CLASSE = /antibi|antimicro|\batb\b/i;
// Palavras-chave para reconhecer antibióticos no texto livre (anotações/scan),
// quando não há classe/categoria atribuída.
const KW_ATB =
  /ceftriaxona|cefepime|cefalexina|cefazolina|ceftazidima|cefuroxima|amoxicilina|ampicilina|azitromicina|claritromicina|ciprofloxac|levofloxac|moxifloxac|piperacilina|tazobactam|imipenem|meropen|ertapen|vancomicina|teicoplanina|oxacilina|metronidazol|clindamicina|gentamicina|amicacina|sulfametoxazol|bactrim|polimixina|penicilina|clavulanato|sulbactam|linezolida|daptomicina|tigeciclina|aztreonam|nitrofurantoína|nitrofurantoina|fosfomicina|rifampicina|rocefin|tazocin|unasyn|clavulin/i;

/** Um item da prescrição é antibiótico? (categoria do badge, classe IA ou nome) */
function ehAtb(texto: string, categoria?: string, classe?: string): boolean {
  if (categoria === "atb") return true;
  if (RE_ATB_CLASSE.test(classe || "")) return true;
  return KW_ATB.test(texto || "");
}

/** Remove duplicados preservando a ordem (case-insensitive). */
function semDuplicar(itens: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const it of itens) {
    const chave = it.trim().toLowerCase();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(it.trim());
  }
  return out;
}

/**
 * Itens da prescrição hospitalar, de TODAS as fontes: lista estruturada
 * (`medicamentos`), anotações timestampadas da seção (com categoria do badge) e
 * conteúdo extraído por foto. Separa antibióticos dos demais ("em uso").
 */
function prescricao(p: Paciente): { atb: string[]; emUso: string[] } {
  const atb: string[] = [];
  const emUso: string[] = [];
  const add = (texto: string, isAtb: boolean) => {
    const t = (texto || "").trim();
    if (t) (isAtb ? atb : emUso).push(t);
  };

  for (const m of p.medicamentos || []) add(m.texto, ehAtb(m.texto, "", m.classe));

  const sec = p.secoes?.prescricaoHospitalar;
  for (const a of (sec?.anotacoes as Anotacao[]) || []) add(a.texto, ehAtb(a.texto, a.categoria));
  for (const b of parseBlocos(sec?.extraido)) for (const it of b.itens) add(it, ehAtb(it));

  return { atb: semDuplicar(atb), emUso: semDuplicar(emUso) };
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
/** Indenta linhas de continuação para alinhar sob um prefixo (ex.: "- Atual: "). */
function alinhar(itens: string[], prefixo: string): string {
  const pad = " ".repeat(prefixo.length);
  return prefixo + itens.map((t, i) => (i === 0 ? t : pad + t)).join("\n");
}

/**
 * Texto "Evolução Médica" (vai para o Tasy). Formato canônico em
 * backend/templates/evolucao-medica.template.js — manter em sincronia.
 * Texto puro (sem emoji/markdown). Escores NÃO entram aqui (só no Passar o Caso).
 */
export function montarTextoEvolucao(paciente: Paciente, hoje: string): string {
  const evo = paciente.evolucoes?.[hoje];
  const sv = paciente.sinaisVitais?.[hoje];

  // — Problemas ativos: viram a Avaliação (*A:). Sem problemas, cai no motivo da
  //   internação / diagnóstico principal (hipótese diagnóstica). —
  const ativos = (paciente.problemas || [])
    .filter((x) => x.status === "ativo")
    .map((x) => x.titulo.trim())
    .filter(Boolean);
  const fallbackHipotese =
    paciente.motivoInternacao?.trim() || paciente.diagnosticoPrincipal?.trim() || "";

  // — Atual: diagnóstico principal + outros problemas ativos (um por linha). —
  const diagPrincipal = paciente.diagnosticoPrincipal?.trim() || "";
  const norm = (x: string) => x.toLowerCase().trim();
  const atualItens = diagPrincipal
    ? [diagPrincipal, ...ativos.filter((t) => norm(t) !== norm(diagPrincipal))]
    : ativos.length
      ? ativos
      : ([paciente.motivoInternacao?.trim()].filter(Boolean) as string[]);
  const blocoAtual = atualItens.length ? alinhar(atualItens, "- Atual: ") : null;

  // — Antibióticos / Culturais (ATB só se cadastrado; senão --). —
  const { atb } = prescricao(paciente);
  const culturas = culturasPendentes(paciente);
  const blocoTrat = [
    `- Antibióticos: ${atb.length ? atb.join(", ") : "--"}`,
    `- Culturais: ${culturas.length ? culturas.join(", ") : "---"}`,
  ].join("\n");

  // — Comorbidades / MUC / Alergias (blocos separados). —
  const { comorb, muc } = comorbidadesMUC(paciente);
  const blocoComorb = [
    `* Comorbidades: ${comorb.length ? comorb.join(", ") : "nega"}`,
    `* MUC: ${muc.length ? muc.join(", ") : "nega"}`,
    `* Alergias: --`,
  ].join("\n");

  // — HDA (História da Doença Atual) —
  const hdaLinhas = secaoLinhas(paciente, "historia");
  const hda = hdaLinhas.length ? `*HDA: ${hdaLinhas.join(" ")}` : null;

  // — Subjetivo: consciência/orientação (minúsculas) + queixas (estadoGeral) —
  const sConsc = [
    rotuloDe(OPC_CONSCIENCIA, evo?.nivelConsciencia ?? null).toLowerCase() || null,
    rotuloDe(OPC_ORIENTACAO, evo?.orientacao ?? null).toLowerCase() || null,
  ]
    .filter(Boolean)
    .join(", ");
  const svSec = paciente.secoes?.sinaisVitaisIntercorrencias;
  const intercorr = [
    sv?.intercorrencias?.trim() || "",
    ...((svSec?.anotacoes as Anotacao[]) || []).map((x) => (x.texto || "").trim()),
  ].filter(Boolean);
  const sPartes = [sConsc, evo?.estadoGeral?.trim() || "", ...intercorr].filter(Boolean);
  const s = sPartes.length ? `*S: ${sPartes.join(". ")}` : null;

  // — Sinais vitais (omite campos vazios; some se não houver nenhum) —
  const ssvvPartes = [
    sv?.paSist && sv?.paDiast ? `PA ${sv.paSist}/${sv.paDiast}` : null,
    sv?.fc ? `FC ${sv.fc}` : null,
    sv?.fr ? `FR ${sv.fr}` : null,
    sv?.sato2 ? `SatO2 ${sv.sato2}` : null,
    sv?.temp ? `Tax ${sv.temp}` : null,
  ].filter(Boolean);
  const ssvv = ssvvPartes.length ? `SSVV: ${ssvvPartes.join(" | ")}` : null;

  // — Objetivo: estado geral (REG/BEG/MEG) + aparelhos (sem consciência/orientação) —
  const oCorpo = [
    evo?.estadoGeralExame?.trim() || null,
    evo?.neurologico?.trim() || null,
    evo?.cardiovascular?.trim() ? `AC ${evo.cardiovascular.trim()}` : null,
    evo?.respiratorio?.trim() ? `AP ${evo.respiratorio.trim()}` : null,
    evo?.abdominal?.trim() ? `Abdome ${evo.abdominal.trim()}` : null,
    evo?.mmii?.trim() ? `MMII ${evo.mmii.trim()}` : null,
    evo?.extremidades?.trim() ? `Extremidades ${evo.extremidades.trim()}` : null,
    evo?.pele?.trim() ? `Pele ${evo.pele.trim()}` : null,
  ].filter(Boolean);
  const o = oCorpo.length ? `*O: ${oCorpo.join("\n")}` : null;

  // — Exames laboratoriais (estruturado + anotações da seção; extraído como
  //   fallback quando não há valores estruturados) —
  const lab = laboratorioLinha(paciente);
  const labSec = paciente.secoes?.examesLaboratoriais;
  const labAnots = ((labSec?.anotacoes as Anotacao[]) || [])
    .map((x) => (x.texto || "").trim())
    .filter(Boolean);
  const labFallback = lab
    ? []
    : parseBlocos(labSec?.extraido)
        .flatMap((b) => b.itens.map((i) => i.trim()))
        .filter(Boolean);
  const exameLinhas = [lab, ...labFallback, ...labAnots].filter(Boolean);
  const exames = exameLinhas.length ? `Exames laboratoriais:\n${exameLinhas.join("\n")}` : null;
  const img = imagemLinhas(paciente);
  // Cada exame é um bloco; linha em branco entre eles (não vira parágrafo).
  const imagem = img.length ? `Exames de imagem:\n${img.join("\n\n")}` : null;

  // — Avaliação (*A:) hipóteses diagnósticas; Plano (*P:) condutas, uma por linha. —
  const avaliacaoItens = ativos.length ? ativos : fallbackHipotese ? [fallbackHipotese] : [];
  const a = avaliacaoItens.length ? alinhar(avaliacaoItens, "*A: ") : null;
  const planoItens = (evo?.condutaDoDia || "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const plano = planoItens.length ? alinhar(planoItens, "*P: ") : null;

  // Ordem canônica (template evolucao-medica): Atual → Antibióticos/Culturais →
  // Comorbidades/MUC/Alergias → HDA → S → SSVV → O → Labs → Imagem → A → P.
  return [
    "                    Evolução Médica",
    blocoAtual,
    blocoTrat,
    blocoComorb,
    hda,
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
