import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C } from "@/constants/clinicalTheme";
import { useAcoes } from "@/store/AcoesContext";

const ICONES = {
  "(rotina)": "list-outline",
  hospitais: "business-outline",
  rede: "people-outline",
  perfil: "person-outline",
} as const;
const LABELS = {
  "(rotina)": "Rotina",
  hospitais: "Hospitais",
  rede: "Rede",
  perfil: "Perfil",
} as const;
type Aba = keyof typeof ICONES;
type Rota = { key: string; name: string };

// Props vêm do navegador de abas do expo-router; tipadas frouxas para evitar
// acoplar à tipagem interna do @react-navigation.
type TabBarProps = { state: any; navigation: any };

/**
 * Bottom tab bar iOS (frosted glass) para o navegador de abas paralelas:
 * [Rotina] [Hospitais] [+] [Perfil]. O "+" é ação (abre o modal na Rotina),
 * não uma aba. Tocar na aba já ativa volta ao topo do stack dela.
 */
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { pedirAdicionar, redeBadge } = useAcoes();
  const atual = state.routes[state.index]?.name;

  const aoPressionar = (name: Aba) => {
    const route = state.routes.find((r: Rota) => r.name === name);
    if (!route) return;
    const focado = atual === name;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!focado && !event.defaultPrevented) navigation.navigate(name);
  };

  const adicionar = () => {
    pedirAdicionar();
    navigation.navigate("(rotina)");
  };

  const item = (name: Aba) => {
    const cor = atual === name ? C.primary : C.textMuted;
    const badge = name === "rede" && redeBadge > 0 ? redeBadge : 0;
    return (
      <Pressable
        key={name}
        style={styles.item}
        onPress={() => aoPressionar(name)}
        hitSlop={6}
      >
        <View>
          <Ionicons name={ICONES[name]} size={24} color={cor} />
          {badge > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{badge > 9 ? "9+" : badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.label, { color: cor }]}>{LABELS[name]}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.barra, { height: 64 + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {item("(rotina)")}
      {item("hospitais")}
      <View style={styles.centroWrap}>
        <Pressable
          style={styles.centro}
          onPress={adicionar}
          accessibilityLabel="Adicionar paciente"
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      </View>
      {item("rede")}
      {item("perfil")}
    </View>
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
    // Fundo sólido translúcido (sem BlurView, que exige módulo nativo do novo build).
    backgroundColor: "rgba(242, 242, 247, 0.97)",
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 10,
    overflow: "visible",
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingTop: 4 },
  label: { fontSize: 10, fontWeight: "600" },
  badge: {
    position: "absolute",
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "700" },
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
