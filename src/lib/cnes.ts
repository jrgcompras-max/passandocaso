import * as Location from "expo-location";

import { apiFetch } from "./sessao";

export type HospitalCnes = {
  cnes: string;
  nomeFantasia: string;
  cidade: string;
  uf: string;
  endereco?: string;
  telefone?: string;
  tipo?: string;
};

/** Busca estabelecimentos no backend (CNES). Best-effort: [] em qualquer falha. */
export async function buscarHospitaisCnes(params: {
  termo?: string;
  cidade?: string;
  uf?: string;
}): Promise<HospitalCnes[]> {
  const q = new URLSearchParams();
  if (params.termo) q.set("termo", params.termo);
  if (params.cidade) q.set("cidade", params.cidade);
  if (params.uf) q.set("uf", params.uf);
  try {
    const r = await apiFetch(`/api/hospitais/buscar?${q.toString()}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.hospitais) ? (j.hospitais as HospitalCnes[]) : [];
  } catch {
    return [];
  }
}

/**
 * Tenta descobrir a cidade/UF do usuário via GPS (expo-location). Retorna null
 * se a permissão for negada, o módulo nativo não existir (build atual) ou falhar
 * — o chamador cai para busca manual.
 */
export async function localizarCidade(): Promise<{ cidade: string; uf: string } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const geo = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
    const g = geo[0];
    const cidade = g?.city || g?.subregion || "";
    if (!cidade) return null;
    return { cidade, uf: ufSigla(g?.region || "") };
  } catch {
    return null;
  }
}

const UFS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapá: "AP", amazonas: "AM", bahia: "BA",
  ceará: "CE", "distrito federal": "DF", "espírito santo": "ES", goiás: "GO",
  maranhão: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", pará: "PA", paraíba: "PB", paraná: "PR",
  pernambuco: "PE", piauí: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondônia: "RO",
  roraima: "RR", "santa catarina": "SC", "são paulo": "SP", sergipe: "SE",
  tocantins: "TO",
};

/** Reduz o nome do estado (retornado pelo geocode) para a sigla de 2 letras. */
function ufSigla(region: string): string {
  if (!region) return "";
  if (region.length === 2) return region.toUpperCase();
  return UFS[region.toLowerCase()] || "";
}
