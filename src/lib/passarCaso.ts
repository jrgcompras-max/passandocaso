import { type Anotacao, type Paciente } from "@/types/paciente";

import { abreviarLab, agruparPorExame } from "./lab";

/**
 * Construtor de dados do "Passar o Caso" (visual rico, fica no app). Estrutura e
 * ordem definidas em backend/templates/passar-o-caso.template.js. Só inclui o que
 * tem conteúdo; sinais vitais e labs SÓ os alterados.
 */

export type LabAlterado = { exame: string; valor: string; seta: "alta" | "baixa" };
export type SsvvAlterado = { label: string; valor: string };
export type ExameSecaoCaso = { label: string; itens: string[] };
export type ImagemCaso = { titulo: string; texto: string; destacado: boolean };

export type CasoData = {
  hda: string;
  /** HDA completa (para resumir via API no Passar o Caso). */
  hdaCompleta: string;
  atual: string[];
  comorbidades: string[];
  muc: string[];
  ssvvAlterados: SsvvAlterado[];
  exameFisico: ExameSecaoCaso[];
  labsAlterados: LabAlterado[];
  imagem: ImagemCaso[];
  antibioticos: string[];
  medicamentos: string[];
  avaliacao: string[];
  conduta: string[];
};

type Bloco = { titulo?: string; itens: string[] };

function parseBlocos(extraido?: string): Bloco[] {
  const t = (extraido || "").trim();
  if (!t.startsWith("[")) return t ? [{ titulo: "", itens: [t] }] : [];
  try {
    const v = JSON.parse(t) as Bloco[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const num = (v: string): number | null => {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

/**
 * Quebra um trecho em itens atômicos: separa por quebra de linha, ponto-e-vírgula
 * e vírgula — exceto vírgula seguida de dígito, para preservar decimais/doses
 * (ex.: "Losartana 2,5 mg" continua um item). Garante comorbidades/MUC em chips
 * individuais mesmo quando vêm num único item (scan ou anotação manual).
 */
function dividir(texto: string): string[] {
  return String(texto || "")
    .split(/[\n;]+|,(?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resume a HDA para UMA LINHA de contexto no Passar o Caso (a HDA completa
 * continua na ficha). Mantém o texto inteiro quando já é curto; senão corta de
 * forma inteligente — preferindo o fim de uma frase e, na falta, a última
 * palavra inteira — para não exibir o parágrafo longo na passagem de plantão.
 */
function resumirUmaLinha(texto: string, max = 180): string {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const fimFrase = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("; "));
  if (fimFrase > max * 0.5) return corte.slice(0, fimFrase + 1).trim();
  const esp = corte.lastIndexOf(" ");
  return (esp > 0 ? corte.slice(0, esp) : corte).trim() + "…";
}

/** Comorbidades e MUC (seções separadas + fallback combinado). */
function comorbidadesMUC(p: Paciente): { comorb: string[]; muc: string[] } {
  const comorb: string[] = [];
  const muc: string[] = [];
  const secC = p.secoes?.comorbidades;
  for (const b of parseBlocos(secC?.extraido)) for (const it of b.itens) comorb.push(...dividir(it));
  for (const a of (secC?.anotacoes as Anotacao[]) || []) comorb.push(...dividir(a.texto));
  const secM = p.secoes?.medicacoesUsoContinuo;
  for (const b of parseBlocos(secM?.extraido)) if (!/alergia/i.test(b.titulo || "")) for (const it of b.itens) muc.push(...dividir(it));
  for (const a of (secM?.anotacoes as Anotacao[]) || []) muc.push(...dividir(a.texto));
  const sec = p.secoes?.comorbidadesMedicacoes;
  if (sec && !comorb.length && !muc.length) {
    for (const b of parseBlocos(sec.extraido)) {
      const alvo = /medica|muc/i.test(b.titulo || "") ? muc : comorb;
      for (const it of b.itens) alvo.push(...dividir(it));
    }
  }
  return { comorb, muc };
}

const RE_ATB = /antibi|antimicro|\batb\b/i;
const KW_ATB =
  /ceftriaxona|cefepime|cefalexina|cefazolina|ceftazidima|amoxicilina|ampicilina|azitromicina|claritromicina|ciprofloxac|levofloxac|piperacilina|tazobactam|imipenem|meropen|ertapen|vancomicina|teicoplanina|oxacilina|metronidazol|clindamicina|gentamicina|amicacina|sulfametoxazol|bactrim|polimixina|penicilina|clavulanato|sulbactam|linezolida|daptomicina/i;

/**
 * Heurística única para "este medicamento é antibiótico?": pela classe
 * farmacológica (classificada pela IA) OU pelo nome do princípio ativo.
 * Usada tanto aqui (antibioticoterapia do Passar o Caso) quanto na badge ATB
 * da Prescrição Hospitalar — uma só fonte de verdade.
 */
export function ehAntibiotico(texto?: string, classe?: string): boolean {
  return RE_ATB.test(classe || "") || KW_ATB.test(texto || "");
}

/** Antibióticos da prescrição (medicamentos + anotações com badge ATB). */
function antibioticos(p: Paciente): string[] {
  const out: string[] = [];
  for (const m of p.medicamentos || []) {
    if (ehAntibiotico(m.texto, m.classe)) out.push(m.texto.trim());
  }
  const sec = p.secoes?.prescricaoHospitalar;
  for (const a of (sec?.anotacoes as Anotacao[]) || []) {
    if (a.categoria === "atb" || KW_ATB.test(a.texto || "")) out.push(a.texto.trim());
  }
  return [...new Set(out)].filter(Boolean);
}

/**
 * Medicamentos em uso (BUG 2): TODOS os medicamentos da Prescrição Hospitalar
 * EXCETO antibióticos (esses ficam na seção "Antibióticos"). Inclui antivirais,
 * antifúngicos, sintomáticos, etc. — antes só os ATBs apareciam no Passar o Caso.
 */
function medicamentosEmUso(p: Paciente): string[] {
  const out: string[] = [];
  for (const m of p.medicamentos || []) {
    if (!ehAntibiotico(m.texto, m.classe)) out.push(m.texto.trim());
  }
  const sec = p.secoes?.prescricaoHospitalar;
  for (const a of (sec?.anotacoes as Anotacao[]) || []) {
    if (a.categoria === "atb" || KW_ATB.test(a.texto || "")) continue;
    out.push(a.texto.trim());
  }
  return [...new Set(out)].filter(Boolean);
}

// Faixas de normalidade dos sinais vitais (fora disso = alterado).
const FAIXA_SV: Record<string, [number, number]> = {
  fc: [60, 100], fr: [12, 20], sato2: [94, 100], temp: [35.5, 37.7], glicemia: [70, 180],
};
function ssvvAlterados(p: Paciente, hoje: string): SsvvAlterado[] {
  const sv = p.sinaisVitais?.[hoje];
  if (!sv) return [];
  const out: SsvvAlterado[] = [];
  const ps = num(sv.paSist || ""), pd = num(sv.paDiast || "");
  if ((ps != null && (ps < 90 || ps > 140)) || (pd != null && (pd < 60 || pd > 90))) {
    out.push({ label: "PA", valor: `${sv.paSist}/${sv.paDiast} mmHg` });
  }
  const checa = (k: keyof typeof FAIXA_SV, label: string, unidade: string) => {
    const v = num((sv as Record<string, string>)[k] || "");
    if (v == null) return;
    const [lo, hi] = FAIXA_SV[k];
    if (v < lo || v > hi) out.push({ label, valor: `${(sv as Record<string, string>)[k]}${unidade}` });
  };
  checa("fc", "FC", " bpm");
  checa("fr", "FR", " irpm");
  checa("sato2", "SatO₂", "%");
  checa("temp", "Tax", "°C");
  checa("glicemia", "Glicemia", " mg/dL");
  return out;
}

// Referências laboratoriais (faixa) por nome normalizado.
const REF_LAB: { re: RegExp; min: number; max: number }[] = [
  { re: /^hb\b|hemoglob/i, min: 12, max: 17 },
  { re: /^ht\b|hemat[óo]crito/i, min: 36, max: 52 },
  { re: /leuc[óo]|^lt\b/i, min: 4000, max: 11000 },
  { re: /plaq/i, min: 150000, max: 450000 },
  { re: /pcr|prote[íi]na c/i, min: 0, max: 5 },
  { re: /^na\b|s[óo]dio/i, min: 135, max: 145 },
  { re: /^k\b|pot[áa]ssio/i, min: 3.5, max: 5.0 },
  { re: /^cr\b|creatin/i, min: 0.6, max: 1.3 },
  { re: /ureia|ur[ée]ia/i, min: 10, max: 50 },
  // Bilirrubinas: direta/indireta ANTES da total para não cair na regra genérica.
  { re: /^bd\b|bilirrubina dir/i, min: 0, max: 0.3 },
  { re: /^bi\b|bilirrubina ind/i, min: 0.1, max: 0.8 },
  { re: /^bt\b|bilirrubina/i, min: 0, max: 1.2 },
  { re: /albumina/i, min: 3.5, max: 5.0 },
  // Função hepática: FA = Fosfatase Alcalina (NÃO fibrilação atrial); GGT = Gama-GT.
  { re: /^fa\b|fosfatase alcalina/i, min: 40, max: 130 },
  { re: /^ggt\b|gama|gama-?gt/i, min: 10, max: 60 },
  { re: /lactato/i, min: 0.5, max: 2.2 },
  { re: /^inr\b|rni/i, min: 0.8, max: 1.2 },
  { re: /^na\b/i, min: 135, max: 145 },
];
function labsAlterados(p: Paciente): LabAlterado[] {
  const out: LabAlterado[] = [];
  // Pediátrico (idade < 18): faixas de referência são de adultos → não classifica.
  if (p.idade != null && p.idade < 18) return out;
  for (const s of agruparPorExame(p.resultadosLab || [])) {
    const ref = REF_LAB.find((r) => r.re.test(s.exame.trim()));
    if (!ref) continue;
    const ultimo = s.pontos[s.pontos.length - 1];
    const v = num(ultimo.valor);
    if (v == null) continue;
    if (v > ref.max) out.push({ exame: abreviarLab(s.exame), valor: ultimo.valor, seta: "alta" });
    else if (v < ref.min) out.push({ exame: abreviarLab(s.exame), valor: ultimo.valor, seta: "baixa" });
  }
  return out;
}

/** Quebra um laudo em frases (igual à tela; sem lookbehind p/ Hermes). */
function fragmentarLaudo(texto: string): string[] {
  return (String(texto || "").match(/[^.;]+[.;]?/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Exames de imagem para o Passar o Caso (FEATURE 3). Se o médico marcou trechos
 * (marca-texto), mostra SÓ os trechos destacados; sem marcação, o laudo inteiro.
 */
function imagemCaso(p: Paciente): ImagemCaso[] {
  const t = (p.secoes?.imagem?.extraido || "").trim();
  if (!t.startsWith("[")) return [];
  let blocos: { titulo?: string; itens?: string[]; destacados?: string[] }[];
  try {
    blocos = JSON.parse(t);
  } catch {
    return [];
  }
  if (!Array.isArray(blocos)) return [];
  const out: ImagemCaso[] = [];
  for (const b of blocos) {
    const laudo = (b.itens || []).join(". ").trim();
    if (!laudo) continue;
    const destacados = b.destacados || [];
    const frases = fragmentarLaudo(laudo);
    const marcadas = frases.filter((f) => destacados.includes(f));
    const texto = marcadas.length ? marcadas.join(" ") : laudo;
    out.push({
      titulo: (b.titulo || "Exame").trim(),
      texto,
      destacado: marcadas.length > 0,
    });
  }
  return out;
}

// Seções do exame físico (mesma ordem dos chips).
const EXAME_SECOES: { campo: string; label: string }[] = [
  { campo: "estadoGeralExame", label: "Estado geral" },
  { campo: "neurologico", label: "Neurológico" },
  { campo: "cardiovascular", label: "Cardiovascular" },
  { campo: "respiratorio", label: "Respiratório" },
  { campo: "abdominal", label: "Abdominal" },
  { campo: "mmii", label: "Membros e extremidades" },
  { campo: "pele", label: "Pele e mucosas" },
];

/** Monta os dados do Passar o Caso (só o que tem conteúdo). */
export function montarCaso(paciente: Paciente, hoje: string): CasoData {
  const evo = paciente.evolucoes?.[hoje];
  const { comorb, muc } = comorbidadesMUC(paciente);

  const hdaBlocos = parseBlocos(paciente.secoes?.historia?.extraido);
  const hdaCompleta = hdaBlocos.flatMap((b) => b.itens).join(" ").trim();
  // Resumo local (fallback imediato); a tela troca pelo resumo via API quando pronto.
  const hda = resumirUmaLinha(hdaCompleta);

  const atual = (paciente.problemas || [])
    .filter((x) => x.status === "ativo" || x.status === "resolvendo")
    .map((x) => x.titulo.trim())
    .filter(Boolean);

  const exameFisico: ExameSecaoCaso[] = [];
  for (const sec of EXAME_SECOES) {
    const txt = String((evo as Record<string, string> | undefined)?.[sec.campo] || "").trim();
    if (!txt) continue;
    const itens = txt.split(/\s*[,;]\s*/).map((t) => t.trim()).filter(Boolean);
    if (itens.length) exameFisico.push({ label: sec.label, itens });
  }

  const avaliacao = (paciente.problemas || [])
    .filter((x) => x.status === "ativo")
    .map((x) => x.titulo.trim())
    .filter(Boolean);
  const fallback = paciente.diagnosticoPrincipal?.trim() || paciente.motivoInternacao?.trim() || "";

  const conduta = (evo?.condutaDoDia || "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    hda,
    hdaCompleta,
    atual,
    comorbidades: comorb,
    muc,
    ssvvAlterados: ssvvAlterados(paciente, hoje),
    exameFisico,
    labsAlterados: labsAlterados(paciente),
    imagem: imagemCaso(paciente),
    antibioticos: antibioticos(paciente),
    medicamentos: medicamentosEmUso(paciente),
    avaliacao: avaliacao.length ? avaliacao : fallback ? [fallback] : [],
    conduta,
  };
}
