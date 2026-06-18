import { Stack } from "expo-router";

import { HospitaisProvider } from "@/store/HospitaisContext";
import { PacientesProvider } from "@/store/PacientesContext";

export default function HomeStackLayout() {
  return (
    <HospitaisProvider>
      <PacientesProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </PacientesProvider>
    </HospitaisProvider>
  );
}
