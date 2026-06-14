import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Platform,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";

import {
  BorderWidth,
  ClinicalColors,
  Radius,
  StatusColors,
  type StatusType,
} from "@/constants/clinicalTheme";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { usePacientes } from "@/store/PacientesContext";
import { type CabecalhoProntuario } from "@/types/paciente";

// Habilita LayoutAnimation no Android (no-op em quem já suporta).
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Ordem de prioridade (topo → fim) usada tanto para avançar quanto para ordenar. */
const ORDEM_STATUS: StatusType[] = [
  "pendente",
  "visitado",
  "discutido",
  "evoluido",
];

/** Rótulo do separador de grupo (plural, maiúsculas vêm do estilo). */
const ROTULO_GRUPO: Record<StatusType, string> = {
  pendente: "Pendentes",
  visitado: "Visitados",
  discutido: "Discutidos",
  evoluido: "Evoluídos",
};

function proximoStatus(atual: StatusType): StatusType {
  const i = ORDEM_STATUS.indexOf(atual);
  return ORDEM_STATUS[(i + 1) % ORDEM_STATUS.length];
}

const INSTRUCAO_CABECALHO =
  "Esta é uma foto do cabeçalho de um prontuário do sistema hospitalar Tasy. " +
  "Extraia os dados de identificação do paciente e responda APENAS com um JSON, " +
  "sem texto adicional, com exatamente os campos: " +
  "nomeCompleto (string), idade (número ou null), setor (string com a unidade/setor de internação, ex.: 'Unidade 09 – São Francisco'), " +
  "dataEntrada (string, data de entrada/internação), numeroProntuario (string). " +
  "Não extraia o número do leito (ele será preenchido manualmente). " +
  "Se algum campo não estiver visível, use string vazia (ou null para idade).";

export default function Index() {
  const router = useRouter();
  const { pacientes, adicionarPorCabecalho, atualizarPaciente } = usePacientes();
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Agrupa por status na ordem de prioridade; só inclui grupos não-vazios.
  const secoes = ORDEM_STATUS.map((status) => ({
    status,
    titulo: ROTULO_GRUPO[status],
    data: pacientes.filter((p) => p.status === status),
  })).filter((s) => s.data.length > 0);

  // Anima a reordenação ao mudar o status (o paciente "viaja" para o grupo novo).
  const avancarStatus = (id: string, atual: StatusType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    atualizarPaciente(id, { status: proximoStatus(atual) });
  };

  const processarImagem = async (uri: string) => {
    setProcessando(true);
    setErro(null);
    try {
      const base64 = await converterParaJpegBase64(uri);
      const cabecalho = await extrairDadosImagem<CabecalhoProntuario>(
        base64,
        INSTRUCAO_CABECALHO,
      );
      // Leito não é extraído da foto — fica para preenchimento manual.
      adicionarPorCabecalho({ ...cabecalho, leito: "" });
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      console.log("Erro ao adicionar paciente:", e);
      setErro(mensagem);
    }
    setProcessando(false);
  };

  const abrirCamera = async () => {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      setErro(
        "Permissão de câmera negada. Habilite o acesso à câmera nas configurações do dispositivo.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) processarImagem(result.assets[0].uri);
  };

  const abrirGaleria = async () => {
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      setErro(
        "Permissão de galeria negada. Habilite o acesso às fotos nas configurações do dispositivo.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled) processarImagem(result.assets[0].uri);
  };

  const adicionarPaciente = () => {
    Alert.alert(
      "Adicionar paciente",
      "Como você quer capturar o cabeçalho do prontuário?",
      [
        { text: "📷 Câmera", onPress: abrirCamera },
        { text: "🖼️ Galeria / Arquivo", onPress: abrirGaleria },
        { text: "Cancelar", style: "cancel" },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTextos}>
          <Text style={styles.titulo}>Rotina do Dia</Text>
          <Text style={styles.subtitulo}>
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.botaoAdd}
          onPress={adicionarPaciente}
          disabled={processando}
          accessibilityLabel="Adicionar paciente"
        >
          {processando ? (
            <ActivityIndicator color={ClinicalColors.text} />
          ) : (
            <Text style={styles.botaoAddTexto}>+</Text>
          )}
        </TouchableOpacity>
      </View>

      {processando && (
        <Text style={styles.processando}>
          ⏳ Lendo cabeçalho do prontuário...
        </Text>
      )}

      {erro && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>⚠️ {erro}</Text>
        </View>
      )}

      <SectionList
        sections={secoes}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={
          pacientes.length === 0 ? styles.vazioContainer : styles.listaConteudo
        }
        ListEmptyComponent={
          !processando ? (
            <View style={styles.vazio}>
              <Text style={styles.vazioTitulo}>Nenhum paciente ainda</Text>
              <Text style={styles.vazioTexto}>
                Toque em + para fotografar o cabeçalho do primeiro prontuário.
              </Text>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.separador}>
            — {section.titulo} ({section.data.length}) —
          </Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({ pathname: "/paciente/[id]", params: { id: item.id } })
            }
          >
            <View style={styles.cardLeft}>
              {(!!item.leito || !!item.setor) && (
                <Text style={styles.leito}>
                  {[item.leito && `Leito ${item.leito}`, item.setor]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
              <Text style={styles.nome}>{item.nomeCompleto || "Sem nome"}</Text>
              <Text style={styles.idade}>
                {item.idade != null ? `${item.idade} anos` : "Idade —"}
                {item.numeroProntuario ? ` · Prontuário ${item.numeroProntuario}` : ""}
              </Text>
              {item.diasAcompanhamento.length > 1 && (
                <Text style={styles.dias}>
                  {item.diasAcompanhamento.length} dias de acompanhamento
                </Text>
              )}
            </View>
            <BadgeStatus
              status={item.status}
              onAvancar={() => avancarStatus(item.id, item.status)}
            />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

/**
 * Badge de status tocável: avança o status e dá um leve "pop" de escala como
 * feedback. Tem onPress próprio, separado do toque no card.
 */
function BadgeStatus({
  status,
  onAvancar,
}: {
  status: StatusType;
  onAvancar: () => void;
}) {
  const escala = useRef(new Animated.Value(1)).current;

  const aoTocar = () => {
    Animated.sequence([
      Animated.timing(escala, {
        toValue: 1.15,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(escala, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
    onAvancar();
  };

  return (
    <TouchableOpacity onPress={aoTocar} activeOpacity={0.8} hitSlop={8}>
      <Animated.View
        style={[
          styles.badge,
          {
            backgroundColor: StatusColors[status].bg,
            transform: [{ scale: escala }],
          },
        ]}
      >
        <Text style={[styles.badgeTexto, { color: StatusColors[status].text }]}>
          {StatusColors[status].label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ClinicalColors.background,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  headerTextos: { flex: 1 },
  titulo: {
    fontSize: 28,
    fontWeight: "bold",
    color: ClinicalColors.text,
    marginBottom: 4,
  },
  subtitulo: {
    fontSize: 14,
    color: ClinicalColors.textMuted,
    textTransform: "capitalize",
  },
  botaoAdd: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ClinicalColors.buttonPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  botaoAddTexto: {
    color: ClinicalColors.text,
    fontSize: 28,
    fontWeight: "600",
    lineHeight: 32,
  },
  processando: {
    color: ClinicalColors.textMuted,
    fontSize: 14,
    marginBottom: 16,
  },
  erroBox: {
    backgroundColor: StatusColors.pendente.bg,
    borderColor: StatusColors.pendente.text,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  erroTexto: { color: StatusColors.pendente.text, fontSize: 13, lineHeight: 18 },
  vazioContainer: { flexGrow: 1, justifyContent: "center" },
  listaConteudo: { paddingBottom: 24 },
  separador: {
    color: ClinicalColors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  vazio: { alignItems: "center", paddingHorizontal: 24 },
  vazioTitulo: {
    color: ClinicalColors.text,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  vazioTexto: {
    color: ClinicalColors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    borderWidth: BorderWidth.hairline,
    borderColor: ClinicalColors.border,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: { flex: 1, paddingRight: 12 },
  leito: { fontSize: 12, color: ClinicalColors.textMuted, marginBottom: 2 },
  nome: {
    fontSize: 16,
    fontWeight: "600",
    color: ClinicalColors.text,
    marginBottom: 2,
  },
  idade: { fontSize: 13, color: ClinicalColors.textMuted },
  dias: { fontSize: 12, color: ClinicalColors.primary, marginTop: 4 },
  badge: {
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeTexto: { fontSize: 12, fontWeight: "600" },
});
