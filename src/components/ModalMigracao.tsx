import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BuscaHospital } from "@/components/BuscaHospital";
import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { HOSPITAL_GERAL, useHospitais } from "@/store/HospitaisContext";
import { usePacientes } from "@/store/PacientesContext";

/**
 * Modal de migração: oferece mover os pacientes do "Geral" para um hospital real
 * (existente ou buscado/criado). Após migrar, remove o "Geral". onConcluir(true)
 * em migração; onConcluir(false) em "Fazer depois".
 */
export function ModalMigracao({
  visivel,
  onConcluir,
}: {
  visivel: boolean;
  onConcluir: (sucesso: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const { hospitais, adicionarHospital, removerHospital, selecionar } = useHospitais();
  const { pacientes, migrarPacientesDeHospital } = usePacientes();
  const [busca, setBusca] = useState(false);

  const totalGeral = pacientes.filter(
    (p) => (p.hospitalId ?? "geral") === "geral",
  ).length;
  const outros = hospitais.filter((h) => h.id !== HOSPITAL_GERAL.id);

  const efetivar = (destinoId: string) => {
    migrarPacientesDeHospital("geral", destinoId);
    selecionar(destinoId);
    removerHospital(HOSPITAL_GERAL.id);
    onConcluir(true);
  };

  const migrarPara = (destinoId: string, nome: string) => {
    Alert.alert(
      "Migrar pacientes",
      `Mover ${totalGeral} ${totalGeral === 1 ? "paciente" : "pacientes"} para "${nome}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Migrar", onPress: () => efetivar(destinoId) },
      ],
    );
  };

  const aoEscolherNovo = (h: { nome: string; cidade: string }) => {
    const novo = adicionarHospital(h.nome, h.cidade);
    setBusca(false);
    migrarPara(novo.id, novo.nome);
  };

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={() => onConcluir(false)}>
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <Ionicons name="business" size={40} color={C.primary} style={styles.icone} />
        <Text style={styles.titulo}>Organize seus pacientes</Text>
        <Text style={styles.texto}>
          Seus pacientes estão salvos em &quot;Geral&quot;. Selecione o hospital
          onde eles estão internados para organizá-los corretamente.
        </Text>

        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {outros.length > 0 && <Text style={styles.secaoLabel}>Seus hospitais</Text>}
          {outros.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={styles.card}
              onPress={() => migrarPara(h.id, h.nome)}
            >
              <Ionicons name="business-outline" size={22} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardNome}>{h.nome}</Text>
                {!!h.cidade && <Text style={styles.cardSub}>{h.cidade}</Text>}
              </View>
              <Ionicons name="arrow-forward" size={18} color={C.chevron} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.btnBuscar} onPress={() => setBusca(true)}>
            <Ionicons name="search-outline" size={18} color={C.primary} />
            <Text style={styles.btnBuscarTxt}>Buscar hospital</Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity
          style={[styles.depois, { marginBottom: insets.bottom + 8 }]}
          onPress={() => onConcluir(false)}
        >
          <Text style={styles.depoisTxt}>Fazer depois</Text>
        </TouchableOpacity>
      </View>

      <BuscaHospital
        visivel={busca}
        onFechar={() => setBusca(false)}
        onEscolher={aoEscolherNovo}
        titulo="Selecionar hospital"
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 16 },
  icone: { alignSelf: "center", marginBottom: 12 },
  titulo: {
    fontSize: 26,
    fontWeight: "700",
    color: C.text,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  texto: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 22,
  },
  secaoLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 8,
  },
  cardNome: { fontSize: 16, fontWeight: "600", color: C.text },
  cardSub: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  btnBuscar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
  },
  btnBuscarTxt: { color: C.primary, fontSize: 17, fontWeight: "600" },
  depois: { alignItems: "center", paddingVertical: 14 },
  depoisTxt: { color: C.textMuted, fontSize: 16, fontWeight: "600" },
});
