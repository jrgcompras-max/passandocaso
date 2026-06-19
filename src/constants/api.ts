/**
 * Configuração de acesso ao backend. O app SEMPRE aponta para o backend de
 * produção — nunca para um servidor local (localhost, IP da LAN ou túnel
 * exp.direct). Toda chamada à Anthropic passa pelo backend — o app não tem chave.
 *
 * Domínio principal: https://api.passandocaso.com.br
 * (equivalente ao host do Railway: https://passandocaso-production.up.railway.app)
 */
export const API_URL = "https://api.passandocaso.com.br";
