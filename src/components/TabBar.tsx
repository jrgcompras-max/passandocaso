import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useRouter, useSegments } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C } from "@/constants/clinicalTheme";
import { useAcoes } from "@/store/AcoesContext";

/**
 * Bottom tab bar estilo iOS: [Hospitais] [+] [Perfil]. Fundo "frosted glass"
 * (BlurView) sobreposto ao conteúdo; botão central azul elevado. Fica absoluta
 * no rodapé — as telas roláveis reservam padding inferior para não esconder
 * conteúdo atrás dela.
 */
export function TabBar() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { pedirAdicionar } = useAcoes();

  const atual = segments[segments.length - 1];
  const corHosp = atual === "hospitais" ? C.primary : C.textMuted;
  const corPerfil = atual === "perfil" ? C.primary : C.textMuted;

  const adicionar = () => {
    pedirAdicionar();
    router.navigate("/");
  };

  return (
    <BlurView
      intensity={80}
      tint="light"
      style={[styles.barra, { height: 64 + insets.bottom, paddingBottom: insets.bottom }]}
    >
      <Pressable style={styles.item} onPress={() => router.navigate("/hospitais")} hitSlop={6}>
        <Ionicons name="business-outline" size={24} color={corHosp} />
        <Text style={[styles.label, { color: corHosp }]}>Hospitais</Text>
      </Pressable>

      <View style={styles.centroWrap}>
        <Pressable
          style={styles.centro}
          onPress={adicionar}
          accessibilityLabel="Adicionar paciente"
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      </View>

      <Pressable style={styles.item} onPress={() => router.navigate("/perfil")} hitSlop={6}>
        <Ionicons name="person-outline" size={24} color={corPerfil} />
        <Text style={[styles.label, { color: corPerfil }]}>Perfil</Text>
      </Pressable>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  barra: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingTop: 10,
    overflow: "visible",
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 4 },
  label: { fontSize: 10, fontWeight: "600" },
  centroWrap: { flex: 1, alignItems: "center" },
  centro: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -16 }],
    shadowColor: "#007AFF",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
