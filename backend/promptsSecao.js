/**
 * Prompts de extração ESTRUTURADA por seção. A IA retorna JSON com campos
 * mapeados (nunca texto corrido). Para manter a renderização atual do app
 * (que consome `blocos`), `deriveBlocos` converte o estruturado em blocos —
 * assim as seções de exibição funcionam e os campos estruturados ficam
 * disponíveis para mapeamento direto. A ontologia valida/normaliza depois.
 *
 * Chaves = secaoId enviado pelo app.
 */

const REGRA = "Responda SOMENTE com JSON válido (aspas duplas), sem nenhum texto fora do JSON.";

/**
 * Pipeline de labs multi-data (BUGS 10+11). A extração única perdia datas quando
 * a tabela de laboratório tinha várias colunas/datas (importava só a mais
 * recente). Estes dois prompts dividem o trabalho:
 *  - INVENTÁRIO: só lista as datas presentes na tabela de labs.
 *  - POR DATA: extrai os exames de UMA data específica (uma chamada por data).
 */
const PROMPT_INVENTARIO_LABS =
  "Esta é a foto de um prontuário. Olhe APENAS a TABELA de exames laboratoriais " +
  "(sangue/urina/líquor). Liste TODAS as datas de coleta presentes (cabeçalhos de " +
  "coluna ou seções de laboratório), na ordem em que aparecem. Ignore sinais vitais, " +
  "imagem, medicamentos e história. " +
  'Formato: {"tem_labs":true/false,"datas":["DD/MM",...]}. ' +
  "Se a tabela não tiver datas explícitas mas houver labs, retorne " +
  '{"tem_labs":true,"datas":[]}. ' +
  REGRA;

function promptLabsPorData(data) {
  const alvo = data ? `da data ${data}` : "presentes (sem data explícita)";
  return (
    `Extraia APENAS os exames laboratoriais ${alvo} desta imagem. ` +
    "Ignore TODAS as outras datas/colunas e todas as outras seções (sinais vitais, " +
    "imagem, medicamentos, comorbidades, história). " +
    "Reconheça abreviações, inclusive de função hepática: FA = Fosfatase Alcalina " +
    "(NÃO fibrilação atrial), GGT = Gama-GT, BD/BI = bilirrubina direta/indireta, " +
    "BT = bilirrubina total, ALB = albumina, TGO/TGP = transaminases. " +
    `Formato: {"data":"${data || "null"}","exames":[{"nome":"Hb","valor":"13","unidade":"g/dL"}]}. ` +
    "Use unidade null quando não houver. Se não houver exames desta data, retorne " +
    `{"data":"${data || "null"}","exames":[]}. ` +
    REGRA
  );
}

const PROMPTS = {
  // Combinada (legado): mantida para compatibilidade. As novas extrações usam
  // as seções separadas `comorbidades` e `medicacoesUsoContinuo`.
  comorbidadesMedicacoes:
    "Extraia APENAS comorbidades e medicações de uso contínuo deste prontuário. " +
    "Ignore: história atual, exames, sinais vitais, prescrição hospitalar. " +
    'Formato: {"comorbidades":["HAS","DM2"],"medicacoesUsoContinuo":[{"nome":"Metformina","dose":"500mg","frequencia":"2x/dia"}],"alergias":["Dipirona"]}. ' +
    REGRA,
  comorbidades:
    "Extraia APENAS as comorbidades/doenças crônicas de base do paciente. " +
    "Ignore COMPLETAMENTE: medicações (de uso contínuo ou hospitalares), história atual, " +
    "exames, sinais vitais, prescrição. " +
    'Formato: {"comorbidades":["HAS","DM2","DPOC"]}. ' +
    REGRA,
  medicacoesUsoContinuo:
    "Extraia APENAS as medicações de uso contínuo (MUC) que o paciente já usava em casa. " +
    "Ignore COMPLETAMENTE: comorbidades, medicamentos iniciados nesta internação " +
    "(prescrição hospitalar), história atual, exames. " +
    "Quando a dose ou a frequência NÃO constarem no documento, use null — NUNCA escreva " +
    "'não informada', 'não informado' ou texto similar. " +
    'Formato: {"medicacoesUsoContinuo":[{"nome":"Metformina","dose":"500mg ou null","frequencia":"2x/dia ou null"}],"alergias":["Dipirona"]}. ' +
    REGRA,
  historia:
    "Extraia APENAS a história da doença atual (HDA), como TEXTO DISSERTATIVO. " +
    "NÃO inclua: listas de comorbidades, medicações, resultados de exames (labs/imagem), " +
    "condutas/prescrição, sinais vitais nem dados de identificação. " +
    "O campo 'hda' deve ser UM PARÁGRAFO CORRIDO (texto dissertado), NUNCA uma lista " +
    "de tópicos. Aplique apenas correção de gramática, concordância e pontuação, " +
    "preservando o conteúdo. " +
    'Formato: {"hda":"texto corrido em parágrafo único","motivoInternacao":"diagnóstico de entrada ou null","sintomaPrincipal":"sintoma principal ou null"}. ' +
    REGRA,
  examesLaboratoriais:
    "Extraia APENAS os valores de exames laboratoriais (sangue/urina/líquor). Use null quando ausente. " +
    "NÃO inclua: sinais vitais (PA, FC, FR, SatO2, Tax), laudos de exames de imagem, " +
    "medicamentos, comorbidades nem história. " +
    'Formato: {"hb":num,"ht":num,"lt":num,"plaq":num,"pcr":num,"na":num,"k":num,"cr":num,"ureia":num,"glicemia":num,"tgo":num,"tgp":num,"bt":num,"inr":num,"hba1c":num,"albumina":num,"data":"DD/MM ou null","outros":[{"nome":"Lactato","valor":"2,1 mmol/L"}]}. ' +
    REGRA,
  imagem:
    "Extraia APENAS laudos de exames de IMAGEM (RX, TC, RM, USG, ECO, Doppler, etc.). " +
    "NÃO inclua: valores de exames laboratoriais, sinais vitais, medicamentos, " +
    "comorbidades, texto clínico nem identificação. " +
    'Formato: {"exames":[{"nome":"TC de Crânio","data":"DD/MM/AAAA ou null","laudo":"texto resumido do laudo"}]}. ' +
    REGRA,
  prescricaoHospitalar:
    "Extraia APENAS medicamentos da prescrição hospitalar ATUAL (em uso nesta internação). " +
    "NÃO inclua, de forma alguma: comorbidades, diagnósticos ou hipóteses diagnósticas " +
    "(ex.: 'DRC dialítico', 'HAS', 'DM'), medicações de uso contínuo de casa, história, " +
    "exames laboratoriais/imagem nem sinais vitais. " +
    "Se a imagem só tiver diagnósticos/comorbidades e NENHUM medicamento prescrito, " +
    'retorne {"medicamentos":[]}. ' +
    "Quando dose, via, frequência ou dia de uso NÃO constarem, use null — NUNCA escreva " +
    "'não informada' ou texto similar. " +
    'Formato: {"medicamentos":[{"nome":"Ceftriaxona","dose":"1g ou null","via":"EV ou null","frequencia":"1x/dia ou null","diaUso":"D5 ou null"}]}. ' +
    REGRA,
  sinaisVitaisIntercorrencias:
    "Extraia APENAS os sinais vitais mais recentes. Use null quando ausente. " +
    "NÃO inclua: exames laboratoriais, laudos de imagem, exame físico por aparelhos, " +
    "Glasgow/orientação (ficam no exame neurológico), medicamentos nem comorbidades. " +
    'Formato: {"data":"DD/MM ou null","hora":"HH:MM ou null","paSist":num,"paDiast":num,"fc":num,"fr":num,"sato2":num,"temp":num,"glicemia":num,"peso":num,"diurese":num}. ' +
    REGRA,
};

const LAB_LABELS = {
  hb: "Hb", ht: "Ht", lt: "LT", plaq: "Plaq", pcr: "PCR", na: "Na", k: "K",
  cr: "Cr", ureia: "Ureia", glicemia: "Glicemia", tgo: "TGO", tgp: "TGP",
  bt: "BT", inr: "INR", hba1c: "HbA1c", albumina: "Albumina",
};

function naoVazio(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

// Placeholders que a IA às vezes devolve para campos ausentes (ex.: dose) — não
// devem ser concatenados ("Losartana não informada não informada").
const RE_PLACEHOLDER = /^(n[ãa]o\s*informad[oa]?|sem\s*informa\w*|nenhum[oa]?|n\/?a|null|undefined|[-—.]+|\?+)$/i;
function campoValido(v) {
  return naoVazio(v) && !RE_PLACEHOLDER.test(String(v).trim());
}

/** Limpa data malformada da IA: "31/05/null" → "31/05"; sem dia/mês → "". */
function limparData(v) {
  let t = String(v ?? "").trim();
  if (!t || /^(null|undefined)$/i.test(t)) return "";
  t = t.replace(/\b(\d{1,2}\/\d{1,2})\/(?:null|undefined)\b/gi, "$1");
  t = t.replace(/\b(?:null|undefined)\/(?:null|undefined)\/(\d{2,4})\b/gi, "$1");
  if (/(null|undefined)/i.test(t) && !/\d/.test(t.replace(/null|undefined/gi, ""))) return "";
  return t.replace(/\b(?:null|undefined)\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** Converte o JSON estruturado em blocos (compatibilidade com a UI atual). */
function deriveBlocos(secao, d) {
  if (!d || typeof d !== "object") return [];
  if (Array.isArray(d.blocos)) return d.blocos;
  const bloco = (titulo, itens) =>
    itens && itens.length ? [{ titulo, itens }] : [];

  if (secao === "comorbidadesMedicacoes") {
    const meds = (d.medicacoesUsoContinuo || []).map((m) =>
      [m.nome, m.dose, m.frequencia].filter(campoValido).join(" "),
    );
    return [
      ...bloco("Comorbidades", (d.comorbidades || []).filter(naoVazio)),
      ...bloco("Medicações de uso contínuo", meds.filter(naoVazio)),
      ...bloco("Alergias", (d.alergias || []).filter(naoVazio)),
    ];
  }
  if (secao === "comorbidades") {
    return bloco("Comorbidades", (d.comorbidades || []).filter(naoVazio));
  }
  if (secao === "medicacoesUsoContinuo") {
    const meds = (d.medicacoesUsoContinuo || []).map((m) =>
      [m.nome, m.dose, m.frequencia].filter(campoValido).join(" "),
    );
    return [
      ...bloco("Medicações de uso contínuo", meds.filter(naoVazio)),
      ...bloco("Alergias", (d.alergias || []).filter(naoVazio)),
    ];
  }
  if (secao === "historia") {
    // HDA em prosa: um único item com o parágrafo (sem prefixos/tópicos).
    const hda = naoVazio(d.hda)
      ? String(d.hda)
      : naoVazio(d.motivoInternacao)
        ? String(d.motivoInternacao)
        : "";
    return bloco("História da doença atual", hda ? [hda] : []);
  }
  if (secao === "examesLaboratoriais") {
    const itens = [];
    for (const [k, label] of Object.entries(LAB_LABELS)) {
      if (naoVazio(d[k])) itens.push(`${label} ${d[k]}`);
    }
    for (const o of d.outros || []) {
      if (naoVazio(o.nome) && naoVazio(o.valor)) itens.push(`${o.nome} ${o.valor}`);
    }
    return bloco("Exames laboratoriais", itens);
  }
  if (secao === "imagem") {
    return (d.exames || [])
      .filter((e) => naoVazio(e.nome) || naoVazio(e.laudo))
      .map((e) => {
        const data = limparData(e.data);
        return {
          titulo: [e.nome, data ? `(${data})` : ""].filter(Boolean).join(" "),
          itens: naoVazio(e.laudo) ? [e.laudo] : [],
        };
      });
  }
  if (secao === "prescricaoHospitalar") {
    const itens = (d.medicamentos || []).map((m) =>
      [m.nome, m.dose, m.via, m.frequencia, m.diaUso].filter(campoValido).join(" "),
    );
    return bloco("Prescrição hospitalar", itens.filter(naoVazio));
  }
  if (secao === "sinaisVitaisIntercorrencias") {
    const itens = [];
    if (naoVazio(d.paSist) && naoVazio(d.paDiast)) itens.push(`PA ${d.paSist}/${d.paDiast}`);
    if (naoVazio(d.fc)) itens.push(`FC ${d.fc}`);
    if (naoVazio(d.fr)) itens.push(`FR ${d.fr}`);
    if (naoVazio(d.sato2)) itens.push(`SatO2 ${d.sato2}`);
    if (naoVazio(d.temp)) itens.push(`Tax ${d.temp}`);
    if (naoVazio(d.glasgow)) itens.push(`Glasgow ${d.glasgow}`);
    if (naoVazio(d.glicemia)) itens.push(`HGT ${d.glicemia}`);
    if (naoVazio(d.diurese)) itens.push(`Diurese ${d.diurese}`);
    return bloco("Sinais vitais", itens);
  }
  return [];
}

module.exports = {
  PROMPTS,
  deriveBlocos,
  PROMPT_INVENTARIO_LABS,
  promptLabsPorData,
};
