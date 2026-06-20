import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { BuscaHospital } from "@/components/BuscaHospital";
import { ModalEspecialidade } from "@/components/ModalEspecialidade";
import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { definirEspecialidade } from "@/lib/rede";
import { useAuth } from "@/store/AuthContext";
import { HOSPITAL_GERAL, useHospitais } from "@/store/HospitaisContext";

export default function HospitaisScreen() {
  const router = useRouter();
  const { usuario, atualizarUsuario } = useAuth();
  const { hospitais, hospitalAtivo, selecionar, adicionarHospital, removerHospital } =
    useHospitais();
  const [busca, setBusca] = useState(false);
  const [espVisivel, setEspVisivel] = useState(false);
  const [cnesPendente, setCnesPendente] = useState<string | undefined>(undefined);

  // Após escolher um hospital: se a especialidade ainda não foi definida, faz o
  // onboarding antes de voltar à Rotina.
  const aposEscolher = (cnes?: string) => {
    if (!usuario?.especialidade_definida) {
      setCnesPendente(cnes);
      setEspVisivel(true);
    } else {
      router.navigate("/");
    }
  };

  const selecionarEVoltar = (id: string) => {
    selecionar(id);
    aposEscolher(hospitais.find((h) => h.id === id)?.cnes);
  };

  const aoEscolher = (h: { nome: string; cidade: string; cnes?: string }) => {
    adicionarHospital(h.nome, h.cidade, h.cnes); // cria e já define como ativo
    setBusca(false);
    aposEscolher(h.cnes);
  };

  const confirmarEspecialidade = (esp: string) => {
    definirEspecialidade(esp, cnesPendente).catch(() => {});
    atualizarUsuario({ especialidade: esp, especialidade_definida: true });
    setEspVisivel(false);
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
      <Text style={styles.titulo}>Hospitais</Text>
      <Text style={styles.subtitulo}>Selecione onde você está trabalhando hoje</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 120, paddingTop: 16 }}>
        {hospitais.length > 0 && (
          <Text style={styles.secaoLabel}>Hospitais recentes</Text>
        )}
        {hospitais.map((h) => {
          const ativo = h.id === hospitalAtivo;
          return (
            <TouchableOpacity
              key={h.id}
              style={styles.card}
              onPress={() => selecionarEVoltar(h.id)}
              onLongPress={
                h.id === HOSPITAL_GERAL.id
                  ? undefined
                  : () => confirmarRemover(h.id, h.nome)
              }
              activeOpacity={0.7}
            >
              <Ionicons name="business-outline" size={22} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.hospNome}>{h.nome}</Text>
                {!!h.cidade && <Text style={styles.hospCidade}>{h.cidade}</Text>}
              </View>
              {ativo && (
                <Ionicons name="checkmark-circle" size={22} color={C.accent} />
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.btnAdd} onPress={() => setBusca(true)}>
          <Ionicons name="add" size={20} color={C.primary} />
          <Text style={styles.btnAddTexto}>Adicionar hospital</Text>
        </TouchableOpacity>
      </ScrollView>

      <BuscaHospital
        visivel={busca}
        onFechar={() => setBusca(false)}
        onEscolher={aoEscolher}
      />
      <ModalEspecialidade
        visivel={espVisivel}
        onConfirmar={confirmarEspecialidade}
        onPular={() => {
          setEspVisivel(false);
          router.navigate("/");
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  titulo: { fontSize: 28, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  subtitulo: { fontSize: 14, color: C.textMuted, marginTop: 4, marginBottom: 20 },
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
  hospNome: { fontSize: 16, fontWeight: "600", color: C.text },
  hospCidade: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  btnAdd: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.background,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
  },
  btnAddTexto: { color: C.primary, fontSize: 17, fontWeight: "600" },
});
