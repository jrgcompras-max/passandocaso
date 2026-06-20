import { Stack } from "expo-router";

/** Stack da aba Rotina: lista → paciente/[id] → evolucao/[id]. */
export default function RotinaLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
