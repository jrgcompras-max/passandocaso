import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { PassarPlantaoModal } from "@/components/PassarPlantaoModal";
import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import * as rede from "@/lib/rede";
import { useHospitais } from "@/store/HospitaisContext";

function iniciais(nome: string) {
  return (nome || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

type ModalAtivo = null | "buscar" | "convidar" | "criarGrupo" | "entrarGrupo";

export default function RedeScreen() {
  const { hospitais, hospitalAtivo } = useHospitais();
  const hosp = hospitais.find((h) => h.id === hospitalAtivo);

  const [passagens, setPassagens] = useState<rede.PassagemRecebida[]>([]);
  const [grupos, setGrupos] = useState<rede.GrupoClinico[]>([]);
  const [conexoes, setConexoes] = useState<rede.Conexao[]>([]);
  const [solic, setSolic] = useState<rede.Solicitacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalAtivo>(null);
  const [passarPara, setPassarPara] = useState<{ id: string; nome: string } | null>(null);

  const carregar = useCallback(async () => {
    const [pg, gr, cx, sl] = await Promise.all([
      rede.listarPassagensRecebidas().catch(() => []),
      rede.listarGrupos().catch(() => []),
      rede.listarConexoes().catch(() => []),
      rede.listarSolicitacoes().catch(() => []),
    ]);
    setPassagens(pg);
    setGrupos(gr);
    setConexoes(cx);
    setSolic(sl);
  }, []);

  useEffect(() => {
    (async () => {
      await carregar();
      setCarregando(false);
    })();
  }, [carregar]);

  const refresh = async () => {
    setAtualizando(true);
    await carregar();
    setAtualizando(false);
  };

  const aceitarPassagem = (id: number) => {
    rede
      .aceitarPassagem(id)
      .then((r: any) =>
        Alert.alert(
          "Passagem aceita",
          `${r?.pacientes_importados ?? 0} paciente(s) importado(s). Eles aparecem na Rotina após a sincronização.`,
        ),
      )
      .catch((e) => Alert.alert("Erro", e.message))
      .finally(carregar);
  };
  const recusarPassagem = (id: number) =>
    rede.recusarPassagem(id).catch((e) => Alert.alert("Erro", e.message)).finally(carregar);

  const responder = (id: number, acao: "aceitar" | "recusar") =>
    rede.responderSolicitacao(id, acao).catch((e) => Alert.alert("Erro", e.message)).finally(carregar);

  const copiarCodigo = async (codigo: string) => {
    await Clipboard.setStringAsync(codigo);
    Alert.alert("Código copiado", `Compartilhe "${codigo}" para colegas entrarem no grupo.`);
  };

  if (carregando) {
    return (
      <View style={[styles.container, styles.centro]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Rede</Text>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={refresh} tintColor={C.primary} />}
      >
        {/* PASSAGENS PENDENTES */}
        {passagens.map((p) => (
          <View key={`pg-${p.id}`} style={styles.passagemCard}>
            <Text style={styles.passagemTitulo}>
              {p.de} quer te passar {p.resumo?.length ?? 0} paciente(s)
            </Text>
            <Text style={styles.passagemSub}>
              {[p.hospital, p.mensagem].filter(Boolean).join(" · ")}
            </Text>
            <TouchableOpacity
              onPress={() => setExpandida(expandida === p.id ? null : p.id)}
              style={styles.verResumo}
            >
              <Text style={styles.verResumoTxt}>
                {expandida === p.id ? "Ocultar resumo" : "Ver resumo"}
              </Text>
              <Ionicons
                name={expandida === p.id ? "chevron-up" : "chevron-down"}
                size={14}
                color={C.primary}
              />
            </TouchableOpacity>
            {expandida === p.id &&
              (p.resumo || []).map((r) => (
                <Text key={r.id} style={styles.resumoItem}>
                  {r.nome} — {r.diagnostico || "sem diagnóstico"}
                  {r.pendencias ? ` — ${r.pendencias} pend.` : ""}
                </Text>
              ))}
            <View style={styles.passagemAcoes}>
              <TouchableOpacity style={styles.btnRecusar} onPress={() => recusarPassagem(p.id)}>
                <Text style={styles.btnRecusarTxt}>Recusar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnAceitar} onPress={() => aceitarPassagem(p.id)}>
                <Text style={styles.btnAceitarTxt}>Aceitar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* SOLICITAÇÕES */}
        {solic.length > 0 && <Text style={styles.secaoLabel}>Solicitações pendentes</Text>}
        {solic.map((s) => (
          <View key={`sl-${s.id}`} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{iniciais(s.de.nome_exibicao)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardNome}>{s.de.nome_exibicao}</Text>
              <Text style={styles.cardSub}>{s.de.especialidade || s.de.categoria}</Text>
            </View>
            <TouchableOpacity onPress={() => responder(s.id, "recusar")} style={styles.iconBtn}>
              <Ionicons name="close-circle-outline" size={26} color={C.danger} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => responder(s.id, "aceitar")} style={styles.iconBtn}>
              <Ionicons name="checkmark-circle" size={26} color={C.accent} />
            </TouchableOpacity>
          </View>
        ))}

        {/* GRUPOS */}
        <View style={styles.secaoTopo}>
          <Text style={styles.secaoLabel}>Meus grupos</Text>
        </View>
        {grupos.map((g) => (
          <TouchableOpacity key={`g-${g.id}`} style={styles.card} onPress={() => copiarCodigo(g.codigo)}>
            <Ionicons name="people-circle-outline" size={30} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardNome}>{g.nome}</Text>
              <Text style={styles.cardSub}>
                {[g.hospital_nome, `${g.membros ?? 0} membro(s)`].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={styles.codigo}>{g.codigo}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.linhaBotoes}>
          <TouchableOpacity style={styles.btnSec} onPress={() => setModal("entrarGrupo")}>
            <Text style={styles.btnSecTxt}>Entrar num grupo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSec} onPress={() => setModal("criarGrupo")}>
            <Text style={styles.btnSecTxt}>Criar grupo</Text>
          </TouchableOpacity>
        </View>

        {/* CONEXÕES */}
        <View style={styles.secaoTopo}>
          <Text style={styles.secaoLabel}>Minhas conexões</Text>
        </View>
        {conexoes.length === 0 && (
          <Text style={styles.vazio}>Você ainda não tem conexões.</Text>
        )}
        {conexoes.map((c) => (
          <View key={`c-${c.conexaoId}`} style={styles.card}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{iniciais(c.nome_exibicao)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardNome}>{c.nome_exibicao}</Text>
              <Text style={styles.cardSub}>
                {[c.especialidade, c.categoria].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.passarBtn}
              onPress={() => setPassarPara({ id: c.id, nome: c.nome_exibicao })}
            >
              <Text style={styles.passarBtnTxt}>Passar →</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.linhaBotoes}>
          <TouchableOpacity style={styles.btnSec} onPress={() => setModal("buscar")}>
            <Text style={styles.btnSecTxt}>Buscar colega</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSec} onPress={() => setModal("convidar")}>
            <Text style={styles.btnSecTxt}>Convidar por e-mail</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ModalEntradaTexto
        visivel={modal === "entrarGrupo"}
        titulo="Entrar num grupo"
        rotulo="Código do grupo"
        placeholder="Ex.: MED4K2"
        onFechar={() => setModal(null)}
        onConfirmar={async (codigo) => {
          try {
            await rede.entrarGrupo(codigo);
            setModal(null);
            carregar();
          } catch (e: any) {
            Alert.alert("Erro", e.message);
          }
        }}
      />
      <ModalEntradaTexto
        visivel={modal === "criarGrupo"}
        titulo="Criar grupo"
        rotulo="Nome do grupo"
        placeholder="Ex.: Enfermaria 5º andar"
        onFechar={() => setModal(null)}
        onConfirmar={async (nome) => {
          try {
            await rede.criarGrupo({
              nome,
              hospital_cnes: hosp?.cnes,
              hospital_nome: hosp?.nome,
            });
            setModal(null);
            carregar();
          } catch (e: any) {
            Alert.alert("Erro", e.message);
          }
        }}
      />
      <ModalEntradaTexto
        visivel={modal === "convidar"}
        titulo="Convidar por e-mail"
        rotulo="E-mail do colega"
        placeholder="colega@email.com"
        teclado="email-address"
        onFechar={() => setModal(null)}
        onConfirmar={async (email) => {
          try {
            const r: any = await rede.convidarPorEmail(email, hosp?.cnes, hosp?.nome);
            setModal(null);
            Alert.alert(
              "Convite enviado",
              r?.tipo === "conexao"
                ? "Solicitação de conexão enviada."
                : "Convite enviado por e-mail.",
            );
            carregar();
          } catch (e: any) {
            Alert.alert("Erro", e.message);
          }
        }}
      />
      <ModalBuscarColega
        visivel={modal === "buscar"}
        hospitalCnes={hosp?.cnes}
        onFechar={() => setModal(null)}
        onConectou={carregar}
      />
      <PassarPlantaoModal
        visivel={!!passarPara}
        destinatarioPre={passarPara ?? undefined}
        onFechar={() => setPassarPara(null)}
      />
    </View>
  );
}

/** Modal simples de um campo de texto. */
function ModalEntradaTexto({
  visivel,
  titulo,
  rotulo,
  placeholder,
  teclado,
  onFechar,
  onConfirmar,
}: {
  visivel: boolean;
  titulo: string;
  rotulo: string;
  placeholder?: string;
  teclado?: "default" | "email-address";
  onFechar: () => void;
  onConfirmar: (valor: string) => void;
}) {
  const [valor, setValor] = useState("");
  return (
    <Modal visible={visivel} animationType="fade" transparent onRequestClose={onFechar}>
      <View style={styles.modalBg}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitulo}>{titulo}</Text>
          <Text style={styles.modalRotulo}>{rotulo}</Text>
          <TextInput
            style={styles.input}
            value={valor}
            onChangeText={setValor}
            placeholder={placeholder}
            placeholderTextColor={C.textMuted}
            autoCapitalize={teclado === "email-address" ? "none" : "sentences"}
            keyboardType={teclado === "email-address" ? "email-address" : "default"}
            autoFocus
          />
          <View style={styles.modalAcoes}>
            <TouchableOpacity style={styles.btnSec} onPress={() => { setValor(""); onFechar(); }}>
              <Text style={styles.btnSecTxt}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrim, !valor.trim() && { opacity: 0.5 }]}
              disabled={!valor.trim()}
              onPress={() => { onConfirmar(valor.trim()); setValor(""); }}
            >
              <Text style={styles.btnPrimTxt}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Modal de busca de colegas + conectar. */
function ModalBuscarColega({
  visivel,
  hospitalCnes,
  onFechar,
  onConectou,
}: {
  visivel: boolean;
  hospitalCnes?: string;
  onFechar: () => void;
  onConectou: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<rede.ProfissionalRede[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [conectados, setConectados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!visivel) return;
    const t = termo.trim();
    if (t.length < 2) {
      setResultados([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await rede.buscarProfissionais(t, hospitalCnes));
      } catch {
        setResultados([]);
      }
      setBuscando(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [termo, visivel, hospitalCnes]);

  const conectar = async (id: string) => {
    try {
      await rede.solicitarConexao(id);
      setConectados((c) => ({ ...c, [id]: true }));
      onConectou();
    } catch (e: any) {
      Alert.alert("Erro", e.message);
    }
  };

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={onFechar}>
      <View style={styles.buscaContainer}>
        <View style={styles.buscaTopo}>
          <Text style={styles.modalTitulo}>Buscar colega</Text>
          <TouchableOpacity onPress={() => { setTermo(""); setResultados([]); onFechar(); }} hitSlop={8}>
            <Ionicons name="close" size={26} color={C.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.buscaCampo}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} />
          <TextInput
            style={{ flex: 1, fontSize: 16, color: C.text }}
            value={termo}
            onChangeText={setTermo}
            placeholder="Buscar por nome..."
            placeholderTextColor={C.textMuted}
            autoFocus
          />
          {buscando && <ActivityIndicator size="small" color={C.primary} />}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {resultados.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{iniciais(p.nome_exibicao)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardNome}>{p.nome_exibicao}</Text>
                <Text style={styles.cardSub}>
                  {[p.especialidade, p.categoria].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {conectados[p.id] ? (
                <Text style={styles.enviado}>Enviado</Text>
              ) : (
                <TouchableOpacity style={styles.btnConectar} onPress={() => conectar(p.id)}>
                  <Text style={styles.btnConectarTxt}>Conectar</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {termo.trim().length >= 2 && !buscando && resultados.length === 0 && (
            <Text style={styles.vazio}>Nenhum colega encontrado neste hospital.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  centro: { justifyContent: "center", alignItems: "center" },
  titulo: { fontSize: 28, fontWeight: "700", color: C.text, letterSpacing: -0.5, marginBottom: 16 },
  secaoTopo: { marginTop: 20 },
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
    padding: 14,
    marginBottom: 8,
  },
  cardNome: { fontSize: 16, fontWeight: "600", color: C.text },
  cardSub: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  codigo: { fontSize: 14, fontWeight: "700", color: C.primary, letterSpacing: 1 },
  iconBtn: { padding: 4 },
  vazio: { color: C.textMuted, fontSize: 14, marginLeft: 4, marginBottom: 8 },
  linhaBotoes: { flexDirection: "row", gap: 8, marginTop: 4 },
  btnSec: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnSecTxt: { color: C.primary, fontSize: 15, fontWeight: "600" },

  // Passagem
  passagemCard: {
    backgroundColor: "#E5F0FF",
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 12,
  },
  passagemTitulo: { fontSize: 16, fontWeight: "700", color: C.text },
  passagemSub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  verResumo: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  verResumoTxt: { color: C.primary, fontSize: 14, fontWeight: "600" },
  resumoItem: { fontSize: 14, color: C.textSecondary, marginTop: 6, lineHeight: 19 },
  passagemAcoes: { flexDirection: "row", gap: 10, marginTop: 14 },
  btnRecusar: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnRecusarTxt: { color: C.danger, fontSize: 15, fontWeight: "600" },
  btnAceitar: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnAceitarTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Conectar (busca)
  btnConectar: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnConectarTxt: { color: "#fff", fontSize: 14, fontWeight: "600" },
  passarBtn: { backgroundColor: C.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  passarBtnTxt: { color: C.primary, fontSize: 13, fontWeight: "600" },
  enviado: { color: C.textMuted, fontSize: 14, fontWeight: "600" },

  // Modais
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: C.surface, borderRadius: Radius.card, padding: 20 },
  modalTitulo: { fontSize: 18, fontWeight: "700", color: C.text },
  modalRotulo: { fontSize: 13, color: C.textMuted, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: C.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.text,
  },
  modalAcoes: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnPrim: { flex: 1, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  btnPrimTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  buscaContainer: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  buscaTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
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
});
