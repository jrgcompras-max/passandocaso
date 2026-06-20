import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  BorderWidth,
  ClinicalColors as C,
  Radius,
} from "@/constants/clinicalTheme";
import { HOSPITAL_GERAL, useHospitais } from "@/store/HospitaisContext";

export default function HospitaisScreen() {
  const router = useRouter();
  const { hospitais, hospitalAtivo, selecionar, adicionarHospital, removerHospital } =
    useHospitais();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nome, setNome] = useState("");
  const [cidade, setCidade] = useState("");

  const selecionarEVoltar = (id: string) => {
    selecionar(id);
    router.navigate("/");
  };

  const salvar = () => {
    if (!nome.trim()) return;
    adicionarHospital(nome, cidade);
    setNome("");
    setCidade("");
    setMostrarForm(false);
    router.navigate("/");
  };

  const confirmarRemover = (id: string, nomeHosp: string) => {
    Alert.alert("Remover hospital", `Remover "${nomeHosp}" da sua lista?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: () => removerHospital(id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titulo}>Hospitais</Text>
          <Text style={styles.subtitulo}>Selecione um hospital para a rotina</Text>
        </View>
        <TouchableOpacity
          style={styles.botaoAdd}
          onPress={() => setMostrarForm((v) => !v)}
          accessibilityLabel="Adicionar hospital"
        >
          <Text style={styles.botaoAddTexto}>+</Text>
        </TouchableOpacity>
      </View>

      {mostrarForm && (
        <View style={styles.form}>
          <Text style={styles.label}>Nome do hospital *</Text>
          <TextInput
            style={styles.input}
            value={nome}
            onChangeText={setNome}
            placeholder="Ex.: Santa Casa"
            placeholderTextColor={C.textMuted}
          />
          <Text style={styles.label}>Cidade</Text>
          <TextInput
            style={styles.input}
            value={cidade}
            onChangeText={setCidade}
            placeholder="Ex.: Florianópolis"
            placeholderTextColor={C.textMuted}
          />
          <TouchableOpacity
            style={[styles.salvarBtn, !nome.trim() && styles.salvarBtnOff]}
            onPress={salvar}
            disabled={!nome.trim()}
          >
            <Text style={styles.salvarBtnTexto}>Salvar hospital</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {hospitais.map((h) => {
          const ativo = h.id === hospitalAtivo;
          return (
            <TouchableOpacity
              key={h.id}
              style={[styles.card, ativo && styles.cardAtivo]}
              onPress={() => selecionarEVoltar(h.id)}
              onLongPress={
                h.id === HOSPITAL_GERAL.id
                  ? undefined
                  : () => confirmarRemover(h.id, h.nome)
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.hospNome}>{h.nome}</Text>
                {!!h.cidade && <Text style={styles.hospCidade}>{h.cidade}</Text>}
              </View>
              {ativo && <Text style={styles.check}>✓</Text>}
            </TouchableOpacity>
          );
        })}
        <Text style={styles.dica}>Toque para selecionar · segure para remover</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  titulo: { fontSize: 28, fontWeight: "bold", color: C.text, marginBottom: 4 },
  subtitulo: { fontSize: 14, color: C.textMuted },
  botaoAdd: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.buttonPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  botaoAddTexto: { color: C.textOnPrimary, fontSize: 28, fontWeight: "600", lineHeight: 32 },
  form: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  label: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: C.text,
  },
  salvarBtn: {
    backgroundColor: C.buttonPrimary,
    borderRadius: Radius.badge,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 14,
  },
  salvarBtnOff: { opacity: 0.5 },
  salvarBtnTexto: { color: C.textOnPrimary, fontSize: 15, fontWeight: "700" },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  cardAtivo: { borderColor: C.primary, backgroundColor: "#F0F7FA" },
  hospNome: { fontSize: 16, fontWeight: "600", color: C.text },
  hospCidade: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  check: { color: C.primary, fontSize: 18, fontWeight: "800", marginLeft: 8 },
  dica: { textAlign: "center", color: C.textMuted, fontSize: 12, marginTop: 6 },
});
