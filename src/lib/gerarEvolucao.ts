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

import { formatarDataBR, limparDataEmTexto } from "./datas";
import { abreviarLab, agruparPorExame, grupoLab, ordemLab } from "./lab";
import { textoComDiaAtual } from "./medicamentoDia";

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

  // BUG 7: D+ recalculado para hoje (avança sozinho a partir da data de início).
  for (const m of p.medicamentos || []) add(textoComDiaAtual(m), ehAtb(m.texto, "", m.classe));

  const sec = p.secoes?.prescricaoHospitalar;
  for (const a of (sec?.anotacoes as Anotacao[]) || []) add(a.texto, ehAtb(a.texto, a.categoria));
  for (const b of parseBlocos(sec?.extraido)) for (const it of b.itens) add(it, ehAtb(it));

  return { atb: semDuplicar(atb), emUso: semDuplicar(emUso) };
}

// FEATURE 1: reconhecimento de culturas (sigla canônica) por nome/variações.
const CULTURA_MAP: { re: RegExp; sigla: string }[] = [
  { re: /hemocult|^hmc\b|\bhemo\b/i, sigla: "HMC" },
  { re: /urocult|^urc\b|\buro\b/i, sigla: "URC" },
  { re: /cult.*cateter|\bcateter\b|\bcat\b/i, sigla: "Cult cateter" },
  { re: /cult.*escarro|\bescarro\b/i, sigla: "Cult escarro" },
  { re: /cult.*l[ií]quor|cult.*lcr/i, sigla: "Cult LCR" },
  { re: /cult.*ferida|\bferida\b/i, sigla: "Cult ferida" },
  { re: /swab/i, sigla: "Swab" },
  { re: /cultura/i, sigla: "Cultura" },
];
function siglaCultura(nome: string): string | null {
  return CULTURA_MAP.find((c) => c.re.test(nome || ""))?.sigla ?? null;
}
const RESULTADO_PENDENTE = /aguard|coletad|pendente|em andamento|sem resultado|solicitad/i;

/** Formata uma cultura: "HMC 21/06 — E. coli" ou "HMC coletada 21/06, aguardando". */
function fmtCultura(sigla: string, dataISO: string | undefined, valor: string): string {
  const dia = dataISO ? formatarDataBR(dataISO).slice(0, 5) : "";
  const v = (valor || "").trim();
  if (!v || RESULTADO_PENDENTE.test(v)) {
    return `${sigla}${dia ? ` coletada ${dia}` : ""}, aguardando`;
  }
  return `${sigla}${dia ? ` ${dia}` : ""} — ${v}`;
}

/**
 * Culturais para a Evolução Médica (FEATURE 1). Reconhece culturas anotadas:
 * resultados em resultadosLab (com data + resultado) e pendências não-feitas
 * (aguardando). Normaliza variações (hemocultura/HMC/hemo, urocultura/URC/uro…).
 */
function culturais(p: Paciente): string[] {
  const out: string[] = [];
  const siglasVistas = new Set<string>();
  // 1) Resultados (resultadosLab) reconhecidos como cultura — data + resultado.
  for (const r of p.resultadosLab || []) {
    const sigla = siglaCultura(r.exame);
    if (!sigla) continue;
    out.push(fmtCultura(sigla, r.data, r.valor));
    siglasVistas.add(sigla);
  }
  // 2) Pendências não-feitas que mencionam cultura (aguardando) — sem duplicar.
  for (const x of p.pendencias || []) {
    if (x.feito) continue;
    const sigla = siglaCultura(x.descricao || "");
    if (!sigla || siglasVistas.has(sigla)) continue;
    out.push(`${sigla} coletada, aguardando`);
    siglasVistas.add(sigla);
  }
  return out;
}

/**
 * Exames laboratoriais SEPARADOS POR DATA (mais recente → mais antiga). Cada
 * data inicia uma linha "DD/MM: " seguida dos labs daquele dia em ordem clínica
 * (ordemLab), quebrando a cada 4 labs com indentação. Abrevia nomes e exclui
 * culturas (vão para "- Culturais:"). Omite exames sem valor.
 */
function laboratorioLinha(p: Paciente): string {
  const porData = new Map<string, { exame: string; valor: string }[]>();
  for (const r of p.resultadosLab || []) {
    if (!String(r.valor ?? "").trim()) continue;
    if (grupoLab(r.exame) === "CULTURAS") continue;
    const d = r.data.slice(0, 10);
    const lista = porData.get(d) ?? [];
    lista.push({ exame: r.exame, valor: String(r.valor).trim() });
    porData.set(d, lista);
  }
  const datas = [...porData.keys()].sort((a, b) => b.localeCompare(a)); // desc
  const linhas: string[] = [];
  for (const d of datas) {
    // 1 valor por exame na data (dedup por nome canônico), em ordem clínica.
    const mapa = new Map<string, string>();
    for (const { exame, valor } of porData.get(d) || []) mapa.set(abreviarLab(exame), valor);
    const labs = [...mapa.entries()]
      .sort((a, b) => ordemLab(a[0]) - ordemLab(b[0]))
      .map(([nome, valor]) => `${nome} ${valor}`);
    if (!labs.length) continue;
    const prefixo = `${formatarDataBR(d).slice(0, 5)}: `; // "DD/MM: "
    const indent = " ".repeat(prefixo.length);
    const blocos: string[] = [];
    for (let i = 0; i < labs.length; i += 4) blocos.push(labs.slice(i, i + 4).join(" / "));
    linhas.push(prefixo + blocos.map((b, i) => (i === 0 ? b : indent + b)).join("\n"));
  }
  return linhas.join("\n");
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
  const culturas = culturais(paciente);
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
  // FEATURE 2: alimentação e eliminações compõem o *S: junto com as queixas.
  const ae = [
    evo?.aeAlimentacao?.trim() || "",
    evo?.aeDiurese?.trim() || "",
    evo?.aeEvacuacao?.trim() || "",
  ]
    .filter(Boolean)
    .join(", ");
  const sPartes = [
    sConsc,
    evo?.estadoGeral?.trim() || "",
    ae,
    ...intercorr,
  ].filter(Boolean);
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
  // Prefixo só é adicionado se o texto ainda não começa com ele (evita "AP AP ...").
  const comPrefixo = (texto: string | undefined, prefixo: string): string | null => {
    const t = (texto || "").trim();
    if (!t) return null;
    return new RegExp(`^${prefixo}\\b`, "i").test(t) ? t : `${prefixo} ${t}`;
  };
  const oCorpo = [
    evo?.estadoGeralExame?.trim() || null,
    evo?.neurologico?.trim() || null,
    // BUG 10: sem prefixo AC/AP no texto gerado (o achado já é autoexplicativo).
    evo?.cardiovascular?.trim() || null,
    evo?.respiratorio?.trim() || null,
    comPrefixo(evo?.abdominal, "Abdome"),
    comPrefixo(evo?.mmii, "MMII"),
    comPrefixo(evo?.extremidades, "Extremidades"),
    comPrefixo(evo?.pele, "Pele"),
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
