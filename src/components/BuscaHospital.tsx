import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BorderWidth,
  ClinicalColors as C,
  Radius,
} from "@/constants/clinicalTheme";
import { buscarHospitaisCnes, localizarCidade, type HospitalCnes } from "@/lib/cnes";

/**
 * Modal de busca de hospital: tenta geolocalização (hospitais próximos), busca
 * no CNES com debounce e oferece entrada manual como fallback. Devolve o
 * hospital escolhido (nome + cidade) via onEscolher.
 */
export function BuscaHospital({
  visivel,
  onFechar,
  onEscolher,
  titulo = "Adicionar hospital",
}: {
  visivel: boolean;
  onFechar: () => void;
  onEscolher: (h: { nome: string; cidade: string }) => void;
  titulo?: string;
}) {
  const insets = useSafeAreaInsets();
  const [termo, setTermo] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [resultados, setResultados] = useState<HospitalCnes[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [geoOk, setGeoOk] = useState(false);
  const [manualAberto, setManualAberto] = useState(false);
  const [manNome, setManNome] = useState("");
  const [manCidade, setManCidade] = useState("");

  // Ao abrir: tenta localização → hospitais próximos.
  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const loc = await localizarCidade();
      if (!vivo) return;
      if (loc) {
        setGeoOk(true);
        setCidade(loc.cidade);
        setUf(loc.uf);
        const r = await buscarHospitaisCnes({ cidade: loc.cidade, uf: loc.uf });
        if (vivo) setResultados(r);
      }
      if (vivo) setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [visivel]);

  // Busca por termo (debounce 500ms).
  useEffect(() => {
    if (!visivel) return;
    const t = termo.trim();
    if (t.length < 2) return;
    const timer = setTimeout(async () => {
      setCarregando(true);
      const r = await buscarHospitaisCnes({ termo: t, cidade, uf });
      setResultados(r);
      setCarregando(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [termo, visivel, cidade, uf]);

  const escolher = (nome: string, cid: string) => {
    onEscolher({ nome: nome.trim(), cidade: cid.trim() });
    limpar();
  };
  const adicionarManual = () => {
    if (!manNome.trim()) return;
    escolher(manNome, manCidade);
  };
  const limpar = () => {
    setTermo("");
    setResultados([]);
    setManualAberto(false);
    setManNome("");
    setManCidade("");
  };
  const fechar = () => {
    limpar();
    onFechar();
  };

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={fechar}>
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topo}>
          <Text style={styles.titulo}>{titulo}</Text>
          <TouchableOpacity onPress={fechar} hitSlop={8}>
            <Ionicons name="close" size={26} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.buscaCampo}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} />
          <TextInput
            style={styles.buscaInput}
            value={termo}
            onChangeText={setTermo}
            placeholder="Buscar por nome ou cidade"
            placeholderTextColor={C.textMuted}
            autoCorrect={false}
          />
          {carregando && <ActivityIndicator size="small" color={C.primary} />}
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {geoOk && !termo.trim() && cidade ? (
            <Text style={styles.secaoLabel}>Hospitais próximos · {cidade}</Text>
          ) : resultados.length > 0 ? (
            <Text style={styles.secaoLabel}>Resultados</Text>
          ) : null}

          {resultados.map((h) => (
            <TouchableOpacity
              key={h.cnes || h.nomeFantasia + h.cidade}
              style={styles.card}
              onPress={() => escolher(h.nomeFantasia, h.cidade)}
            >
              <Ionicons name="business-outline" size={22} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardNome}>{h.nomeFantasia}</Text>
                <Text style={styles.cardSub}>
                  {[h.cidade, h.uf].filter(Boolean).join(" · ")}
                  {h.tipo ? ` · ${h.tipo}` : ""}
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {!carregando && termo.trim().length >= 2 && resultados.length === 0 && (
            <Text style={styles.vazio}>Nenhum hospital encontrado.</Text>
          )}

          {/* Entrada manual */}
          {!manualAberto ? (
            <TouchableOpacity
              style={styles.manualToggle}
              onPress={() => setManualAberto(true)}
            >
              <Text style={styles.manualToggleTexto}>
                Não encontrou? Adicionar manualmente
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.manualBox}>
              <Text style={styles.secaoLabel}>Adicionar manualmente</Text>
              <TextInput
                style={styles.input}
                value={manNome}
                onChangeText={setManNome}
                placeholder="Nome do hospital *"
                placeholderTextColor={C.textMuted}
              />
              <TextInput
                style={styles.input}
                value={manCidade}
                onChangeText={setManCidade}
                placeholder="Cidade"
                placeholderTextColor={C.textMuted}
              />
              <TouchableOpacity
                style={[styles.btnPrim, !manNome.trim() && styles.btnOff]}
                onPress={adicionarManual}
                disabled={!manNome.trim()}
              >
                <Text style={styles.btnPrimTxt}>Adicionar</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 16 },
  topo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  titulo: { fontSize: 22, fontWeight: "700", color: C.text, letterSpacing: -0.3 },
  buscaCampo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  buscaInput: { flex: 1, fontSize: 16, color: C.text },
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
  vazio: { color: C.textMuted, fontSize: 14, textAlign: "center", marginVertical: 16 },
  manualToggle: { paddingVertical: 16, alignItems: "center" },
  manualToggleTexto: { color: C.primary, fontSize: 15, fontWeight: "600" },
  manualBox: { marginTop: 8 },
  input: {
    backgroundColor: C.surface,
    borderWidth: BorderWidth.hairline,
    borderColor: C.border,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.text,
    marginBottom: 10,
  },
  btnPrim: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnOff: { opacity: 0.5 },
  btnPrimTxt: { color: C.textOnPrimary, fontSize: 17, fontWeight: "600" },
});
