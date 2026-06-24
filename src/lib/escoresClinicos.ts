import {
  type EvolucaoBeiraLeito,
  type Paciente,
  type SinaisVitaisDia,
} from "@/types/paciente";

/**
 * Escores clínicos automáticos (Fase 3).
 *
 * Posicionamento regulatório: os escores são CALCULADOS, não interpretados. Cada
 * função devolve o número e a classificação DA PRÓPRIA ESCALA (sem texto clínico
 * adicional) e cita a fonte. Quando falta um campo, o escore fica `calculavel:
 * false` com a lista do que falta ("dados insuficientes para calcular"). Nada
 * aqui sugere conduta — o julgamento é sempre do médico.
 */

export type FaixaEscore = "baixo" | "medio" | "alto";

/** Um critério pontuado do escore (para a visualização ●/○). */
export type ItemEscore = {
  label: string;
  pontos: number;
  /** Pontuação máxima daquele critério (1 na maioria; 2 em alguns). */
  max: number;
  /** Critério marcado/positivo. */
  marcado: boolean;
  /** Critério não avaliado por falta de dado (conta como 0). */
  ausente?: boolean;
};

export type Escore = {
  id: "curb65" | "sofa" | "childPugh" | "chadsvasc";
  nome: string;
  /** Sigla compacta para o "Passar o Caso". */
  sigla: string;
  calculavel: boolean;
  /** Aplicável ao contexto clínico (diagnóstico justifica o escore). */
  aplicavel: boolean;
  pontos: number;
  maxPontos: number;
  faixa: FaixaEscore;
  /** Texto curto definido pela própria escala (classe/risco). */
  classificacao: string;
  fonte: string;
  itens: ItemEscore[];
  /** Campos ausentes (quando não calculável ou com critério não avaliado). */
  faltam: string[];
};

// ── helpers de extração ─────────────────────────────────────────────────────

function normalizar(s: string | null | undefined): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Primeiro número de um texto ("2,3 mg/dL" → 2.3). */
function num(v: string | null | undefined): number | null {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Valor numérico mais recente de um exame (por sinônimos do nome). */
function labMaisRecente(p: Paciente, sinonimos: string[]): number | null {
  const alvos = sinonimos.map(normalizar);
  const candidatos = (p.resultadosLab || []).filter((r) => {
    const e = normalizar(r.exame);
    return alvos.some((a) => e === a || e.startsWith(a + " ") || e.startsWith(a));
  });
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.data.localeCompare(a.data));
  return num(candidatos[0].valor);
}

/** Lê os itens de comorbidade do `extraido` (JSON de blocos), ignorando MUC. */
function comorbDosBlocos(extraido: string | undefined, todos: boolean): string[] {
  if (!extraido) return [];
  try {
    const blocos = JSON.parse(extraido) as { titulo?: string; itens?: string[] }[];
    if (!Array.isArray(blocos)) return [extraido];
    const out: string[] = [];
    for (const b of blocos) {
      if (todos || !/medica|muc/i.test(b.titulo || "")) out.push(...(b.itens || []));
    }
    return out;
  } catch {
    return [extraido];
  }
}

/** Texto agregado de comorbidades (seção nova + combinada legada + dados + problemas). */
function textoComorbidades(p: Paciente): string {
  const partes: string[] = [];
  if (p.dadosClinicos?.comorbidades) partes.push(p.dadosClinicos.comorbidades);
  // Seção separada (novo formato): todos os itens são comorbidades.
  partes.push(...comorbDosBlocos(p.secoes?.comorbidades?.extraido, true));
  // Seção combinada antiga: filtra os blocos de MUC.
  partes.push(...comorbDosBlocos(p.secoes?.comorbidadesMedicacoes?.extraido, false));
  for (const pr of p.problemas || []) partes.push(pr.titulo);
  return normalizar(partes.join(" | "));
}

function temComorbidade(texto: string, termos: string[]): boolean {
  return termos.some((t) => texto.includes(normalizar(t)));
}

/**
 * Contexto clínico do paciente para filtrar escores por aplicabilidade:
 * comorbidades + problemas ativos (já vêm de textoComorbidades) + hipóteses
 * diagnósticas (diagnóstico principal / motivo de internação). Tudo normalizado.
 */
function textoContextoClinico(p: Paciente): string {
  return normalizar(
    [
      textoComorbidades(p),
      p.diagnosticoPrincipal || "",
      p.motivoInternacao || "",
    ].join(" | "),
  );
}

/** Contexto indica Fibrilação Atrial? (CHA₂DS₂-VASc). */
function temFibrilacaoAtrial(p: Paciente): boolean {
  return /fibrila[cç][aã]o atrial|flutter atrial|\bfa\b|\bfaarv\b|\bfac\b/.test(
    textoContextoClinico(p),
  );
}

/** Contexto indica hepatopatia? (Child-Pugh). */
function temHepatopatia(p: Paciente): boolean {
  const txt = textoContextoClinico(p);
  return temComorbidade(txt, [
    "cirrose",
    "hepat", // hepatite, hepatopatia, hepatocelular, doenca hepatica
    "insuficiencia hepatica",
    "hipertensao portal",
    "encefalopatia",
    "ascite",
    "varizes esofag",
    "child",
    "dhc",
  ]);
}

/** Vasopressor em uso (varredura da prescrição). */
function temVasopressor(p: Paciente): boolean {
  const re = /noradrenalina|norepinefrina|vasopressina|dobutamina|dopamina|adrenalina|epinefrina/i;
  return (p.medicamentos || []).some((m) => re.test(m.texto || ""));
}

function faixaPorTercos(pontos: number, corteMedio: number, corteAlto: number): FaixaEscore {
  if (pontos >= corteAlto) return "alto";
  if (pontos >= corteMedio) return "medio";
  return "baixo";
}

// ── CURB-65 (pneumonia) ─────────────────────────────────────────────────────

function calcularCurb65(p: Paciente, hoje: string): Escore {
  const sv: SinaisVitaisDia | undefined = p.sinaisVitais?.[hoje];
  const evo: EvolucaoBeiraLeito | undefined = p.evolucoes?.[hoje];
  const faltam: string[] = [];

  const fr = num(sv?.fr);
  const paSist = num(sv?.paSist);
  const paDiast = num(sv?.paDiast);
  // Dados mínimos objetivos: FR e PA do dia.
  const calculavel = fr != null && (paSist != null || paDiast != null) && p.idade != null;

  // Confusão: nível de consciência ≠ lúcido OU desorientado.
  const temConsc = !!(evo && (evo.nivelConsciencia || evo.orientacao));
  const confusao =
    (evo?.nivelConsciencia != null && evo.nivelConsciencia !== "lucido") ||
    evo?.orientacao === "desorientado";
  if (!temConsc) faltam.push("nível de consciência");

  const ureia = labMaisRecente(p, ["ureia", "uréia", "u"]);
  if (ureia == null) faltam.push("ureia");

  const idade = p.idade ?? null;

  const itens: ItemEscore[] = [
    { label: "Confusão mental", pontos: confusao ? 1 : 0, max: 1, marcado: confusao, ausente: !temConsc },
    { label: "Ureia > 43 mg/dL", pontos: ureia != null && ureia > 43 ? 1 : 0, max: 1, marcado: ureia != null && ureia > 43, ausente: ureia == null },
    { label: "FR ≥ 30 irpm", pontos: fr != null && fr >= 30 ? 1 : 0, max: 1, marcado: fr != null && fr >= 30, ausente: fr == null },
    {
      label: "PAS < 90 ou PAD ≤ 60 mmHg",
      pontos: (paSist != null && paSist < 90) || (paDiast != null && paDiast <= 60) ? 1 : 0,
      max: 1,
      marcado: (paSist != null && paSist < 90) || (paDiast != null && paDiast <= 60),
      ausente: paSist == null && paDiast == null,
    },
    { label: "Idade ≥ 65 anos", pontos: idade != null && idade >= 65 ? 1 : 0, max: 1, marcado: idade != null && idade >= 65, ausente: idade == null },
  ];
  const pontos = itens.reduce((s, i) => s + i.pontos, 0);

  let classificacao = "Baixo risco";
  if (pontos >= 3) classificacao = "Alto risco";
  else if (pontos === 2) classificacao = "Risco intermediário";

  return {
    id: "curb65",
    nome: "CURB-65",
    sigla: "CURB-65",
    calculavel,
    aplicavel: true, // aplicável a qualquer internação
    pontos,
    maxPontos: 5,
    faixa: faixaPorTercos(pontos, 2, 3),
    classificacao,
    fonte: "Lim et al., Thorax 2003 · BTS",
    itens,
    faltam,
  };
}

// ── SOFA (sepse/UTI) ────────────────────────────────────────────────────────

/** Pontuação SOFA da PaO2/FiO2 ESTIMADA pela SatO2 (per protocolo do app). */
function sofaRespiratorioPorSato2(sato2: number): number {
  if (sato2 >= 97) return 0;
  if (sato2 >= 93) return 1;
  if (sato2 >= 88) return 2;
  return 3; // < 88% → PaO2/FiO2 < 200
}

function calcularSofa(p: Paciente, hoje: string): Escore {
  const sv = p.sinaisVitais?.[hoje];
  const evo = p.evolucoes?.[hoje];
  const faltam: string[] = [];
  const itens: ItemEscore[] = [];

  // Respiratório (SatO2 → PaO2/FiO2 estimada).
  const sato2 = num(sv?.sato2);
  const respDisp = sato2 != null;
  const respPts = respDisp ? sofaRespiratorioPorSato2(sato2) : 0;
  if (!respDisp) faltam.push("SatO2");
  itens.push({ label: "Respiratório (PaO2/FiO2 est.)", pontos: respPts, max: 4, marcado: respPts > 0, ausente: !respDisp });

  // Coagulação (plaquetas, em milhares).
  const plaq = labMaisRecente(p, ["plaquetas", "plaq", "plt"]);
  const coagDisp = plaq != null;
  let coagPts = 0;
  if (plaq != null) {
    const k = plaq / 1000; // /mm³ → x10³
    coagPts = k < 20 ? 4 : k < 50 ? 3 : k < 100 ? 2 : k < 150 ? 1 : 0;
  } else faltam.push("plaquetas");
  itens.push({ label: "Coagulação (plaquetas)", pontos: coagPts, max: 4, marcado: coagPts > 0, ausente: !coagDisp });

  // Hepático (bilirrubina total).
  const bt = labMaisRecente(p, ["bilirrubina total", "bt", "bilirrubina"]);
  const hepDisp = bt != null;
  let hepPts = 0;
  if (bt != null) hepPts = bt >= 12 ? 4 : bt >= 6 ? 3 : bt >= 2 ? 2 : bt >= 1.2 ? 1 : 0;
  else faltam.push("bilirrubina");
  itens.push({ label: "Hepático (bilirrubina)", pontos: hepPts, max: 4, marcado: hepPts > 0, ausente: !hepDisp });

  // Cardiovascular (PAM / vasopressor).
  const paSist = num(sv?.paSist);
  const paDiast = num(sv?.paDiast);
  const pam = paSist != null && paDiast != null ? (paSist + 2 * paDiast) / 3 : null;
  const vaso = temVasopressor(p);
  const cardioDisp = pam != null || vaso;
  let cardioPts = 0;
  if (vaso) cardioPts = 3; // vasopressor em uso (sem dose → grau aproximado)
  else if (pam != null) cardioPts = pam < 70 ? 1 : 0;
  else faltam.push("pressão arterial");
  itens.push({ label: "Cardiovascular (PAM)", pontos: cardioPts, max: 4, marcado: cardioPts > 0, ausente: !cardioDisp });

  // SNC (Glasgow estimado pelo nível de consciência).
  const nc = evo?.nivelConsciencia || null;
  const sncDisp = nc != null;
  let sncPts = 0;
  if (nc === "torporoso") sncPts = 2;
  else if (nc === "comatoso") sncPts = 4;
  else if (nc === "lucido") sncPts = 0;
  else faltam.push("nível de consciência");
  itens.push({ label: "Neurológico (consciência)", pontos: sncPts, max: 4, marcado: sncPts > 0, ausente: !sncDisp });

  // Renal (creatinina).
  const cr = labMaisRecente(p, ["creatinina", "cr", "creat"]);
  const renalDisp = cr != null;
  let renalPts = 0;
  if (cr != null) renalPts = cr >= 5 ? 4 : cr >= 3.5 ? 3 : cr >= 2 ? 2 : cr >= 1.2 ? 1 : 0;
  else faltam.push("creatinina");
  itens.push({ label: "Renal (creatinina)", pontos: renalPts, max: 4, marcado: renalPts > 0, ausente: !renalDisp });

  // Suficiência: respiratório + cardiovascular + renal + ao menos 3 sistemas no total.
  const avaliados = itens.filter((i) => !i.ausente).length;
  const calculavel = respDisp && cardioDisp && renalDisp && avaliados >= 3;
  const pontos = itens.reduce((s, i) => s + i.pontos, 0);

  let classificacao = "Disfunção orgânica leve";
  if (pontos >= 10) classificacao = "Disfunção orgânica grave";
  else if (pontos >= 6) classificacao = "Disfunção orgânica moderada";

  return {
    id: "sofa",
    nome: "SOFA",
    sigla: "SOFA",
    calculavel,
    aplicavel: true, // aplicável a qualquer internação
    pontos,
    maxPontos: 24,
    faixa: faixaPorTercos(pontos, 6, 10),
    classificacao: `${classificacao} · ${avaliados}/6 sistemas`,
    fonte: "Vincent et al., Intensive Care Med 1996",
    itens,
    faltam,
  };
}

// ── Child-Pugh (cirrose) ────────────────────────────────────────────────────

function calcularChildPugh(p: Paciente, hoje: string): Escore {
  const evo = p.evolucoes?.[hoje];
  const faltam: string[] = [];

  const bt = labMaisRecente(p, ["bilirrubina total", "bt", "bilirrubina"]);
  const alb = labMaisRecente(p, ["albumina"]);
  const inr = labMaisRecente(p, ["inr", "rni"]);
  if (bt == null) faltam.push("bilirrubina");
  if (alb == null) faltam.push("albumina");
  if (inr == null) faltam.push("INR");

  // Ascite e encefalopatia: derivadas do exame/consciência (default: ausente).
  const textoAbd = normalizar(
    [evo?.abdominal, evo?.estadoGeral, evo?.exameFisico].filter(Boolean).join(" "),
  );
  const asciteGrave = /ascite (volumosa|tensa|de grande|importante|3\+|grau iii)/.test(textoAbd);
  const asciteLeve = !asciteGrave && /ascite/.test(textoAbd);
  const nc = evo?.nivelConsciencia || null;
  const encGrave = nc === "comatoso";
  const encLeve = nc === "torporoso";

  const ptBili = bt == null ? 0 : bt < 2 ? 1 : bt <= 3 ? 2 : 3;
  const ptAlb = alb == null ? 0 : alb > 3.5 ? 1 : alb >= 2.8 ? 2 : 3;
  const ptInr = inr == null ? 0 : inr < 1.7 ? 1 : inr <= 2.3 ? 2 : 3;
  const ptAsc = asciteGrave ? 3 : asciteLeve ? 2 : 1;
  const ptEnc = encGrave ? 3 : encLeve ? 2 : 1;

  const itens: ItemEscore[] = [
    { label: "Bilirrubina total", pontos: ptBili, max: 3, marcado: ptBili > 1, ausente: bt == null },
    { label: "Albumina", pontos: ptAlb, max: 3, marcado: ptAlb > 1, ausente: alb == null },
    { label: "INR", pontos: ptInr, max: 3, marcado: ptInr > 1, ausente: inr == null },
    { label: "Ascite", pontos: ptAsc, max: 3, marcado: ptAsc > 1 },
    { label: "Encefalopatia", pontos: ptEnc, max: 3, marcado: ptEnc > 1 },
  ];

  const calculavel = bt != null && alb != null && inr != null;
  const pontos = itens.reduce((s, i) => s + i.pontos, 0);

  let classe = "A";
  if (pontos >= 10) classe = "C";
  else if (pontos >= 7) classe = "B";
  const classificacao = `Classe ${classe}`;

  return {
    id: "childPugh",
    nome: "Child-Pugh",
    sigla: "Child-Pugh",
    calculavel,
    aplicavel: temHepatopatia(p), // só com diagnóstico hepático
    pontos,
    maxPontos: 15,
    faixa: classe === "A" ? "baixo" : classe === "B" ? "medio" : "alto",
    classificacao,
    fonte: "Pugh et al., 1973",
    itens,
    faltam,
  };
}

// ── CHA₂DS₂-VASc (fibrilação atrial) ────────────────────────────────────────

function calcularChadsvasc(p: Paciente): Escore {
  const faltam: string[] = [];
  const txt = textoComorbidades(p);
  const idade = p.idade ?? null;
  const sexo = p.sexo ?? null;
  if (idade == null) faltam.push("idade");
  if (!sexo) faltam.push("sexo");

  const icc = temComorbidade(txt, ["insuficiencia cardiaca", "icc", "icfer", "icfep", "fração de ejeção"]);
  const has = temComorbidade(txt, ["hipertens", "has", "pressao alta"]);
  const dm = temComorbidade(txt, ["diabetes", "dm2", "dm1", "dm "]);
  const avc = temComorbidade(txt, ["avc", "ave", "ait", "isquemia cerebral", "embolia", "tromboembol"]);
  const vasc = temComorbidade(txt, ["doenca arterial", "dac", "iam", "infarto", "coronar", "doenca arterial periferica", "dap", "aterosclerose"]);

  const ptIdade = idade != null && idade >= 75 ? 2 : idade != null && idade >= 65 ? 1 : 0;
  const ptSexo = sexo === "F" ? 1 : 0;

  const itens: ItemEscore[] = [
    { label: "ICC/disfunção VE", pontos: icc ? 1 : 0, max: 1, marcado: icc },
    { label: "Hipertensão", pontos: has ? 1 : 0, max: 1, marcado: has },
    { label: "Idade ≥ 75 (2) / 65-74 (1)", pontos: ptIdade, max: 2, marcado: ptIdade > 0, ausente: idade == null },
    { label: "Diabetes", pontos: dm ? 1 : 0, max: 1, marcado: dm },
    { label: "AVC/AIT/tromboembolismo", pontos: avc ? 2 : 0, max: 2, marcado: avc },
    { label: "Doença vascular", pontos: vasc ? 1 : 0, max: 1, marcado: vasc },
    { label: "Sexo feminino", pontos: ptSexo, max: 1, marcado: ptSexo > 0, ausente: !sexo },
  ];

  const calculavel = idade != null && !!sexo;
  const pontos = itens.reduce((s, i) => s + i.pontos, 0);

  let classificacao = "Baixo risco tromboembólico";
  if (pontos >= 2) classificacao = "Alto risco tromboembólico";
  else if (pontos === 1) classificacao = "Risco intermediário";

  return {
    id: "chadsvasc",
    nome: "CHA₂DS₂-VASc",
    sigla: "CHA2DS2-VASc",
    calculavel,
    aplicavel: temFibrilacaoAtrial(p), // só com Fibrilação Atrial
    pontos,
    maxPontos: 9,
    faixa: faixaPorTercos(pontos, 1, 2),
    classificacao,
    fonte: "Lip et al., Chest 2010 · ESC",
    itens,
    faltam,
  };
}

/**
 * Calcula todos os escores do paciente para o dia. Retorna a lista completa
 * (com `calculavel` indicando se há dados suficientes). A UI deve exibir apenas
 * os calculáveis.
 */
export function calcularEscores(paciente: Paciente, hoje: string): Escore[] {
  return [
    calcularCurb65(paciente, hoje),
    calcularSofa(paciente, hoje),
    calcularChildPugh(paciente, hoje),
    calcularChadsvasc(paciente),
  ];
}

/** Escores com dados suficientes E aplicáveis ao contexto clínico do paciente. */
export function escoresCalculaveis(paciente: Paciente, hoje: string): Escore[] {
  return calcularEscores(paciente, hoje).filter((e) => e.calculavel && e.aplicavel);
}

/** Cor associada à faixa do escore (verde/amarelo/vermelho). */
export const COR_FAIXA: Record<FaixaEscore, string> = {
  baixo: "#34C759",
  medio: "#FF9500",
  alto: "#FF3B30",
};
