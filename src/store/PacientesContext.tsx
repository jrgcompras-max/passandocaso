import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { type StatusType } from "@/constants/clinicalTheme";
import { EVOLUCAO_VAZIA } from "@/constants/evolucao";
import { gerarPacientesExemplo } from "@/constants/pacientesExemplo";
import { ancorarDiaUso } from "@/lib/medicamentoDia";
import {
  buscarPacientes,
  enviarPacientes,
  mesclarPacientes,
  removerPacienteRemoto,
} from "@/lib/sincronizarPacientes";
import {
  type CabecalhoProntuario,
  type DadosClinicos,
  type EvolucaoBeiraLeito,
  type Paciente,
  type Pendencia,
  type Problema,
  type SecaoClinica,
  type SecaoId,
} from "@/types/paciente";

const STORAGE_KEY = "@passandocaso/pacientes";
// BUG 1: tombstone de exclusão — ids removidos localmente que NÃO devem voltar
// pelo merge com o backend (cobre exclusão feita offline).
const EXCLUIDOS_KEY = "@passandocaso/pacientesExcluidos";
/** Última data (YYYY-MM-DD) em que o reset diário de status foi aplicado. */
const RESET_STATUS_KEY = "@passandocaso/ultimoResetStatus";

/** Data de hoje em formato YYYY-MM-DD (local). */
function hojeISO() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * Reset diário de status: todo paciente volta a "naoVisitado" na virada do dia.
 * O status do dia que terminou é preservado em `historicoStatus[diaEncerrado]`
 * (registro/evolução). Idempotente: quem já está "naoVisitado" não muda.
 * "altaRealizada" é PRESERVADO (não reaparece como não visitado na rotina).
 */
function resetarStatusDoDia(lista: Paciente[], diaEncerrado: string): Paciente[] {
  return lista.map((p) =>
    p.status === "naoVisitado" || p.status === "altaRealizada"
      ? p
      : {
          ...p,
          status: "naoVisitado" as StatusType,
          historicoStatus: {
            ...(p.historicoStatus ?? {}),
            [diaEncerrado]: p.status,
          },
        },
  );
}

type AdicionarResultado = { id: string; vinculado: boolean };

type PacientesContextValue = {
  pacientes: Paciente[];
  carregado: boolean;
  getPaciente: (id: string) => Paciente | undefined;
  /**
   * Adiciona um paciente a partir do cabeçalho extraído. Se já existir um
   * paciente com o mesmo número de prontuário, vincula o dia de hoje ao
   * registro existente (acompanhamento entre dias) em vez de duplicar.
   */
  adicionarPorCabecalho: (
    cab: CabecalhoProntuario,
    hospitalId?: string,
  ) => AdicionarResultado;
  atualizarDadosClinicos: (id: string, dados: DadosClinicos) => void;
  /** Atualiza (mesclando) os campos de uma seção clínica do paciente. */
  atualizarSecao: (
    id: string,
    secao: SecaoId,
    campos: Partial<SecaoClinica>,
  ) => void;
  atualizarPaciente: (id: string, campos: PacienteEditavel) => void;
  /** Substitui a lista de problemas ativos do paciente. */
  atualizarProblemas: (id: string, problemas: Problema[]) => void;
  /** Substitui a lista de pendências do paciente. */
  atualizarPendencias: (id: string, pendencias: Pendencia[]) => void;
  /**
   * Mescla campos da evolução beira-leito de uma data. Recebe um PATCH parcial
   * e o funde no objeto do dia já armazenado — assim seções independentes
   * (ex.: Conduta do Dia vs. Exame Físico) não sobrescrevem os campos umas das
   * outras ao salvar (cada uma envia só o que possui).
   */
  atualizarEvolucao: (
    id: string,
    data: string,
    patch: Partial<EvolucaoBeiraLeito>,
  ) => void;
  removerPaciente: (id: string) => void;
  /** Move todos os pacientes de um hospital para outro. Retorna quantos moveu. */
  migrarPacientesDeHospital: (origem: string, destino: string) => number;
  /** Insere/atualiza pacientes recebidos por passagem de plantão (upsert por id). */
  importarRecebidos: (lista: Paciente[]) => void;
};

/** Campos do paciente que podem ser editados manualmente. */
export type PacienteEditavel = Partial<
  Pick<
    Paciente,
    | "nomeCompleto"
    | "idade"
    | "leito"
    | "setor"
    | "dataEntrada"
    | "numeroProntuario"
    | "status"
    | "diagnosticoPrincipal"
    | "motivoInternacao"
    | "statusClinico"
    | "resumoRapido"
    | "checklistAlta"
    | "medicamentos"
    | "resultadosLab"
    | "sinaisVitais"
  >
>;

const STATUS_VALIDOS: StatusType[] = [
  "naoVisitado",
  "visitado",
  "revisar",
  "pendente",
  "altaProvavel",
  "altaRealizada",
];

/** Status do esquema antigo (4 estados) → novos status (6 estados). */
const STATUS_LEGADO: Record<string, StatusType> = {
  discutido: "revisar",
  evoluido: "altaRealizada",
};

/** Converte um status armazenado para o vocabulário atual (fallback: não visitado). */
function migrarStatus(s: unknown): StatusType {
  if (typeof s === "string") {
    if (STATUS_LEGADO[s]) return STATUS_LEGADO[s];
    if ((STATUS_VALIDOS as string[]).includes(s)) return s as StatusType;
  }
  return "naoVisitado";
}

/**
 * Migra registros antigos para o formato atual:
 * - `leitoSetor` único foi separado em `setor` (IA) e `leito` (manual);
 * - status do esquema de 4 estados é remapeado para os 6 novos.
 */
function migrarPacientes(bruto: unknown): Paciente[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((p) => {
    const antigo = p as Paciente & { leitoSetor?: string };
    const status = migrarStatus(antigo.status);
    // Pacientes sem hospital pertencem ao "Geral" (multi-hospital).
    const hospitalId = antigo.hospitalId ?? "geral";
    if (antigo.setor === undefined && antigo.leitoSetor !== undefined) {
      const { leitoSetor, ...resto } = antigo;
      return { ...resto, status, hospitalId, leito: "", setor: leitoSetor ?? "" };
    }
    return {
      ...antigo,
      status,
      hospitalId,
      leito: antigo.leito ?? "",
      setor: antigo.setor ?? "",
    };
  });
}

const PacientesContext = createContext<PacientesContextValue | null>(null);

export function PacientesProvider({ children }: { children: ReactNode }) {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [carregado, setCarregado] = useState(false);
  // Tombstone de pacientes excluídos (BUG 1), persistido em AsyncStorage.
  const excluidosRef = useRef<Set<string>>(new Set());
  const persistExcluidos = () =>
    AsyncStorage.setItem(
      EXCLUIDOS_KEY,
      JSON.stringify([...excluidosRef.current]),
    ).catch(() => {});

  // Carrega do armazenamento local na montagem.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        // Carrega o tombstone de exclusões antes de mesclar.
        try {
          const ex = await AsyncStorage.getItem(EXCLUIDOS_KEY);
          if (ex) excluidosRef.current = new Set(JSON.parse(ex) as string[]);
        } catch {
          // sem tombstone salvo
        }
        const bruto = await AsyncStorage.getItem(STORAGE_KEY);
        let lista = bruto ? migrarPacientes(JSON.parse(bruto)) : [];
        // Primeira execução (nada salvo): popula com os pacientes de exemplo
        // (migrados para garantir hospitalId = "geral").
        if (!lista.length) lista = migrarPacientes(gerarPacientesExemplo());
        // Busca o backend (fonte primária) e mescla, excluindo os do tombstone.
        try {
          const remoto = migrarPacientes(await buscarPacientes());
          // Reenvia o DELETE para excluídos que o backend ainda devolve (ex.:
          // exclusão feita offline) — limpa o servidor sem ressuscitar a lista.
          for (const r of remoto) {
            if (excluidosRef.current.has(r.id)) {
              removerPacienteRemoto(r.id, r.hospitalId || "geral").catch(() => {});
            }
          }
          lista = mesclarPacientes(lista, remoto, excluidosRef.current);
        } catch {
          // sem rede / backend indisponível: segue só com o cache local
        }
        if (ativo) setPacientes(lista);
      } catch (e) {
        console.log("Erro ao carregar pacientes:", e);
      } finally {
        if (ativo) setCarregado(true);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  // Persiste a cada mudança — só depois do carregamento inicial, para não
  // sobrescrever o que está salvo com uma lista vazia.
  useEffect(() => {
    if (!carregado) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pacientes)).catch((e) =>
      console.log("Erro ao salvar pacientes:", e),
    );
  }, [pacientes, carregado]);

  // Sincroniza com o backend (best-effort, debounced para coalescer edições
  // rápidas). Em offline simplesmente não envia — o cache local segue válido.
  // Roda também na primeira carga (carregado → true), empurrando o estado atual.
  useEffect(() => {
    if (!carregado) return;
    const t = setTimeout(() => {
      enviarPacientes(pacientes).catch((e) =>
        console.log("Falha ao sincronizar pacientes:", e),
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [pacientes, carregado]);

  // Reset diário de status (virada do dia). Backend não guarda paciente/status
  // (são local-first), então o reset acontece aqui: ao abrir o app, ao voltar do
  // background e à meia-noite com o app aberto.
  const verificarResetDiario = useCallback(async () => {
    const hoje = hojeISO();
    let ultimoReset: string | null = null;
    try {
      ultimoReset = await AsyncStorage.getItem(RESET_STATUS_KEY);
    } catch {
      // sem storage: tenta resetar mesmo assim (best-effort)
    }
    if (ultimoReset === hoje) return;
    try {
      await AsyncStorage.setItem(RESET_STATUS_KEY, hoje);
    } catch {
      // best-effort
    }
    // Primeira execução (sem registro prévio): apenas ancora hoje, sem resetar —
    // evita zerar status legítimos do dia logo após o update.
    if (!ultimoReset) return;
    setPacientes((prev) => resetarStatusDoDia(prev, ultimoReset));
  }, []);

  useEffect(() => {
    if (!carregado) return;
    verificarResetDiario();

    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") verificarResetDiario();
    });

    // Agenda a próxima meia-noite (00:00:05) e reagenda a cada dia.
    let timer: ReturnType<typeof setTimeout>;
    const agendarMeiaNoite = () => {
      const agora = new Date();
      const proxima = new Date(agora);
      proxima.setHours(24, 0, 5, 0);
      timer = setTimeout(() => {
        verificarResetDiario();
        agendarMeiaNoite();
      }, proxima.getTime() - agora.getTime());
    };
    agendarMeiaNoite();

    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [carregado, verificarResetDiario]);

  const getPaciente = (id: string) => pacientes.find((p) => p.id === id);

  const migrarPacientesDeHospital = (origem: string, destino: string) => {
    const n = pacientes.filter((p) => (p.hospitalId ?? "geral") === origem).length;
    if (n > 0) {
      setPacientes((prev) =>
        prev.map((p) =>
          (p.hospitalId ?? "geral") === origem ? { ...p, hospitalId: destino } : p,
        ),
      );
    }
    return n;
  };

  const adicionarPorCabecalho = (
    cab: CabecalhoProntuario,
    hospitalId?: string,
  ): AdicionarResultado => {
    const hoje = hojeISO();
    const id = cab.numeroProntuario?.trim() || `p-${Date.now()}`;
    // Re-adicionar um prontuário antes excluído limpa o tombstone (BUG 1).
    if (excluidosRef.current.delete(id)) persistExcluidos();
    const existente = pacientes.find((p) => p.id === id);

    if (existente) {
      // Mesmo paciente em outro dia: atualiza o que pode mudar e vincula o dia.
      setPacientes((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                nomeCompleto: cab.nomeCompleto || p.nomeCompleto,
                // Idade: a PRIMEIRA leitura conhecida vence. Re-escanear o cabeçalho
                // não sobrescreve uma idade já registrada (a IA pode ler valores
                // diferentes em fotos distintas — ex.: 60 vs 69). Correção fica a
                // cargo da edição manual da ficha (atualizarPaciente).
                idade: p.idade ?? cab.idade,
                sexo: cab.sexo ?? p.sexo,
                // Setor vem da IA; leito é manual, então preservamos o existente.
                setor: cab.setor || p.setor,
                dataEntrada: cab.dataEntrada || p.dataEntrada,
                status: "naoVisitado",
                diasAcompanhamento: p.diasAcompanhamento.includes(hoje)
                  ? p.diasAcompanhamento
                  : [...p.diasAcompanhamento, hoje],
              }
            : p,
        ),
      );
      return { id, vinculado: true };
    }

    const novo: Paciente = {
      id,
      nomeCompleto: cab.nomeCompleto,
      idade: cab.idade,
      sexo: cab.sexo ?? null,
      leito: cab.leito,
      setor: cab.setor,
      dataEntrada: cab.dataEntrada,
      numeroProntuario: cab.numeroProntuario,
      status: "naoVisitado",
      hospitalId: hospitalId || "geral",
      diasAcompanhamento: [hoje],
      dadosClinicos: null,
    };
    setPacientes((prev) => [...prev, novo]);
    return { id, vinculado: false };
  };

  const atualizarDadosClinicos = (id: string, dados: DadosClinicos) => {
    setPacientes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, dadosClinicos: dados } : p)),
    );
  };

  const atualizarSecao = (
    id: string,
    secao: SecaoId,
    campos: Partial<SecaoClinica>,
  ) => {
    setPacientes((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const atual = p.secoes?.[secao] ?? { anotacoes: [], extraido: "" };
        return {
          ...p,
          secoes: { ...p.secoes, [secao]: { ...atual, ...campos } },
        };
      }),
    );
  };

  const atualizarPaciente = (id: string, campos: PacienteEditavel) => {
    // BUG 7: ao salvar medicamentos, ancora a data de início do D+ (avança sozinho).
    const ajustados =
      "medicamentos" in campos && Array.isArray(campos.medicamentos)
        ? { ...campos, medicamentos: ancorarDiaUso(campos.medicamentos) }
        : campos;
    setPacientes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...ajustados } : p)),
    );
  };

  const atualizarProblemas = (id: string, problemas: Problema[]) => {
    setPacientes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, problemas } : p)),
    );
  };

  const atualizarPendencias = (id: string, pendencias: Pendencia[]) => {
    setPacientes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pendencias } : p)),
    );
  };

  const atualizarEvolucao = (
    id: string,
    data: string,
    patch: Partial<EvolucaoBeiraLeito>,
  ) => {
    setPacientes((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              evolucoes: {
                ...p.evolucoes,
                [data]: {
                  ...(p.evolucoes?.[data] ?? EVOLUCAO_VAZIA),
                  ...patch,
                },
              },
            }
          : p,
      ),
    );
  };

  const removerPaciente = (id: string) => {
    const hospitalId = pacientes.find((p) => p.id === id)?.hospitalId || "geral";
    // Tombstone: marca como excluído para o merge não trazer de volta (BUG 1).
    excluidosRef.current.add(id);
    persistExcluidos();
    setPacientes((prev) => prev.filter((p) => p.id !== id));
    // Remove também no backend (soft delete; o sync por upsert não apaga).
    removerPacienteRemoto(id, hospitalId).catch((e) =>
      console.log("Falha ao remover paciente no backend:", e),
    );
  };

  const importarRecebidos = (lista: Paciente[]) => {
    if (!lista?.length) return;
    setPacientes((prev) => {
      const porId = new Map(prev.map((p) => [p.id, p]));
      for (const p of lista) porId.set(p.id, p);
      return Array.from(porId.values());
    });
  };

  return (
    <PacientesContext.Provider
      value={{
        pacientes,
        carregado,
        getPaciente,
        adicionarPorCabecalho,
        atualizarDadosClinicos,
        atualizarSecao,
        atualizarPaciente,
        atualizarProblemas,
        atualizarPendencias,
        atualizarEvolucao,
        removerPaciente,
        migrarPacientesDeHospital,
        importarRecebidos,
      }}
    >
      {children}
    </PacientesContext.Provider>
  );
}

export function usePacientes() {
  const ctx = useContext(PacientesContext);
  if (!ctx) {
    throw new Error("usePacientes precisa estar dentro de <PacientesProvider>");
  }
  return ctx;
}
