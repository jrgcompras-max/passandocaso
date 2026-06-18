import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
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
import { diaDeInternacao } from "@/lib/datas";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { formatarNome } from "@/lib/formatarNome";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { useHospitais } from "@/store/HospitaisContext";
import { usePacientes } from "@/store/PacientesContext";
import { type CabecalhoProntuario, type Hospital } from "@/types/paciente";

// Habilita LayoutAnimation no Android (no-op em quem já suporta).
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Ordem de prioridade (topo → fim) usada tanto para avançar quanto para ordenar. */
const ORDEM_STATUS: StatusType[] = [
  "naoVisitado",
  "visitado",
  "revisar",
  "pendente",
  "altaProvavel",
  "altaRealizada",
];

/** Rótulo do separador de grupo (maiúsculas vêm do estilo). */
const ROTULO_GRUPO: Record<StatusType, string> = {
  naoVisitado: "Não visitados",
  visitado: "Visitados",
  revisar: "Revisar",
  pendente: "Pendentes",
  altaProvavel: "Alta provável",
  altaRealizada: "Alta realizada",
};

function proximoStatus(atual: StatusType): StatusType {
  const i = ORDEM_STATUS.indexOf(atual);
  return ORDEM_STATUS[(i + 1) % ORDEM_STATUS.length];
}

/**
 * Data por extenso em pt-BR com apenas a primeira letra maiúscula
 * (ex.: "Domingo, 14 de junho") — os meses/dias da semana ficam minúsculos.
 */
function dataPorExtenso(): string {
  const texto = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Estado inicial do formulário manual de paciente. */
const FORM_VAZIO = {
  nome: "",
  idadeNasc: "",
  leito: "",
  setor: "",
  prontuario: "",
  internacao: "",
  diagnostico: "",
  motivo: "",
};

/**
 * Interpreta o campo "Data de nascimento ou idade": número puro vira idade;
 * uma data (DD/MM/YYYY ou YYYY-MM-DD) é convertida em idade. Retorna null se
 * não reconhecer.
 */
function idadeDeTexto(txt: string): number | null {
  const t = txt.trim();
  if (!t) return null;
  if (/^\d{1,3}$/.test(t)) return Number(t);

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  const br = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  let nasc: Date | null = null;
  if (iso) {
    nasc = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  } else if (br) {
    const ano = br[3].length === 2 ? 1900 + Number(br[3]) : Number(br[3]);
    nasc = new Date(ano, Number(br[2]) - 1, Number(br[1]));
  }
  if (!nasc || Number.isNaN(nasc.getTime())) return null;

  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade >= 0 ? idade : null;
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
  const { pacientes, adicionarPorCabecalho, atualizarPaciente, removerPaciente } =
    usePacientes();
  const {
    hospitais,
    hospitalAtivo,
    carregado: hospCarregado,
    selecionar,
    trocarHospital,
    adicionarHospital,
  } = useHospitais();
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modalVisivel, setModalVisivel] = useState(false);
  const [modoModal, setModoModal] = useState<"escolha" | "form">("escolha");
  const [form, setForm] = useState(FORM_VAZIO);
  const setCampo = (campo: keyof typeof FORM_VAZIO) => (valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  // Reordenação adiada: ao trocar o status, o card mantém a posição no grupo
  // atual por 1,5s já exibindo o novo badge; depois desliza para o grupo certo.
  const [aguardando, setAguardando] = useState<Record<string, StatusType>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const grupoDe = (p: (typeof pacientes)[number]) =>
    aguardando[p.id] ?? p.status;

  // Pacientes do hospital selecionado (registros sem hospital = "geral").
  const pacientesHosp = pacientes.filter(
    (p) => (p.hospitalId ?? "geral") === hospitalAtivo,
  );

  // Agrupa por status na ordem de prioridade; só inclui grupos não-vazios.
  const secoes = ORDEM_STATUS.map((status) => ({
    status,
    titulo: ROTULO_GRUPO[status],
    data: pacientesHosp.filter((p) => grupoDe(p) === status),
  })).filter((s) => s.data.length > 0);

  const avancarStatus = (id: string, atual: StatusType) => {
    // Atualiza o status na hora (o badge já muda), mas ancora o card no grupo
    // atual para não pular; após 1,5s remove a âncora com deslize contínuo.
    setAguardando((a) => ({ ...a, [id]: a[id] ?? atual }));
    atualizarPaciente(id, { status: proximoStatus(atual) });
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      // Animação longa (550ms) para o card percorrer visivelmente a tela até o
      // grupo de destino, em vez de sumir/reaparecer.
      LayoutAnimation.configureNext({
        duration: 550,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
        create: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
        delete: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
      });
      setAguardando((a) => {
        const copia = { ...a };
        delete copia[id];
        return copia;
      });
    }, 1500);
  };

  const confirmarExcluir = (id: string, nome: string) => {
    Alert.alert(
      "Excluir paciente",
      `Remover ${nome || "este paciente"} da rotina? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            LayoutAnimation.configureNext(
              LayoutAnimation.Presets.easeInEaseOut,
            );
            removerPaciente(id);
          },
        },
      ],
    );
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
      adicionarPorCabecalho({ ...cabecalho, leito: "" }, hospitalAtivo ?? undefined);
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

  // Sub-escolha do fluxo de foto: câmera ou galeria.
  const escolherCaptura = () => {
    Alert.alert(
      "Fotografar prontuário",
      "Como você quer capturar o cabeçalho do prontuário?",
      [
        { text: "📷 Câmera", onPress: abrirCamera },
        { text: "🖼️ Galeria / Arquivo", onPress: abrirGaleria },
        { text: "Cancelar", style: "cancel" },
      ],
    );
  };

  const abrirModal = () => {
    setModoModal("escolha");
    setModalVisivel(true);
  };

  const fecharModal = () => setModalVisivel(false);

  // Opção "Fotografar prontuário": fecha o modal e segue o fluxo de foto atual.
  const escolherFoto = () => {
    setModalVisivel(false);
    escolherCaptura();
  };

  const salvarManual = () => {
    const nome = form.nome.trim();
    if (!nome) return;
    const { id } = adicionarPorCabecalho(
      {
        nomeCompleto: nome,
        idade: idadeDeTexto(form.idadeNasc),
        leito: form.leito.trim(),
        setor: form.setor.trim(),
        dataEntrada: form.internacao.trim(),
        numeroProntuario: form.prontuario.trim(),
      },
      hospitalAtivo ?? undefined,
    );
    const diag = form.diagnostico.trim();
    const mot = form.motivo.trim();
    if (diag || mot) {
      atualizarPaciente(id, {
        diagnosticoPrincipal: diag,
        motivoInternacao: mot,
      });
    }
    setForm(FORM_VAZIO);
    setModalVisivel(false);
  };

  const hospitalNome =
    hospitais.find((h) => h.id === hospitalAtivo)?.nome ?? "";

  // Antes da Rotina: tela de seleção de hospital.
  if (hospCarregado && !hospitalAtivo) {
    return (
      <SelecaoHospital
        hospitais={hospitais}
        onSelecionar={selecionar}
        onAdicionar={adicionarHospital}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTextos}>
          <TouchableOpacity onPress={trocarHospital} style={styles.trocarHosp}>
            <Text style={styles.trocarHospTexto}>
              🏥 {hospitalNome || "Hospital"} ⌄
            </Text>
          </TouchableOpacity>
          <Text style={styles.titulo}>Rotina do Dia</Text>
          <Text style={styles.subtitulo}>{dataPorExtenso()}</Text>
        </View>
        <TouchableOpacity
          style={styles.botaoAdd}
          onPress={abrirModal}
          disabled={processando}
          accessibilityLabel="Adicionar paciente"
        >
          {processando ? (
            <ActivityIndicator color={ClinicalColors.textOnPrimary} />
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
          pacientesHosp.length === 0 ? styles.vazioContainer : styles.listaConteudo
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
        renderItem={({ item }) => {
          const dia = diaDeInternacao(item.dataEntrada);
          const pendenciasAbertas =
            item.pendencias?.filter((p) => !p.feito).length ?? 0;
          return (
            <ReanimatedSwipeable
              friction={2}
              rightThreshold={40}
              overshootRight={false}
              renderRightActions={() => (
                <TouchableOpacity
                  style={styles.swipeExcluir}
                  onPress={() => confirmarExcluir(item.id, item.nomeCompleto)}
                >
                  <Text style={styles.swipeExcluirTexto}>Excluir</Text>
                </TouchableOpacity>
              )}
            >
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
                  <Text style={styles.nome}>
                    {formatarNome(item.nomeCompleto) || "Sem nome"}
                  </Text>
                  <Text style={styles.idade}>
                    {item.idade != null ? `${item.idade} anos` : "Idade —"}
                    {item.numeroProntuario
                      ? ` · Prontuário ${item.numeroProntuario}`
                      : ""}
                  </Text>
                  {!!item.diagnosticoPrincipal && (
                    <Text style={styles.diagnostico} numberOfLines={2}>
                      {item.diagnosticoPrincipal}
                    </Text>
                  )}
                  <View style={styles.metaRow}>
                    {dia != null && <Text style={styles.diaBadge}>D{dia}</Text>}
                    {pendenciasAbertas > 0 && (
                      <Text style={styles.pendenciasIndicador}>
                        {pendenciasAbertas}{" "}
                        {pendenciasAbertas === 1 ? "pendência" : "pendências"}
                      </Text>
                    )}
                  </View>
                </View>
                <BadgeStatus
                  status={item.status}
                  onAvancar={() => avancarStatus(item.id, item.status)}
                />
              </TouchableOpacity>
            </ReanimatedSwipeable>
          );
        }}
      />

      <Modal
        visible={modalVisivel}
        animationType="slide"
        transparent
        onRequestClose={fecharModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitulo}>
                {modoModal === "escolha"
                  ? "Adicionar paciente"
                  : "Preencher manualmente"}
              </Text>
              <TouchableOpacity onPress={fecharModal} hitSlop={8}>
                <Text style={styles.modalFechar}>✕</Text>
              </TouchableOpacity>
            </View>

            {modoModal === "escolha" ? (
              <View style={styles.modalOpcoes}>
                <TouchableOpacity style={styles.opcaoBtn} onPress={escolherFoto}>
                  <Text style={styles.opcaoBtnTexto}>
                    📷 Fotografar prontuário
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.opcaoBtn, styles.opcaoBtnSecundaria]}
                  onPress={() => setModoModal("form")}
                >
                  <Text
                    style={[styles.opcaoBtnTexto, styles.opcaoBtnTextoSecundaria]}
                  >
                    ✏️ Preencher manualmente
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                style={styles.modalForm}
                keyboardShouldPersistTaps="handled"
              >
                <CampoForm
                  label="Nome completo *"
                  value={form.nome}
                  onChange={setCampo("nome")}
                />
                <CampoForm
                  label="Data de nascimento ou idade"
                  value={form.idadeNasc}
                  onChange={setCampo("idadeNasc")}
                  placeholder="Ex.: 72 ou 07/06/1953"
                />
                <CampoForm
                  label="Leito"
                  value={form.leito}
                  onChange={setCampo("leito")}
                />
                <CampoForm
                  label="Setor"
                  value={form.setor}
                  onChange={setCampo("setor")}
                />
                <CampoForm
                  label="Número do prontuário"
                  value={form.prontuario}
                  onChange={setCampo("prontuario")}
                />
                <CampoForm
                  label="Data de internação"
                  value={form.internacao}
                  onChange={setCampo("internacao")}
                  placeholder="Ex.: 07/06/2026"
                />
                <CampoForm
                  label="Diagnóstico principal"
                  value={form.diagnostico}
                  onChange={setCampo("diagnostico")}
                />
                <CampoForm
                  label="Motivo da internação"
                  value={form.motivo}
                  onChange={setCampo("motivo")}
                  multiline
                />
                <TouchableOpacity
                  style={[
                    styles.salvarBtn,
                    !form.nome.trim() && styles.salvarBtnDesativado,
                  ]}
                  onPress={salvarManual}
                  disabled={!form.nome.trim()}
                >
                  <Text style={styles.salvarBtnTexto}>Salvar paciente</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** Campo de formulário do modal de adicionar paciente (tema claro). */
function CampoForm({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.campoForm}>
      <Text style={styles.campoFormLabel}>{label}</Text>
      <TextInput
        style={[styles.campoFormInput, multiline && styles.campoFormInputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? "—"}
        placeholderTextColor={ClinicalColors.textMuted}
        multiline={multiline}
      />
    </View>
  );
}

/**
 * Tela de seleção de hospital (antes da Rotina do Dia). Lista os hospitais do
 * médico e permite adicionar um novo (nome + cidade).
 */
function SelecaoHospital({
  hospitais,
  onSelecionar,
  onAdicionar,
}: {
  hospitais: Hospital[];
  onSelecionar: (id: string) => void;
  onAdicionar: (nome: string, cidade: string) => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nome, setNome] = useState("");
  const [cidade, setCidade] = useState("");

  const salvar = () => {
    if (!nome.trim()) return;
    onAdicionar(nome, cidade);
    setNome("");
    setCidade("");
    setMostrarForm(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTextos}>
          <Text style={styles.titulo}>Hospitais</Text>
          <Text style={styles.subtitulo}>
            Selecione um hospital para começar
          </Text>
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
        <View style={styles.hospForm}>
          <CampoForm label="Nome do hospital *" value={nome} onChange={setNome} />
          <CampoForm label="Cidade" value={cidade} onChange={setCidade} />
          <TouchableOpacity
            style={[styles.salvarBtn, !nome.trim() && styles.salvarBtnDesativado]}
            onPress={salvar}
            disabled={!nome.trim()}
          >
            <Text style={styles.salvarBtnTexto}>Salvar hospital</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.listaConteudo}>
        {hospitais.map((h) => (
          <TouchableOpacity
            key={h.id}
            style={styles.hospCard}
            onPress={() => onSelecionar(h.id)}
          >
            <Text style={styles.hospNome}>{h.nome}</Text>
            {!!h.cidade && <Text style={styles.hospCidade}>{h.cidade}</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
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
    color: ClinicalColors.textOnPrimary,
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
    color: ClinicalColors.chevron,
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
  diagnostico: {
    fontSize: 14,
    color: ClinicalColors.text,
    fontWeight: "500",
    marginTop: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  diaBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: ClinicalColors.primary,
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  pendenciasIndicador: {
    fontSize: 12,
    fontWeight: "600",
    color: ClinicalColors.warning,
    backgroundColor: ClinicalColors.warningBg,
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  badge: {
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeTexto: { fontSize: 12, fontWeight: "600" },
  swipeExcluir: {
    backgroundColor: "#991B1B",
    justifyContent: "center",
    alignItems: "center",
    width: 96,
    marginBottom: 12,
    borderRadius: Radius.card,
  },
  swipeExcluirTexto: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },

  // Multi-hospital
  trocarHosp: { marginBottom: 4, alignSelf: "flex-start" },
  trocarHospTexto: {
    color: ClinicalColors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  hospForm: {
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  hospCard: {
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 12,
  },
  hospNome: { fontSize: 16, fontWeight: "600", color: ClinicalColors.text },
  hospCidade: { fontSize: 13, color: ClinicalColors.textMuted, marginTop: 2 },

  // Modal de adicionar paciente
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 45, 82, 0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: ClinicalColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: "88%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: ClinicalColors.text,
  },
  modalFechar: { fontSize: 18, color: ClinicalColors.textMuted },
  modalOpcoes: { gap: 12, paddingBottom: 8 },
  opcaoBtn: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.card,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: BorderWidth.hairline,
    borderColor: ClinicalColors.buttonPrimary,
  },
  opcaoBtnTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  opcaoBtnSecundaria: {
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.primary,
  },
  opcaoBtnTextoSecundaria: { color: ClinicalColors.primary },
  modalForm: {},
  campoForm: { marginBottom: 12 },
  campoFormLabel: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    marginBottom: 6,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  campoFormInput: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: ClinicalColors.text,
    fontSize: 15,
  },
  campoFormInputMulti: { minHeight: 64, textAlignVertical: "top" },
  salvarBtn: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.card,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  salvarBtnDesativado: { opacity: 0.5 },
  salvarBtnTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
});
