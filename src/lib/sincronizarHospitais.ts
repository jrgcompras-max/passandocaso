import { API_URL, MEDICO_ID } from "@/constants/api";
import { type Hospital } from "@/types/paciente";

/** Sincronização dos hospitais com o backend (best-effort, offline-first). */

export async function buscarHospitais(): Promise<Hospital[]> {
  const resp = await fetch(
    `${API_URL}/api/hospitais/${encodeURIComponent(MEDICO_ID)}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return Array.isArray(json?.hospitais) ? (json.hospitais as Hospital[]) : [];
}

export async function enviarHospitais(hospitais: Hospital[]): Promise<void> {
  await fetch(`${API_URL}/api/hospitais/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ medicoId: MEDICO_ID, hospitais }),
  });
}

export async function removerHospitalRemoto(id: string): Promise<void> {
  await fetch(
    `${API_URL}/api/hospitais/${encodeURIComponent(MEDICO_ID)}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** Une local + remoto por id (local tem prioridade). */
export function mesclarHospitais(
  local: Hospital[],
  remoto: Hospital[],
): Hospital[] {
  const porId = new Map<string, Hospital>();
  for (const h of remoto) porId.set(h.id, h);
  for (const h of local) porId.set(h.id, h);
  return Array.from(porId.values());
}
