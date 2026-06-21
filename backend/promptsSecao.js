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
    'Formato: {"medicacoesUsoContinuo":[{"nome":"Metformina","dose":"500mg","frequencia":"2x/dia"}],"alergias":["Dipirona"]}. ' +
    REGRA,
  historia:
    "Extraia APENAS a história da doença atual (HDA/HMA), como TEXTO DISSERTATIVO. " +
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
    'Formato: {"medicamentos":[{"nome":"Ceftriaxona","dose":"1g","via":"EV","frequencia":"1x/dia","diaUso":"D5 ou null"}]}. ' +
    REGRA,
  sinaisVitaisIntercorrencias:
    "Extraia APENAS os sinais vitais mais recentes. Use null quando ausente. " +
    "NÃO inclua: exames laboratoriais, laudos de imagem, exame físico por aparelhos, " +
    "medicamentos nem comorbidades. " +
    'Formato: {"data":"DD/MM ou null","hora":"HH:MM ou null","paSist":num,"paDiast":num,"fc":num,"fr":num,"sato2":num,"temp":num,"glasgow":num,"glicemia":num,"peso":num,"diurese":num}. ' +
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
      [m.nome, m.dose, m.frequencia].filter(naoVazio).join(" "),
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
      [m.nome, m.dose, m.frequencia].filter(naoVazio).join(" "),
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
      [m.nome, m.dose, m.via, m.frequencia, m.diaUso].filter(naoVazio).join(" "),
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

module.exports = { PROMPTS, deriveBlocos };
