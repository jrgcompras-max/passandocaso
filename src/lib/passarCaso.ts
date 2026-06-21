import { type Anotacao, type Paciente } from "@/types/paciente";

import { agruparPorExame } from "./lab";

/**
 * Construtor de dados do "Passar o Caso" (visual rico, fica no app). Estrutura e
 * ordem definidas em backend/templates/passar-o-caso.template.js. Só inclui o que
 * tem conteúdo; sinais vitais e labs SÓ os alterados.
 */

export type LabAlterado = { exame: string; valor: string; seta: "alta" | "baixa" };
export type SsvvAlterado = { label: string; valor: string };
export type ExameSecaoCaso = { label: string; itens: string[] };

export type CasoData = {
  hda: string;
  atual: string[];
  comorbidades: string[];
  muc: string[];
  ssvvAlterados: SsvvAlterado[];
  exameFisico: ExameSecaoCaso[];
  labsAlterados: LabAlterado[];
  antibioticos: string[];
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

/** Comorbidades e MUC (seções separadas + fallback combinado). */
function comorbidadesMUC(p: Paciente): { comorb: string[]; muc: string[] } {
  const comorb: string[] = [];
  const muc: string[] = [];
  const secC = p.secoes?.comorbidades;
  for (const b of parseBlocos(secC?.extraido)) comorb.push(...b.itens);
  for (const a of (secC?.anotacoes as Anotacao[]) || []) if (a.texto?.trim()) comorb.push(a.texto.trim());
  const secM = p.secoes?.medicacoesUsoContinuo;
  for (const b of parseBlocos(secM?.extraido)) if (!/alergia/i.test(b.titulo || "")) muc.push(...b.itens);
  for (const a of (secM?.anotacoes as Anotacao[]) || []) if (a.texto?.trim()) muc.push(a.texto.trim());
  const sec = p.secoes?.comorbidadesMedicacoes;
  if (sec && !comorb.length && !muc.length) {
    for (const b of parseBlocos(sec.extraido)) (/medica|muc/i.test(b.titulo || "") ? muc : comorb).push(...b.itens);
  }
  return { comorb, muc };
}

const RE_ATB = /antibi|antimicro|\batb\b/i;
const KW_ATB =
  /ceftriaxona|cefepime|cefalexina|cefazolina|ceftazidima|amoxicilina|ampicilina|azitromicina|claritromicina|ciprofloxac|levofloxac|piperacilina|tazobactam|imipenem|meropen|ertapen|vancomicina|teicoplanina|oxacilina|metronidazol|clindamicina|gentamicina|amicacina|sulfametoxazol|bactrim|polimixina|penicilina|clavulanato|sulbactam|linezolida|daptomicina/i;

/** Antibióticos da prescrição (medicamentos + anotações com badge ATB). */
function antibioticos(p: Paciente): string[] {
  const out: string[] = [];
  for (const m of p.medicamentos || []) {
    if (RE_ATB.test(m.classe || "") || KW_ATB.test(m.texto || "")) out.push(m.texto.trim());
  }
  const sec = p.secoes?.prescricaoHospitalar;
  for (const a of (sec?.anotacoes as Anotacao[]) || []) {
    if (a.categoria === "atb" || KW_ATB.test(a.texto || "")) out.push(a.texto.trim());
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
  const g = num(sv.glasgow || "");
  if (g != null && g < 15) out.push({ label: "Glasgow", valor: String(sv.glasgow) });
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
  { re: /^bt\b|bilirrubina/i, min: 0, max: 1.2 },
  { re: /albumina/i, min: 3.5, max: 5.0 },
  { re: /lactato/i, min: 0.5, max: 2.2 },
  { re: /^inr\b|rni/i, min: 0.8, max: 1.2 },
  { re: /^na\b/i, min: 135, max: 145 },
];
function labsAlterados(p: Paciente): LabAlterado[] {
  const out: LabAlterado[] = [];
  for (const s of agruparPorExame(p.resultadosLab || [])) {
    const ref = REF_LAB.find((r) => r.re.test(s.exame.trim()));
    if (!ref) continue;
    const ultimo = s.pontos[s.pontos.length - 1];
    const v = num(ultimo.valor);
    if (v == null) continue;
    if (v > ref.max) out.push({ exame: s.exame, valor: ultimo.valor, seta: "alta" });
    else if (v < ref.min) out.push({ exame: s.exame, valor: ultimo.valor, seta: "baixa" });
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
  const hda = hdaBlocos.flatMap((b) => b.itens).join(" ").trim();

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
    atual,
    comorbidades: comorb,
    muc,
    ssvvAlterados: ssvvAlterados(paciente, hoje),
    exameFisico,
    labsAlterados: labsAlterados(paciente),
    antibioticos: antibioticos(paciente),
    avaliacao: avaliacao.length ? avaliacao : fallback ? [fallback] : [],
    conduta,
  };
}
