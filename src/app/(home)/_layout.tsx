import { Tabs, useRouter } from "expo-router";
import { useCallback, useEffect } from "react";

import { TabBar } from "@/components/TabBar";
import * as notificacoes from "@/lib/notificacoes";
import * as rede from "@/lib/rede";
import { AcoesProvider, useAcoes } from "@/store/AcoesContext";
import { HospitaisProvider } from "@/store/HospitaisContext";
import { PacientesProvider } from "@/store/PacientesContext";

export default function HomeLayout() {
  return (
    <HospitaisProvider>
      <PacientesProvider>
        <AcoesProvider>
          <NotificacoesManager />
          <Tabs
            screenOptions={{ headerShown: false }}
            tabBar={(props) => <TabBar {...props} />}
          >
            <Tabs.Screen name="(rotina)" options={{ title: "Rotina" }} />
            <Tabs.Screen name="hospitais" options={{ title: "Hospitais" }} />
            <Tabs.Screen name="rede" options={{ title: "Rede" }} />
            <Tabs.Screen name="perfil" options={{ title: "Perfil" }} />
          </Tabs>
        </AcoesProvider>
      </PacientesProvider>
    </HospitaisProvider>
  );
}

/**
 * Registra o push token, atualiza o badge da Rede e trata o toque na
 * notificação (navega para a aba Rede). Não renderiza nada. Tudo defensivo —
 * sem o módulo nativo (build atual) vira no-op.
 */
function NotificacoesManager() {
  const router = useRouter();
  const { setRedeBadge } = useAcoes();

  const atualizarBadge = useCallback(async () => {
    const [pg, sl] = await Promise.all([
      rede.listarPassagensRecebidas().catch(() => []),
      rede.listarSolicitacoes().catch(() => []),
    ]);
    setRedeBadge(pg.length + sl.length);
  }, [setRedeBadge]);

  useEffect(() => {
    notificacoes.registrarPushToken().catch(() => {});
    atualizarBadge();
    const limpar = notificacoes.configurarListeners(
      (tipo) => {
        if (
          tipo === "passagem_recebida" ||
          tipo === "nova_solicitacao_conexao" ||
          tipo === "solicitacao_aceita"
        ) {
          router.navigate("/rede");
        }
        atualizarBadge();
      },
      () => atualizarBadge(),
    );
    return limpar;
  }, [atualizarBadge, router]);

  return null;
}
