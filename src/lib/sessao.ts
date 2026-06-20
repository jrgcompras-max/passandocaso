import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_URL } from "@/constants/api";

/**
 * Sessão de autenticação. O token JWT fica em memória (acesso síncrono pelas
 * libs de rede) e é persistido no AsyncStorage para sobreviver a reinícios.
 */

const TOKEN_KEY = "@passandocaso/token";

let tokenEmMemoria: string | null = null;

/** Define (ou limpa) o token de sessão em memória e no AsyncStorage. */
export async function definirToken(token: string | null): Promise<void> {
  tokenEmMemoria = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Recupera o token persistido para a memória (chamado no boot). */
export async function carregarToken(): Promise<string | null> {
  tokenEmMemoria = await AsyncStorage.getItem(TOKEN_KEY);
  return tokenEmMemoria;
}

export function getToken(): string | null {
  return tokenEmMemoria;
}

/** Erro de autenticação (HTTP 401) — sinaliza sessão ausente/inválida/expirada. */
export class ErroAutenticacao extends Error {}

/**
 * fetch central: prefixa API_URL, injeta o header Authorization com o token de
 * sessão e normaliza o Content-Type para JSON quando há corpo. Lança
 * ErroAutenticacao em 401 para o chamador derrubar a sessão.
 */
export async function apiFetch(
  rota: string,
  opcoes: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(opcoes.headers || {});
  if (opcoes.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (tokenEmMemoria) headers.set("Authorization", `Bearer ${tokenEmMemoria}`);

  const resp = await fetch(`${API_URL}${rota}`, { ...opcoes, headers });
  // Só é "sessão expirada" quando havia token (requisição autenticada). No login/
  // cadastro não há token: deixa o 401 passar para o chamador mostrar o erro real
  // (ex.: "E-mail ou senha incorretos.").
  if (resp.status === 401 && tokenEmMemoria) {
    throw new ErroAutenticacao("Sessão expirada.");
  }
  return resp;
}
