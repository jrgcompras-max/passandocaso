import { Tabs } from "expo-router";

import { TabBar } from "@/components/TabBar";
import { AcoesProvider } from "@/store/AcoesContext";
import { HospitaisProvider } from "@/store/HospitaisContext";
import { PacientesProvider } from "@/store/PacientesContext";

export default function HomeLayout() {
  return (
    <HospitaisProvider>
      <PacientesProvider>
        <AcoesProvider>
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
