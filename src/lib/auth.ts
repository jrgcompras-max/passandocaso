import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  apiFetch,
  carregarToken,
  definirToken,
  ErroAutenticacao,
} from "./sessao";

/** Projeção pública do usuário devolvida pelo backend. */
export type Usuario = {
  id: string;
  nome: string;
  email: string;
  plano: string;
  isAdmin: boolean;
  trialFim: string | null;
  diasRestantes: number | null;
  expirado: boolean;
  // Perfil profissional (Fase 2)
  categoria?: string;
  especialidade?: string | null;
  subespecialidade?: string | null;
  crm?: string | null;
  foto_url?: string | null;
  ano_residencia?: number | null;
  instituicao_formacao?: string | null;
  nome_exibicao?: string | null;
  especialidade_definida?: boolean;
  onboarding_completo?: boolean;
  /** Funcionalidades clínicas opcionais (toggles). Ex.: { escores: false }. */
  features_ativas?: Record<string, boolean> | null;
};

const USUARIO_KEY = "@passandocaso/usuario";

/** Extrai a mensagem de erro do corpo JSON da resposta (com fallback). */
async function lerErro(resp: Response): Promise<string> {
  try {
    const j = await resp.json();
    return j?.erro || `Erro ${resp.status}`;
  } catch {
    return `Erro ${resp.status}`;
  }
}

async function persistirSessao(token: string, usuario: Usuario): Promise<Usuario> {
  await definirToken(token);
  await AsyncStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
  return usuario;
}

export async function cadastrar(
  nome: string,
  email: string,
  senha: string,
  categoria?: string,
): Promise<Usuario> {
  const resp = await apiFetch("/api/auth/cadastro", {
    method: "POST",
    body: JSON.stringify({ nome, email, senha, categoria }),
  });
  if (!resp.ok) throw new Error(await lerErro(resp));
  const { token, usuario } = await resp.json();
  return persistirSessao(token, usuario);
}

/** Mescla campos no usuário em cache (após editar o perfil) e persiste. */
export async function mesclarUsuarioLocal(parcial: Partial<Usuario>): Promise<Usuario | null> {
  const raw = await AsyncStorage.getItem(USUARIO_KEY);
  if (!raw) return null;
  const atual = JSON.parse(raw) as Usuario;
  const novo = { ...atual, ...parcial };
  await AsyncStorage.setItem(USUARIO_KEY, JSON.stringify(novo));
  return novo;
}

export async function entrar(email: string, senha: string): Promise<Usuario> {
  const resp = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, senha }),
  });
  if (!resp.ok) throw new Error(await lerErro(resp));
  const { token, usuario } = await resp.json();
  return persistirSessao(token, usuario);
}

export async function recuperarSenha(email: string): Promise<void> {
  const resp = await apiFetch("/api/auth/recuperar", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) throw new Error(await lerErro(resp));
}

export async function sair(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // logout é stateless no servidor — ignora falha de rede.
  }
  await definirToken(null);
  await AsyncStorage.removeItem(USUARIO_KEY);
}

/**
 * Carrega a sessão salva no boot: lê o token persistido e revalida com /me.
 * Em 401, derruba a sessão. Offline (ou erro de servidor), usa o usuário em cache.
 */
export async function carregarSessao(): Promise<Usuario | null> {
  const token = await carregarToken();
  if (!token) return null;

  const cacheRaw = await AsyncStorage.getItem(USUARIO_KEY);
  const cache = cacheRaw ? (JSON.parse(cacheRaw) as Usuario) : null;

  try {
    const resp = await apiFetch("/api/auth/me");
    if (resp.ok) {
      const { usuario } = await resp.json();
      await AsyncStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
      return usuario as Usuario;
    }
    return cache; // erro de servidor: mantém cache
  } catch (e) {
    if (e instanceof ErroAutenticacao) {
      await sair();
      return null;
    }
    return cache; // offline: usa cache
  }
}
