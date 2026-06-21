import { type Paciente } from "@/types/paciente";

import { apiFetch } from "./sessao";

/**
 * Cliente da API da rede clínica (Fase 2). Todas as chamadas usam apiFetch, que
 * injeta o JWT automaticamente. Lançam Error com a mensagem do backend em falha.
 */

export type ProfissionalRede = {
  id: string;
  nome_exibicao: string;
  categoria: string;
  especialidade: string | null;
  foto_url: string | null;
};
export type Conexao = ProfissionalRede & { conexaoId: number };
export type Solicitacao = { id: number; criado_em: string; de: ProfissionalRede };
export type GrupoClinico = {
  id: number;
  nome: string;
  descricao?: string | null;
  hospital_cnes?: string | null;
  hospital_nome?: string | null;
  especialidade?: string | null;
  codigo: string;
  membros?: number;
};
export type ResumoPaciente = {
  id: string;
  nome: string;
  diagnostico: string;
  pendencias: number;
  conduta: string;
};
export type PassagemRecebida = {
  id: number;
  de: string;
  foto_url: string | null;
  hospital: string | null;
  mensagem: string | null;
  resumo: ResumoPaciente[];
  criado_em: string;
  expira_em: string;
};

async function req<T>(rota: string, opts?: RequestInit): Promise<T> {
  const r = await apiFetch(rota, opts);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((dados as any)?.erro || `Erro ${r.status}`);
  return dados as T;
}
const post = (rota: string, body: unknown) =>
  req(rota, { method: "POST", body: JSON.stringify(body) });
const put = (rota: string, body?: unknown) =>
  req(rota, { method: "PUT", body: body ? JSON.stringify(body) : undefined });

// ---- Perfil ----
export function atualizarPerfil(dados: Record<string, unknown>) {
  return req<{ usuario: ProfissionalRede }>("/api/perfil/atualizar", {
    method: "PUT",
    body: JSON.stringify(dados),
  });
}
/** Atualiza as funcionalidades clínicas (toggles); retorna o usuário completo. */
export function atualizarFeatures(features: Record<string, boolean>) {
  return req<{ usuario: Record<string, unknown> }>("/api/perfil/features", {
    method: "PUT",
    body: JSON.stringify({ features_ativas: features }),
  });
}
export function definirEspecialidade(especialidade: string, hospitalCnes?: string) {
  return put("/api/perfil/especialidade", {
    especialidade,
    hospital_cnes: hospitalCnes,
  });
}
export function salvarPushToken(token: string) {
  return put("/api/perfil/push-token", { token });
}

// ---- Busca / conexões ----
export async function buscarProfissionais(
  nome: string,
  hospitalCnes?: string,
  hospitalNome?: string,
): Promise<ProfissionalRede[]> {
  const q = new URLSearchParams({ nome });
  if (hospitalCnes) q.set("hospital_cnes", hospitalCnes);
  if (hospitalNome) q.set("hospital_nome", hospitalNome);
  const r = await req<{ profissionais: ProfissionalRede[] }>(
    `/api/rede/buscar?${q.toString()}`,
  );
  return r.profissionais || [];
}
export function solicitarConexao(destinatarioId: string) {
  return post("/api/rede/conectar", { destinatario_id: destinatarioId });
}
export function convidarPorEmail(email: string, hospitalCnes?: string, hospitalNome?: string) {
  return post("/api/rede/convidar-email", {
    email,
    hospital_cnes: hospitalCnes,
    hospital_nome: hospitalNome,
  });
}
export async function listarConexoes(): Promise<Conexao[]> {
  const r = await req<{ conexoes: Conexao[] }>("/api/rede/conexoes");
  return r.conexoes || [];
}
export async function listarSolicitacoes(): Promise<Solicitacao[]> {
  const r = await req<{ solicitacoes: Solicitacao[] }>("/api/rede/solicitacoes");
  return r.solicitacoes || [];
}
export function responderSolicitacao(id: number, acao: "aceitar" | "recusar") {
  return put(`/api/rede/solicitacoes/${id}`, { acao });
}
export function removerConexao(id: number) {
  return req(`/api/rede/conexoes/${id}`, { method: "DELETE" });
}

// ---- Grupos ----
export function criarGrupo(dados: {
  nome: string;
  hospital_cnes?: string;
  hospital_nome?: string;
  especialidade?: string;
  descricao?: string;
}) {
  return post("/api/rede/grupos", dados);
}
export async function listarGrupos(): Promise<GrupoClinico[]> {
  const r = await req<{ grupos: GrupoClinico[] }>("/api/rede/grupos");
  return r.grupos || [];
}
export function detalhesGrupo(id: number) {
  return req<{ grupo: GrupoClinico; membros: ProfissionalRede[] }>(
    `/api/rede/grupos/${id}`,
  );
}
export function entrarGrupo(codigo: string) {
  return post("/api/rede/grupos/entrar", { codigo });
}
export function sairGrupo(id: number) {
  return req(`/api/rede/grupos/${id}/sair`, { method: "DELETE" });
}

// ---- Passagem de plantão ----
export function criarPassagem(dados: {
  destinatario_id?: string;
  grupo_id?: number;
  pacientes: unknown[];
  mensagem?: string;
  hospital_cnes?: string;
  hospital_nome?: string;
}) {
  return post("/api/rede/passagem", dados);
}
export async function listarPassagensRecebidas(): Promise<PassagemRecebida[]> {
  const r = await req<{ passagens: PassagemRecebida[] }>(
    "/api/rede/passagem/recebidas",
  );
  return r.passagens || [];
}
export function listarPassagensEnviadas() {
  return req<{ passagens: unknown[] }>("/api/rede/passagem/enviadas");
}
export type AceitarPassagemResposta = {
  ok: boolean;
  pacientes_importados: number;
  hospitalId: string;
  pacientes: Paciente[];
};
/** Aceita a passagem; os pacientes vão para o hospital ativo informado. */
export function aceitarPassagem(id: number, hospitalId?: string) {
  return put(
    `/api/rede/passagem/${id}/aceitar`,
    hospitalId ? { hospitalId } : undefined,
  ) as Promise<AceitarPassagemResposta>;
}
export function recusarPassagem(id: number) {
  return put(`/api/rede/passagem/${id}/recusar`);
}
