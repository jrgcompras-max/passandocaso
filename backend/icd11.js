/**
 * Integração com a API CID-11 (ICD-11) da OMS.
 *
 * Autenticação OAuth2 client_credentials (Basic Auth com clientId:clientSecret).
 * O token (~1h) fica em memória e é renovado automaticamente quando expira.
 *
 * As credenciais vêm do Railway com os nomes ClientId / ClientSecret
 * (process.env.ClientId / process.env.ClientSecret).
 *
 * Posicionamento regulatório: a OMS é a fonte oficial da CID-11. O backend só
 * consulta e faz cache local (termos_clinicos) — nunca inventa códigos.
 */

const TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token";
const SEARCH_URL = "https://id.who.int/icd/release/11/2024-01/mms/search";

// Token em memória com controle de expiração.
let tokenCache = null; // { valor, expiraEm }

function temCredenciais() {
  return !!(process.env.ClientId && process.env.ClientSecret);
}

/** Obtém (ou renova) o token OAuth2. Cacheado até ~1 min antes de expirar. */
async function obterToken() {
  if (tokenCache && Date.now() < tokenCache.expiraEm - 60_000) {
    return tokenCache.valor;
  }
  if (!temCredenciais()) {
    throw new Error("Credenciais CID-11 ausentes (ClientId/ClientSecret).");
  }
  const basic = Buffer.from(
    `${process.env.ClientId}:${process.env.ClientSecret}`,
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "icdapi_access",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Token CID-11 HTTP ${r.status}`);
  const j = await r.json();
  tokenCache = {
    valor: j.access_token,
    expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
  return tokenCache.valor;
}

/** Remove as marcações <em>/<b> que a busca da OMS coloca no título. */
function limparHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca um diagnóstico na CID-11 (MMS, release 2024-01) em português.
 * Retorna { cid11, titulo, descricao } do melhor resultado, ou null.
 */
async function buscarCid11(termo) {
  const token = await obterToken();
  const url = `${SEARCH_URL}?q=${encodeURIComponent(String(termo || "").trim())}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "API-Version": "v2",
      "Accept-Language": "pt",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Busca CID-11 HTTP ${r.status}`);
  const j = await r.json();
  const ent = (j.destinationEntities || [])[0];
  if (!ent) return null;
  return {
    cid11: ent.theCode || null,
    titulo: limparHtml(ent.title),
    // A busca não devolve definição; mantém vazio (pode ser enriquecido depois).
    descricao: limparHtml(ent.descricao || ""),
    id: ent.id || null,
  };
}

module.exports = { obterToken, buscarCid11, temCredenciais };
