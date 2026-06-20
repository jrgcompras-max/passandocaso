import { Stack } from "expo-router";

/** Header nativo iOS (estilo Apple Saúde): só o chevron azul, sem título/sombra. */
const headerNativo = {
  headerShown: true,
  headerBackTitle: "",
  headerTintColor: "#007AFF",
  headerStyle: { backgroundColor: "#F2F2F7" },
  headerShadowVisible: false,
  headerTitle: "",
} as const;

/** Stack da aba Rotina: lista → paciente/[id] → evolucao/[id]. */
export default function RotinaLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="paciente/[id]" options={headerNativo} />
      <Stack.Screen name="evolucao/[id]" options={headerNativo} />
    </Stack>
  );
}
