import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";

export const ESPECIALIDADES = [
  { rotulo: "Cardiologia", icone: "heart" },
  { rotulo: "Neurologia", icone: "pulse-outline" },
  { rotulo: "Pneumologia", icone: "fitness-outline" },
  { rotulo: "Clínica Médica", icone: "medical" },
  { rotulo: "UTI / Intensivismo", icone: "pulse" },
  { rotulo: "Pediatria", icone: "happy-outline" },
  { rotulo: "Cirurgia Geral", icone: "cut-outline" },
  { rotulo: "Ginecologia e Obstetrícia", icone: "woman-outline" },
  { rotulo: "Hematologia / Oncologia", icone: "ribbon-outline" },
  { rotulo: "Nefrologia", icone: "water-outline" },
] as const;

export function ModalEspecialidade({
  visivel,
  titulo = "Qual é a sua especialidade neste hospital?",
  onConfirmar,
  onPular,
  rotuloPular = "Pular por agora",
}: {
  visivel: boolean;
  titulo?: string;
  onConfirmar: (especialidade: string) => void;
  onPular: () => void;
  rotuloPular?: string;
}) {
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState<string | null>(null);
  const [outra, setOutra] = useState("");
  const usandoOutra = sel === "__outra__";
  const valor = usandoOutra ? outra.trim() : sel || "";

  const confirmar = () => {
    if (!valor) return;
    onConfirmar(valor);
    setSel(null);
    setOutra("");
  };

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={onPular}>
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.titulo}>{titulo}</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
          {ESPECIALIDADES.map((e) => {
            const ativo = sel === e.rotulo;
            return (
              <TouchableOpacity
                key={e.rotulo}
                style={[styles.item, ativo && styles.itemAtivo]}
                onPress={() => setSel(e.rotulo)}
              >
                <Ionicons name={e.icone} size={22} color={ativo ? C.primary : C.textMuted} />
                <Text style={[styles.itemTxt, ativo && styles.itemTxtAtivo]}>{e.rotulo}</Text>
                {ativo && <Ionicons name="checkmark-circle" size={20} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.item, usandoOutra && styles.itemAtivo]}
            onPress={() => setSel("__outra__")}
          >
            <Ionicons name="add-circle-outline" size={22} color={usandoOutra ? C.primary : C.textMuted} />
            <Text style={[styles.itemTxt, usandoOutra && styles.itemTxtAtivo]}>Outra</Text>
          </TouchableOpacity>
          {usandoOutra && (
            <TextInput
              style={styles.input}
              value={outra}
              onChangeText={setOutra}
              placeholder="Digite a especialidade"
              placeholderTextColor={C.textMuted}
              autoFocus
            />
          )}
        </ScrollView>

        <View style={[styles.rodape, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity style={styles.btnSec} onPress={onPular}>
            <Text style={styles.btnSecTxt}>{rotuloPular}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrim, !valor && { opacity: 0.5 }]}
            disabled={!valor}
            onPress={confirmar}
          >
            <Text style={styles.btnPrimTxt}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 16 },
  titulo: { fontSize: 22, fontWeight: "700", color: C.text, letterSpacing: -0.3, marginBottom: 16 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: "transparent",
    padding: 16,
    marginBottom: 8,
  },
  itemAtivo: { borderColor: C.primary, backgroundColor: "#E5F0FF" },
  itemTxt: { flex: 1, fontSize: 16, fontWeight: "500", color: C.text },
  itemTxtAtivo: { color: C.primary, fontWeight: "600" },
  input: {
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.text,
  },
  rodape: { flexDirection: "row", gap: 10, paddingTop: 8 },
  btnSec: { flex: 1, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnSecTxt: { color: C.primary, fontSize: 16, fontWeight: "600" },
  btnPrim: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnPrimTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
