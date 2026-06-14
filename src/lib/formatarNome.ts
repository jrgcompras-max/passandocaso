/**
 * Abrevia o nome do paciente para exibição: mantém o primeiro nome por extenso
 * e reduz os demais às suas iniciais maiúsculas seguidas de ponto.
 *
 * "Maria Goretti Brasil Ribeiro" → "Maria G. B. R."
 * "João Carlos Mendes"          → "João C. M."
 *
 * Apenas para exibição — o nome completo continua armazenado e é usado na
 * geração do texto de passagem de caso.
 */
export function formatarNome(nomeCompleto: string): string {
  const partes = (nomeCompleto ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];

  const [primeiro, ...resto] = partes;
  const iniciais = resto.map((p) => `${p[0].toUpperCase()}.`).join(" ");
  return `${primeiro} ${iniciais}`;
}
