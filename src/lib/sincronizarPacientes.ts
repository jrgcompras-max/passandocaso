import { type Paciente } from "@/types/paciente";

import { apiFetch } from "./sessao";

/**
 * Sincronização dos pacientes com o backend (PostgreSQL). O AsyncStorage segue
 * como cache local (offline-first); estas funções são best-effort — falham em
 * silêncio quando não há rede, sem bloquear o app. O escopo (médico) vem do
 * token de sessão no backend, não mais de um id no path/body.
 */

/** Busca todos os pacientes do usuário no backend. Lança em falha. */
export async function buscarPacientes(): Promise<Paciente[]> {
  const resp = await apiFetch("/api/pacientes");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return Array.isArray(json?.pacientes) ? (json.pacientes as Paciente[]) : [];
}

/** Envia (upsert) a lista completa de pacientes para o backend. */
export async function enviarPacientes(pacientes: Paciente[]): Promise<void> {
  await apiFetch("/api/pacientes/sync", {
    method: "POST",
    body: JSON.stringify({ pacientes }),
  });
}

/** Remove um paciente (escopado por hospital) no backend. */
export async function removerPacienteRemoto(
  pacienteId: string,
  hospitalId: string,
): Promise<void> {
  await apiFetch(
    `/api/pacientes/${encodeURIComponent(hospitalId)}/${encodeURIComponent(pacienteId)}`,
    { method: "DELETE" },
  );
}

/**
 * Mescla a lista local com a remota por id. O local tem prioridade (é o
 * dispositivo ativo que edita); pacientes que só existem no remoto (ex.: outro
 * aparelho) são adicionados.
 */
export function mesclarPacientes(
  local: Paciente[],
  remoto: Paciente[],
): Paciente[] {
  const porId = new Map<string, Paciente>();
  for (const p of remoto) porId.set(p.id, p);
  for (const p of local) porId.set(p.id, p); // local sobrescreve
  return Array.from(porId.values());
}
