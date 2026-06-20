import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Ações globais disparadas pela tab bar e consumidas pelas telas. Hoje só o
 * pedido de "adicionar paciente": a tab bar incrementa o contador e a tela da
 * Rotina abre o modal ao detectar a mudança.
 */
type AcoesContextValor = {
  pedidoAdicionar: number;
  pedirAdicionar: () => void;
  /** Nº de pendências na Rede (passagens + solicitações) para o badge da aba. */
  redeBadge: number;
  setRedeBadge: (n: number) => void;
};

const AcoesContext = createContext<AcoesContextValor | null>(null);

export function AcoesProvider({ children }: { children: ReactNode }) {
  const [pedidoAdicionar, setPedido] = useState(0);
  const pedirAdicionar = useCallback(() => setPedido((n) => n + 1), []);
  const [redeBadge, setRedeBadge] = useState(0);
  const valor = useMemo(
    () => ({ pedidoAdicionar, pedirAdicionar, redeBadge, setRedeBadge }),
    [pedidoAdicionar, pedirAdicionar, redeBadge],
  );
  return <AcoesContext.Provider value={valor}>{children}</AcoesContext.Provider>;
}

export function useAcoes() {
  const ctx = useContext(AcoesContext);
  if (!ctx) throw new Error("useAcoes precisa estar dentro de <AcoesProvider>");
  return ctx;
}
