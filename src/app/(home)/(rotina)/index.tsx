import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, { FadeOut, LinearTransition } from "react-native-reanimated";
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import {
  BorderWidth,
  ClinicalColors,
  Radius,
  StatusColors,
  type StatusType,
} from "@/constants/clinicalTheme";
import {
  type AlertaTendencia,
  buscarAlertas,
  setaAlerta,
} from "@/lib/alertasTendencia";
import { diaDeInternacao } from "@/lib/datas";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { formatarNome } from "@/lib/formatarNome";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { ModalMigracao } from "@/components/ModalMigracao";
import { PassarPlantaoModal } from "@/components/PassarPlantaoModal";
import * as rede from "@/lib/rede";
import { useAcoes } from "@/store/AcoesContext";
import { KEY_MIGRACAO_GERAL, useHospitais } from "@/store/HospitaisContext";
import { usePacientes } from "@/store/PacientesContext";
import { type CabecalhoProntuario } from "@/types/paciente";

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

/** Ordem de prioridade para abrir o primeiro grupo com pacientes no launch. */
const ORDEM_AUTO: StatusType[] = [
  "naoVisitado",
  "revisar",
  "pendente",
  "visitado",
  "altaProvavel",
  "altaRealizada",
];
const KEY_GRUPOS = "@passandocaso/gruposAbertos";

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
  const { pedidoAdicionar, recebidos, limparRecebidos } = useAcoes();

  // Destaque transitório dos pacientes recém-recebidos por passagem de plantão:
  // um leve realce que esmaece sozinho — confirma visualmente que "deu certo".
  const destaqueAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recebidos.length) return;
    destaqueAnim.setValue(1);
    const t = Animated.timing(destaqueAnim, {
      toValue: 0,
      duration: 2200,
      delay: 600,
      useNativeDriver: false,
    });
    t.start(({ finished }) => {
      if (finished) limparRecebidos();
    });
    return () => t.stop();
  }, [recebidos, destaqueAnim, limparRecebidos]);
  const {
    pacientes,
    carregado: pacCarregado,
    adicionarPorCabecalho,
    atualizarPaciente,
    removerPaciente,
  } = usePacientes();
  const {
    hospitais,
    hospitalAtivo,
    carregado: hospCarregado,
    selecionar,
  } = useHospitais();

  // Sem hospital ativo, seleciona "Geral" por padrão (a troca é feita na aba Hospitais).
  useEffect(() => {
    if (hospCarregado && !hospitalAtivo) selecionar("geral");
  }, [hospCarregado, hospitalAtivo, selecionar]);

  // Migração do "Geral": pergunta uma vez se houver pacientes em "Geral".
  const [migracaoVisivel, setMigracaoVisivel] = useState(false);
  const migracaoChecada = useRef(false);
  useEffect(() => {
    if (migracaoChecada.current || !pacCarregado || !hospCarregado) return;
    migracaoChecada.current = true;
    (async () => {
      const feita = await AsyncStorage.getItem(KEY_MIGRACAO_GERAL);
      if (feita) return;
      const temGeralComPac = pacientes.some(
        (p) => (p.hospitalId ?? "geral") === "geral",
      );
      const temGeral = hospitais.some((h) => h.id === "geral");
      if (temGeralComPac && temGeral) setMigracaoVisivel(true);
    })();
  }, [pacCarregado, hospCarregado, pacientes, hospitais]);

  const concluirMigracao = (sucesso: boolean) => {
    setMigracaoVisivel(false);
    if (sucesso) AsyncStorage.setItem(KEY_MIGRACAO_GERAL, "1").catch(() => {});
  };

  // Botão "Passar plantão" só aparece se houver conexões ou grupos.
  const [passarVisivel, setPassarVisivel] = useState(false);
  const [temRede, setTemRede] = useState(false);
  useEffect(() => {
    Promise.all([
      rede.listarConexoes().catch(() => []),
      rede.listarGrupos().catch(() => []),
    ]).then(([cx, gr]) => setTemRede(cx.length + gr.length > 0));
  }, []);
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

  // Alertas de tendência laboratorial por paciente. Busca em paralelo (não
  // bloqueia a lista); falha silenciosa quando o backend está indisponível.
  const [alertas, setAlertas] = useState<Record<string, AlertaTendencia[]>>({});
  const [atualizando, setAtualizando] = useState(false);
  const idsHosp = pacientesHosp.map((p) => p.id).join(",");

  const carregarAlertas = async (forcar = false) => {
    const ids = idsHosp ? idsHosp.split(",") : [];
    if (ids.length === 0) {
      setAlertas({});
      return;
    }
    const pares = await Promise.all(
      ids.map(async (pid) => [pid, await buscarAlertas(pid, forcar)] as const),
    );
    setAlertas(Object.fromEntries(pares));
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      const ids = idsHosp ? idsHosp.split(",") : [];
      if (ids.length === 0) {
        if (vivo) setAlertas({});
        return;
      }
      const pares = await Promise.all(
        ids.map(async (pid) => [pid, await buscarAlertas(pid)] as const),
      );
      if (vivo) setAlertas(Object.fromEntries(pares));
    })();
    return () => {
      vivo = false;
    };
  }, [idsHosp]);

  const aoAtualizar = async () => {
    setAtualizando(true);
    try {
      await carregarAlertas(true);
    } finally {
      setAtualizando(false);
    }
  };

  // Agrupa por status na ordem de prioridade; só inclui grupos não-vazios.
  const secoes = ORDEM_STATUS.map((status) => ({
    status,
    titulo: ROTULO_GRUPO[status],
    data: pacientesHosp.filter((p) => grupoDe(p) === status),
  })).filter((s) => s.data.length > 0);

  // Grupos expansíveis. Estado salvo no AsyncStorage; "Não visitados" (ou o
  // primeiro grupo com pacientes) sempre reabre no launch.
  const [grupoAberto, setGrupoAberto] = useState<Record<string, boolean>>({});
  const initGrupos = useRef(false);
  const temPac = (st: StatusType) => pacientesHosp.some((p) => grupoDe(p) === st);
  const primeiroComPac = ORDEM_AUTO.find((st) => temPac(st));
  const estaAberto = (st: StatusType) => grupoAberto[st] ?? st === primeiroComPac;

  useEffect(() => {
    if (initGrupos.current || pacientes.length === 0) return;
    initGrupos.current = true;
    (async () => {
      let salvo: Record<string, boolean> = {};
      try {
        const raw = await AsyncStorage.getItem(KEY_GRUPOS);
        if (raw) salvo = JSON.parse(raw) || {};
      } catch {
        // sem cache
      }
      // O grupo de maior prioridade com pacientes volta ao padrão (aberto).
      const primeiro = ORDEM_AUTO.find((st) =>
        pacientesHosp.some((p) => grupoDe(p) === st),
      );
      if (primeiro) delete salvo[primeiro];
      setGrupoAberto(salvo);
    })();
  }, [pacientes, pacientesHosp]);

  const alternarGrupo = (st: StatusType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setGrupoAberto((prev) => {
      const atual = prev[st] ?? st === primeiroComPac;
      const novo = { ...prev, [st]: !atual };
      AsyncStorage.setItem(KEY_GRUPOS, JSON.stringify(novo)).catch(() => {});
      return novo;
    });
  };

  const avancarStatus = (id: string, atual: StatusType) => {
    // Atualiza o status na hora (o badge já muda), mas ancora o card no grupo
    // atual para não pular; após 1,5s remove a âncora com deslize contínuo.
    setAguardando((a) => ({ ...a, [id]: a[id] ?? atual }));
    atualizarPaciente(id, { status: proximoStatus(atual) });
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      // Remove a âncora; o reanimated (layout=LinearTransition no card) desliza
      // o card continuamente até o grupo de destino.
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
            // O reanimated (exiting=FadeOut no card) anima a saída suavemente.
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
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!result.canceled) processarImagem(result.assets[0].uri);
  };

  const abrirModal = () => {
    setModoModal("escolha");
    setModalVisivel(true);
  };

  const fecharModal = () => setModalVisivel(false);

  // O botão "+" da tab bar incrementa o pedido; aqui abrimos o modal de adicionar.
  const ultimoPedido = useRef(0);
  useEffect(() => {
    if (pedidoAdicionar > ultimoPedido.current) {
      ultimoPedido.current = pedidoAdicionar;
      abrirModal();
    }
  }, [pedidoAdicionar]);

  // Opção "Escanear prontuário": fecha o modal e abre a câmera direto.
  const escolherFoto = () => {
    setModalVisivel(false);
    abrirCamera();
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTextos}>
          <Text style={styles.titulo}>Rotina do Dia</Text>
          <TouchableOpacity
            style={styles.hospTopo}
            onPress={() => router.navigate("/hospitais")}
            hitSlop={6}
          >
            <Ionicons name="business-outline" size={14} color={ClinicalColors.primary} />
            <Text style={styles.hospTopoTexto}>
              {hospitalNome || "Selecionar hospital"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={ClinicalColors.primary} />
          </TouchableOpacity>
          <Text style={styles.subtitulo}>{dataPorExtenso()}</Text>
          {temRede && (
            <TouchableOpacity
              style={styles.passarBtn}
              onPress={() => setPassarVisivel(true)}
              hitSlop={6}
            >
              <Ionicons name="arrow-redo-outline" size={15} color={ClinicalColors.primary} />
              <Text style={styles.passarTxt}>Passar plantão</Text>
            </TouchableOpacity>
          )}
        </View>
        {processando && <ActivityIndicator color={ClinicalColors.primary} />}
      </View>

      {processando && (
        <Text style={styles.processando}>
          Lendo cabeçalho do prontuário...
        </Text>
      )}

      {erro && (
        <View style={styles.erroBox}>
          <Text style={styles.erroTexto}>{erro}</Text>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={
          pacientesHosp.length === 0 ? styles.vazioContainer : styles.listaConteudo
        }
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={atualizando} onRefresh={aoAtualizar} />
        }
      >
        {pacientesHosp.length === 0
          ? !processando && (
              <View style={styles.vazio}>
                <Text style={styles.vazioTitulo}>Nenhum paciente ainda</Text>
                <Text style={styles.vazioTexto}>
                  Toque em + para fotografar o cabeçalho do primeiro prontuário.
                </Text>
              </View>
            )
          : secoes.flatMap((s) => [
              <Reanimated.View
                key={`h-${s.status}`}
                layout={LinearTransition.duration(450)}
              >
                <TouchableOpacity
                  style={styles.grupoHeader}
                  onPress={() => alternarGrupo(s.status)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.separador}>
                    {s.titulo} ({s.data.length})
                  </Text>
                  <Ionicons
                    name={estaAberto(s.status) ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={ClinicalColors.chevron}
                  />
                </TouchableOpacity>
              </Reanimated.View>,
              ...(estaAberto(s.status)
                ? s.data.map((item) => {
                const dia = diaDeInternacao(item.dataEntrada);
                const pendenciasAbertas =
                  item.pendencias?.filter((p) => !p.feito).length ?? 0;
                return (
                  <Reanimated.View
                    key={item.id}
                    layout={LinearTransition.duration(450)}
                    exiting={FadeOut.duration(250)}
                  >
                    <ReanimatedSwipeable
                      friction={2}
                      rightThreshold={40}
                      overshootRight={false}
                      renderRightActions={() => (
                        <TouchableOpacity
                          style={styles.swipeExcluir}
                          onPress={() =>
                            confirmarExcluir(item.id, item.nomeCompleto)
                          }
                        >
                          <Text style={styles.swipeExcluirTexto}>Excluir</Text>
                        </TouchableOpacity>
                      )}
                    >
                      <TouchableOpacity
                        style={styles.card}
                        onPress={() =>
                          router.push({
                            pathname: "/paciente/[id]",
                            params: { id: item.id },
                          })
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
                          {!!item.recebidoDe && (
                            <Text style={styles.recebidoTag}>
                              ↓ {item.recebidoDe.nome}
                            </Text>
                          )}
                          <View style={styles.metaRow}>
                            {dia != null && (
                              <Text style={styles.diaBadge}>D{dia}</Text>
                            )}
                            {pendenciasAbertas > 0 && (
                              <Text style={styles.pendenciasIndicador}>
                                {pendenciasAbertas}{" "}
                                {pendenciasAbertas === 1 ? "pendência" : "pendências"}
                              </Text>
                            )}
                            {(alertas[item.id] ?? [])
                              .slice(0, 2)
                              .map((a) => (
                                <View
                                  key={a.lab}
                                  style={[
                                    styles.badgeAlertaPill,
                                    a.severidade === "alerta"
                                      ? styles.badgeAlerta
                                      : styles.badgeAtencao,
                                  ]}
                                >
                                  <Ionicons
                                    name={
                                      a.severidade === "alerta"
                                        ? "alert-circle-outline"
                                        : "warning-outline"
                                    }
                                    size={12}
                                    color={
                                      a.severidade === "alerta"
                                        ? "#FF3B30"
                                        : "#FF9500"
                                    }
                                  />
                                  <Text
                                    style={
                                      a.severidade === "alerta"
                                        ? styles.badgeAlertaTexto
                                        : styles.badgeAtencaoTexto
                                    }
                                  >
                                    {a.label} {setaAlerta(a)}
                                  </Text>
                                </View>
                              ))}
                            {(alertas[item.id]?.length ?? 0) > 2 && (
                              <Text style={styles.badgeMais}>
                                +{(alertas[item.id]?.length ?? 0) - 2}
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
                    {recebidos.includes(item.id) && (
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.recebidoDestaque, { opacity: destaqueAnim }]}
                      />
                    )}
                  </Reanimated.View>
                );
                  })
                : []),
            ])}
      </ScrollView>

      <Modal
        visible={modalVisivel}
        animationType="slide"
        transparent
        onRequestClose={fecharModal}
      >
        <View style={styles.modalOverlay}>
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
                  <Ionicons
                    name="scan-outline"
                    size={20}
                    color={ClinicalColors.textOnPrimary}
                  />
                  <Text style={styles.opcaoBtnTexto}>Escanear prontuário</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.opcaoBtn, styles.opcaoBtnSecundaria]}
                  onPress={() => setModoModal("form")}
                >
                  <Text
                    style={[styles.opcaoBtnTexto, styles.opcaoBtnTextoSecundaria]}
                  >
                    Preencher manualmente
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <KeyboardAwareScrollView
                style={styles.modalForm}
                keyboardShouldPersistTaps="handled"
                enableOnAndroid
                enableAutomaticScroll
                extraScrollHeight={20}
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
              </KeyboardAwareScrollView>
            )}
          </View>
        </View>
      </Modal>

      <ModalMigracao visivel={migracaoVisivel} onConcluir={concluirMigracao} />
      <PassarPlantaoModal visivel={passarVisivel} onFechar={() => setPassarVisivel(false)} />
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
    fontWeight: "700",
    color: ClinicalColors.text,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  hospTopo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  hospTopoTexto: {
    fontSize: 14,
    fontWeight: "600",
    color: ClinicalColors.primary,
  },
  subtitulo: {
    fontSize: 14,
    color: ClinicalColors.textMuted,
    marginTop: 2,
  },
  passarBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  passarTxt: { color: ClinicalColors.primary, fontSize: 15, fontWeight: "600" },
  recebidoTag: {
    fontSize: 11,
    fontStyle: "italic",
    color: ClinicalColors.textMuted,
    marginTop: 2,
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
  listaConteudo: { paddingBottom: 110 },
  grupoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingRight: 4,
    marginTop: 4,
  },
  separador: {
    color: ClinicalColors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: 4,
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
  // Badges de alerta de tendência laboratorial.
  badgeAlertaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: Radius.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeAtencao: { backgroundColor: "#FFF3E0" },
  badgeAtencaoTexto: { fontSize: 11, fontWeight: "700", color: "#FF9500" },
  badgeAlerta: { backgroundColor: "#FFE5E5" },
  badgeAlertaTexto: { fontSize: 11, fontWeight: "700", color: "#FF3B30" },
  badgeMais: {
    fontSize: 11,
    fontWeight: "600",
    color: ClinicalColors.textMuted,
  },
  // Realce transitório de paciente recém-recebido (passagem aceita).
  recebidoDestaque: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 12,
    borderRadius: Radius.card,
    backgroundColor: "rgba(10,132,255,0.10)",
    borderWidth: 1.5,
    borderColor: ClinicalColors.primary,
  },
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
  topoLinha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sairTexto: {
    color: ClinicalColors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
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
    backgroundColor: "#4D94FF",
    borderRadius: Radius.card,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: BorderWidth.hairline,
    borderColor: "#4D94FF",
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
