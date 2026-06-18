import { API_URL, MEDICO_ID } from "@/constants/api";
import { type Paciente } from "@/types/paciente";

/**
 * Sincronização dos pacientes com o backend (PostgreSQL). O AsyncStorage segue
 * como cache local (offline-first); estas funções são best-effort — falham em
 * silêncio quando não há rede, sem bloquear o app.
 */

/** Busca todos os pacientes do médico no backend. Lança em falha. */
export async function buscarPacientes(): Promise<Paciente[]> {
  const resp = await fetch(
    `${API_URL}/api/pacientes/${encodeURIComponent(MEDICO_ID)}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return Array.isArray(json?.pacientes) ? (json.pacientes as Paciente[]) : [];
}

/** Envia (upsert) a lista completa de pacientes para o backend. */
export async function enviarPacientes(pacientes: Paciente[]): Promise<void> {
  await fetch(`${API_URL}/api/pacientes/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ medicoId: MEDICO_ID, pacientes }),
  });
}

/** Remove um paciente (escopado por hospital) no backend. */
export async function removerPacienteRemoto(
  pacienteId: string,
  hospitalId: string,
): Promise<void> {
  await fetch(
    `${API_URL}/api/pacientes/${encodeURIComponent(MEDICO_ID)}/${encodeURIComponent(hospitalId)}/${encodeURIComponent(pacienteId)}`,
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
