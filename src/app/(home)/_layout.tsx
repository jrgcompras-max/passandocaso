import { Stack, useSegments } from "expo-router";
import { View } from "react-native";

import { TabBar } from "@/components/TabBar";
import { AcoesProvider } from "@/store/AcoesContext";
import { HospitaisProvider } from "@/store/HospitaisContext";
import { PacientesProvider } from "@/store/PacientesContext";

export default function HomeStackLayout() {
  return (
    <HospitaisProvider>
      <PacientesProvider>
        <AcoesProvider>
          <Conteudo />
        </AcoesProvider>
      </PacientesProvider>
    </HospitaisProvider>
  );
}

function Conteudo() {
  const segments = useSegments() as string[];
  // A tab bar some nas telas de detalhe (paciente / passar o caso).
  const ocultarTab =
    segments.includes("paciente") || segments.includes("evolucao");

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      {!ocultarTab && <TabBar />}
    </View>
  );
}
