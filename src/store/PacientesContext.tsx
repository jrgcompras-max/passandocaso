import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  type CabecalhoProntuario,
  type DadosClinicos,
  type EvolucaoBeiraLeito,
  type Paciente,
  type SecaoClinica,
  type SecaoId,
} from "@/types/paciente";

const STORAGE_KEY = "@passandocaso/pacientes";

/** Data de hoje em formato YYYY-MM-DD (local). */
function hojeISO() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
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
  adicionarPorCabecalho: (cab: CabecalhoProntuario) => AdicionarResultado;
  atualizarDadosClinicos: (id: string, dados: DadosClinicos) => void;
  /** Atualiza (mesclando) os campos de uma seção clínica do paciente. */
  atualizarSecao: (
    id: string,
    secao: SecaoId,
    campos: Partial<SecaoClinica>,
  ) => void;
  atualizarPaciente: (id: string, campos: PacienteEditavel) => void;
  /** Salva (substitui) a evolução beira-leito de uma data específica. */
  atualizarEvolucao: (
    id: string,
    data: string,
    evolucao: EvolucaoBeiraLeito,
  ) => void;
  removerPaciente: (id: string) => void;
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
  >
>;

/**
 * Migra registros antigos para o formato atual. O principal: o campo único
 * `leitoSetor` foi separado em `setor` (extraído pela IA) e `leito` (manual).
 */
function migrarPacientes(bruto: unknown): Paciente[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((p) => {
    const antigo = p as Paciente & { leitoSetor?: string };
    if (antigo.setor === undefined && antigo.leitoSetor !== undefined) {
      const { leitoSetor, ...resto } = antigo;
      return { ...resto, leito: "", setor: leitoSetor ?? "" };
    }
    return { ...antigo, leito: antigo.leito ?? "", setor: antigo.setor ?? "" };
  });
}

const PacientesContext = createContext<PacientesContextValue | null>(null);

export function PacientesProvider({ children }: { children: ReactNode }) {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [carregado, setCarregado] = useState(false);

  // Carrega do armazenamento local na montagem.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const bruto = await AsyncStorage.getItem(STORAGE_KEY);
        if (ativo && bruto) {
          setPacientes(migrarPacientes(JSON.parse(bruto)));
        }
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

  const getPaciente = (id: string) => pacientes.find((p) => p.id === id);

  const adicionarPorCabecalho = (
    cab: CabecalhoProntuario,
  ): AdicionarResultado => {
    const hoje = hojeISO();
    const id = cab.numeroProntuario?.trim() || `p-${Date.now()}`;
    const existente = pacientes.find((p) => p.id === id);

    if (existente) {
      // Mesmo paciente em outro dia: atualiza o que pode mudar e vincula o dia.
      setPacientes((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                nomeCompleto: cab.nomeCompleto || p.nomeCompleto,
                idade: cab.idade ?? p.idade,
                // Setor vem da IA; leito é manual, então preservamos o existente.
                setor: cab.setor || p.setor,
                dataEntrada: cab.dataEntrada || p.dataEntrada,
                status: "pendente",
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
      leito: cab.leito,
      setor: cab.setor,
      dataEntrada: cab.dataEntrada,
      numeroProntuario: cab.numeroProntuario,
      status: "pendente",
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
    setPacientes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...campos } : p)),
    );
  };

  const atualizarEvolucao = (
    id: string,
    data: string,
    evolucao: EvolucaoBeiraLeito,
  ) => {
    setPacientes((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, evolucoes: { ...p.evolucoes, [data]: evolucao } }
          : p,
      ),
    );
  };

  const removerPaciente = (id: string) => {
    setPacientes((prev) => prev.filter((p) => p.id !== id));
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
        atualizarEvolucao,
        removerPaciente,
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
