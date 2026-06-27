import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ClinicalColors as C } from "@/constants/clinicalTheme";

/**
 * Overlay de bloqueio que cobre o app inteiro até a biometria autenticar.
 * Fica por cima de tudo (zIndex alto) para que nenhum dado de paciente apareça
 * antes do desbloqueio.
 */
export function BloqueioBiometrico({
  nome,
  onDesbloquear,
  onSair,
}: {
  nome: string;
  onDesbloquear: () => void;
  onSair: () => void;
}) {
  return (
    <View style={styles.overlay}>
      <View style={styles.iconeCirc}>
        <Ionicons name="lock-closed" size={36} color={C.primary} />
      </View>
      <Text style={styles.titulo}>Passando Caso</Text>
      <Text style={styles.sub}>App bloqueado para proteger os dados dos pacientes.</Text>

      <Pressable style={styles.btn} onPress={onDesbloquear}>
        <Ionicons name="scan-outline" size={20} color="#fff" />
        <Text style={styles.btnTxt}>Desbloquear com {nome}</Text>
      </Pressable>

      <Pressable onPress={onSair} hitSlop={10} style={styles.sairBtn}>
        <Text style={styles.sairTxt}>Usar senha (sair)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    zIndex: 2000,
    elevation: 2000,
  },
  iconeCirc: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  titulo: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.4 },
  sub: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 28,
    lineHeight: 20,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  sairBtn: { marginTop: 18 },
  sairTxt: { color: C.textMuted, fontSize: 14, fontWeight: "600" },
});
