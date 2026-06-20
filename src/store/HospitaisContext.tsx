import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  buscarHospitais,
  enviarHospitais,
  mesclarHospitais,
  removerHospitalRemoto,
} from "@/lib/sincronizarHospitais";
import { type Hospital } from "@/types/paciente";

const STORAGE_HOSP = "@passandocaso/hospitais";
const STORAGE_ATIVO = "@passandocaso/hospitalAtivo";

/** Hospital padrão para onde migram os pacientes sem hospital definido. */
export const HOSPITAL_GERAL: Hospital = { id: "geral", nome: "Geral", cidade: "" };

type HospitaisContextValue = {
  hospitais: Hospital[];
  /** Hospital selecionado; null mostra a tela de seleção. */
  hospitalAtivo: string | null;
  carregado: boolean;
  selecionar: (id: string) => void;
  trocarHospital: () => void;
  adicionarHospital: (nome: string, cidade: string) => Hospital;
  removerHospital: (id: string) => void;
};

/** Flag de migração dos pacientes do "Geral" (definida após migrar/concluir). */
export const KEY_MIGRACAO_GERAL = "@passandocaso/migracaoGeral";

const HospitaisContext = createContext<HospitaisContextValue | null>(null);

export function HospitaisProvider({ children }: { children: ReactNode }) {
  const [hospitais, setHospitais] = useState<Hospital[]>([]);
  const [hospitalAtivo, setHospitalAtivo] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const bruto = await AsyncStorage.getItem(STORAGE_HOSP);
        let lista: Hospital[] = bruto ? JSON.parse(bruto) : [];
        if (!lista.length) lista = [HOSPITAL_GERAL];
        try {
          lista = mesclarHospitais(lista, await buscarHospitais());
        } catch {
          // sem rede: segue com o cache local
        }
        // Garante o hospital "Geral" (destino dos pacientes legados) — exceto se
        // a migração já foi concluída (aí o "Geral" deve permanecer removido).
        const migrou = await AsyncStorage.getItem(KEY_MIGRACAO_GERAL);
        if (!migrou && !lista.find((h) => h.id === HOSPITAL_GERAL.id)) {
          lista = [HOSPITAL_GERAL, ...lista];
        }
        const ativoSalvo = await AsyncStorage.getItem(STORAGE_ATIVO);
        if (ativo) {
          setHospitais(lista);
          setHospitalAtivo(ativoSalvo || null);
        }
      } catch (e) {
        console.log("Erro ao carregar hospitais:", e);
      } finally {
        if (ativo) setCarregado(true);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  // Persiste e sincroniza a lista de hospitais (best-effort, debounced).
  useEffect(() => {
    if (!carregado) return;
    AsyncStorage.setItem(STORAGE_HOSP, JSON.stringify(hospitais)).catch(() => {});
    const t = setTimeout(() => {
      enviarHospitais(hospitais).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [hospitais, carregado]);

  useEffect(() => {
    if (!carregado) return;
    if (hospitalAtivo) AsyncStorage.setItem(STORAGE_ATIVO, hospitalAtivo).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_ATIVO).catch(() => {});
  }, [hospitalAtivo, carregado]);

  const selecionar = (id: string) => setHospitalAtivo(id);
  const trocarHospital = () => setHospitalAtivo(null);

  const adicionarHospital = (nome: string, cidade: string): Hospital => {
    const novo: Hospital = {
      id: `h-${Date.now()}`,
      nome: nome.trim(),
      cidade: cidade.trim(),
    };
    setHospitais((prev) => [...prev, novo]);
    setHospitalAtivo(novo.id);
    return novo;
  };

  const removerHospital = (id: string) => {
    if (id === HOSPITAL_GERAL.id) return; // o "Geral" não é removível
    setHospitais((prev) => prev.filter((h) => h.id !== id));
    if (hospitalAtivo === id) setHospitalAtivo(null);
    removerHospitalRemoto(id).catch(() => {});
  };

  return (
    <HospitaisContext.Provider
      value={{
        hospitais,
        hospitalAtivo,
        carregado,
        selecionar,
        trocarHospital,
        adicionarHospital,
        removerHospital,
      }}
    >
      {children}
    </HospitaisContext.Provider>
  );
}

export function useHospitais() {
  const ctx = useContext(HospitaisContext);
  if (!ctx) {
    throw new Error("useHospitais precisa estar dentro de <HospitaisProvider>");
  }
  return ctx;
}
