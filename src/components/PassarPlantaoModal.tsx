import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius, StatusColors } from "@/constants/clinicalTheme";
import { formatarNome } from "@/lib/formatarNome";
import * as rede from "@/lib/rede";
import { useHospitais } from "@/store/HospitaisContext";
import { usePacientes } from "@/store/PacientesContext";

type Destino = { tipo: "conexao" | "grupo"; id: string | number; nome: string };

function iniciais(nome: string) {
  return (nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** Remove o nome completo antes de transmitir (LGPD): só o nome abreviado sai. */
function sanitizar(p: any) {
  const abrev = formatarNome(p.nomeCompleto || "");
  return { ...p, nomeCompleto: abrev, nomeAbreviado: abrev };
}

export function PassarPlantaoModal({
  visivel,
  onFechar,
  destinatarioPre,
}: {
  visivel: boolean;
  onFechar: () => void;
  destinatarioPre?: { id: string; nome: string };
}) {
  const insets = useSafeAreaInsets();
  const { pacientes } = usePacientes();
  const { hospitais, hospitalAtivo } = useHospitais();
  const hosp = hospitais.find((h) => h.id === hospitalAtivo);

  const pacientesHosp = useMemo(
    () => pacientes.filter((p) => (p.hospitalId ?? "geral") === hospitalAtivo),
    [pacientes, hospitalAtivo],
  );

  const [passo, setPasso] = useState(1);
  const [conexoes, setConexoes] = useState<rede.Conexao[]>([]);
  const [grupos, setGrupos] = useState<rede.GrupoClinico[]>([]);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);

  // (Re)inicializa ao abrir.
  useEffect(() => {
    if (!visivel) return;
    setSelecionados({});
    setMensagem("");
    if (destinatarioPre) {
      setDestino({ tipo: "conexao", id: destinatarioPre.id, nome: destinatarioPre.nome });
      setPasso(2);
    } else {
      setDestino(null);
      setPasso(1);
      Promise.all([
        rede.listarConexoes().catch(() => []),
        rede.listarGrupos().catch(() => []),
      ]).then(([cx, gr]) => {
        setConexoes(cx);
        // grupos do mesmo hospital (por cnes ou nome).
        const ch = hosp?.cnes;
        setGrupos(
          gr.filter(
            (g) =>
              (ch && g.hospital_cnes === ch) ||
              (!!hosp?.nome && (g.hospital_nome || "") === hosp.nome) ||
              (!g.hospital_cnes && !g.hospital_nome),
          ),
        );
      });
    }
  }, [visivel, destinatarioPre, hosp?.cnes, hosp?.nome]);

  const idsSel = Object.keys(selecionados).filter((id) => selecionados[id]);
  const todosSel = pacientesHosp.length > 0 && idsSel.length === pacientesHosp.length;
  const toggleTodos = () => {
    if (todosSel) setSelecionados({});
    else setSelecionados(Object.fromEntries(pacientesHosp.map((p) => [p.id, true])));
  };

  const enviar = async () => {
    if (!destino || idsSel.length === 0) return;
    setEnviando(true);
    try {
      const lista = pacientesHosp.filter((p) => selecionados[p.id]).map(sanitizar);
      await rede.criarPassagem({
        ...(destino.tipo === "conexao"
          ? { destinatario_id: String(destino.id) }
          : { grupo_id: Number(destino.id) }),
        pacientes: lista,
        mensagem: mensagem.trim() || undefined,
        hospital_cnes: hosp?.cnes,
        hospital_nome: hosp?.nome,
      });
      Alert.alert("Passagem enviada", `Passagem enviada para ${destino.nome}.`);
      onFechar();
    } catch (e: any) {
      Alert.alert("Não foi possível enviar", e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + 12 }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.topo}>
          <TouchableOpacity onPress={onFechar} hitSlop={8}>
            <Ionicons name="close" size={26} color={C.textMuted} />
          </TouchableOpacity>
          <View style={styles.dots}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.dot, passo >= n && styles.dotAtivo]} />
            ))}
          </View>
          <View style={{ width: 26 }} />
        </View>

        {/* PASSO 1 — para quem */}
        {passo === 1 && (
          <>
            <Text style={styles.titulo}>Para quem você quer passar?</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              {conexoes.length > 0 && <Text style={styles.secao}>Conexões</Text>}
              {conexoes.map((c) => (
                <TouchableOpacity
                  key={`c-${c.id}`}
                  style={styles.card}
                  onPress={() => { setDestino({ tipo: "conexao", id: c.id, nome: c.nome_exibicao }); setPasso(2); }}
                >
                  <View style={styles.avatar}><Text style={styles.avatarTxt}>{iniciais(c.nome_exibicao)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardNome}>{c.nome_exibicao}</Text>
                    <Text style={styles.cardSub}>{[c.especialidade, c.categoria].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.chevron} />
                </TouchableOpacity>
              ))}
              {grupos.length > 0 && <Text style={styles.secao}>Grupos</Text>}
              {grupos.map((g) => (
                <TouchableOpacity
                  key={`g-${g.id}`}
                  style={styles.card}
                  onPress={() => { setDestino({ tipo: "grupo", id: g.id, nome: g.nome }); setPasso(2); }}
                >
                  <Ionicons name="people-circle-outline" size={30} color={C.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardNome}>{g.nome}</Text>
                    <Text style={styles.cardSub}>{g.membros ?? 0} membro(s)</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.chevron} />
                </TouchableOpacity>
              ))}
              {conexoes.length === 0 && grupos.length === 0 && (
                <Text style={styles.vazio}>
                  Você ainda não tem conexões ou grupos neste hospital. Use a aba Rede para se conectar.
                </Text>
              )}
            </ScrollView>
          </>
        )}

        {/* PASSO 2 — quais pacientes */}
        {passo === 2 && (
          <>
            <Text style={styles.titulo}>Selecione os pacientes</Text>
            <TouchableOpacity style={styles.todos} onPress={toggleTodos}>
              <Ionicons
                name={todosSel ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={todosSel ? C.accent : C.chevron}
              />
              <Text style={styles.todosTxt}>Selecionar todos</Text>
            </TouchableOpacity>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              {pacientesHosp.map((p) => {
                const sel = !!selecionados[p.id];
                const pend = p.pendencias?.filter((x) => !x.feito).length ?? 0;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.pacCard}
                    onPress={() => setSelecionados((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  >
                    <Ionicons
                      name={sel ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={sel ? C.accent : C.chevron}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardNome}>{formatarNome(p.nomeCompleto) || "Sem nome"}</Text>
                      {!!p.diagnosticoPrincipal && (
                        <Text style={styles.cardSub} numberOfLines={1}>{p.diagnosticoPrincipal}</Text>
                      )}
                      <View style={styles.metaRow}>
                        <Text style={[styles.badge, { backgroundColor: StatusColors[p.status].bg, color: StatusColors[p.status].text }]}>
                          {StatusColors[p.status].label}
                        </Text>
                        {pend > 0 && (
                          <Text style={styles.pendChip}>{pend} pend.</Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {pacientesHosp.length === 0 && (
                <Text style={styles.vazio}>Nenhum paciente neste hospital.</Text>
              )}
            </ScrollView>
            <Text style={styles.lgpd}>Os nomes serão enviados de forma abreviada (LGPD).</Text>
            <View style={styles.rodapeAcoes}>
              {!destinatarioPre && (
                <TouchableOpacity style={styles.btnSec} onPress={() => setPasso(1)}>
                  <Text style={styles.btnSecTxt}>Voltar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.btnPrim, idsSel.length === 0 && { opacity: 0.5 }]}
                disabled={idsSel.length === 0}
                onPress={() => setPasso(3)}
              >
                <Text style={styles.btnPrimTxt}>Continuar ({idsSel.length})</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* PASSO 3 — mensagem */}
        {passo === 3 && (
          <>
            <Text style={styles.titulo}>Alguma observação?</Text>
            <Text style={styles.cardSub}>Para {destino?.nome} · {idsSel.length} paciente(s)</Text>
            <TextInput
              style={styles.textarea}
              value={mensagem}
              onChangeText={setMensagem}
              placeholder="Ex: Maria aguarda resultado de hemocultura..."
              placeholderTextColor={C.textMuted}
              multiline
            />
            <View style={styles.rodapeAcoes}>
              <TouchableOpacity style={styles.btnSec} onPress={() => setPasso(2)}>
                <Text style={styles.btnSecTxt}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnEnviar, enviando && { opacity: 0.6 }]}
                disabled={enviando}
                onPress={enviar}
              >
                {enviando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnEnviarTxt}>Enviar passagem</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 16 },
  topo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotAtivo: { backgroundColor: C.primary },
  titulo: { fontSize: 22, fontWeight: "700", color: C.text, letterSpacing: -0.3, marginBottom: 12 },
  secao: {
    fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginTop: 12, marginBottom: 8, marginLeft: 4,
  },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface,
    borderRadius: Radius.card, padding: 14, marginBottom: 8,
  },
  cardNome: { fontSize: 16, fontWeight: "600", color: C.text },
  cardSub: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  vazio: { color: C.textMuted, fontSize: 14, marginTop: 16, lineHeight: 20, textAlign: "center", paddingHorizontal: 20 },
  todos: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, marginBottom: 4 },
  todosTxt: { fontSize: 15, fontWeight: "600", color: C.text },
  pacCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface,
    borderRadius: Radius.card, padding: 14, marginBottom: 8,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  badge: { fontSize: 11, fontWeight: "600", borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  pendChip: {
    fontSize: 11, fontWeight: "600", color: C.warning, backgroundColor: C.warningBg,
    borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden",
  },
  lgpd: { fontSize: 12, color: C.textMuted, textAlign: "center", marginVertical: 8 },
  rodapeAcoes: { flexDirection: "row", gap: 10, marginBottom: 12 },
  btnSec: { flex: 1, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnSecTxt: { color: C.primary, fontSize: 16, fontWeight: "600" },
  btnPrim: { flex: 2, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnPrimTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  btnEnviar: { flex: 2, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  btnEnviarTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  textarea: {
    backgroundColor: C.surface, borderRadius: Radius.card, padding: 14, fontSize: 16,
    color: C.text, minHeight: 120, textAlignVertical: "top", marginTop: 12, marginBottom: 16,
  },
});
