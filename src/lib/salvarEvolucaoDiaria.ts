import {
  type EvolucaoBeiraLeito,
  type Paciente,
  type SinaisVitaisDia,
} from "@/types/paciente";

import { hojeISO } from "./datas";
import { agruparPorExame } from "./lab";
import { apiFetch } from "./sessao";

/** Um snapshot diário, como devolvido pelo backend. */
export type RegistroDiario = {
  data: string;
  sinais_vitais: SinaisVitaisDia | null;
  exames_laboratoriais: Record<string, string> | null;
  exames_imagem: string | null;
  evolucao_beira_leito: EvolucaoBeiraLeito | null;
  conduta: string | null;
  problemas_ativos: string[] | null;
  passou_caso: string | null;
};

/** Último valor de cada exame (mapa exame → valor) para o snapshot do dia. */
function labsDoDia(p: Paciente): Record<string, string> {
  const o: Record<string, string> = {};
  for (const s of agruparPorExame(p.resultadosLab || [])) {
    o[s.exame] = s.pontos[s.pontos.length - 1].valor;
  }
  return o;
}

/** Texto resumido da seção de imagem (anotações + extração simples). */
function textoImagem(p: Paciente): string {
  const sec = p.secoes?.imagem;
  if (!sec) return "";
  const anots = ((sec.anotacoes as { texto?: string }[]) || [])
    .map((a) => (a.texto || "").trim())
    .filter(Boolean);
  const ex = (sec.extraido || "").trim();
  const exTxt = ex.startsWith("[") ? "" : ex; // ignora blocos JSON
  return [exTxt, ...anots].filter(Boolean).join(" · ");
}

/**
 * Coleta o estado atual do paciente e salva (upsert) o snapshot do dia.
 * Best-effort: nunca lança. `passouCaso` é o texto gerado (opcional).
 */
export async function salvarSnapshotDiario(
  p: Paciente,
  passouCaso?: string,
): Promise<void> {
  try {
    const hoje = hojeISO();
    const sv = p.sinaisVitais?.[hoje] ?? null;
    const evo = p.evolucoes?.[hoje] ?? null;
    const problemas = (p.problemas || [])
      .filter((x) => x.status === "ativo")
      .map((x) => x.titulo.trim())
      .filter(Boolean);
    await apiFetch("/api/evolucao-diaria/salvar", {
      method: "POST",
      body: JSON.stringify({
        pacienteId: p.id,
        data: hoje,
        sinaisVitais: sv,
        examesLab: labsDoDia(p),
        examesImagem: textoImagem(p),
        evolucaoBeiraleito: evo,
        conduta: evo?.condutaDoDia || "",
        problemasAtivos: problemas,
        passouCaso: passouCaso || null,
      }),
    });
  } catch {
    // best-effort: offline / sem sessão não bloqueia o fluxo
  }
}

/** Lista os snapshots de um paciente (mais recentes primeiro). */
export async function listarEvolucaoDiaria(
  pacienteId: string,
  dias = 30,
): Promise<RegistroDiario[]> {
  try {
    const r = await apiFetch(
      `/api/evolucao-diaria/${encodeURIComponent(pacienteId)}?dias=${dias}`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.registros) ? (j.registros as RegistroDiario[]) : [];
  } catch {
    return [];
  }
}
