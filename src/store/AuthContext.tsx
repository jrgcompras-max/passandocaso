import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import * as authLib from "@/lib/auth";
import { type Usuario } from "@/lib/auth";

type AuthContextValor = {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  recuperar: (email: string) => Promise<void>;
  sair: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValor | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const u = await authLib.carregarSessao();
        if (vivo) setUsuario(u);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    setUsuario(await authLib.entrar(email, senha));
  }, []);

  const cadastrar = useCallback(
    async (nome: string, email: string, senha: string) => {
      setUsuario(await authLib.cadastrar(nome, email, senha));
    },
    [],
  );

  const recuperar = useCallback(async (email: string) => {
    await authLib.recuperarSenha(email);
  }, []);

  const sair = useCallback(async () => {
    await authLib.sair();
    setUsuario(null);
  }, []);

  const valor = useMemo(
    () => ({ usuario, carregando, entrar, cadastrar, recuperar, sair }),
    [usuario, carregando, entrar, cadastrar, recuperar, sair],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValor {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return ctx;
}
