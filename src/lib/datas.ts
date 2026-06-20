/** Data de hoje em formato YYYY-MM-DD (local). */
export function hojeISO(): string {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * Formata uma data para o padrão brasileiro DD/MM/YYYY. Aceita ISO
 * (YYYY-MM-DD) e devolve no formato BR; qualquer outro texto é repassado
 * sem alteração (ex.: já em BR ou formato não reconhecido).
 */
export function formatarDataBR(texto: string): string {
  const t = (texto ?? "").trim();
  if (!t) return "";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : t;
}

/**
 * Limpa datas malformadas dentro de um texto (ex.: títulos de exame). Remove
 * partes "null"/"undefined": "31/05/null" → "31/05"; uma data totalmente vazia
 * ("(null/null/null)") é removida junto com os parênteses. Idempotente.
 */
export function limparDataEmTexto(texto: string): string {
  let t = texto ?? "";
  // dd/mm/null → dd/mm  (ano ausente)
  t = t.replace(/\b(\d{1,2}\/\d{1,2})\/(?:null|undefined)\b/gi, "$1");
  // null/null/aaaa → aaaa  (dia/mês ausentes)
  t = t.replace(/\b(?:null|undefined)\/(?:null|undefined)\/(\d{2,4})\b/gi, "$1");
  // qualquer "null"/"undefined" remanescente em contexto de data
  t = t.replace(/\b(?:null|undefined)\b/gi, "");
  // parênteses que ficaram vazios ou só com barras/espaços
  t = t.replace(/\(\s*[/\s]*\)/g, "");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * Tenta interpretar a data de entrada extraída pela IA (texto livre, formato
 * incerto) como um Date no meio-dia local. Aceita ISO (YYYY-MM-DD) e BR
 * (DD/MM/YYYY), com hora opcional ignorada. Retorna null se não reconhecer.
 *
 * Usa meio-dia para evitar que fuso horário empurre a data para o dia anterior.
 */
function parseDataEntrada(texto: string): Date | null {
  const t = texto.trim();
  if (!t) return null;

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
  }

  const br = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const ano = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    return new Date(ano, Number(br[2]) - 1, Number(br[1]), 12);
  }

  return null;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Dia de internação a partir da data de entrada: o próprio dia da entrada é o
 * "Dia 1". Recalcula sempre que chamada, então abre no dia seguinte e já mostra
 * o número certo. Retorna null se a data não for reconhecida.
 */
export function diaDeInternacao(dataEntrada: string): number | null {
  const entrada = parseDataEntrada(dataEntrada);
  if (!entrada) return null;

  const agora = new Date();
  const hoje = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    12,
  );
  const entradaMeioDia = new Date(
    entrada.getFullYear(),
    entrada.getMonth(),
    entrada.getDate(),
    12,
  );

  const dias = Math.round((hoje.getTime() - entradaMeioDia.getTime()) / UM_DIA_MS);
  return Math.max(1, dias + 1);
}
