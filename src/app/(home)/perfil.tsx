import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  BorderWidth,
  ClinicalColors as C,
  Radius,
} from "@/constants/clinicalTheme";
import { useAuth } from "@/store/AuthContext";

export default function PerfilScreen() {
  const { usuario, sair } = useAuth();

  // Cor e texto do badge de trial conforme o estado da assinatura.
  let badge = { txt: "", bg: "#DBEAFE", fg: "#1E40AF" };
  if (usuario) {
    if (usuario.plano === "ativo") {
      badge = { txt: "Plano ativo", bg: "#DCFCE7", fg: "#166534" };
    } else if (usuario.expirado) {
      badge = { txt: "Trial expirado", bg: "#FEE2E2", fg: "#991B1B" };
    } else {
      const d = usuario.diasRestantes ?? 0;
      const texto = `Trial · ${d} ${d === 1 ? "dia restante" : "dias restantes"}`;
      badge =
        d <= 7
          ? { txt: texto, bg: "#FEF3C7", fg: "#B45309" }
          : { txt: texto, bg: "#DCFCE7", fg: "#166534" };
    }
  }

  const iniciais = (usuario?.nome || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Perfil</Text>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarTxt}>{iniciais}</Text>
        </View>
        <Text style={styles.nome}>{usuario?.nome ?? "—"}</Text>
        <Text style={styles.email}>{usuario?.email ?? ""}</Text>
        {!!badge.txt && (
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeTxt, { color: badge.fg }]}>{badge.txt}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.sairBtn} onPress={() => void sair()}>
        <Text style={styles.sairTxt}>Sair da conta</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  titulo: { fontSize: 28, fontWeight: "bold", color: C.text, marginBottom: 20 },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 24,
    alignItems: "center",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarTxt: { color: "#FFFFFF", fontSize: 26, fontWeight: "800" },
  nome: { fontSize: 20, fontWeight: "700", color: C.text },
  email: { fontSize: 14, color: C.textMuted, marginTop: 2 },
  badge: {
    marginTop: 14,
    borderRadius: Radius.badge,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeTxt: { fontSize: 13, fontWeight: "700" },
  sairBtn: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: Radius.card,
    paddingVertical: 14,
    alignItems: "center",
  },
  sairTxt: { color: "#991B1B", fontSize: 15, fontWeight: "700" },
});
