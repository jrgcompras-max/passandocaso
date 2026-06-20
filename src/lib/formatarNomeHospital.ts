/**
 * Formata o nome de um hospital para exibição. Os nomes vêm do CNES/DATASUS em
 * CAIXA ALTA ("HOSPITAL NOSSA SENHORA DA CONCEICAO"), o que destoa do layout.
 * Convertemos para Title Case com preposições/artigos em minúsculas
 * ("Hospital Nossa Senhora da Conceicao"), mais elegante e dentro da UX.
 *
 * O nome ORIGINAL continua armazenado no backend (serve de alias para casamento
 * por nome, CNES e usos futuros na API) — a formatação é só de apresentação.
 *
 * Não reintroduz acentos perdidos (ex.: "CONCEICAO" não vira "Conceição"): isso
 * exigiria um dicionário e seria frágil; o Title Case já resolve a estética.
 */
const MINUSCULAS = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os",
  "em", "no", "na", "nos", "nas", "à", "ao",
]);

export function formatarNomeHospital(nome: string | undefined | null): string {
  const t = (nome || "").trim();
  if (!t) return "";

  // Só reformata se vier predominantemente em CAIXA ALTA — preserva nomes que o
  // usuário já digitou bem (mistos), como "Hospital Nossa Sra. Conceição".
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const ehCaixaAlta = letras.length > 0 && letras === letras.toUpperCase();
  if (!ehCaixaAlta) return t;

  return t
    .toLowerCase()
    .split(/\s+/)
    .map((palavra, i) => {
      if (i > 0 && MINUSCULAS.has(palavra)) return palavra;
      return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    })
    .join(" ");
}
