/**
 * MÓDULO DE ALERTAS DE TENDÊNCIA LABORATORIAL (backend)
 *
 * Espelha a lógica de src/lib/alertasTendencia.ts. A análise roda no servidor
 * para não sobrecarregar o app. Conformidade ANVISA: alertas DESCRITIVOS,
 * nunca sugerem conduta. Ao alterar parâmetros/algoritmo, replique no app.
 */

const LABS_MONITORADOS = {
  creatinina: {
    label: "Cr", nome: "Creatinina", direcaoAlerta: "subida",
    variacaoSignificativa: 0.2, diasMinimos: 2, matcher: /creat|^cr\b/i,
  },
  pcr: {
    label: "PCR", nome: "PCR", direcaoAlerta: "subida",
    variacaoSignificativa: 20, diasMinimos: 2,
    matcher: /\bpcr\b|prote[ií]na c reativa/i,
  },
  leucocitos: {
    label: "LT", nome: "Leucócitos", direcaoAlerta: "subida",
    variacaoSignificativa: 2000, diasMinimos: 2,
    matcher: /leuc|^lt\b|gl[oó]bulos brancos/i,
  },
  hemoglobina: {
    label: "Hb", nome: "Hemoglobina", direcaoAlerta: "descida",
    variacaoSignificativa: 1.0, diasMinimos: 2, matcher: /hemoglob|^hb\b/i,
  },
  plaquetas: {
    label: "Plaq", nome: "Plaquetas", direcaoAlerta: "descida",
    variacaoSignificativa: 50000, diasMinimos: 2, matcher: /plaq|^plt\b/i,
  },
  sodio: {
    label: "Na", nome: "Sódio", direcaoAlerta: "ambos",
    variacaoSignificativa: 5, diasMinimos: 2, matcher: /s[oó]dio|^na\+?\b/i,
  },
  potassio: {
    label: "K", nome: "Potássio", direcaoAlerta: "ambos",
    variacaoSignificativa: 0.5, diasMinimos: 2, matcher: /pot[aá]ssio|^k\+?\b/i,
  },
};

function num(v) {
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function unidade(v) {
  const m = String(v).match(/[\d.,]+\s*([a-zµμ/%]+(?:\/[a-zµμ³]+)?)/i);
  return m ? m[1] : undefined;
}

function serieDoLab(registros, p) {
  const pontos = [];
  for (const reg of registros) {
    const labs = reg.exames_laboratoriais;
    if (!labs) continue;
    const chave = Object.keys(labs).find((k) => p.matcher.test(String(k).trim()));
    if (!chave) continue;
    const n = num(labs[chave]);
    if (n == null) continue;
    pontos.push({ valor: n, texto: labs[chave] });
  }
  return pontos;
}

function trechoFinal(valores, dir) {
  const n = valores.length;
  if (n < 2) return null;
  const ultimoPasso = valores[n - 1] - valores[n - 2];
  if (ultimoPasso === 0) return null;
  const direcao = ultimoPasso > 0 ? "subida" : "descida";
  if (dir !== "ambos" && dir !== direcao) return null;
  let i = n - 1;
  while (i - 1 >= 0) {
    const passo = valores[i] - valores[i - 1];
    const segue = direcao === "subida" ? passo > 0 : passo < 0;
    if (!segue) break;
    i--;
  }
  return { direcao, inicio: i };
}

/** Recebe registros de evolucoes_diarias e devolve os alertas detectados. */
function analisarTendencias(registros) {
  const ordenados = [...registros].sort((a, b) =>
    String(a.data).localeCompare(String(b.data)),
  );
  const alertas = [];

  for (const [lab, p] of Object.entries(LABS_MONITORADOS)) {
    const pontos = serieDoLab(ordenados, p);
    if (pontos.length < p.diasMinimos) continue;

    const valores = pontos.map((x) => x.valor);
    const trecho = trechoFinal(valores, p.direcaoAlerta);
    if (!trecho) continue;

    const run = valores.slice(trecho.inicio);
    if (run.length < p.diasMinimos) continue;

    const variacao = Math.abs(run[run.length - 1] - run[0]);
    if (variacao < p.variacaoSignificativa) continue;

    alertas.push({
      lab,
      label: p.label,
      nome: p.nome,
      tendencia: trecho.direcao,
      diasConsecutivos: run.length,
      valorAtual: run[run.length - 1],
      valorAnterior: run[run.length - 2],
      variacao: Math.round(variacao * 1000) / 1000,
      severidade: run.length >= 3 ? "alerta" : "atencao",
      valores: run,
      unidade: unidade(pontos[pontos.length - 1].texto),
    });
  }

  return alertas.sort((a, b) =>
    a.severidade === b.severidade
      ? b.diasConsecutivos - a.diasConsecutivos
      : a.severidade === "alerta" ? -1 : 1,
  );
}

module.exports = { analisarTendencias };
