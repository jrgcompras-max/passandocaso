import { Stack } from "expo-router";

import { PacientesProvider } from "@/store/PacientesContext";

export default function HomeStackLayout() {
  return (
    <PacientesProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PacientesProvider>
  );
}
