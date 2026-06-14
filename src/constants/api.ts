/**
 * Configuração de acesso ao backend. A URL vem de EXPO_PUBLIC_API_URL
 * (ex.: http://192.168.0.10:3000 para testar no device, ou a URL pública em
 * produção). Toda chamada à Anthropic passa pelo backend — o app não tem chave.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.passandocaso.com.br";

/**
 * Identificador do médico. Fixo e temporário até existir autenticação real.
 * TODO: substituir pelo id do médico logado.
 */
export const MEDICO_ID = "medico-001";
