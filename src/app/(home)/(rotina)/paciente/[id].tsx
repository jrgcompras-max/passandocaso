import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    AppState,
    LayoutAnimation,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    BorderWidth,
    ClinicalColors,
    PrioridadeColors,
    Radius,
    StatusClinicoColors,
    StatusColors,
    type Prioridade,
    type StatusClinico,
    type StatusType,
} from "@/constants/clinicalTheme";
import {
  EVOLUCAO_VAZIA,
  OPC_CONSCIENCIA,
  OPC_ORIENTACAO,
  type Opcao,
} from "@/constants/evolucao";
import { CHECKLIST_ALTA } from "@/constants/checklistAlta";
import { SECOES } from "@/constants/secoes";
import { categorizarAnotacao } from "@/lib/categorizarAnotacao";
import { classificarMedicamento } from "@/lib/classificarMedicamento";
import { ehAntibiotico } from "@/lib/passarCaso";
import { textoComDiaAtual } from "@/lib/medicamentoDia";
import {
  extrairLabsMultiData,
  mesclarResultadosLab,
} from "@/lib/extrairLabsMultiData";
import { brParaISO, diaDeInternacao, formatarDataBR, hojeISO, limparDataEmTexto, ontemISO } from "@/lib/datas";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { formatarNome } from "@/lib/formatarNome";
import { gerarResumoIA } from "@/lib/gerarResumoIA";
import { useCrop, useCapturaPaginas } from "@/components/CropImagem";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { abreviarLab, agruparPorExame, type ExameSerie, GRUPOS_LAB, grupoLab, ordemLab, TENDENCIA_INFO, unidadeExibicaoLab } from "@/lib/lab";
import {
  carregarReferencias,
  classificarLabSync,
  DISCLAIMER_ABIM,
} from "@/lib/labsReferencia";
import { EscoresClinicosSecao } from "@/components/EscoresClinicosSecao";
import {
  buscarInteracoes,
  buscarPosologia,
  calcularTFG,
  type Interacao,
  type Posologia,
  type Severidade,
  textoPosologia,
  type TFG,
} from "@/lib/farmaco";
import { listarGlobais, listarPessoais, logTermos as logChipTermos } from "@/lib/chips";
import {
  buscarReferencia,
  type ReferenciaLab,
  statusReferencia,
  textoReferencia,
  valorNumerico,
} from "@/lib/ontologia";
import { montarDadosParaResumo } from "@/lib/resumoPaciente";
import {
  type AlertaTendencia,
  buscarAlertas,
  descreverAlerta,
  serieFormatada,
} from "@/lib/alertasTendencia";
import { listarEvolucaoDiaria, salvarSnapshotDiario } from "@/lib/salvarEvolucaoDiaria";
import { fraseSinaisVitais, O2_OPCOES, SV_VAZIO } from "@/lib/sinaisVitais";
import { useAuth } from "@/store/AuthContext";
import { usePacientes } from "@/store/PacientesContext";
import {
  type Anotacao,
  type DadosClinicos,
  type EvolucaoBeiraLeito,
  type Medicamento,
  type Paciente as PacienteModel,
  type Pendencia,
  type Problema,
  type ProblemaStatus,
  type ResultadoLab,
  type SecaoId,
  type SinaisVitaisDia,
} from "@/types/paciente";

// FEATURE 1: accordion da ficha — uma seção aberta por vez. O estado fica no
// componente pai (Paciente) e cada seção usa useSecaoAccordion(id) no lugar do
// useState local. Mantém a mesma assinatura de setAberto (não muda os call sites).
const AccordionContext = createContext<{
  abertaId: string | null;
  setAbertaId: (next: string | null) => void;
}>({ abertaId: null, setAbertaId: () => {} });

function useSecaoAccordion(
  id: string,
): [boolean, (next: boolean | ((v: boolean) => boolean)) => void] {
  const { abertaId, setAbertaId } = useContext(AccordionContext);
  const aberto = abertaId === id;
  const setAberto = (next: boolean | ((v: boolean) => boolean)) => {
    const novo = typeof next === "function" ? next(aberto) : next;
    setAbertaId(novo ? id : null);
  };
  return [aberto, setAberto];
}

const STATUS_OPCOES = Object.keys(StatusColors) as StatusType[];
const STATUS_CLINICO_OPCOES = Object.keys(StatusClinicoColors) as StatusClinico[];
const PRIORIDADE_OPCOES = Object.keys(PrioridadeColors) as Prioridade[];

/** Categorias de anotação por seção (chave usada pela IA + rótulo + cor do badge). */
type CategoriaAnotacao = { chave: string; label: string; cor: string };
const CATEGORIAS_SECAO: Partial<Record<SecaoId, CategoriaAnotacao[]>> = {
  comorbidadesMedicacoes: [
    { chave: "comorbidade", label: "Comorbidade", cor: "#1A6B8A" },
    { chave: "medicacao", label: "MUC", cor: "#0E7A5A" },
  ],
  prescricaoHospitalar: [
    { chave: "atb", label: "ATB", cor: "#991B1B" },
    { chave: "antifungico", label: "Antifúngico", cor: "#9A3412" },
    { chave: "anticoagulante", label: "Anticoagulante", cor: "#6B21A8" },
    { chave: "outro", label: "Outro", cor: "#64748B" },
  ],
};

/** Rótulos dos estados de um problema ativo. */
const PROBLEMA_STATUS_LABEL: Record<ProblemaStatus, string> = {
  ativo: "Ativo",
  resolvendo: "Resolvendo",
  resolvido: "Resolvido",
};
const PROBLEMA_STATUS_OPCOES = Object.keys(
  PROBLEMA_STATUS_LABEL,
) as ProblemaStatus[];

/** Gera um id estável a partir do horário atual. */
function novoId(): string {
  return String(Date.now());
}

// Placeholders que a IA às vezes devolve para campos ausentes (dose/via/freq) —
// não devem ser concatenados ("Losartana não informada não informada").
const RE_PLACEHOLDER_MED =
  /^(n[ãa]o\s*informad[oa]?|sem\s*informa\w*|nenhum[oa]?|n\/?a|null|undefined|[-—.]+|\?+)$/i;
function campoMedValido(v?: string | null): boolean {
  const t = String(v ?? "").trim();
  return !!t && !RE_PLACEHOLDER_MED.test(t);
}

/** Sufixo comum: força a resposta da IA a vir como JSON estruturado em blocos. */
const SUFIXO_JSON =
  'Responda APENAS com JSON no formato {"blocos": [{"titulo": "<rótulo curto, ou string vazia>", "itens": ["<item curto>", ...]}]}, sem texto adicional. ' +
  "Regras obrigatórias: " +
  "(1) Cada item é UMA única informação atômica — uma comorbidade, uma medicação com sua dose/posologia, um exame com valor e unidade, um sinal vital. NUNCA junte várias informações no mesmo item nem devolva texto corrido. " +
  "(2) Organize os itens em blocos por categoria clínica, do mais relevante para o menos relevante, usando títulos curtos e padronizados. " +
  "(3) Não invente dados ausentes na imagem; omita o que não houver. " +
  "(4) Não escreva nada fora do JSON. " +
  'Exemplo de resposta CORRETA (itens separados, nunca em lista única): ' +
  '{"blocos":[{"titulo":"Comorbidades","itens":["HAS","DM2","DPOC","AVC isquêmico prévio"]},' +
  '{"titulo":"Medicações de uso contínuo","itens":["AAS 100 mg/dia","Losartana 50 mg/dia","Metformina 500 mg 2-0-2"]}]}';

/** Um agrupamento clínico do conteúdo extraído: rótulo opcional + itens.
 * `destacados` (FEATURE 3): trechos do laudo marca-texto (imagem). */
type Bloco = { titulo?: string; itens: string[]; destacados?: string[] };

/** Quebra um laudo em frases tocáveis (sem lookbehind, p/ Hermes). */
function fragmentarLaudo(texto: string): string[] {
  return (String(texto || "").match(/[^.;]+[.;]?/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Horário atual no formato HH:MM (local). */
function horaAgora(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Normaliza o valor de `anotacoes` para uma lista. Registros antigos guardavam
 * as anotações como uma única string — converte para uma anotação avulsa.
 */
function normalizarAnotacoes(valor: unknown): Anotacao[] {
  if (Array.isArray(valor)) return valor as Anotacao[];
  if (typeof valor === "string" && valor.trim()) {
    return [{ id: "legado", texto: valor, horario: "" }];
  }
  return [];
}

/**
 * Fallback de exibição: mapeia os dados clínicos no formato legado para a seção
 * correspondente, para que pacientes salvos antes das seções não percam o que já
 * havia sido extraído.
 */
function extraidoLegado(
  dados: DadosClinicos | null | undefined,
  secao: SecaoId,
): string {
  if (!dados) return "";
  switch (secao) {
    case "comorbidadesMedicacoes":
    case "comorbidades":
      return dados.comorbidades;
    case "historia":
      return dados.motivoInternacao;
    case "examesLaboratoriais":
      return dados.examesRecentes;
    case "sinaisVitaisIntercorrencias":
      return [dados.sinaisVitais, dados.intercorrencias]
        .filter(Boolean)
        .join("\n\n");
    default:
      return "";
  }
}

/** Blocos crus do JSON extraído (sem dividir itens — para migração/leitura). */
function blocosBrutos(texto: string | undefined): Bloco[] {
  const t = (texto || "").trim();
  if (!t.startsWith("[")) return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? (v as Bloco[]) : [];
  } catch {
    return [];
  }
}

const normMerge = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Mescla os blocos de uma nova foto com os já existentes (merge não destrutivo):
 * mantém os itens atuais e ACRESCENTA apenas os novos não duplicados (agrupados
 * por título de bloco). Nunca descarta o que já foi escaneado. (BUG 3)
 */
function mergeBlocos(extraidoAtual: string, novos: Bloco[]): Bloco[] {
  const porTitulo = new Map<string, Bloco>();
  const ordem: string[] = [];
  const obter = (titulo?: string) => {
    const k = normMerge(titulo || "");
    if (!porTitulo.has(k)) {
      porTitulo.set(k, { titulo: titulo || "", itens: [] });
      ordem.push(k);
    }
    return porTitulo.get(k) as Bloco;
  };
  const adicionar = (blocos: Bloco[]) => {
    for (const b of blocos) {
      const alvo = obter(b.titulo);
      const vistos = new Set(alvo.itens.map(normMerge));
      for (const it of b.itens || []) {
        const n = normMerge(it);
        if (n && !vistos.has(n)) {
          alvo.itens.push(it);
          vistos.add(n);
        }
      }
      // FEATURE 3 / BUG 6: preserva o marca-texto ao re-escanear (merge dos
      // trechos destacados do mesmo exame).
      if (b.destacados?.length) {
        alvo.destacados = [...new Set([...(alvo.destacados ?? []), ...b.destacados])];
      }
    }
  };
  adicionar(blocosBrutos(extraidoAtual));
  adicionar(novos);
  return ordem.map((k) => porTitulo.get(k) as Bloco).filter((b) => b.itens.length);
}

/**
 * Compatibilidade: deriva o conteúdo das seções separadas (comorbidades /
 * medicacoesUsoContinuo) a partir da seção combinada antiga (comorbidadesMedicacoes),
 * filtrando os blocos pelo título. Assim registros antigos seguem visíveis.
 */
function extraidoDerivadoCombinado(
  secoes: Partial<Record<SecaoId, { extraido?: string }>> | undefined,
  secaoId: SecaoId,
): string {
  const combinado = secoes?.comorbidadesMedicacoes?.extraido;
  if (!combinado) return "";
  const querMuc = secaoId === "medicacoesUsoContinuo";
  const filtrados = blocosBrutos(combinado).filter(
    (b) => /medica|muc/i.test(b.titulo ?? "") === querMuc,
  );
  return filtrados.length ? JSON.stringify(filtrados) : "";
}

export default function Paciente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    carregado,
    getPaciente,
    atualizarSecao,
    atualizarPaciente,
    atualizarProblemas,
    atualizarPendencias,
    atualizarEvolucao,
  } = usePacientes();
  const { usuario } = useAuth();
  // Escores clínicos podem ser desativados em Perfil → Funcionalidades (default ON).
  const escoresAtivado = usuario?.features_ativas?.escores !== false;
  const paciente = getPaciente(id);
  const diaInternacao = paciente ? diaDeInternacao(paciente.dataEntrada) : null;

  // Banner "recebido de" (só até ser fechado uma vez; persistido por paciente).
  const KEY_RECEBIDO_VISTO = "@passandocaso/recebidoVisto";
  const [bannerRecebido, setBannerRecebido] = useState(false);
  useEffect(() => {
    if (!paciente?.recebidoDe) {
      setBannerRecebido(false);
      return;
    }
    AsyncStorage.getItem(KEY_RECEBIDO_VISTO).then((raw) => {
      const vistos: string[] = raw ? JSON.parse(raw) : [];
      setBannerRecebido(!vistos.includes(id));
    });
  }, [paciente?.recebidoDe, id]);
  const fecharBannerRecebido = () => {
    setBannerRecebido(false);
    AsyncStorage.getItem(KEY_RECEBIDO_VISTO).then((raw) => {
      const vistos: string[] = raw ? JSON.parse(raw) : [];
      if (!vistos.includes(id)) {
        AsyncStorage.setItem(KEY_RECEBIDO_VISTO, JSON.stringify([...vistos, id])).catch(() => {});
      }
    });
  };

  // Evolução temporal: contagem de registros + snapshot ao ir para background.
  const [registrosCount, setRegistrosCount] = useState(0);
  useEffect(() => {
    let vivo = true;
    listarEvolucaoDiaria(id, 60).then((r) => {
      if (vivo) setRegistrosCount(r.length);
    });
    return () => {
      vivo = false;
    };
  }, [id]);

  const insets = useSafeAreaInsets();

  // FEATURE 1: accordion — id da única seção aberta (null = todas fechadas).
  const [secaoAberta, setSecaoAberta] = useState<string | null>(null);

  // Destaque de interações GRAVES no header (scroll até a Prescrição ao tocar).
  const scrollRef = useRef<KeyboardAwareScrollView>(null);
  const [prescY, setPrescY] = useState(0);
  const [interacoesGraves, setInteracoesGraves] = useState<Interacao[]>([]);
  const medsTexto = (paciente?.medicamentos ?? []).map((m) => m.texto).join("|");
  useEffect(() => {
    let vivo = true;
    buscarInteracoes((paciente?.medicamentos ?? []).map((m) => m.texto)).then((l) => {
      if (vivo) setInteracoesGraves(l.filter((i) => i.severidade === "grave"));
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medsTexto]);
  const irParaPrescricao = () => scrollRef.current?.scrollToPosition(0, Math.max(0, prescY - 8), true);
  // "Adicionar medicamento" acionado pelo cabeçalho da seção Prescrição.
  const [addPrescricao, setAddPrescricao] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (estado) => {
      if ((estado === "inactive" || estado === "background") && paciente) {
        salvarSnapshotDiario(paciente);
      }
    });
    return () => sub.remove();
  }, [paciente]);

  // Edição
  const [editando, setEditando] = useState(false);
  const [nomeForm, setNomeForm] = useState("");
  const [idadeForm, setIdadeForm] = useState("");
  const [leitoForm, setLeitoForm] = useState("");
  const [setorForm, setSetorForm] = useState("");
  const [entradaForm, setEntradaForm] = useState("");
  const [prontuarioForm, setProntuarioForm] = useState("");
  const [statusForm, setStatusForm] = useState<StatusType>("naoVisitado");
  const [diagnosticoForm, setDiagnosticoForm] = useState("");
  const [motivoForm, setMotivoForm] = useState("");

  // Modo Round (apresentação) e geração de resumo por IA.
  const [gerandoResumo, setGerandoResumo] = useState(false);

  // BUG 3: modal "Data da coleta?" para labs escaneados sem data identificada.
  const [modalDataLabs, setModalDataLabs] = useState<{
    qtd: number;
    resolver: (iso: string | null) => void;
  } | null>(null);
  const [outraDataLabs, setOutraDataLabs] = useState("");
  const pedirDataLabs = (qtd: number): Promise<string | null> => {
    setOutraDataLabs("");
    return new Promise((resolver) => setModalDataLabs({ qtd, resolver }));
  };
  const responderDataLabs = (iso: string | null) => {
    modalDataLabs?.resolver(iso);
    setModalDataLabs(null);
  };

  const iniciarEdicao = () => {
    if (!paciente) return;
    setNomeForm(paciente.nomeCompleto);
    setIdadeForm(paciente.idade != null ? String(paciente.idade) : "");
    setLeitoForm(paciente.leito);
    setSetorForm(paciente.setor);
    setEntradaForm(paciente.dataEntrada);
    setProntuarioForm(paciente.numeroProntuario);
    setStatusForm(paciente.status);
    setDiagnosticoForm(paciente.diagnosticoPrincipal ?? "");
    setMotivoForm(paciente.motivoInternacao ?? "");
    setEditando(true);
  };

  const salvarEdicao = () => {
    const idadeTexto = idadeForm.trim();
    const idadeNum = idadeTexto === "" ? null : Number(idadeTexto);
    const idadeFinal =
      idadeNum != null && Number.isNaN(idadeNum) ? null : idadeNum;
    const aplicar = () => {
      atualizarPaciente(id, {
        nomeCompleto: nomeForm.trim(),
        idade: idadeFinal,
        leito: leitoForm.trim(),
        setor: setorForm.trim(),
        dataEntrada: entradaForm.trim(),
        numeroProntuario: prontuarioForm.trim(),
        status: statusForm,
        diagnosticoPrincipal: diagnosticoForm.trim(),
        motivoInternacao: motivoForm.trim(),
      });
      setEditando(false);
    };
    // Idade improvável (erro de digitação ou de leitura do scan): confirma antes.
    if (idadeFinal != null && (idadeFinal < 0 || idadeFinal > 120)) {
      Alert.alert(
        "Idade improvável",
        `${idadeFinal} anos parece fora do esperado. Deseja salvar mesmo assim?`,
        [
          { text: "Revisar", style: "cancel" },
          { text: "Salvar assim", style: "destructive", onPress: aplicar },
        ],
      );
      return;
    }
    aplicar();
  };

  const definirStatusClinico = (sc: StatusClinico) => {
    atualizarPaciente(id, {
      statusClinico: paciente?.statusClinico === sc ? null : sc,
    });
  };

  const gerarResumo = async () => {
    if (!paciente) return;
    setGerandoResumo(true);
    try {
      const dados = montarDadosParaResumo(paciente, hojeISO());
      const resumo = await gerarResumoIA(dados);
      atualizarPaciente(id, { resumoRapido: resumo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Não foi possível gerar o resumo", msg);
    }
    setGerandoResumo(false);
  };

  const dados = paciente?.dadosClinicos;

  const cabecalho = (
    <>
      {bannerRecebido && paciente?.recebidoDe && (
        <View style={styles.bannerRecebido}>
          <Text style={styles.bannerRecebidoTexto}>
            Paciente recebido de {paciente.recebidoDe.nome} — revise as informações
          </Text>
          <TouchableOpacity onPress={fecharBannerRecebido} hitSlop={8}>
            <Ionicons name="close" size={18} color={ClinicalColors.warning} />
          </TouchableOpacity>
        </View>
      )}

      {!paciente ? (
        <Text style={styles.aviso}>
          {carregado ? "Paciente não encontrado." : "Carregando..."}
        </Text>
      ) : (
        <>
          <View style={styles.cabecalho}>
            <Text style={styles.titulo}>
              {formatarNome(paciente.nomeCompleto) || "Sem nome"}
            </Text>
            {!editando && (
              <View style={styles.acoesIcones}>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: StatusColors[paciente.status].bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeTexto,
                      { color: StatusColors[paciente.status].text },
                    ]}
                  >
                    {StatusColors[paciente.status].label}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.iconeBtn}
                  onPress={iniciarEdicao}
                  accessibilityLabel="Editar paciente"
                >
                  <Ionicons name="create-outline" size={28} color="#1A6B8A" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {!editando && interacoesGraves.length > 0 && (
            <TouchableOpacity
              style={styles.alertaGraveBanner}
              onPress={irParaPrescricao}
              activeOpacity={0.8}
              accessibilityLabel="Ver interações graves na prescrição"
            >
              <Ionicons name="warning" size={16} color="#FFFFFF" />
              <Text style={styles.alertaGraveTexto}>
                {interacoesGraves.length}{" "}
                {interacoesGraves.length === 1 ? "interação grave" : "interações graves"}
              </Text>
              <Ionicons name="chevron-forward" size={15} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {editando ? (
            <>
              <View style={styles.identificacao}>
                <Campo label="Nome completo" value={nomeForm} onChange={setNomeForm} />
                <Campo
                  label="Idade"
                  value={idadeForm}
                  onChange={setIdadeForm}
                  keyboardType="numeric"
                />
                <Campo label="Leito" value={leitoForm} onChange={setLeitoForm} />
                <Campo label="Setor" value={setorForm} onChange={setSetorForm} />
                <Campo
                  label="Data de entrada"
                  value={entradaForm}
                  onChange={setEntradaForm}
                />
                <Campo
                  label="Nº do prontuário"
                  value={prontuarioForm}
                  onChange={setProntuarioForm}
                />
                <Campo
                  label="Diagnóstico principal"
                  value={diagnosticoForm}
                  onChange={setDiagnosticoForm}
                />
                <Campo
                  label="Motivo da internação"
                  value={motivoForm}
                  onChange={setMotivoForm}
                />

                <Text style={styles.campoLabel}>Status</Text>
                <View style={styles.statusRow}>
                  {STATUS_OPCOES.map((s) => {
                    const ativo = statusForm === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setStatusForm(s)}
                        style={[
                          styles.statusChip,
                          {
                            borderColor: StatusColors[s].text,
                            backgroundColor: ativo
                              ? StatusColors[s].bg
                              : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChipTexto,
                            { color: StatusColors[s].text },
                          ]}
                        >
                          {StatusColors[s].label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.acoesRow}>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoSalvar]}
                  onPress={salvarEdicao}
                >
                  <Text style={styles.botaoAcaoTexto}>Salvar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoCancelar]}
                  onPress={() => setEditando(false)}
                >
                  <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.diagnosticoBox}>
                {paciente.diagnosticoPrincipal ? (
                  <Text style={styles.diagnosticoPrincipal}>
                    {paciente.diagnosticoPrincipal}
                  </Text>
                ) : (
                  <Text style={styles.diagnosticoVazio}>
                    Toque em Editar para definir o diagnóstico principal
                  </Text>
                )}
                {!!paciente.motivoInternacao && (
                  <Text style={styles.motivoInternacao}>
                    {paciente.motivoInternacao}
                  </Text>
                )}
              </View>

              <View style={styles.identificacao}>
                <CampoLeitura
                  label="Leito"
                  value={paciente.leito}
                  onChange={(t) => atualizarPaciente(id, { leito: t.trim() })}
                  placeholder="Ex: 306-4"
                />

                <View style={styles.campoIdent}>
                  <Text style={styles.campoIdentLabel}>Setor</Text>
                  <Text style={styles.campoIdentValor}>
                    {paciente.setor || "—"}
                  </Text>
                </View>

                <Text style={styles.identLinha}>
                  Idade: {paciente.idade != null ? `${paciente.idade} anos` : "—"}
                </Text>
                {!!paciente.numeroProntuario && (
                  <Text style={styles.identLinha}>
                    Prontuário: {paciente.numeroProntuario}
                  </Text>
                )}
                {!!paciente.dataEntrada && (
                  <Text style={styles.identLinha}>
                    Entrada: {formatarDataBR(paciente.dataEntrada)}
                  </Text>
                )}
                {diaInternacao != null && (
                  <Text style={styles.diaInternacao}>
                    Dia {diaInternacao} de internação
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.verEvolucao}
                onPress={() => router.push({ pathname: "/timeline/[id]", params: { id } })}
              >
                <Ionicons name="stats-chart-outline" size={18} color={ClinicalColors.primary} />
                <Text style={styles.verEvolucaoTxt}>Ver evolução</Text>
                {registrosCount > 0 && (
                  <Text style={styles.verEvolucaoBadge}>
                    {registrosCount} {registrosCount === 1 ? "registro" : "registros"}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color={ClinicalColors.chevron} />
              </TouchableOpacity>

              <View style={styles.statusClinicoBox}>
                <Text style={styles.campoLabel}>Status clínico</Text>
                <View style={styles.statusClinicoRow}>
                  {STATUS_CLINICO_OPCOES.map((sc) => {
                    const ativo = paciente.statusClinico === sc;
                    const cor = StatusClinicoColors[sc];
                    return (
                      <TouchableOpacity
                        key={sc}
                        onPress={() => definirStatusClinico(sc)}
                        style={[
                          styles.statusClinicoChip,
                          {
                            backgroundColor: ativo
                              ? cor.bg
                              : ClinicalColors.background,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusClinicoChipTexto,
                            {
                              color: ativo ? cor.text : ClinicalColors.textMuted,
                            },
                          ]}
                        >
                          {cor.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <ResumoRapidoSecao
                resumo={paciente.resumoRapido ?? ""}
                gerando={gerandoResumo}
                onGerar={gerarResumo}
              />

              {/* BUG 6: card "Tendências laboratoriais" removido (alertas
                  automáticos não confiáveis). As setas ↑↓ por valor permanecem. */}

              <ProblemasSecao
                problemas={paciente.problemas ?? []}
                onChange={(lista) => atualizarProblemas(id, lista)}
              />
              {escoresAtivado && (
                <EscoresClinicosSecao
                  paciente={paciente}
                  pacienteId={id}
                  hoje={hojeISO()}
                />
              )}
              <PendenciasSecao
                pendencias={paciente.pendencias ?? []}
                onChange={(lista) => atualizarPendencias(id, lista)}
              />
            </>
          )}
        </>
      )}
    </>
  );

  // As seções só aparecem no modo de visualização de um paciente existente.
  const mostrarSecoes = !!paciente && !editando;
  const hoje = hojeISO();
  // Checklist de alta só aparece quando o status é de alta (provável/realizada).
  const mostrarChecklistAlta =
    !!paciente &&
    (paciente.status === "altaProvavel" ||
      paciente.status === "altaRealizada");

  return (
    <AccordionContext.Provider
      value={{ abertaId: secaoAberta, setAbertaId: setSecaoAberta }}
    >
    <KeyboardAwareScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={[
        styles.containerConteudo,
        { paddingBottom: insets.bottom + 140 },
      ]}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={20}
    >
      {cabecalho}

      <Modal
        visible={!!modalDataLabs}
        transparent
        animationType="fade"
        onRequestClose={() => responderDataLabs(null)}
      >
        <View style={styles.modalDataFundo}>
          <View style={styles.modalDataCaixa}>
            <Text style={styles.modalDataTitulo}>Data da coleta</Text>
            <Text style={styles.modalDataSub}>
              {modalDataLabs?.qtd
                ? `${modalDataLabs.qtd} resultado(s) sem data identificada. Quando foram coletados?`
                : "Quando esses exames foram coletados?"}
            </Text>
            <TouchableOpacity
              style={styles.modalDataOpcao}
              onPress={() => responderDataLabs(hojeISO())}
            >
              <Text style={styles.modalDataOpcaoTxt}>
                Hoje · {formatarDataBR(hojeISO()).slice(0, 5)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalDataOpcao}
              onPress={() => responderDataLabs(ontemISO())}
            >
              <Text style={styles.modalDataOpcaoTxt}>
                Ontem · {formatarDataBR(ontemISO()).slice(0, 5)}
              </Text>
            </TouchableOpacity>
            <View style={styles.modalDataOutra}>
              <TextInput
                style={styles.modalDataInput}
                placeholder="Outra data (DD/MM)"
                placeholderTextColor={ClinicalColors.textMuted}
                keyboardType="numbers-and-punctuation"
                value={outraDataLabs}
                onChangeText={setOutraDataLabs}
              />
              <TouchableOpacity
                style={[
                  styles.modalDataOk,
                  !brParaISO(outraDataLabs) && styles.modalDataOkOff,
                ]}
                disabled={!brParaISO(outraDataLabs)}
                onPress={() => {
                  const iso = brParaISO(outraDataLabs);
                  if (iso) responderDataLabs(iso);
                }}
              >
                <Text style={styles.modalDataOkTxt}>OK</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.modalDataCancelar}
              onPress={() => responderDataLabs(null)}
            >
              <Text style={styles.modalDataCancelarTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {mostrarSecoes &&
        SECOES.map((item) => (
          <View
            key={item.id}
            onLayout={
              item.id === "prescricaoHospitalar"
                ? (e) => setPrescY(e.nativeEvent.layout.y)
                : undefined
            }
          >
          <SecaoExpansivel
            titulo={item.titulo}
            instrucao={item.instrucao}
            secaoId={item.id}
            medicacao={item.medicacao}
            onAdicionar={
              item.id === "prescricaoHospitalar"
                ? () => setAddPrescricao(true)
                : undefined
            }
            rotuloAdicionar="Medicamento"
            anotacoes={normalizarAnotacoes(
              paciente?.secoes?.[item.id]?.anotacoes,
            )}
            prosa={item.prosa}
            extraido={
              paciente?.secoes?.[item.id]?.extraido ||
              extraidoDerivadoCombinado(paciente?.secoes, item.id) ||
              extraidoLegado(dados, item.id)
            }
            onSalvarAnotacoes={(lista) =>
              atualizarSecao(id, item.id, { anotacoes: lista })
            }
            onExtraido={(t) => atualizarSecao(id, item.id, { extraido: t })}
            aoExtrair={(dados) => {
              // Prescrição: cria itens na lista de medicamentos (com classe IA).
              if (item.id === "prescricaoHospitalar") {
                const meds = Array.isArray(dados.medicamentos)
                  ? (dados.medicamentos as Record<string, string>[])
                  : [];
                if (!meds.length) return false;
                const base = paciente?.medicamentos ?? [];
                // BUG 3: não duplica medicamentos já presentes na lista.
                const jaExiste = new Set(base.map((m) => normMerge(m.texto)));
                const novos = meds
                  .map((m, i) => ({
                    id: `${novoId()}-${i}`,
                    texto: [m.nome, m.dose, m.via, m.frequencia, m.diaUso]
                      .filter(campoMedValido)
                      .join(" ")
                      .trim(),
                    classe: "",
                  }))
                  .filter((m) => m.texto && !jaExiste.has(normMerge(m.texto)));
                if (!novos.length) return false;
                const lista = [...base, ...novos];
                atualizarPaciente(id, { medicamentos: lista });
                Promise.all(
                  novos.map((n) =>
                    classificarMedicamento(n.texto).then((c) => ({
                      id: n.id,
                      classe: c || "",
                    })),
                  ),
                ).then((cls) => {
                  const mapa = Object.fromEntries(cls.map((c) => [c.id, c.classe]));
                  atualizarPaciente(id, {
                    medicamentos: lista.map((m) =>
                      mapa[m.id] != null ? { ...m, classe: mapa[m.id] } : m,
                    ),
                  });
                });
                return true;
              }
              // Sinais vitais (BUG 3): preenche só os campos VAZIOS; mantém os já
              // preenchidos; em conflito (valor diferente), pergunta ao usuário.
              if (item.id === "sinaisVitaisIntercorrencias") {
                const rotuloSV: Record<string, string> = {
                  paSist: "PA sist", paDiast: "PA diast", fc: "FC", fr: "FR",
                  sato2: "SatO₂", temp: "Tax",
                  glicemia: "Glicemia", diurese: "Diurese",
                };
                const campos = Object.keys(rotuloSV);
                const valorNovo = (k: string) =>
                  dados[k] != null && String(dados[k]).trim() !== "" ? String(dados[k]).trim() : "";
                if (!campos.some((k) => valorNovo(k))) return false;
                const atual = paciente?.sinaisVitais?.[hoje] ?? SV_VAZIO;
                const novo = { ...atual } as Record<string, string>;
                const conflitos: { k: string; cur: string; nv: string }[] = [];
                for (const k of campos) {
                  const nv = valorNovo(k);
                  if (!nv) continue;
                  const cur = String((atual as Record<string, string>)[k] || "").trim();
                  if (!cur) novo[k] = nv; // vazio → preenche
                  else if (cur !== nv) conflitos.push({ k, cur, nv }); // conflito
                  // igual → mantém
                }
                atualizarPaciente(id, {
                  sinaisVitais: { ...paciente?.sinaisVitais, [hoje]: novo as SinaisVitaisDia },
                });
                if (conflitos.length) {
                  Alert.alert(
                    "Valores diferentes na foto",
                    conflitos
                      .map((c) => `${rotuloSV[c.k]}: atual ${c.cur} → foto ${c.nv}`)
                      .join("\n"),
                    [
                      { text: "Manter atuais", style: "cancel" },
                      {
                        text: "Usar os da foto",
                        onPress: () => {
                          const novo2 = { ...novo };
                          for (const c of conflitos) novo2[c.k] = c.nv;
                          atualizarPaciente(id, {
                            sinaisVitais: { ...paciente?.sinaisVitais, [hoje]: novo2 as SinaisVitaisDia },
                          });
                        },
                      },
                    ],
                  );
                }
                return true;
              }
              return false;
            }}
            scanCustom={
              item.id === "examesLaboratoriais"
                ? async (base64, onProgresso) => {
                    // BUGS 10+11 + 4/9: pipeline multi-data → popula resultadosLab
                    // (estrutura única dos labs). Não perde datas e alimenta o
                    // "Resultados por data", a timeline e o Passar o Caso.
                    onProgresso("Identificando datas dos labs...");
                    const r = await extrairLabsMultiData(base64);
                    if (r.porData.length && paciente) {
                      // BUG 3: se algum grupo veio SEM data, pergunta antes de
                      // salvar (não assume "hoje" silenciosamente).
                      let porData = r.porData;
                      let dataPadrao: string | undefined;
                      const semData = r.porData.filter((p) => !p.data);
                      if (semData.length) {
                        const qtd = semData.reduce(
                          (n, p) => n + p.exames.length,
                          0,
                        );
                        const escolhida = await pedirDataLabs(qtd);
                        if (escolhida) {
                          dataPadrao = escolhida;
                        } else {
                          // Cancelou: salva só os grupos COM data identificada.
                          porData = r.porData.filter((p) => p.data);
                        }
                      }
                      if (porData.length) {
                        const total = porData.reduce(
                          (n, p) => n + p.exames.length,
                          0,
                        );
                        onProgresso(`Importando ${total} resultado(s)...`);
                        const novos = mesclarResultadosLab(
                          porData,
                          paciente.resultadosLab ?? [],
                          dataPadrao,
                        );
                        atualizarPaciente(id, { resultadosLab: novos });
                        salvarSnapshotDiario({
                          ...paciente,
                          resultadosLab: novos,
                        });
                      }
                    }
                    return r.gaps.length
                      ? { aviso: r.gaps.map((g) => g.detalhe).join(" ") }
                      : undefined;
                  }
                : undefined
            }
            extra={(editando) =>
              item.id === "examesLaboratoriais" ? (
                <LabsPorData
                  resultados={paciente?.resultadosLab ?? []}
                  sexo={paciente?.sexo ?? null}
                  idade={paciente?.idade ?? null}
                  onChange={(lista) =>
                    atualizarPaciente(id, { resultadosLab: lista })
                  }
                  onAposSalvar={(novos) => {
                    // Atualiza o snapshot do dia (alimenta sparklines/alertas).
                    if (paciente)
                      salvarSnapshotDiario({ ...paciente, resultadosLab: novos });
                  }}
                />
              ) : item.id === "prescricaoHospitalar" ? (
                <PrescricaoSecao
                  medicamentos={paciente?.medicamentos ?? []}
                  paciente={paciente}
                  editando={editando}
                  mostrarAdd={addPrescricao}
                  onFecharAdd={() => setAddPrescricao(false)}
                  onChange={(l) => atualizarPaciente(id, { medicamentos: l })}
                />
              ) : item.id === "sinaisVitaisIntercorrencias" ? (
                <SinaisVitaisSecao
                  sv={paciente?.sinaisVitais?.[hoje] ?? SV_VAZIO}
                  onChange={(v) =>
                    atualizarPaciente(id, {
                      sinaisVitais: { ...paciente?.sinaisVitais, [hoje]: v },
                    })
                  }
                />
              ) : null
            }
          />
          </View>
        ))}
      {mostrarSecoes && (
        <>
          <EvolucaoBeiraLeitoSecao
            key={hoje}
            evolucao={paciente?.evolucoes?.[hoje] ?? EVOLUCAO_VAZIA}
            // Salva tudo MENOS a conduta — a Conduta do Dia é dona desse campo
            // e o grava por conta própria; assim uma seção não apaga a outra.
            onSalvar={({ condutaDoDia: _conduta, ...resto }) =>
              atualizarEvolucao(id, hoje, resto)
            }
          />
          <CondutaSecao
            key={`conduta-${hoje}`}
            evolucao={paciente?.evolucoes?.[hoje] ?? EVOLUCAO_VAZIA}
            onSalvar={(evo) =>
              atualizarEvolucao(id, hoje, { condutaDoDia: evo.condutaDoDia })
            }
          />
          {mostrarChecklistAlta && (
            <ChecklistAltaSecao
              checklist={paciente?.checklistAlta ?? {}}
              onChange={(c) => atualizarPaciente(id, { checklistAlta: c })}
            />
          )}
          <View style={styles.botoesCasoRow}>
            <TouchableOpacity
              style={styles.botaoPassarCaso}
              activeOpacity={0.85}
              onPress={() => {
                if (paciente) salvarSnapshotDiario(paciente);
                router.push({ pathname: "/evolucao/[id]", params: { id } });
              }}
            >
              <View style={styles.passarCasoIcone}>
                <Ionicons name="document-text-outline" size={15} color="#0E7A5A" />
              </View>
              <Text style={styles.botaoPassarCasoTexto}>Evolução Médica</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.botaoPassarCaso}
              activeOpacity={0.85}
              onPress={() => {
                if (paciente) salvarSnapshotDiario(paciente);
                router.push({ pathname: "/passar-caso/[id]", params: { id } });
              }}
            >
              <View style={styles.passarCasoIcone}>
                <Ionicons name="albums-outline" size={15} color="#0E7A5A" />
              </View>
              <Text style={styles.botaoPassarCasoTexto}>Passar o Caso</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAwareScrollView>
    </AccordionContext.Provider>
  );
}

/**
 * Card de tendências laboratoriais. Puramente DESCRITIVO (conformidade ANVISA):
 * descreve o movimento dos exames inseridos, sem qualquer sugestão de conduta.
 */
function AlertasTendenciaSecao({ alertas }: { alertas: AlertaTendencia[] }) {
  return (
    <View style={styles.alertasCard}>
      <Text style={styles.alertasTitulo}>Tendências laboratoriais</Text>
      {alertas.map((a) => (
        <View key={a.lab} style={styles.alertaItem}>
          <Text style={styles.alertaDescricao}>{descreverAlerta(a)}</Text>
          <Text style={styles.alertaSerie}>{serieFormatada(a)}</Text>
        </View>
      ))}
      <Text style={styles.alertasRodape}>
        Indicadores gerados a partir dos dados inseridos. Avalie clinicamente.
      </Text>
    </View>
  );
}

function Campo({
  label,
  value,
  onChange,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.campo}>
      <Text style={styles.campoLabel}>{label}</Text>
      <TextInput
        style={styles.campoInput}
        value={value}
        onChangeText={onChange}        keyboardType={keyboardType ?? "default"}
        placeholder="—"
        placeholderTextColor={ClinicalColors.textMuted}
      />
    </View>
  );
}

/**
 * Quebra um trecho em itens individuais. Separa por quebra de linha, ponto-e-vírgula
 * e vírgula — mas NÃO por vírgula seguida de dígito, para preservar decimais e doses
 * (ex.: "metformina 2,5/1000 mg" continua um item só).
 */
function dividirItens(texto: string): string[] {
  return texto
    .split(/[\n;]+|,(?!\d)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Heurística: o bloco é de medicações? (renderizado com bullets, não chips). */
function ehMedicacao(titulo?: string): boolean {
  return /medica/i.test(titulo ?? "");
}

/**
 * Tenta interpretar o conteúdo extraído como blocos estruturados (JSON gerado
 * pela IA). Devolve null para texto simples/legado.
 */
function parseBlocos(texto: string): Bloco[] | null {
  const t = texto.trim();
  if (!t.startsWith("[")) return null;
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v) && v.every((b) => b && Array.isArray(b.itens))) {
      return (v as Bloco[]).map((b) => ({
        titulo: b.titulo,
        itens: b.itens.flatMap((it) => dividirItens(String(it))),
        // FEATURE 3: preserva o marca-texto dos laudos (não descartar no parse).
        ...(b.destacados ? { destacados: b.destacados } : {}),
      }));
    }
  } catch {
    // texto comum, não é JSON de blocos
  }
  return null;
}

/**
 * Exibe o conteúdo extraído. Cada bloco vira um agrupamento; medicações saem em
 * linhas com bullet (•), os demais como chips em linha com quebra. Texto legado
 * (sem blocos) é tratado como um único bloco sem título.
 */
/** Junta o conteúdo extraído em um único parágrafo (para seções dissertativas). */
function textoProsa(texto: string): string {
  const t = (texto || "").trim();
  if (t.startsWith("[")) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) {
        return (v as Bloco[])
          .map((b) => (b.itens || []).join(" ").trim())
          .filter(Boolean)
          .join("\n\n")
          .trim();
      }
    } catch {
      // texto comum
    }
  }
  return t;
}

function ConteudoExtraido({
  texto,
  medicacao,
  prosa,
  editando,
  onChange,
}: {
  texto: string;
  medicacao?: boolean;
  /** Renderiza como TEXTO dissertativo (parágrafo), sem chips/bullets (ex.: HDA). */
  prosa?: boolean;
  /** Modo de revisão: itens viram editáveis (tocar para corrigir) + remover. */
  editando?: boolean;
  onChange?: (texto: string) => void;
}) {
  // Item em edição inline: "bi-ii". rascunho mantém o texto sendo corrigido.
  const [editId, setEditId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  // Rascunho do parágrafo (modo prosa).
  const [rascunhoProsa, setRascunhoProsa] = useState<string | null>(null);

  // Seção dissertativa (HDA): parágrafo corrido, sem dividir por vírgula.
  if (prosa) {
    const corpo = textoProsa(texto);
    if (editando && onChange) {
      const valor = rascunhoProsa ?? corpo;
      const salvar = () => {
        const v = valor.trim();
        onChange(
          v ? JSON.stringify([{ titulo: "História da doença atual", itens: [v] }]) : "",
        );
        setRascunhoProsa(null);
      };
      return (
        <TextInput
          style={[styles.campoInput, styles.prosaInput]}
          value={valor}
          onChangeText={setRascunhoProsa}
          onBlur={salvar}
          multiline
          placeholder="História da doença atual (texto dissertativo)…"
          placeholderTextColor={ClinicalColors.textMuted}
        />
      );
    }
    return <Text style={styles.prosaTexto}>{corpo || "—"}</Text>;
  }

  if (!texto) return <Text style={styles.secaoConteudo}>—</Text>;

  const blocos = parseBlocos(texto) ?? [
    { titulo: "", itens: dividirItens(texto) },
  ];
  const editavel = !!editando && !!onChange;

  const salvarBlocos = (novos: Bloco[]) =>
    onChange?.(JSON.stringify(novos.filter((b) => b.itens.length > 0)));

  const aplicarItem = (bi: number, ii: number, valor: string) => {
    const v = valor.trim();
    const novos = blocos.map((b, i) =>
      i === bi
        ? {
            ...b,
            itens: v
              ? b.itens.map((it, j) => (j === ii ? v : it))
              : b.itens.filter((_, j) => j !== ii),
          }
        : b,
    );
    salvarBlocos(novos);
    setEditId(null);
  };

  const remover = (bi: number, ii: number) => {
    const item = blocos[bi]?.itens[ii] ?? "este item";
    Alert.alert("Remover este item?", item, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: () => {
          setEditId(null);
          salvarBlocos(
            blocos.map((b, i) =>
              i === bi ? { ...b, itens: b.itens.filter((_, j) => j !== ii) } : b,
            ),
          );
        },
      },
    ]);
  };

  return (
    <View style={styles.conteudoBlocos}>
      {blocos.map((bloco, i) => (
        <View key={i} style={styles.bloco}>
          {!!bloco.titulo && (
            <Text style={styles.blocoTitulo}>{bloco.titulo}</Text>
          )}
          {editavel ? (
            // Modo edição: linha por item, tocar abre o campo; lixeira ao lado.
            bloco.itens.map((item, j) => {
              const key = `${i}-${j}`;
              const emEdicao = editId === key;
              return (
                <View key={j} style={styles.itemRow}>
                  <Text style={styles.itemBullet}>•</Text>
                  {emEdicao ? (
                    <>
                      <TextInput
                        style={[styles.campoInput, styles.itemEditInput]}
                        value={rascunho}
                        onChangeText={setRascunho}
                        autoFocus
                        onSubmitEditing={() => aplicarItem(i, j, rascunho)}
                        onBlur={() => aplicarItem(i, j, rascunho)}
                      />
                      <TouchableOpacity onPress={() => remover(i, j)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={ClinicalColors.danger} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.itemTocavel}
                      onPress={() => {
                        setEditId(key);
                        setRascunho(item);
                      }}
                    >
                      <Text style={styles.itemTexto}>{item}</Text>
                      <Ionicons name="create-outline" size={15} color={ClinicalColors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          ) : medicacao || ehMedicacao(bloco.titulo) ? (
            bloco.itens.map((item, j) => (
              <View key={j} style={styles.itemRow}>
                <Text style={styles.itemBullet}>•</Text>
                <Text style={styles.itemTexto}>{item}</Text>
              </View>
            ))
          ) : (
            <View style={styles.chipsWrap}>
              {bloco.itens.map((item, j) => (
                <View key={j} style={styles.chip}>
                  <Text style={styles.chipTexto}>{item}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * Visão unificada de "Comorbidades e MUC": junta o que veio da foto (extraído)
 * com as anotações digitadas, no MESMO formato (bullets), agrupadas em
 * Comorbidades e Medicações de uso contínuo. Anotações têm 🗑️ para remover.
 */
function ComorbidadesUnificado({
  extraido,
  anotacoes,
  editando,
  onExcluir,
  onExtraido,
}: {
  extraido: string;
  anotacoes: Anotacao[];
  editando?: boolean;
  onExcluir: (a: Anotacao) => void;
  onExtraido: (texto: string) => void;
}) {
  // Normaliza: cada item vira um átomo (split por vírgula/;/quebra). Garante que
  // "Cirrose, HIV, insônia" (vindo de scan ou legado num item só) apareça como
  // chips/itens individuais — e o split é persistido no próximo salvar.
  const blocos = (
    parseBlocos(extraido) ??
    (extraido.trim() ? [{ titulo: "", itens: dividirItens(extraido) }] : [])
  ).map((b) => ({ ...b, itens: b.itens.flatMap((it) => dividirItens(it)) }));
  // Cada extra guarda a origem (bloco/índice) para permitir remover no modo edição.
  type Extra = { texto: string; bi: number; ii: number };
  const comorbExtra: Extra[] = [];
  const mucExtra: Extra[] = [];
  blocos.forEach((b, bi) => {
    const muc = /medica|muc/i.test(b.titulo ?? "");
    b.itens.forEach((texto, ii) =>
      (muc ? mucExtra : comorbExtra).push({ texto, bi, ii }),
    );
  });
  const comorbAnot = anotacoes.filter((a) => a.categoria !== "medicacao");
  const mucAnot = anotacoes.filter((a) => a.categoria === "medicacao");

  const removerExtra = (e: Extra) => {
    Alert.alert("Remover este item?", e.texto, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: () =>
          onExtraido(
            JSON.stringify(
              blocos
                .map((b, i) =>
                  i === e.bi
                    ? { ...b, itens: b.itens.filter((_, j) => j !== e.ii) }
                    : b,
                )
                .filter((b) => b.itens.length > 0),
            ),
          ),
      },
    ]);
  };

  const grupo = (titulo: string, extras: Extra[], anots: Anotacao[]) => {
    if (!extras.length && !anots.length) return null;
    return (
      <View style={styles.uniGrupo}>
        <Text style={styles.blocoTitulo}>{titulo}</Text>
        {extras.map((e, i) => (
          <View key={`e${i}`} style={styles.itemRow}>
            <Text style={styles.itemBullet}>•</Text>
            <Text style={styles.itemTexto}>{e.texto}</Text>
            {editando && (
              <TouchableOpacity onPress={() => removerExtra(e)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
              </TouchableOpacity>
            )}
          </View>
        ))}
        {anots.flatMap((a) =>
          dividirItens(a.texto).map((atomo, k) => (
            <View key={`${a.id}-${k}`} style={styles.itemRow}>
              <Text style={styles.itemBullet}>•</Text>
              <Text style={styles.itemTexto}>{atomo}</Text>
              {editando && (
                <TouchableOpacity onPress={() => onExcluir(a)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
                </TouchableOpacity>
              )}
            </View>
          )),
        )}
      </View>
    );
  };

  if (
    !comorbExtra.length &&
    !mucExtra.length &&
    !comorbAnot.length &&
    !mucAnot.length
  ) {
    return <Text style={styles.secaoConteudo}>—</Text>;
  }

  return (
    <View style={styles.conteudoBlocos}>
      {grupo("Comorbidades", comorbExtra, comorbAnot)}
      {grupo("Medicações de uso contínuo", mucExtra, mucAnot)}
    </View>
  );
}

/**
 * Seção "Imagem": cada exame em seu próprio card (nome em destaque + laudo),
 * com excluir individual (confirmado) e botão para adicionar manualmente. O
 * conteúdo é persistido no mesmo formato de blocos (titulo = nome do exame,
 * itens = achados do laudo).
 */
function ImagemSecao({
  extraido,
  editando,
  onChange,
}: {
  extraido: string;
  editando?: boolean;
  onChange: (texto: string) => void;
}) {
  const blocos =
    parseBlocos(extraido) ??
    (extraido.trim() ? [{ titulo: "", itens: dividirItens(extraido) }] : []);
  const [adicionando, setAdicionando] = useState(false);
  const [nome, setNome] = useState("");
  const [laudo, setLaudo] = useState("");
  // FEATURE 3: marca-texto. Card em modo "marcar" (índice) destaca trechos.
  const [marcandoIdx, setMarcandoIdx] = useState<number | null>(null);

  const salvar = (lista: Bloco[]) => onChange(JSON.stringify(lista));

  // Liga/desliga um trecho do laudo no destaque (marca-texto) do exame `i`.
  const alternarDestaque = (i: number, frase: string) => {
    const atual = blocos[i]?.destacados ?? [];
    const destacados = atual.includes(frase)
      ? atual.filter((f) => f !== frase)
      : [...atual, frase];
    salvar(blocos.map((b, j) => (j === i ? { ...b, destacados } : b)));
  };

  const remover = (i: number) => {
    Alert.alert("Remover este exame?", blocos[i]?.titulo || "Exame de imagem", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: () => salvar(blocos.filter((_, j) => j !== i)),
      },
    ]);
  };

  const adicionar = () => {
    if (!nome.trim() && !laudo.trim()) return;
    salvar([
      ...blocos,
      { titulo: nome.trim(), itens: laudo.trim() ? [laudo.trim()] : [] },
    ]);
    setNome("");
    setLaudo("");
    setAdicionando(false);
  };

  return (
    <View>
      <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
        Exames de imagem
      </Text>

      {blocos.length === 0 && !adicionando && (
        <Text style={styles.secaoConteudo}>—</Text>
      )}

      {blocos.map((b, i) => {
        const laudoTxt = b.itens.join(". ");
        const destacados = b.destacados ?? [];
        const frases = fragmentarLaudo(laudoTxt);
        const marcando = marcandoIdx === i;
        return (
          <View key={i} style={styles.imgCard}>
            <View style={styles.imgCardTopo}>
              <Text style={styles.imgNome}>{limparDataEmTexto(b.titulo || "") || "Exame"}</Text>
              <View style={styles.imgCardAcoes}>
                {!!laudoTxt && (
                  <TouchableOpacity
                    onPress={() => setMarcandoIdx(marcando ? null : i)}
                    hitSlop={8}
                  >
                    <Text style={styles.imgMarcarTxt}>
                      {marcando ? "Concluir" : "Marcar"}
                    </Text>
                  </TouchableOpacity>
                )}
                {editando && (
                  <TouchableOpacity onPress={() => remover(i)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {!!laudoTxt &&
              (marcando ? (
                <View style={styles.imgFrasesWrap}>
                  {frases.map((f, j) => {
                    const on = destacados.includes(f);
                    return (
                      <TouchableOpacity
                        key={j}
                        style={[styles.imgFrase, on && styles.imgFraseOn]}
                        onPress={() => alternarDestaque(i, f)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.imgFraseTxt}>{f}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.imgLaudo}>
                  {frases.map((f, j) =>
                    destacados.includes(f) ? (
                      <Text key={j} style={styles.imgLaudoMarcado}>
                        {f}{" "}
                      </Text>
                    ) : (
                      <Text key={j}>{f} </Text>
                    ),
                  )}
                </Text>
              ))}
            {marcando && (
              <Text style={styles.imgMarcarDica}>
                Toque nos trechos relevantes. No Passar o Caso aparece só o que estiver marcado.
              </Text>
            )}
          </View>
        );
      })}

      {!editando ? null : adicionando ? (
        <View style={styles.formInline}>
          <TextInput
            style={styles.campoInput}
            value={nome}
            onChangeText={setNome}
            placeholder="Nome do exame (ex.: TC de crânio)"
            placeholderTextColor={ClinicalColors.textMuted}
          />
          <TextInput
            style={[styles.campoInput, styles.imgLaudoInput]}
            value={laudo}
            onChangeText={setLaudo}
            placeholder="Laudo / achados"
            placeholderTextColor={ClinicalColors.textMuted}
            multiline
          />
          <View style={styles.formAcoes}>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoSalvar]}
              onPress={adicionar}
            >
              <Text style={styles.botaoAcaoTexto}>Adicionar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoCancelar]}
              onPress={() => {
                setAdicionando(false);
                setNome("");
                setLaudo("");
              }}
            >
              <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.imgAddBtn}
          onPress={() => setAdicionando(true)}
        >
          <Ionicons name="add" size={16} color={ClinicalColors.primary} />
          <Text style={styles.imgAddTexto}>Adicionar exame</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Card de seção clínica expansível. Começa fechado; ao tocar no cabeçalho abre,
 * revelando o botão de câmera (foto → extração por IA), uma área de anotações
 * livres e o conteúdo extraído pela IA logo abaixo.
 */
function SecaoExpansivel({
  titulo,
  instrucao,
  secaoId,
  anotacoes,
  extraido,
  medicacao,
  prosa,
  extra,
  onSalvarAnotacoes,
  onExtraido,
  aoExtrair,
  scanCustom,
  onAdicionar,
  rotuloAdicionar,
}: {
  titulo: string;
  instrucao: string;
  secaoId: SecaoId;
  anotacoes: Anotacao[];
  extraido: string;
  medicacao?: boolean;
  prosa?: boolean;
  /** Ação opcional exibida à esquerda da linha de botões (ex.: "+ Medicamento"). */
  onAdicionar?: () => void;
  rotuloAdicionar?: string;
  /**
   * Conteúdo estruturado extra no fim do corpo da seção. Pode ser um render-prop
   * que recebe o estado de edição (para gating de ações de editar/remover).
   */
  extra?: React.ReactNode | ((editando: boolean) => React.ReactNode);
  onSalvarAnotacoes: (lista: Anotacao[]) => void;
  onExtraido: (texto: string) => void;
  /**
   * Consome o JSON estruturado da extração mapeando direto para os campos da
   * seção (ex.: prescrição → lista de medicamentos; sinais vitais → formulário).
   * Retorna true se consumiu (aí não grava em `extraido`).
   */
  aoExtrair?: (dados: Record<string, unknown>) => boolean;
  /**
   * Fluxo de scan próprio da seção (ex.: labs multi-data via /api/extract-labs).
   * Quando presente, SUBSTITUI a extração genérica: recebe a imagem em base64,
   * faz a sua própria extração/persistência e devolve um aviso opcional (gaps)
   * para o banner amarelo. Mensagens de progresso vêm por `onProgresso`.
   */
  scanCustom?: (
    base64: string,
    onProgresso: (msg: string) => void,
  ) => Promise<{ aviso?: string } | void>;
}) {
  const [aberto, setAberto] = useSecaoAccordion(secaoId);
  const recortar = useCrop();
  const capturarPaginas = useCapturaPaginas();
  const [rascunho, setRascunho] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [extraindo, setExtraindo] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Aviso de itens removidos por não pertencerem a esta seção (anti-misrouting).
  const [aviso, setAviso] = useState<string | null>(null);
  // Modo de revisão/correção: fora dele, a exibição é limpa (sem lixeiras nem
  // campos). Ligado pelo botão "Editar" — o médico revisa o que a IA escaneou.
  const [editando, setEditando] = useState(false);

  const categorias = CATEGORIAS_SECAO[secaoId];

  // Classifica a anotação pela IA (best-effort) e grava a categoria.
  const classificar = async (anotacaoId: string, texto: string, base: Anotacao[]) => {
    if (!categorias) return;
    const chave = await categorizarAnotacao(
      texto,
      categorias.map((c) => c.chave),
    );
    if (chave) {
      onSalvarAnotacoes(
        base.map((a) => (a.id === anotacaoId ? { ...a, categoria: chave } : a)),
      );
    }
  };

  // Correção manual: toca no badge para alternar a categoria.
  const alternarCategoria = (a: Anotacao) => {
    if (!categorias) return;
    const i = categorias.findIndex((c) => c.chave === a.categoria);
    const prox = categorias[(i + 1) % categorias.length].chave;
    onSalvarAnotacoes(
      anotacoes.map((x) => (x.id === a.id ? { ...x, categoria: prox } : x)),
    );
  };

  const salvarAnotacao = () => {
    const texto = rascunho.trim();
    if (!texto) return;
    if (editandoId) {
      // Edição: substitui o texto da anotação, preservando id e horário.
      onSalvarAnotacoes(
        anotacoes.map((a) => (a.id === editandoId ? { ...a, texto } : a)),
      );
    } else {
      // Nova anotação no topo (mais recentes primeiro).
      const nova: Anotacao = {
        id: String(Date.now()),
        texto,
        horario: horaAgora(),
      };
      const lista = [nova, ...anotacoes];
      onSalvarAnotacoes(lista);
      // Categorização automática por IA (sem bloquear a UI).
      classificar(nova.id, texto, lista);
    }
    setRascunho("");
    setEditandoId(null);
  };

  const editarAnotacao = (a: Anotacao) => {
    setRascunho(a.texto);
    setEditandoId(a.id);
  };

  const excluirAnotacao = (a: Anotacao) => {
    Alert.alert("Excluir esta anotação?", a.texto, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => {
          onSalvarAnotacoes(anotacoes.filter((x) => x.id !== a.id));
          if (editandoId === a.id) {
            setRascunho("");
            setEditandoId(null);
          }
        },
      },
    ]);
  };

  // Enquanto uma anotação está em edição, o card dela some até salvar de novo.
  const anotacoesVisiveis = anotacoes.filter((a) => a.id !== editandoId);

  // Seleção múltipla das anotações (FEATURE 1).
  const selAnot = useSelecaoMultipla();
  const excluirAnotacoesSelecionadas = () => {
    if (!selAnot.selecionados.size) return;
    Alert.alert(
      "Excluir anotações",
      `Remover ${selAnot.selecionados.size} anotação(ões)? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Excluir (${selAnot.selecionados.size})`,
          style: "destructive",
          onPress: () => {
            onSalvarAnotacoes(
              anotacoes.filter((a) => !selAnot.selecionados.has(a.id)),
            );
            selAnot.sair();
          },
        },
      ],
    );
  };

  /** Card de anotação (com/sem chip de categoria), com modo seleção. */
  const renderAnotacao = (a: Anotacao, comCategoria: boolean) => {
    const conteudo = (
      <View style={styles.anotacaoConteudo}>
        {!!a.horario && <Text style={styles.anotacaoHorario}>{a.horario}</Text>}
        <Text style={styles.anotacaoTexto}>{a.texto}</Text>
        {comCategoria &&
          categorias &&
          (() => {
            const cat = categorias.find((c) => c.chave === a.categoria);
            return cat ? (
              <TouchableOpacity
                onPress={() => alternarCategoria(a)}
                style={[styles.anotacaoCategoria, { backgroundColor: cat.cor }]}
              >
                <Text style={styles.anotacaoCategoriaTexto}>{cat.label}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.anotacaoClassificando}>classificando…</Text>
            );
          })()}
      </View>
    );
    if (selAnot.selecionando) {
      return (
        <TouchableOpacity
          key={a.id}
          style={[styles.anotacaoCard, styles.selLinha]}
          onPress={() => selAnot.alternar(a.id)}
          activeOpacity={0.7}
        >
          <CheckSelecao on={selAnot.selecionados.has(a.id)} />
          {conteudo}
        </TouchableOpacity>
      );
    }
    return (
      <View key={a.id} style={styles.anotacaoCard}>
        {conteudo}
        {editando && (
          <View style={styles.anotacaoAcoes}>
            <TouchableOpacity onPress={() => editarAnotacao(a)} hitSlop={8}>
              <Ionicons name="pencil" size={16} color={ClinicalColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => excluirAnotacao(a)} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const processarUri = async (uri: string) => {
    setExtraindo(true);
    setErro(null);
    setAviso(null);
    setProgresso(null);
    try {
      const base64 = await converterParaJpegBase64(uri);
      // Seção com scan próprio (ex.: labs multi-data): delega tudo e sai.
      if (scanCustom) {
        const r = await scanCustom(base64, setProgresso);
        if (r?.aviso) setAviso(r.aviso);
        setProgresso(null);
        setExtraindo(false);
        return;
      }
      const json = await extrairDadosImagem<
        { blocos?: Bloco[]; anomalias?: { item: string }[] } & Record<string, unknown>
      >(base64, `${instrucao} ${SUFIXO_JSON}`, secaoId);
      // Anti-misrouting: o backend remove itens que não pertencem a esta seção
      // e os reporta em `anomalias` — avisa o usuário (não foram salvos aqui).
      if (Array.isArray(json.anomalias) && json.anomalias.length) {
        const itens = json.anomalias.map((a) => a.item).filter(Boolean).join(", ");
        setAviso(
          `${json.anomalias.length} item(ns) não pertencem a esta seção e foram ignorados${
            itens ? `: ${itens}` : ""
          }.`,
        );
      }
      // Mapeamento direto (prescrição/sinais vitais) consome o estruturado; as
      // demais seções MESCLAM os blocos novos com os já existentes (não
      // sobrescreve — múltiplas fotos acumulam). (BUG 3)
      if (!(aoExtrair && aoExtrair(json))) {
        onExtraido(JSON.stringify(mergeBlocos(extraido, (json.blocos ?? []) as Bloco[])));
      }
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      console.log("Erro ao extrair seção:", e);
      setErro(mensagem);
    }
    setExtraindo(false);
  };

  // FEATURE: laudo de imagem com VÁRIAS páginas — extrai cada uma e concatena
  // o texto num único exame (na ordem das páginas).
  const fotografarLaudoMultiplo = async () => {
    const paginas = await capturarPaginas();
    if (!paginas.length) return;
    setExtraindo(true);
    setErro(null);
    setAviso(null);
    try {
      const blocos: Bloco[] = [];
      for (let i = 0; i < paginas.length; i++) {
        setProgresso(`Extraindo página ${i + 1} de ${paginas.length}…`);
        const base64 = await converterParaJpegBase64(paginas[i]);
        const json = await extrairDadosImagem<{ blocos?: Bloco[] }>(
          base64,
          `${instrucao} ${SUFIXO_JSON}`,
          secaoId,
        );
        for (const b of json.blocos ?? []) blocos.push(b);
      }
      // Concatena num ÚNICO laudo: nome da 1ª página com título; itens em ordem.
      const titulo = blocos.find((b) => b.titulo?.trim())?.titulo?.trim() || "Exame";
      const itens = blocos.flatMap((b) => b.itens || []);
      if (itens.length) {
        onExtraido(JSON.stringify(mergeBlocos(extraido, [{ titulo, itens }])));
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
    setProgresso(null);
    setExtraindo(false);
  };

  const fotografar = async () => {
    // Seção Imagem: fluxo de múltiplas páginas (um laudo por vários scans).
    if (secaoId === "imagem") return fotografarLaudoMultiplo();
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      setErro(
        "Permissão de câmera negada. Habilite o acesso à câmera nas configurações do dispositivo.",
      );
      return;
    }
    // Corte antes do scan; "Tirar de novo" reabre a câmera (loop).
    for (;;) {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (result.canceled) return;
      const cortada = await recortar(result.assets[0].uri);
      if (cortada) {
        processarUri(cortada);
        return;
      }
    }
  };

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>{titulo}</Text>
        <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
      </TouchableOpacity>

      {aberto && (
        <View style={styles.secaoBody}>
          <View style={styles.escanearRow}>
            {onAdicionar && (
              <TouchableOpacity
                style={[styles.botaoEscanear, styles.botaoAdicionarSecao]}
                onPress={onAdicionar}
              >
                <Ionicons name="add" size={18} color="#34C759" />
                <Text style={[styles.botaoEscanearTexto, styles.botaoAdicionarTexto]}>
                  {rotuloAdicionar || "Adicionar"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.botaoEscanear, editando && styles.botaoEscanearAtivo]}
              onPress={() => setEditando((v) => !v)}
            >
              <Ionicons
                name={editando ? "checkmark" : "create-outline"}
                size={16}
                color={editando ? "#fff" : ClinicalColors.primary}
              />
              <Text
                style={[
                  styles.botaoEscanearTexto,
                  editando && styles.botaoEscanearTextoAtivo,
                ]}
              >
                {editando ? "Concluir" : "Editar"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.botaoEscanear} onPress={fotografar}>
              <Ionicons name="scan-outline" size={16} color={ClinicalColors.primary} />
              <Text style={styles.botaoEscanearTexto}>Escanear</Text>
            </TouchableOpacity>
          </View>

          {extraindo && (
            <Text style={styles.extraindo}>{progresso || "Lendo prontuário..."}</Text>
          )}

          {erro && (
            <View style={styles.erroBox}>
              <Text style={styles.erroTitulo}>Erro ao extrair dados</Text>
              <Text style={styles.erroTexto}>{erro}</Text>
            </View>
          )}

          {aviso && (
            <View style={styles.avisoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#9A6700" />
              <Text style={styles.avisoTexto}>{aviso}</Text>
            </View>
          )}

          {/* Prescrição: medicamentos (extra) no topo; anotações vão ao fim. */}
          {secaoId === "prescricaoHospitalar" &&
            (typeof extra === "function" ? extra(editando) : extra)}

          <View style={styles.medLabelLinha}>
            <Text style={styles.campoLabel}>Anotações</Text>
            {secaoId !== "comorbidadesMedicacoes" &&
              anotacoesVisiveis.length > 0 && (
                <BotaoSelecionar
                  ativo={selAnot.selecionando}
                  onPress={() =>
                    selAnot.selecionando
                      ? selAnot.sair()
                      : selAnot.setSelecionando(true)
                  }
                />
              )}
          </View>
          {!selAnot.selecionando && (
            <>
              <TextInput
                style={styles.anotacoesInput}
                value={rascunho}
                onChangeText={setRascunho}
                placeholder="Digite uma anotação..."
                placeholderTextColor={ClinicalColors.textMuted}
                multiline
              />
              <TouchableOpacity
                style={[
                  styles.botaoSalvarAnotacao,
                  !rascunho.trim() && styles.botaoSalvarAnotacaoDesativado,
                ]}
                onPress={salvarAnotacao}
                disabled={!rascunho.trim()}
              >
                <Text style={styles.botaoSalvarAnotacaoTexto}>
                  {editandoId ? "Atualizar anotação" : "Salvar anotação"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {secaoId === "comorbidadesMedicacoes" ? (
            // Unificado: foto + anotações no mesmo formato (bullets), agrupados.
            <ComorbidadesUnificado
              extraido={extraido}
              anotacoes={anotacoes}
              editando={editando}
              onExcluir={excluirAnotacao}
              onExtraido={onExtraido}
            />
          ) : secaoId === "imagem" ? (
            <>
              {anotacoesVisiveis.map((a) => renderAnotacao(a, false))}
              {selAnot.selecionando && (
                <BarraSelecao
                  n={selAnot.selecionados.size}
                  total={anotacoesVisiveis.length}
                  onTodos={() =>
                    selAnot.setSelecionados(
                      selAnot.selecionados.size === anotacoesVisiveis.length
                        ? new Set()
                        : new Set(anotacoesVisiveis.map((a) => a.id)),
                    )
                  }
                  onExcluir={excluirAnotacoesSelecionadas}
                />
              )}
              <ImagemSecao
                extraido={extraido}
                editando={editando}
                onChange={onExtraido}
              />
            </>
          ) : (
            <>
              {anotacoesVisiveis.map((a) => renderAnotacao(a, true))}
              {selAnot.selecionando && (
                <BarraSelecao
                  n={selAnot.selecionados.size}
                  total={anotacoesVisiveis.length}
                  onTodos={() =>
                    selAnot.setSelecionados(
                      selAnot.selecionados.size === anotacoesVisiveis.length
                        ? new Set()
                        : new Set(anotacoesVisiveis.map((a) => a.id)),
                    )
                  }
                  onExcluir={excluirAnotacoesSelecionadas}
                />
              )}

              {/* SSVV/Prescrição: o componente estruturado (extra) é a fonte; o
                  conteúdo extraído só aparece se houver texto (retrocompat).
                  Labs (BUG 4): "Resultados por data" é a ÚNICA estrutura — nunca
                  mostra "Informações do sistema" (evita estrutura paralela). */}
              {secaoId !== "examesLaboratoriais" &&
              !(
                (secaoId === "sinaisVitaisIntercorrencias" ||
                  secaoId === "prescricaoHospitalar") &&
                !extraido.trim()
              ) && (
                <>
                  <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
                    Informações do sistema
                  </Text>
                  <ConteudoExtraido
                    texto={extraido}
                    medicacao={medicacao}
                    prosa={prosa}
                    editando={editando}
                    onChange={onExtraido}
                  />
                </>
              )}
            </>
          )}

          {/* Na Prescrição o extra já foi renderizado no topo (medicamentos). */}
          {secaoId !== "prescricaoHospitalar" &&
            (typeof extra === "function" ? extra(editando) : extra)}
        </View>
      )}
    </View>
  );
}

/** Linha de toggles de seleção única (com opção de desmarcar tocando de novo). */
function ToggleLinha({
  label,
  opcoes,
  valor,
  onSelecionar,
}: {
  label: string;
  opcoes: Opcao[];
  valor: string | null;
  onSelecionar: (valor: string) => void;
}) {
  return (
    <View style={styles.toggleLinha}>
      <Text style={styles.evoLabel}>{label}</Text>
      <View style={styles.chipsWrap}>
        {opcoes.map((o) => {
          const ativo = valor === o.valor;
          return (
            <TouchableOpacity
              key={o.valor}
              onPress={() => onSelecionar(o.valor)}
              style={[styles.toggleChip, ativo && styles.toggleChipAtivo]}
            >
              <Text
                style={[
                  styles.toggleChipTexto,
                  ativo && styles.toggleChipTextoAtivo,
                ]}
              >
                {o.rotulo}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Campo de texto livre (multilinha) com label opcional e salvamento no onBlur. */
/**
 * Campo de texto inline em MODO LEITURA por padrão: mostra o valor com um ✏️;
 * só ao tocar no ✏️ vira editável e abre o teclado. Mantém o contrato
 * (onChangeText ao vivo + onBlur ao persistir) usado pela Evolução Beira-Leito.
 */
function CampoTexto({
  label,
  value,
  placeholder,
  onChangeText,
  onBlur,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  onChangeText: (t: string) => void;
  onBlur: () => void;
}) {
  const [editando, setEditando] = useState(false);
  return (
    <View style={styles.campo}>
      {!!label && <Text style={styles.evoLabel}>{label}</Text>}
      {editando ? (
        <TextInput
          style={styles.evoInput}
          value={value}
          onChangeText={onChangeText}          onBlur={() => {
            setEditando(false);
            onBlur();
          }}
          autoFocus
          placeholder={placeholder ?? "Digite..."}
          placeholderTextColor={ClinicalColors.textMuted}
          multiline
        />
      ) : (
        <TouchableOpacity
          style={styles.leituraRow}
          onPress={() => setEditando(true)}
          activeOpacity={0.6}
        >
          <Text style={[styles.leituraTexto, !value && styles.leituraVazio]}>
            {value || placeholder || "—"}
          </Text>
          <Ionicons name="pencil" size={16} color={ClinicalColors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Campo simples sempre editável (SEM ✏️) — usado em Sinais Vitais, onde os
 * campos já são autoexplicativos. Persiste via onChange ao perder o foco.
 */
function CampoSimples({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label?: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
}) {
  const [texto, setTexto] = useState(value);
  useEffect(() => setTexto(value), [value]);
  return (
    <View style={styles.campo}>
      {!!label && <Text style={styles.campoLabel}>{label}</Text>}
      <TextInput
        style={multiline ? styles.anotacoesInput : styles.campoInput}
        value={texto}
        onChangeText={setTexto}        onBlur={() => {
          if (texto !== value) onChange(texto);
        }}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={ClinicalColors.textMuted}
      />
    </View>
  );
}

/**
 * Campo inline (uma linha ou multiline) em MODO LEITURA por padrão, com ✏️ para
 * editar. Gerencia o próprio rascunho e persiste via onChange ao perder o foco.
 */
function CampoLeitura({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label?: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(value);
  useEffect(() => {
    if (!editando) setTexto(value);
  }, [value, editando]);
  const salvar = () => {
    setEditando(false);
    if (texto !== value) onChange(texto);
  };
  return (
    <View style={styles.campo}>
      {!!label && <Text style={styles.campoLabel}>{label}</Text>}
      {editando ? (
        <TextInput
          style={multiline ? styles.anotacoesInput : styles.campoInput}
          value={texto}
          onChangeText={setTexto}          onBlur={salvar}
          autoFocus
          multiline={multiline}
          keyboardType={keyboardType ?? "default"}
          placeholder={placeholder}
          placeholderTextColor={ClinicalColors.textMuted}
        />
      ) : (
        <TouchableOpacity
          style={styles.leituraRow}
          onPress={() => setEditando(true)}
          activeOpacity={0.6}
        >
          <Text style={[styles.leituraTexto, !value && styles.leituraVazio]}>
            {value || placeholder || "—"}
          </Text>
          <Ionicons name="pencil" size={16} color={ClinicalColors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Campos de exame físico que usam chips. */
type CampoExame =
  | "estadoGeralExame"
  | "neurologico"
  | "cardiovascular"
  | "respiratorio"
  | "abdominal"
  | "mmii"
  | "pele";

/**
 * Chips do exame físico por seção (os 4 primeiros aparecem por padrão; "ver mais"
 * revela o restante). `secao` é o identificador usado no aprendizado de chips.
 */
const CHIPS_EXAME: { secao: string; campo: CampoExame; label: string; chips: string[] }[] = [
  {
    secao: "estado_geral", campo: "estadoGeralExame", label: "Estado geral",
    chips: ["BEG", "consciente", "orientado", "afebril", "REG", "MEG", "hipocorado", "ictérico", "desidratado", "prostrado"],
  },
  {
    secao: "neurologico", campo: "neurologico", label: "Neurológico",
    chips: ["Glasgow 15", "sem déficit focal", "pupilas isocóricas fotorreativas", "orientado", "sonolento", "torporoso", "desorientado", "pupilas anisocóricas", "força preservada nos 4 membros", "rigidez de nuca"],
  },
  {
    secao: "cardiovascular", campo: "cardiovascular", label: "Cardiovascular",
    chips: ["RR 2T BNF sem sopros", "taquicárdico", "bulhas normofonéticas", "TEC < 2s", "bradicárdico", "ritmo irregular", "sopro sistólico", "B3 presente", "pulsos cheios e simétricos", "turgência jugular"],
  },
  {
    secao: "respiratorio", campo: "respiratorio", label: "Respiratório",
    chips: ["MV+ bilat simétrico", "eupneico", "sem ruídos adventícios", "taquipneico", "dispneico", "estertores crepitantes", "sibilos difusos", "roncos", "MV reduzido globalmente", "MV reduzido em base", "uso de musculatura acessória"],
  },
  {
    secao: "abdominal", campo: "abdominal", label: "Abdominal",
    chips: ["flácido", "indolor à palpação", "RHA+", "sem visceromegalias", "doloroso à palpação", "distendido", "ascite", "hepatomegalia", "RHA diminuídos", "descompressão brusca negativa"],
  },
  {
    secao: "membros", campo: "mmii", label: "Membros e extremidades",
    chips: ["MMII sem edema", "panturrilhas livres", "perfusão periférica preservada", "extremidades quentes", "edema MMII +/4", "edema MMII ++/4", "extremidades frias", "cianose periférica", "empastamento de panturrilha", "pulsos pediosos presentes"],
  },
  {
    secao: "pele", campo: "pele", label: "Pele e mucosas",
    chips: ["mucosas normocoradas e úmidas", "pele íntegra", "acianótico", "anictérico", "mucosas hipocoradas", "mucosas desidratadas", "ictérico", "cianótico", "lesões de pele", "petéquias"],
  },
];

// FEATURE 2 / BUG 2: "Alimentação e Eliminações" em três subseções de chips
// (Alimentação · Diurese · Evacuação). O conteúdo compõe o *S: da Evolução
// Médica (não o *O:). Cada subseção é um ExameComChips próprio.
const CHIPS_ALIMENTACAO = [
  "aceitando dieta",
  "dieta zero",
  "jejum",
  "dieta enteral",
  "NPT",
  "sonda nasoenteral",
];
const CHIPS_DIURESE = [
  "oligúrico",
  "diurese preservada",
  "anúrico",
  "hematúria",
  "colúria",
  "piúria",
  "sonda vesical",
];
const CHIPS_EVACUACAO = [
  "evacuou",
  "sem evacuações",
  "diarreia",
  "melena",
  "enterorragia",
  "estomia funcionante",
];

/**
 * Campo de exame físico com chips clicáveis (top 4 + "ver mais") e caixa de texto
 * para achados não listados. Os chips inserem/removem seu texto no conteúdo do
 * campo; o resultado já é o texto clínico usado no Passar o Caso. (Feature 1)
 */
/** Junta termos em texto (trim, sem vazios, separados por vírgula). */
const juntarTermos = (arr: string[]) =>
  arr.map((t) => t.trim()).filter(Boolean).join(", ");

// BUG 1: sinônimos de chips renomeados — o valor salvo antigo colapsa no chip
// atual, para não sobrar "texto solto" abaixo dos chips após renomear um chip.
const SINONIMOS_CHIP: { re: RegExp; novo: string }[] = [
  // Ordem: variantes mais específicas primeiro. Os prefixos AC/AP saíram dos
  // chips (BUG 1) — o prefixo é adicionado só na geração da Evolução Médica.
  { re: /AP\s+MV\+?\s*bilat\.?\s*sim[ée]trico\s+sem\s+RA/gi, novo: "MV+ bilat simétrico" },
  { re: /AP\s+MV\+?\s*bilat\.?\s*sim[ée]trico/gi, novo: "MV+ bilat simétrico" },
  { re: /AC\s+RR\s+2T\s+BNF\s+sem\s+sopros/gi, novo: "RR 2T BNF sem sopros" },
];
function normalizarChipsLegado(v: string): string {
  let t = v || "";
  for (const s of SINONIMOS_CHIP) t = t.replace(s.re, s.novo);
  return t;
}

function ExameComChips({
  label,
  secao,
  valor,
  chips,
  pessoais,
  globais,
  onChange,
  onBlur,
  onLog,
}: {
  label: string;
  secao: string;
  valor: string;
  chips: string[];
  /** Chips pessoais aprendidos (borda tracejada). */
  pessoais: string[];
  /** Chips globais aprovados (sempre visíveis). */
  globais: string[];
  onChange: (t: string) => void;
  onBlur: () => void;
  onLog: (secao: string, termos: string[]) => void;
}) {
  const [verMais, setVerMais] = useState(false);
  const jaLogados = useRef<Set<string>>(new Set());

  // Conjunto de TODOS os chips conhecidos (padrões + globais + pessoais).
  const normPadroes = new Set(chips.map(normMerge));
  const globaisExtra = globais.filter((g) => !normPadroes.has(normMerge(g)));
  const pessoaisExtra = pessoais.filter(
    (p) => !normPadroes.has(normMerge(p)) && !globaisExtra.some((g) => normMerge(g) === normMerge(p)),
  );
  const conhecidos = [...chips, ...globaisExtra, ...pessoaisExtra];
  const normConhecidos = new Set(conhecidos.map(normMerge));

  // Separa o conteúdo do campo em: chips selecionados × texto livre (achados
  // não listados). A caixa de texto mostra SÓ o texto livre (Feature 1).
  const tokens = normalizarChipsLegado(valor).split(/\s*[,;]\s*/).map((t) => t.trim()).filter(Boolean);
  const chipsSelecionados = tokens.filter((t) => normConhecidos.has(normMerge(t)));
  const selecionadoNorm = new Set(chipsSelecionados.map(normMerge));
  const livre = juntarTermos(tokens.filter((t) => !normConhecidos.has(normMerge(t))));

  // BUG: a caixa "Achados adicionais" precisa de estado LOCAL — o valor salvo é
  // normalizado (trim a cada tecla), o que apagava o espaço antes da palavra
  // seguinte. Aqui o input mostra o texto como digitado; o store só normaliza.
  const [livreLocal, setLivreLocal] = useState(livre);
  useEffect(() => {
    // Re-sincroniza apenas quando o conteúdo muda POR FORA (chip toggle, scan),
    // sem clobberar o espaço que o usuário está digitando.
    if (livre.trim() !== livreLocal.trim()) setLivreLocal(livre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livre]);

  const recompor = (novosChips: string[], novoLivre: string) =>
    onChange(juntarTermos([...novosChips, novoLivre]));

  const toggle = (chip: string) => {
    if (selecionadoNorm.has(normMerge(chip))) {
      recompor(chipsSelecionados.filter((t) => normMerge(t) !== normMerge(chip)), livreLocal);
    } else {
      recompor([...chipsSelecionados, chip], livreLocal);
    }
  };

  // Termos do texto livre alimentam o aprendizado (Feature 2). Evita re-logar.
  const aoSair = () => {
    onBlur();
    const termos = livreLocal
      .split(/\s*[,;]\s*/)
      .map((t) => t.trim())
      .filter((t) => normMerge(t).length >= 3 && !jaLogados.current.has(normMerge(t)));
    if (termos.length) {
      termos.forEach((t) => jaLogados.current.add(normMerge(t)));
      onLog(secao, termos);
    }
  };

  const padroesVisiveis = verMais ? chips : chips.slice(0, 4);
  const visiveis = [...padroesVisiveis, ...globaisExtra, ...pessoaisExtra];

  return (
    <View style={styles.exameBox}>
      <Text style={styles.evoLabel}>{label}</Text>
      <View style={styles.chipsWrap}>
        {visiveis.map((chip) => {
          const ativo = selecionadoNorm.has(normMerge(chip));
          const pessoal = pessoaisExtra.some((p) => normMerge(p) === normMerge(chip));
          return (
            <TouchableOpacity
              key={chip}
              onPress={() => toggle(chip)}
              style={[
                styles.exameChip,
                pessoal && styles.exameChipPessoal,
                ativo && styles.exameChipAtivo,
              ]}
            >
              <Text style={[styles.exameChipTxt, ativo && styles.exameChipTxtAtivo]}>{chip}</Text>
            </TouchableOpacity>
          );
        })}
        {chips.length > 4 && (
          <TouchableOpacity onPress={() => setVerMais((v) => !v)} style={styles.verMaisChip}>
            <Text style={styles.verMaisTxt}>{verMais ? "− ver menos" : "+ ver mais"}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TextInput
        style={[styles.campoInput, styles.exameLivre]}
        value={livreLocal}
        onChangeText={(t) => {
          setLivreLocal(t);
          recompor(chipsSelecionados, t);
        }}
        onBlur={aoSair}
        placeholder="Achados adicionais (texto livre)…"
        placeholderTextColor={ClinicalColors.textMuted}
        multiline
      />
    </View>
  );
}

/**
 * Seção "Evolução Beira-Leito" — formulário estruturado, 100% manual (sem foto).
 * Toggles persistem na hora; campos de texto persistem ao perder o foco.
 */
function EvolucaoBeiraLeitoSecao({
  evolucao,
  onSalvar,
}: {
  evolucao: EvolucaoBeiraLeito;
  onSalvar: (evo: EvolucaoBeiraLeito) => void;
}) {
  const [aberto, setAberto] = useSecaoAccordion("beiraLeito");
  const [evo, setEvo] = useState(evolucao);
  // Chips aprendidos (Feature 2): pessoais (do médico) e globais (aprovados).
  const [chipsPessoais, setChipsPessoais] = useState<Record<string, string[]>>({});
  const [chipsGlobais, setChipsGlobais] = useState<Record<string, string[]>>({});

  // Resync se a evolução do dia mudar (ex.: virada de data).
  useEffect(() => setEvo(evolucao), [evolucao]);

  // Carrega os chips pessoais/globais ao abrir a seção pela primeira vez.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    listarPessoais().then((m) => {
      if (!vivo) return;
      const so: Record<string, string[]> = {};
      for (const [secao, lista] of Object.entries(m)) so[secao] = lista.map((c) => c.texto);
      setChipsPessoais(so);
    });
    listarGlobais().then((m) => {
      if (vivo) setChipsGlobais(m);
    });
    return () => {
      vivo = false;
    };
  }, [aberto]);

  const registrarTermos = (secao: string, termos: string[]) => {
    logChipTermos(secao, termos);
  };

  // Auto-save com debounce para os campos de TEXTO (persistir=false): grava
  // enquanto digita, sem depender do onBlur. Toggles/seleções (persistir=true)
  // continuam salvando na hora. Evita perder texto ao fechar o app sem desfocar.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => cancelarTimer, []);

  const aplicar = (patch: Partial<EvolucaoBeiraLeito>, persistir = true) => {
    const novo = { ...evo, ...patch };
    setEvo(novo);
    cancelarTimer();
    if (persistir) onSalvar(novo);
    else timerRef.current = setTimeout(() => onSalvar(novo), 800);
  };

  const selecionarUnico = (
    campo: "nivelConsciencia" | "orientacao" | "alimentacao" | "diurese" | "evacuacao",
    valor: string,
  ) => {
    aplicar({ [campo]: evo[campo] === valor ? null : valor });
  };

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>Evolução Beira-Leito</Text>
        <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
      </TouchableOpacity>

      {aberto && (
        <View style={styles.secaoBody}>
          {/* BUG 2: Alimentação e Eliminações em 3 subseções de chips, ANTES do
              exame físico (e do Estado Geral). Compõem o *S: da Evolução Médica. */}
          <Text style={styles.evoGrupo}>Alimentação e Eliminações</Text>
          <ExameComChips
            label="Alimentação"
            secao="ae_alimentacao"
            chips={CHIPS_ALIMENTACAO}
            pessoais={chipsPessoais["ae_alimentacao"] ?? []}
            globais={chipsGlobais["ae_alimentacao"] ?? []}
            valor={evo.aeAlimentacao ?? ""}
            onChange={(t) => aplicar({ aeAlimentacao: t }, false)}
            onBlur={() => onSalvar(evo)}
            onLog={registrarTermos}
          />
          <ExameComChips
            label="Diurese"
            secao="ae_diurese"
            chips={CHIPS_DIURESE}
            pessoais={chipsPessoais["ae_diurese"] ?? []}
            globais={chipsGlobais["ae_diurese"] ?? []}
            valor={evo.aeDiurese ?? ""}
            onChange={(t) => aplicar({ aeDiurese: t }, false)}
            onBlur={() => onSalvar(evo)}
            onLog={registrarTermos}
          />
          <ExameComChips
            label="Evacuação"
            secao="ae_evacuacao"
            chips={CHIPS_EVACUACAO}
            pessoais={chipsPessoais["ae_evacuacao"] ?? []}
            globais={chipsGlobais["ae_evacuacao"] ?? []}
            valor={evo.aeEvacuacao ?? ""}
            onChange={(t) => aplicar({ aeEvacuacao: t }, false)}
            onBlur={() => onSalvar(evo)}
            onLog={registrarTermos}
          />

          <Text style={styles.evoGrupo}>Estado Geral</Text>
          <ToggleLinha
            label="Nível de consciência"
            opcoes={OPC_CONSCIENCIA}
            valor={evo.nivelConsciencia}
            onSelecionar={(v) => selecionarUnico("nivelConsciencia", v)}
          />
          <ToggleLinha
            label="Orientação"
            opcoes={OPC_ORIENTACAO}
            valor={evo.orientacao}
            onSelecionar={(v) => selecionarUnico("orientacao", v)}
          />
          <CampoTexto
            label="Estado geral (subjetivo / queixas)"
            value={evo.estadoGeral}
            placeholder="Ex: refere dor abdominal, sem queixas..."
            onChangeText={(t) => aplicar({ estadoGeral: t }, false)}
            onBlur={() => onSalvar(evo)}
          />

          <Text style={styles.evoGrupo}>Exame Físico</Text>
          {CHIPS_EXAME.map((cfg) => (
            <ExameComChips
              key={cfg.campo}
              label={cfg.label}
              secao={cfg.secao}
              chips={cfg.chips}
              pessoais={chipsPessoais[cfg.secao] ?? []}
              globais={chipsGlobais[cfg.secao] ?? []}
              valor={(evo[cfg.campo] as string) ?? ""}
              onChange={(t) => aplicar({ [cfg.campo]: t } as Partial<EvolucaoBeiraLeito>, false)}
              onBlur={() => onSalvar(evo)}
              onLog={registrarTermos}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Conduta do Dia — seção independente (texto livre, sem foto). Guardada em
 * evolucoes[hoje].condutaDoDia; alimenta o *P: do "Passar o Caso".
 */
function CondutaSecao({
  evolucao,
  onSalvar,
}: {
  evolucao: EvolucaoBeiraLeito;
  onSalvar: (evo: EvolucaoBeiraLeito) => void;
}) {
  const [aberto, setAberto] = useSecaoAccordion("conduta");
  const [evo, setEvo] = useState(evolucao);
  useEffect(() => setEvo(evolucao), [evolucao]);

  // Auto-save com debounce: a conduta é gravada ENQUANTO digita, não só quando o
  // campo perde o foco. Dado clínico não pode depender do onBlur — se a médica
  // fechar o app ou trocar de tela sem desfocar, o texto se perderia.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => cancelarTimer, []);

  // Feedback do botão "Salvar" explícito (BUG 8): mostra "Salvo ✓" por um tempo.
  const [salvo, setSalvo] = useState(false);
  const aoDigitar = (t: string) => {
    const proximo = { ...evo, condutaDoDia: t };
    setEvo(proximo);
    setSalvo(false);
    cancelarTimer();
    timerRef.current = setTimeout(() => onSalvar(proximo), 800);
  };
  const salvarAgora = () => {
    cancelarTimer();
    onSalvar(evo);
  };
  // Salvar explícito: persiste e confirma visualmente (dado clínico crítico).
  const salvarExplicito = () => {
    salvarAgora();
    setSalvo(true);
  };

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>Conduta do Dia</Text>
        <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
      </TouchableOpacity>
      {aberto && (
        <View style={styles.secaoBody}>
          <CampoTexto
            value={evo.condutaDoDia}
            placeholder="Condutas definidas na discussão com o preceptor..."
            onChangeText={aoDigitar}
            onBlur={salvarAgora}
          />
          <TouchableOpacity
            style={[styles.botaoSalvarAnotacao, salvo && styles.botaoSalvarConfirmado]}
            onPress={salvarExplicito}
            activeOpacity={0.8}
          >
            <Text style={styles.botaoSalvarAnotacaoTexto}>
              {salvo ? "Salvo ✓" : "Salvar conduta"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/** Estado inicial de um problema novo no formulário. */
const PROBLEMA_VAZIO: Omit<Problema, "id"> = {
  titulo: "",
  status: "ativo",
  prioridade: "media",
  observacao: "",
  conduta: "",
};

/**
 * Seção "Problemas Ativos": lista com cor por prioridade (alta/vermelho,
 * média/amarelo, baixa/verde) e formulário inline para adicionar/editar.
 * A persistência fica a cargo do componente pai (via onChange).
 */
/**
 * Seleção múltipla para exclusão em massa (FEATURE 1), reaproveitada pelas seções
 * de lista (Problemas, Pendências, Medicamentos, Anotações). Cada seção tem seu
 * próprio modo de seleção, com barra inline ao fim do conteúdo da seção.
 */
function useSelecaoMultipla() {
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const alternar = (id: string) =>
    setSelecionados((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sair = () => {
    setSelecionando(false);
    setSelecionados(new Set());
  };
  return { selecionando, setSelecionando, selecionados, setSelecionados, alternar, sair };
}

/** Botão "Selecionar"/"Cancelar" para o cabeçalho de uma seção. */
function BotaoSelecionar({ ativo, onPress }: { ativo: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.selBotao}>
      <Text style={styles.selBotaoTexto}>{ativo ? "Cancelar" : "Selecionar"}</Text>
    </TouchableOpacity>
  );
}

/** Indicador (círculo) de checkbox dos itens em modo seleção. */
function CheckSelecao({ on }: { on: boolean }) {
  return (
    <View style={[styles.selCheck, on && styles.selCheckOn]}>
      {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
    </View>
  );
}

/** Barra inferior "Selecionar todos / Excluir (N)" do modo seleção. */
function BarraSelecao({
  n,
  total,
  onTodos,
  onExcluir,
}: {
  n: number;
  total: number;
  onTodos: () => void;
  onExcluir: () => void;
}) {
  const todos = total > 0 && n === total;
  return (
    <View style={styles.selBarra}>
      <TouchableOpacity onPress={onTodos} hitSlop={8}>
        <Text style={styles.selBarraTodos}>
          {todos ? "Limpar seleção" : "Selecionar todos"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.selBarraExcluir, !n && styles.selBarraExcluirOff]}
        onPress={onExcluir}
        disabled={!n}
      >
        <Ionicons name="trash-outline" size={15} color="#FFFFFF" />
        <Text style={styles.selBarraExcluirTexto}>Excluir ({n})</Text>
      </TouchableOpacity>
    </View>
  );
}

function ProblemasSecao({
  problemas,
  onChange,
}: {
  problemas: Problema[];
  onChange: (lista: Problema[]) => void;
}) {
  const sel = useSelecaoMultipla();
  const [aberto, setAberto] = useSecaoAccordion("problemas");
  const [editId, setEditId] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState<Omit<Problema, "id">>(PROBLEMA_VAZIO);

  const abrirNovo = () => {
    setEditId(null);
    setForm(PROBLEMA_VAZIO);
    setMostrarForm(true);
    setAberto(true);
  };

  const abrirEdicao = (p: Problema) => {
    const { id: _id, ...resto } = p;
    setEditId(p.id);
    setForm(resto);
    setMostrarForm(true);
    setAberto(true);
  };

  const cancelar = () => {
    setMostrarForm(false);
    setEditId(null);
    setForm(PROBLEMA_VAZIO);
  };

  const salvar = () => {
    const titulo = form.titulo.trim();
    if (!titulo) return;
    const limpo = { ...form, titulo };
    if (editId) {
      onChange(
        problemas.map((p) => (p.id === editId ? { ...limpo, id: editId } : p)),
      );
    } else {
      onChange([...problemas, { ...limpo, id: novoId() }]);
    }
    cancelar();
  };

  const excluir = (p: Problema) => {
    Alert.alert("Excluir problema?", p.titulo, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => {
          onChange(problemas.filter((x) => x.id !== p.id));
          if (editId === p.id) cancelar();
        },
      },
    ]);
  };

  const excluirSelecionados = () => {
    if (!sel.selecionados.size) return;
    Alert.alert(
      "Excluir problemas",
      `Remover ${sel.selecionados.size} problema${sel.selecionados.size > 1 ? "s" : ""}? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Excluir (${sel.selecionados.size})`,
          style: "destructive",
          onPress: () => {
            onChange(problemas.filter((x) => !sel.selecionados.has(x.id)));
            sel.sair();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.secao}>
      <View style={styles.secaoHeader}>
        <TouchableOpacity
          style={styles.secaoHeaderToque}
          onPress={() => setAberto((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.secaoHeaderTitulo}>
            Problemas Ativos{problemas.length ? ` (${problemas.length})` : ""}
          </Text>
          <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
        </TouchableOpacity>
        {aberto && problemas.length > 0 && (
          <BotaoSelecionar
            ativo={sel.selecionando}
            onPress={() => (sel.selecionando ? sel.sair() : sel.setSelecionando(true))}
          />
        )}
        {!sel.selecionando && (
          <TouchableOpacity style={styles.botaoMais} onPress={abrirNovo} hitSlop={8}>
            <Text style={styles.botaoMaisTexto}>+</Text>
          </TouchableOpacity>
        )}
      </View>

      {aberto && (
        <View style={styles.secaoBody}>
          {problemas.length === 0 && !mostrarForm && (
            <Text style={styles.vazioTexto}>Nenhum problema ativo.</Text>
          )}

          {problemas.map((p) => {
            const cor = PrioridadeColors[p.prioridade];
            const on = sel.selecionados.has(p.id);
            const card = (
              <View
                style={[
                  styles.problemaCard,
                  { borderLeftColor: cor.text },
                  sel.selecionando && { flex: 1 },
                ]}
              >
                <View style={styles.problemaTopo}>
                  <Text style={styles.problemaTitulo}>{p.titulo}</Text>
                  {!sel.selecionando && (
                    <View style={styles.anotacaoAcoes}>
                      <TouchableOpacity onPress={() => abrirEdicao(p)} hitSlop={8}>
                        <Ionicons name="pencil" size={16} color={ClinicalColors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => excluir(p)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <View style={styles.problemaMeta}>
                  <Text
                    style={[
                      styles.miniChip,
                      {
                        color: ClinicalColors.textMuted,
                        backgroundColor: ClinicalColors.background,
                      },
                    ]}
                  >
                    {PROBLEMA_STATUS_LABEL[p.status]}
                  </Text>
                  <Text
                    style={[
                      styles.miniChip,
                      { color: cor.text, backgroundColor: cor.bg },
                    ]}
                  >
                    Prioridade {cor.label.toLowerCase()}
                  </Text>
                </View>
                {!!p.observacao && (
                  <Text style={styles.problemaObs}>{p.observacao}</Text>
                )}
                {!!p.conduta && (
                  <Text style={styles.problemaConduta}>Conduta: {p.conduta}</Text>
                )}
              </View>
            );
            if (!sel.selecionando) return <View key={p.id}>{card}</View>;
            return (
              <TouchableOpacity
                key={p.id}
                style={styles.selLinha}
                onPress={() => sel.alternar(p.id)}
                activeOpacity={0.7}
              >
                <CheckSelecao on={on} />
                {card}
              </TouchableOpacity>
            );
          })}

          {sel.selecionando && (
            <BarraSelecao
              n={sel.selecionados.size}
              total={problemas.length}
              onTodos={() =>
                sel.setSelecionados(
                  sel.selecionados.size === problemas.length
                    ? new Set()
                    : new Set(problemas.map((p) => p.id)),
                )
              }
              onExcluir={excluirSelecionados}
            />
          )}

          {mostrarForm && !sel.selecionando && (
            <View style={styles.formInline}>
              <TextInput
                style={styles.campoInput}
                value={form.titulo}
                onChangeText={(t) => setForm((f) => ({ ...f, titulo: t }))}
                placeholder="Título do problema"
                placeholderTextColor={ClinicalColors.textMuted}
              />
              <Text style={styles.campoLabel}>Prioridade</Text>
              <View style={styles.chipsWrap}>
                {PRIORIDADE_OPCOES.map((pr) => {
                  const ativo = form.prioridade === pr;
                  const cor = PrioridadeColors[pr];
                  return (
                    <TouchableOpacity
                      key={pr}
                      onPress={() => setForm((f) => ({ ...f, prioridade: pr }))}
                      style={[
                        styles.statusChip,
                        {
                          borderColor: cor.text,
                          backgroundColor: ativo ? cor.bg : "transparent",
                        },
                      ]}
                    >
                      <Text style={[styles.statusChipTexto, { color: cor.text }]}>
                        {cor.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.campoLabel}>Status</Text>
              <View style={styles.chipsWrap}>
                {PROBLEMA_STATUS_OPCOES.map((st) => {
                  const ativo = form.status === st;
                  return (
                    <TouchableOpacity
                      key={st}
                      onPress={() => setForm((f) => ({ ...f, status: st }))}
                      style={[styles.toggleChip, ativo && styles.toggleChipAtivo]}
                    >
                      <Text
                        style={[
                          styles.toggleChipTexto,
                          ativo && styles.toggleChipTextoAtivo,
                        ]}
                      >
                        {PROBLEMA_STATUS_LABEL[st]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                style={styles.campoInput}
                value={form.observacao}
                onChangeText={(t) => setForm((f) => ({ ...f, observacao: t }))}
                placeholder="Observação curta"
                placeholderTextColor={ClinicalColors.textMuted}
              />
              <TextInput
                style={styles.campoInput}
                value={form.conduta}
                onChangeText={(t) => setForm((f) => ({ ...f, conduta: t }))}
                placeholder="Conduta relacionada"
                placeholderTextColor={ClinicalColors.textMuted}
              />
              <View style={styles.formAcoes}>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoSalvar]}
                  onPress={salvar}
                >
                  <Text style={styles.botaoAcaoTexto}>Salvar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoCancelar]}
                  onPress={cancelar}
                >
                  <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Seção "Pendências": checklist com checkbox. Itens feitos ficam riscados e em
 * cinza. A persistência fica a cargo do componente pai (via onChange).
 */
function PendenciasSecao({
  pendencias,
  onChange,
}: {
  pendencias: Pendencia[];
  onChange: (lista: Pendencia[]) => void;
}) {
  const [aberto, setAberto] = useSecaoAccordion("pendencias");
  const [mostrarForm, setMostrarForm] = useState(false);
  const [descForm, setDescForm] = useState("");
  const [prioForm, setPrioForm] = useState<Prioridade>("media");
  const sel = useSelecaoMultipla();

  const abertas = pendencias.filter((p) => !p.feito).length;

  const abrirNovo = () => {
    setDescForm("");
    setPrioForm("media");
    setMostrarForm(true);
    setAberto(true);
  };

  const salvar = () => {
    const descricao = descForm.trim();
    if (!descricao) return;
    onChange([
      ...pendencias,
      { id: novoId(), descricao, prioridade: prioForm, feito: false },
    ]);
    setMostrarForm(false);
    setDescForm("");
  };

  const alternar = (p: Pendencia) => {
    onChange(
      pendencias.map((x) => (x.id === p.id ? { ...x, feito: !x.feito } : x)),
    );
  };

  const excluir = (p: Pendencia) => {
    onChange(pendencias.filter((x) => x.id !== p.id));
  };

  const excluirSelecionados = () => {
    if (!sel.selecionados.size) return;
    Alert.alert(
      "Excluir pendências",
      `Remover ${sel.selecionados.size} pendência${sel.selecionados.size > 1 ? "s" : ""}? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Excluir (${sel.selecionados.size})`,
          style: "destructive",
          onPress: () => {
            onChange(pendencias.filter((x) => !sel.selecionados.has(x.id)));
            sel.sair();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.secao}>
      <View style={styles.secaoHeader}>
        <TouchableOpacity
          style={styles.secaoHeaderToque}
          onPress={() => setAberto((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.secaoHeaderTitulo}>
            Pendências{abertas ? ` (${abertas})` : ""}
          </Text>
          <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
        </TouchableOpacity>
        {aberto && pendencias.length > 0 && (
          <BotaoSelecionar
            ativo={sel.selecionando}
            onPress={() => (sel.selecionando ? sel.sair() : sel.setSelecionando(true))}
          />
        )}
        {!sel.selecionando && (
          <TouchableOpacity style={styles.botaoMais} onPress={abrirNovo} hitSlop={8}>
            <Text style={styles.botaoMaisTexto}>+</Text>
          </TouchableOpacity>
        )}
      </View>

      {aberto && (
        <View style={styles.secaoBody}>
          {pendencias.length === 0 && !mostrarForm && (
            <Text style={styles.vazioTexto}>Nenhuma pendência.</Text>
          )}

          {pendencias.map((p) => {
            const cor = PrioridadeColors[p.prioridade];
            if (sel.selecionando) {
              const on = sel.selecionados.has(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pendenciaLinha}
                  onPress={() => sel.alternar(p.id)}
                  activeOpacity={0.7}
                >
                  <CheckSelecao on={on} />
                  <Text
                    style={[styles.pendenciaTexto, p.feito && styles.pendenciaFeita]}
                  >
                    {p.descricao}
                  </Text>
                </TouchableOpacity>
              );
            }
            return (
              <View key={p.id} style={styles.pendenciaLinha}>
                <TouchableOpacity onPress={() => alternar(p)} hitSlop={8}>
                  <Ionicons
                    name={p.feito ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={p.feito ? ClinicalColors.accent : ClinicalColors.chevron}
                  />
                </TouchableOpacity>
                <Text
                  style={[
                    styles.pendenciaTexto,
                    p.feito && styles.pendenciaFeita,
                  ]}
                >
                  {p.descricao}
                </Text>
                {!p.feito && (
                  <View
                    style={[styles.prioridadePonto, { backgroundColor: cor.text }]}
                  />
                )}
                <TouchableOpacity onPress={() => excluir(p)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
                </TouchableOpacity>
              </View>
            );
          })}

          {sel.selecionando && (
            <BarraSelecao
              n={sel.selecionados.size}
              total={pendencias.length}
              onTodos={() =>
                sel.setSelecionados(
                  sel.selecionados.size === pendencias.length
                    ? new Set()
                    : new Set(pendencias.map((p) => p.id)),
                )
              }
              onExcluir={excluirSelecionados}
            />
          )}

          {mostrarForm && !sel.selecionando && (
            <View style={styles.formInline}>
              <TextInput
                style={styles.campoInput}
                value={descForm}
                onChangeText={setDescForm}
                placeholder="Descrição da pendência"
                placeholderTextColor={ClinicalColors.textMuted}
              />
              <Text style={styles.campoLabel}>Prioridade</Text>
              <View style={styles.chipsWrap}>
                {PRIORIDADE_OPCOES.map((pr) => {
                  const ativo = prioForm === pr;
                  const cor = PrioridadeColors[pr];
                  return (
                    <TouchableOpacity
                      key={pr}
                      onPress={() => setPrioForm(pr)}
                      style={[
                        styles.statusChip,
                        {
                          borderColor: cor.text,
                          backgroundColor: ativo ? cor.bg : "transparent",
                        },
                      ]}
                    >
                      <Text style={[styles.statusChipTexto, { color: cor.text }]}>
                        {cor.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.formAcoes}>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoSalvar]}
                  onPress={salvar}
                >
                  <Text style={styles.botaoAcaoTexto}>Adicionar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoCancelar]}
                  onPress={() => setMostrarForm(false)}
                >
                  <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Campos numéricos dos sinais vitais (todos guardados como string). */
type CampoNum =
  | "temp"
  | "paSist"
  | "paDiast"
  | "fc"
  | "fr"
  | "sato2"
  | "glicemia"
  | "diurese";

/**
 * Resumo Rápido: SOMENTE LEITURA (sem ✏️), minimizado por padrão. "✨ Gerar"
 * cria o resumo pela IA e expande com animação; "▲ Minimizar" recolhe. O texto
 * fica salvo — ao expandir de novo aparece sem regenerar.
 */
function ResumoRapidoSecao({
  resumo,
  gerando,
  onGerar,
}: {
  resumo: string;
  gerando: boolean;
  onGerar: () => void;
}) {
  const [aberto, setAberto] = useSecaoAccordion("resumoRapido");
  const temResumo = !!resumo;

  const alternar = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAberto((v) => !v);
  };

  return (
    <View style={styles.resumoCard}>
      <View style={styles.resumoTopo}>
        <Text style={styles.resumoTitulo}>RESUMO RÁPIDO</Text>
        <View style={styles.resumoAcoes}>
          {temResumo && (
            <TouchableOpacity onPress={alternar}>
              <Text style={styles.resumoToggle}>
                {aberto ? "▲ Minimizar" : "▼ Ver"}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.resumoGerarBtn}
            onPress={() => {
              LayoutAnimation.configureNext(
                LayoutAnimation.Presets.easeInEaseOut,
              );
              setAberto(true);
              onGerar();
            }}
            disabled={gerando}
          >
            {gerando ? (
              <ActivityIndicator size="small" color={ClinicalColors.primary} />
            ) : (
              <Text style={styles.resumoGerarTexto}>Gerar resumo</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {aberto && (
        <Text style={[styles.resumoTextoLeitura, !resumo && styles.leituraVazio]}>
          {resumo || "Gerando resumo…"}
        </Text>
      )}
    </View>
  );
}

/** Campos laboratoriais comuns do formulário "Adicionar hoje". */
const LAB_CAMPOS: { key: string; label: string; unidade: string; alias: RegExp }[] = [
  { key: "Hb", label: "Hb", unidade: "g/dL", alias: /^(hb|hemoglob)/i },
  { key: "Ht", label: "Ht", unidade: "%", alias: /^(ht|hemat[oó]cr)/i },
  { key: "LT", label: "LT", unidade: "/mm³", alias: /^(lt|leuc)/i },
  { key: "Plaq", label: "Plaq", unidade: "/mm³", alias: /^(plaq|plt)/i },
  { key: "PCR", label: "PCR", unidade: "mg/L", alias: /^pcr/i },
  { key: "Na", label: "Na", unidade: "mEq/L", alias: /^(na|s[oó]dio)/i },
  { key: "K", label: "K", unidade: "mEq/L", alias: /^(k|pot[aá]ssio)/i },
  { key: "Cr", label: "Cr", unidade: "mg/dL", alias: /^(cr|creat)/i },
  { key: "Ureia", label: "Ureia", unidade: "mg/dL", alias: /^ur[eé]ia/i },
  { key: "Glicemia", label: "Glicemia", unidade: "mg/dL", alias: /^(glic)/i },
  { key: "TGO", label: "TGO", unidade: "U/L", alias: /^(tgo|ast)/i },
  { key: "TGP", label: "TGP", unidade: "U/L", alias: /^(tgp|alt)/i },
  { key: "FA", label: "FA", unidade: "U/L", alias: /^(fa|fosfatase)/i },
  { key: "GGT", label: "GGT", unidade: "U/L", alias: /^(ggt|gama)/i },
  { key: "BT", label: "BT", unidade: "mg/dL", alias: /^bt\b|bilirrubina t/i },
  { key: "BD", label: "BD", unidade: "mg/dL", alias: /^bd\b|bilirrubina d/i },
  { key: "Alb", label: "Alb", unidade: "g/dL", alias: /^(alb|albumin)/i },
  { key: "INR", label: "INR", unidade: "", alias: /^(inr|rni)/i },
];
// Labs onde a queda é o "ruim" (para a cor da seta de tendência).
const LAB_INVERTIDOS = /^(hb|ht|plaq)$/i;

// Abreviação dos labs: fonte única em @/lib/lab (abreviarLab), incluindo LÍQUOR.

// Seta colorida por referência (↑ alto/vermelho, ↓ baixo/azul, → normal/cinza).
// Fonte ÚNICA: tabela labs_referencia (ABIM 2026), via cache de @/lib/labsReferencia.
// Exame sem referência cadastrada → sem seta (string vazia).
function setaRefLab(
  nome: string,
  valor: string,
  sexo?: "M" | "F" | null,
  idade?: number | null,
): { seta: string; cor: string } {
  const c = classificarLabSync(abreviarLab(nome), valor, sexo, idade);
  // BUG 4: seta SÓ em alto (↑) / baixo (↓); normal e sem referência não têm seta.
  const seta = c.status === "alto" || c.status === "baixo" ? c.seta : "";
  return { seta, cor: c.cor };
}


/** Rótulo curto de data ISO → "20 jun". */
function rotuloDiaMes(iso: string): string {
  const m = iso.slice(0, 10).split("-").map(Number);
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[2]} ${MESES[m[1] - 1] ?? ""}`;
}

/**
 * Um valor de lab no painel de hoje. Busca a referência oficial (LOINC, por
 * sexo) e colore o valor quando está fora do intervalo. A seta mostra a
 * tendência vs. o dia anterior.
 */
function LabHojeChip({
  label,
  exameKey,
  valor,
  sexo,
  idade,
}: {
  label: string;
  exameKey: string;
  valor: string;
  sexo?: "M" | "F" | null;
  idade?: number | null;
}) {
  // BUG 4: padrão único — alto ↑ vermelho, baixo ↓ azul, normal só o valor preto.
  const { seta, cor } = setaRefLab(exameKey, valor, sexo, idade);
  const num = valorNumerico(valor);
  return (
    <View style={styles.labHojeChip}>
      <Text style={styles.labHojeLabel}>{label} </Text>
      <Text style={[styles.labHojeValor, { color: cor }]}>{num ?? valor}</Text>
      {!!seta && <Text style={[styles.labHojeSeta, { color: cor }]}> {seta}</Text>}
    </View>
  );
}

/**
 * Exames laboratoriais com HISTÓRICO POR DATA. O store continua sendo
 * resultadosLab (lista plana exame/data/valor) — compatível com timeline,
 * alertas e snapshot —, mas a UI é organizada por dia: painel de hoje em
 * destaque (com tendência vs. dia anterior) e dias anteriores colapsados.
 */
function LabsPorData({
  resultados,
  sexo,
  idade,
  onChange,
  onAposSalvar,
}: {
  resultados: ResultadoLab[];
  sexo?: "M" | "F" | null;
  idade?: number | null;
  onChange: (l: ResultadoLab[]) => void;
  onAposSalvar?: (novos: ResultadoLab[]) => void;
}) {
  const hoje = hojeISO();
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [freeNome, setFreeNome] = useState("");
  const [freeValor, setFreeValor] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const recortar = useCrop();
  const [verTodos, setVerTodos] = useState(false);
  // BUG 3: data cujo detalhe (todos os exames, agrupados) está aberto no modal.
  const [dataDetalhe, setDataDetalhe] = useState<string | null>(null);
  // FEATURE 1: seleção múltipla das entradas de hoje (excluir em massa).
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Carrega as referências ABIM (cache) e re-renderiza quando prontas, p/ as
  // setas das datas anteriores (classificação síncrona) aparecerem.
  const [, setRefVersao] = useState(0);
  useEffect(() => {
    carregarReferencias().then(() => setRefVersao((v) => v + 1));
  }, []);
  const toggleSel = (k: string) =>
    setSelecionados((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const sairSelecao = () => {
    setSelecionando(false);
    setSelecionados(new Set());
  };

  // Agrupa por data → mapa exame→valor (último valor do dia vence).
  const porData = new Map<string, { exame: string; valor: string }[]>();
  for (const r of resultados) {
    const d = r.data.slice(0, 10);
    const lista = porData.get(d) ?? [];
    lista.push({ exame: r.exame, valor: r.valor });
    porData.set(d, lista);
  }
  const datas = [...porData.keys()].sort((a, b) => b.localeCompare(a));
  const temHoje = porData.has(hoje);
  const datasAnteriores = datas.filter((d) => d !== hoje);

  const valorDe = (data: string, exame: string) =>
    porData.get(data)?.find((x) => x.exame.toLowerCase() === exame.toLowerCase())?.valor;

  // Abre o formulário com os valores de hoje já preenchidos (editar) ou vazio.
  const abrirForm = () => {
    const f: Record<string, string> = {};
    for (const c of LAB_CAMPOS) {
      const v = valorDe(hoje, c.key);
      f[c.key] = v != null ? String(valorNumerico(v) ?? v) : "";
    }
    setForm(f);
    setFreeNome("");
    setFreeValor("");
  };

  const salvar = () => {
    if (!form) return;
    const semHoje = resultados.filter((r) => r.data.slice(0, 10) !== hoje);
    const novosHoje: ResultadoLab[] = [];
    for (const c of LAB_CAMPOS) {
      const v = (form[c.key] || "").trim();
      if (v) {
        // Guarda só o número (a unidade do campo é a padrão do sistema). Mantém
        // os valores limpos em todas as telas (consistente com o scan).
        novosHoje.push({
          id: `${hoje}-${c.key}`,
          exame: c.key,
          data: hoje,
          valor: v,
        });
      }
    }
    if (freeNome.trim() && freeValor.trim()) {
      novosHoje.push({
        id: `${hoje}-${freeNome.trim()}`,
        exame: freeNome.trim(),
        data: hoje,
        valor: freeValor.trim(),
      });
    }
    const novos = [...semHoje, ...novosHoje];
    onChange(novos);
    setForm(null);
    onAposSalvar?.(novos);
  };

  // Escaneia o prontuário e pré-preenche os campos de lab reconhecidos.
  const escanearLabs = async () => {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) return;
    // Corte antes do scan; "Tirar de novo" reabre a câmera (loop).
    let cortada: string | null = null;
    for (;;) {
      const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (r.canceled) return;
      cortada = await recortar(r.assets[0].uri);
      if (cortada) break;
    }
    setEscaneando(true);
    try {
      const base64 = await converterParaJpegBase64(cortada);
      const instrucao =
        SECOES.find((s) => s.id === "examesLaboratoriais")?.instrucao ?? "";
      // O backend retorna JSON estruturado (campos hb, cr, ...) + blocos derivados.
      const json = await extrairDadosImagem<Record<string, unknown>>(
        base64,
        `${instrucao} ${SUFIXO_JSON}`,
        "examesLaboratoriais",
      );
      setForm((prev) => {
        const f = { ...(prev ?? {}) };
        // 1) Campos estruturados (preferencial).
        let achouEstruturado = false;
        for (const c of LAB_CAMPOS) {
          const v = json[c.key.toLowerCase()];
          if (v != null && String(v).trim() !== "") {
            f[c.key] = String(valorNumerico(String(v)) ?? v);
            achouEstruturado = true;
          }
        }
        // 2) Fallback: parse dos blocos derivados ("Hb 9.5").
        if (!achouEstruturado && Array.isArray((json as { blocos?: Bloco[] }).blocos)) {
          const itens = ((json as { blocos?: Bloco[] }).blocos ?? []).flatMap(
            (b) => b.itens || [],
          );
          for (const it of itens) {
            const [nomeRaw, ...resto] = String(it).split(":");
            const num = valorNumerico(resto.join(":") || nomeRaw);
            if (num == null) continue;
            const campo = LAB_CAMPOS.find((c) => c.alias.test(nomeRaw.trim()));
            if (campo) f[campo.key] = String(num);
          }
        }
        return f;
      });
    } catch {
      // best-effort
    }
    setEscaneando(false);
  };

  // Painel de hoje: entradas na ordem dos campos comuns + extras.
  const entradasHoje = temHoje
    ? [
        ...LAB_CAMPOS.filter((c) => valorDe(hoje, c.key) != null).map((c) => ({
          label: c.label,
          key: c.key,
          valor: valorDe(hoje, c.key)!,
        })),
        ...(porData.get(hoje) || [])
          .filter((x) => !LAB_CAMPOS.some((c) => c.key.toLowerCase() === x.exame.toLowerCase()))
          .map((x) => ({ label: abreviarLab(x.exame), key: x.exame, valor: x.valor })),
      ]
    : [];

  // BUG 1: agrupa as entradas de hoje por tipo (HEMOGRAMA / BIOQUÍMICA / ...).
  // BUG 8: dentro do grupo, ordem clínica (Hb, Ht, LT, Plaq, Na, K…).
  const gruposHoje = GRUPOS_LAB.map((g) => ({
    grupo: g,
    itens: entradasHoje
      .filter((e) => grupoLab(e.key) === g)
      .sort((a, b) => ordemLab(a.key) - ordemLab(b.key)),
  })).filter((x) => x.itens.length > 0);

  const dataAnteriorMaisRecente = datasAnteriores[0];

  const seta = (key: string, valorHoje: string) => {
    if (!dataAnteriorMaisRecente) return null;
    const ant = valorDe(dataAnteriorMaisRecente, key);
    const a = valorNumerico(valorHoje);
    const p = ant != null ? valorNumerico(ant) : null;
    if (a == null || p == null || a === p) return "→";
    return a > p ? "↑" : "↓";
  };

  const keysHoje = entradasHoje.map((e) => e.key.toLowerCase());
  const todosSelecionados =
    keysHoje.length > 0 && keysHoje.every((k) => selecionados.has(k));
  const excluirSelecionados = () => {
    if (!selecionados.size) return;
    Alert.alert(
      "Excluir exames de hoje",
      `Remover ${selecionados.size} exame${selecionados.size > 1 ? "s" : ""} de hoje? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Excluir (${selecionados.size})`,
          style: "destructive",
          onPress: () => {
            const novos = resultados.filter(
              (r) =>
                !(
                  r.data.slice(0, 10) === hoje &&
                  selecionados.has(r.exame.toLowerCase())
                ),
            );
            onChange(novos);
            onAposSalvar?.(novos);
            sairSelecao();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.labBox}>
      <View style={styles.labHistHeader}>
        <Text style={styles.labHistTitulo}>Resultados por data</Text>
        <TouchableOpacity style={styles.labHistBtn} onPress={abrirForm}>
          <Ionicons
            name={temHoje ? "create-outline" : "add"}
            size={15}
            color={ClinicalColors.primary}
          />
          <Text style={styles.labHistBtnTexto}>
            {temHoje ? "Editar hoje" : "Adicionar hoje"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Painel de hoje */}
      {temHoje && (
        <View style={styles.labHojeBox}>
          <View style={styles.labHojeTopo}>
            <Text style={styles.labHojeData}>Hoje · {rotuloDiaMes(hoje)}</Text>
            {entradasHoje.length > 0 && (
              <TouchableOpacity
                onPress={() => (selecionando ? sairSelecao() : setSelecionando(true))}
                hitSlop={8}
              >
                <Text style={styles.labSelToggle}>
                  {selecionando ? "Cancelar" : "Selecionar"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {gruposHoje.map((grupo) => (
            <View key={grupo.grupo} style={styles.labGrupo}>
              <Text style={styles.labGrupoLabel}>{grupo.grupo}</Text>
              <View style={styles.labHojeWrap}>
                {grupo.itens.map((e) => {
                  const k = e.key.toLowerCase();
                  const sel = selecionados.has(k);
                  const chip = (
                    <LabHojeChip
                      label={e.label}
                      exameKey={e.key}
                      valor={e.valor}
                      sexo={sexo}
                      idade={idade}
                    />
                  );
                  if (!selecionando) return <View key={e.key}>{chip}</View>;
                  return (
                    <TouchableOpacity
                      key={e.key}
                      style={[styles.labChipSel, sel && styles.labChipSelOn]}
                      onPress={() => toggleSel(k)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={sel ? "checkmark-circle" : "ellipse-outline"}
                        size={16}
                        color={sel ? ClinicalColors.primary : ClinicalColors.textMuted}
                      />
                      {chip}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          {selecionando && (
            <View style={styles.labSelBar}>
              <TouchableOpacity
                onPress={() =>
                  setSelecionados(todosSelecionados ? new Set() : new Set(keysHoje))
                }
                hitSlop={8}
              >
                <Text style={styles.labSelTodos}>
                  {todosSelecionados ? "Limpar seleção" : "Selecionar todos"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.labSelExcluir,
                  !selecionados.size && styles.labSelExcluirOff,
                ]}
                onPress={excluirSelecionados}
                disabled={!selecionados.size}
              >
                <Ionicons name="trash-outline" size={14} color="#FFFFFF" />
                <Text style={styles.labSelExcluirTxt}>
                  Excluir ({selecionados.size})
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.labRefFonte}>{DISCLAIMER_ABIM}</Text>
        </View>
      )}

      {/* Formulário Adicionar/Editar hoje */}
      {form && (
        <View style={styles.formInline}>
          <View style={styles.labFormGrid}>
            {LAB_CAMPOS.map((c) => (
              <View key={c.key} style={styles.labFormCampo}>
                <Text style={styles.labFormLabel}>
                  {c.label}
                  {c.unidade ? ` (${c.unidade})` : ""}
                </Text>
                <TextInput
                  style={styles.campoInput}
                  value={form[c.key]}
                  onChangeText={(t) => setForm((f) => ({ ...(f ?? {}), [c.key]: t }))}
                  keyboardType="numeric"
                  placeholder="—"
                  placeholderTextColor={ClinicalColors.textMuted}
                />
              </View>
            ))}
          </View>
          <View style={styles.labFreeRow}>
            <TextInput
              style={[styles.campoInput, { flex: 1 }]}
              value={freeNome}
              onChangeText={setFreeNome}
              placeholder="Outro exame"
              placeholderTextColor={ClinicalColors.textMuted}
            />
            <TextInput
              style={[styles.campoInput, { width: 90 }]}
              value={freeValor}
              onChangeText={setFreeValor}
              placeholder="Valor"
              placeholderTextColor={ClinicalColors.textMuted}
            />
          </View>

          <TouchableOpacity
            style={styles.labScanBtn}
            onPress={escanearLabs}
            disabled={escaneando}
          >
            <Ionicons name="scan-outline" size={15} color={ClinicalColors.primary} />
            <Text style={styles.labHistBtnTexto}>
              {escaneando ? "Lendo prontuário…" : "Escanear labs"}
            </Text>
          </TouchableOpacity>

          <View style={styles.formAcoes}>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoSalvar]}
              onPress={salvar}
            >
              <Text style={styles.botaoAcaoTexto}>Salvar hoje</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoCancelar]}
              onPress={() => setForm(null)}
            >
              <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Dias anteriores (colapsados) */}
      {datasAnteriores.length > 0 && (
        <View style={styles.labPrevBox}>
          {(verTodos ? datasAnteriores : datasAnteriores.slice(0, 4)).map((d) => {
            const itens = porData.get(d) || [];
            return (
              // BUG 3: tocar abre o modal com TODOS os exames daquela data.
              <TouchableOpacity
                key={d}
                style={styles.labPrevLinha}
                onPress={() => setDataDetalhe(d)}
                activeOpacity={0.6}
              >
                <Text style={styles.labPrevData}>{rotuloDiaMes(d)}</Text>
                {/* BUG 13: abreviação + seta colorida por referência, inline. */}
                <Text style={styles.labPrevValores} numberOfLines={2}>
                  {itens.map((x, i) => {
                    const { seta, cor } = setaRefLab(x.exame, x.valor, sexo, idade);
                    return (
                      <Text key={i}>
                        {i > 0 ? "   " : ""}
                        {abreviarLab(x.exame)} {valorNumerico(x.valor) ?? x.valor}
                        {seta ? <Text style={{ color: cor }}>{seta}</Text> : null}
                      </Text>
                    );
                  })}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={15}
                  color={ClinicalColors.textMuted}
                />
              </TouchableOpacity>
            );
          })}
          {datasAnteriores.length > 4 && (
            <TouchableOpacity onPress={() => setVerTodos((v) => !v)}>
              <Text style={styles.labVerMais}>
                {verTodos ? "ver menos ↑" : `ver mais ${datasAnteriores.length - 4} dias ↓`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {datas.length === 0 && !form && (
        <Text style={styles.vazioTexto}>Nenhum resultado ainda.</Text>
      )}

      {/* Disclaimer ABIM (obrigatório) — garante exibição quando não há painel
          de hoje (só datas anteriores). */}
      {!temHoje && datas.length > 0 && (
        <Text style={styles.labRefFonte}>{DISCLAIMER_ABIM}</Text>
      )}

      {/* BUG 3: detalhe de uma data — TODOS os exames, agrupados por tipo. */}
      <Modal
        visible={!!dataDetalhe}
        transparent
        animationType="slide"
        onRequestClose={() => setDataDetalhe(null)}
      >
        <View style={styles.labModalFundo}>
          <View style={styles.labModalCaixa}>
            <View style={styles.labModalTopo}>
              <Text style={styles.labModalTitulo}>
                {dataDetalhe ? rotuloDiaMes(dataDetalhe) : ""}
              </Text>
              <TouchableOpacity onPress={() => setDataDetalhe(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={ClinicalColors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {GRUPOS_LAB.map((g) => {
                const itensG = (dataDetalhe ? porData.get(dataDetalhe) || [] : [])
                  .filter((x) => grupoLab(x.exame) === g)
                  .sort((a, b) => ordemLab(a.exame) - ordemLab(b.exame)); // BUG 8
                if (!itensG.length) return null;
                return (
                  <View key={g} style={styles.labGrupo}>
                    <Text style={styles.labGrupoLabel}>{g}</Text>
                    {itensG.map((x, i) => {
                      const { seta, cor } = setaRefLab(x.exame, x.valor, sexo, idade);
                      return (
                        <View key={i} style={styles.labModalLinha}>
                          <Text style={styles.labModalNome}>{abreviarLab(x.exame)}</Text>
                          <Text style={[styles.labModalValor, { color: cor }]}>
                            {valorNumerico(x.valor) ?? x.valor} {seta}
                            {unidadeExibicaoLab(x.exame) ? (
                              <Text style={styles.labModalUnidade}>
                                {` ${unidadeExibicaoLab(x.exame)}`}
                              </Text>
                            ) : null}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * (Legado) Evolução laboratorial por exame com série temporal e referência.
 * Mantida para compatibilidade; a seção usa LabsPorData (histórico por data).
 */
function LabEvolucao({
  resultados,
  editando,
  onChange,
}: {
  resultados: ResultadoLab[];
  editando?: boolean;
  onChange: (l: ResultadoLab[]) => void;
}) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [exame, setExame] = useState("");
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState("");

  const adicionar = () => {
    if (!exame.trim() || !valor.trim()) return;
    onChange([
      ...resultados,
      {
        id: novoId(),
        exame: exame.trim(),
        data: data.trim() || hojeISO(),
        valor: valor.trim(),
      },
    ]);
    setExame("");
    setValor("");
    setData(hojeISO());
    setMostrarForm(false);
  };

  const removerExame = (nome: string) =>
    Alert.alert("Remover este exame?", nome, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: () => onChange(resultados.filter((r) => r.exame.trim() !== nome)),
      },
    ]);

  const series = agruparPorExame(resultados);

  return (
    <View style={styles.labBox}>
      {editando && (
        <TouchableOpacity
          style={styles.labAddBtn}
          onPress={() => setMostrarForm((v) => !v)}
        >
          <Text style={styles.labAddTexto}>📅 Adicionar resultado por data</Text>
        </TouchableOpacity>
      )}

      {editando && mostrarForm && (
        <View style={styles.formInline}>
          <TextInput
            style={styles.campoInput}
            value={exame}
            onChangeText={setExame}
            placeholder="Exame (ex.: PCR)"
            placeholderTextColor={ClinicalColors.textMuted}
          />
          <TextInput
            style={styles.campoInput}
            value={data}
            onChangeText={setData}
            placeholder="Data (YYYY-MM-DD)"
            placeholderTextColor={ClinicalColors.textMuted}
          />
          <TextInput
            style={styles.campoInput}
            value={valor}
            onChangeText={setValor}
            placeholder="Valor (ex.: 42)"
            placeholderTextColor={ClinicalColors.textMuted}
          />
          <View style={styles.formAcoes}>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoSalvar]}
              onPress={adicionar}
            >
              <Text style={styles.botaoAcaoTexto}>Adicionar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.botaoAcao, styles.botaoCancelar]}
              onPress={() => setMostrarForm(false)}
            >
              <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {series.length === 0 ? (
        editando ? (
          <Text style={styles.vazioTexto}>Nenhum resultado por data ainda.</Text>
        ) : null
      ) : (
        series.map((s) => (
          <LabSerieLinha
            key={s.exame}
            serie={s}
            editando={editando}
            onRemover={() => removerExame(s.exame)}
          />
        ))
      )}
    </View>
  );
}

/**
 * Uma linha de exame na evolução laboratorial: série de valores, tendência e —
 * via ontologia — a faixa de referência oficial (LOINC) com badge discreto se o
 * último valor estiver fora. O app só EXIBE a referência; avaliação é clínica.
 */
function LabSerieLinha({
  serie,
  editando,
  onRemover,
}: {
  serie: ExameSerie;
  editando?: boolean;
  onRemover: () => void;
}) {
  const [ref, setRef] = useState<ReferenciaLab | null>(null);
  useEffect(() => {
    let vivo = true;
    buscarReferencia(serie.exame).then((r) => {
      if (vivo) setRef(r);
    });
    return () => {
      vivo = false;
    };
  }, [serie.exame]);

  const info = serie.tendencia ? TENDENCIA_INFO[serie.tendencia] : null;
  const ultimo = serie.pontos[serie.pontos.length - 1]?.valor;
  const status = ref ? statusReferencia(valorNumerico(ultimo), ref) : "normal";
  const textoRef = ref ? textoReferencia(ref) : "";

  return (
    <View style={styles.labLinha}>
      <View style={styles.labLinhaTopo}>
        <Text style={styles.labExame}>{serie.exame}</Text>
        <View style={styles.labLinhaDir}>
          {info && (
            <Text style={[styles.labTend, { color: info.cor }]}>
              {info.icone} {info.rotulo}
            </Text>
          )}
          {editando && (
            <TouchableOpacity onPress={onRemover} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={styles.labSerie}>
        {serie.pontos
          .map((p) => `${p.valor} (${formatarDataBR(p.data).slice(0, 5)})`)
          .join("  →  ")}
      </Text>
      {ref?.encontrado && !!textoRef && (
        <View style={styles.labRefRow}>
          <Text style={styles.labRefTexto}>({textoRef})</Text>
          {status === "fora" && (
            <Text style={[styles.labRefBadge, styles.labRefBadgeFora]}>
              Fora do ref.
            </Text>
          )}
          {status === "atencao" && (
            <Text style={[styles.labRefBadge, styles.labRefBadgeAtencao]}>
              Atenção
            </Text>
          )}
          {!!ref.fonte && (
            <Text style={styles.labRefFonte}>Fonte: {ref.fonte}</Text>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Sinais vitais estruturados de um dia. Campos numéricos + O2 em uso + frase
 * clínica gerada automaticamente (usada também no "Passar o Caso"). Persiste ao
 * perder o foco / ao alternar o O2.
 */
function SinaisVitaisSecao({
  sv,
  onChange,
}: {
  sv: SinaisVitaisDia;
  onChange: (v: SinaisVitaisDia) => void;
}) {
  const set = (campo: CampoNum) => (t: string) => onChange({ ...sv, [campo]: t });

  const camposNum: { k: CampoNum; label: string; ph: string }[] = [
    { k: "temp", label: "Temp (°C)", ph: "36,5" },
    { k: "fc", label: "FC (bpm)", ph: "78" },
    { k: "fr", label: "FR (irpm)", ph: "16" },
    { k: "sato2", label: "SatO2 (%)", ph: "96" },
    { k: "glicemia", label: "Glicemia (mg/dL)", ph: "—" },
    { k: "diurese", label: "Diurese (mL/24h)", ph: "—" },
  ];

  return (
    <View style={styles.svBox}>
      <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
        Sinais vitais (estruturado)
      </Text>
      <View style={styles.svGrid}>
        <View style={styles.svCampo}>
          <CampoSimples
            label="PA sistólica"
            value={sv.paSist}
            onChange={set("paSist")}
            keyboardType="numeric"
            placeholder="120"
          />
        </View>
        <View style={styles.svCampo}>
          <CampoSimples
            label="PA diastólica"
            value={sv.paDiast}
            onChange={set("paDiast")}
            keyboardType="numeric"
            placeholder="80"
          />
        </View>
        {camposNum.map((c) => (
          <View key={c.k} style={styles.svCampo}>
            <CampoSimples
              label={c.label}
              value={sv[c.k] ?? ""}
              onChange={set(c.k)}
              keyboardType="numeric"
              placeholder={c.ph}
            />
          </View>
        ))}
      </View>

      <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
        O2 em uso
      </Text>
      <View style={styles.chipsWrap}>
        {O2_OPCOES.map((o) => {
          const ativo = sv.o2 === o.valor;
          return (
            <TouchableOpacity
              key={o.valor}
              onPress={() => onChange({ ...sv, o2: ativo ? null : o.valor })}
              style={[styles.toggleChip, ativo && styles.toggleChipAtivo]}
            >
              <Text
                style={[
                  styles.toggleChipTexto,
                  ativo && styles.toggleChipTextoAtivo,
                ]}
              >
                {o.rotulo}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
        Intercorrências
      </Text>
      <CampoSimples
        value={sv.intercorrencias}
        onChange={(t) => onChange({ ...sv, intercorrencias: t })}
        multiline
        placeholder="Intercorrências nas últimas 24h..."
      />
    </View>
  );
}

/**
 * Checklist de Alta: lista de itens marcáveis. Item marcado fica verde e
 * riscado. Só é renderizado quando o status do paciente é de alta.
 */
function ChecklistAltaSecao({
  checklist,
  onChange,
}: {
  checklist: Record<string, boolean>;
  onChange: (c: Record<string, boolean>) => void;
}) {
  const [aberto, setAberto] = useSecaoAccordion("checklistAlta");
  const feitos = CHECKLIST_ALTA.filter((i) => checklist[i.id]).length;

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>
          Checklist de Alta ({feitos}/{CHECKLIST_ALTA.length})
        </Text>
        <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={ClinicalColors.chevron} />
      </TouchableOpacity>
      {aberto && (
        <View style={styles.secaoBody}>
          {CHECKLIST_ALTA.map((item) => {
            const feito = !!checklist[item.id];
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.checkItem}
                onPress={() => onChange({ ...checklist, [item.id]: !feito })}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={feito ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={feito ? ClinicalColors.accent : ClinicalColors.chevron}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[styles.checkItemTexto, feito && styles.checkItemFeito]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Cores de destaque por classe farmacológica (default para classes diversas). */
const CLASSE_COR: Record<string, string> = {
  atb: "#991B1B",
  antibiotico: "#991B1B",
  "antibiótico": "#991B1B",
  antifungico: "#9A3412",
  "antifúngico": "#9A3412",
  anticoagulante: "#1E40AF",
  corticoide: "#854D0E",
  "corticóide": "#854D0E",
};
function corDaClasse(classe: string): string {
  return CLASSE_COR[(classe || "").toLowerCase().trim()] ?? "#475569";
}

/**
 * Prescrição Hospitalar: a médica digita o medicamento em texto livre e a IA
 * classifica a classe farmacológica (badge colorido, editável tocando nele).
 * Os classificados como antibiótico alimentam a ANTIBIOTICOTERAPIA do caso.
 */
const ORDEM_SEVERIDADE: Record<Severidade, number> = { desconhecida: 0, leve: 1, moderada: 2, grave: 3 };
const COR_SEVERIDADE: Record<Severidade, string> = {
  desconhecida: "#8E8E93",
  leve: "#34C759",
  moderada: "#FF9500",
  grave: "#FF3B30",
};
const rotuloSeveridade = (s: Severidade) => s.charAt(0).toUpperCase() + s.slice(1);

const normFarm = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pior severidade de interação envolvendo este medicamento (match por substring). */
function severidadeDoMed(texto: string, interacoes: Interacao[]): Severidade | null {
  const t = normFarm(texto);
  let pior: Severidade | null = null;
  for (const it of interacoes) {
    if (t.includes(normFarm(it.medicamentoA)) || t.includes(normFarm(it.medicamentoB))) {
      if (!pior || ORDEM_SEVERIDADE[it.severidade] > ORDEM_SEVERIDADE[pior]) pior = it.severidade;
    }
  }
  return pior;
}

/** Creatinina mais recente do paciente (número), para estimar a TFG. */
function ultimaCreatinina(p?: PacienteModel | null): number | null {
  if (!p?.resultadosLab) return null;
  const alvos = ["creatinina", "creat", "cr"];
  const cand = p.resultadosLab.filter((r) => {
    const e = normFarm(r.exame);
    return alvos.some((a) => e === a || e.startsWith(a));
  });
  if (!cand.length) return null;
  cand.sort((a, b) => b.data.localeCompare(a.data));
  const m = String(cand[0].valor).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function PrescricaoSecao({
  medicamentos,
  paciente,
  editando,
  mostrarAdd,
  onFecharAdd,
  onChange,
}: {
  medicamentos: Medicamento[];
  paciente?: PacienteModel | null;
  editando?: boolean;
  /** Abre o campo de adicionar medicamento no topo (acionado pelo cabeçalho). */
  mostrarAdd?: boolean;
  onFecharAdd?: () => void;
  onChange: (l: Medicamento[]) => void;
}) {
  const [texto, setTexto] = useState("");
  const [editClasseId, setEditClasseId] = useState<string | null>(null);
  const [classeDraft, setClasseDraft] = useState("");
  const inputAddRef = useRef<TextInput>(null);
  const sel = useSelecaoMultipla();
  const excluirSelecionados = () => {
    if (!sel.selecionados.size) return;
    Alert.alert(
      "Excluir medicamentos",
      `Remover ${sel.selecionados.size} medicamento${sel.selecionados.size > 1 ? "s" : ""}? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Excluir (${sel.selecionados.size})`,
          style: "destructive",
          onPress: () => {
            onChange(medicamentos.filter((x) => !sel.selecionados.has(x.id)));
            sel.sair();
          },
        },
      ],
    );
  };

  // Foca o campo ao abrir "Adicionar" pelo cabeçalho da seção.
  useEffect(() => {
    if (!mostrarAdd) return;
    const t = setTimeout(() => inputAddRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [mostrarAdd]);

  // Segurança farmacológica (informativa). Falhas degradam em silêncio.
  const [interacoes, setInteracoes] = useState<Interacao[]>([]);
  // BUG 1: assinatura das interações fechadas pelo médico. O card some ao fechar
  // e reaparece se o conjunto de interações mudar (nova interação identificada).
  const [interacoesFechadasSig, setInteracoesFechadasSig] = useState<string | null>(null);
  const [posologias, setPosologias] = useState<Record<string, Posologia>>({});
  const [tfg, setTfg] = useState<TFG | null>(null);
  const medTextos = medicamentos.map((m) => m.texto).join("|");

  useEffect(() => {
    let vivo = true;
    buscarInteracoes(medicamentos.map((m) => m.texto)).then((l) => {
      if (vivo) setInteracoes(l);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medTextos]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const entradas = await Promise.all(
        medicamentos.map(async (m) => [m.id, await buscarPosologia(m.texto)] as const),
      );
      if (vivo) setPosologias(Object.fromEntries(entradas));
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medTextos]);

  const creatinina = ultimaCreatinina(paciente);
  const idadePac = paciente?.idade ?? null;
  const sexoPac = paciente?.sexo ?? null;
  useEffect(() => {
    let vivo = true;
    const promessa =
      creatinina != null && idadePac != null
        ? calcularTFG({ creatinina, idade: idadePac, sexo: sexoPac ?? undefined })
        : Promise.resolve(null);
    promessa.then((t) => {
      if (vivo) setTfg(t);
    });
    return () => {
      vivo = false;
    };
  }, [creatinina, idadePac, sexoPac]);

  const adicionar = async () => {
    const t = texto.trim();
    if (!t) return;
    const novo: Medicamento = { id: novoId(), texto: t, classe: "" };
    const lista = [...medicamentos, novo];
    onChange(lista);
    setTexto("");
    const classe = await classificarMedicamento(t);
    if (classe) {
      onChange(lista.map((m) => (m.id === novo.id ? { ...m, classe } : m)));
    }
  };

  const salvarClasse = (id: string) => {
    const c = classeDraft.trim();
    setEditClasseId(null);
    if (c) {
      onChange(medicamentos.map((m) => (m.id === id ? { ...m, classe: c } : m)));
    }
  };

  // FEATURE: segurar o medicamento → Finalizar (término = hoje) ou Excluir.
  const menuMedicamento = (m: Medicamento) => {
    Alert.alert(m.texto, undefined, [
      {
        text: `Finalizar (hoje, ${formatarDataBR(hojeISO())})`,
        onPress: () =>
          onChange(
            medicamentos.map((x) =>
              x.id === m.id ? { ...x, finalizadoEm: hojeISO() } : x,
            ),
          ),
      },
      {
        text: "Excluir",
        style: "destructive",
        onPress: () => onChange(medicamentos.filter((x) => x.id !== m.id)),
      },
      { text: "Cancelar", style: "cancel" },
    ]);
  };
  const reativarMedicamento = (m: Medicamento) =>
    onChange(
      medicamentos.map((x) => {
        if (x.id !== m.id) return x;
        const { finalizadoEm, ...resto } = x;
        return resto;
      }),
    );

  const ativos = medicamentos.filter((m) => !m.finalizadoEm);
  const suspensos = medicamentos.filter((m) => m.finalizadoEm);

  return (
    <View style={styles.prescBox}>
      <View style={styles.medLabelLinha}>
        <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
          Medicamentos
        </Text>
        {medicamentos.length > 0 && (
          <BotaoSelecionar
            ativo={sel.selecionando}
            onPress={() => (sel.selecionando ? sel.sair() : sel.setSelecionando(true))}
          />
        )}
      </View>
      {tfg && (
        <Text style={styles.tfgNota}>
          TFG estimada: {tfg.tfg} mL/min/1,73m² · {tfg.estadio} ({tfg.descricao}) · {tfg.fonte}
        </Text>
      )}

      {(mostrarAdd || editando) && (
        <View style={styles.medAddBox}>
          <TextInput
            ref={inputAddRef}
            style={[styles.campoInput, styles.medAddInput]}
            value={texto}
            onChangeText={setTexto}
            placeholder="Ex.: Ceftriaxona 1g EV 1x/dia D5/7"
            placeholderTextColor={ClinicalColors.textMuted}
            onSubmitEditing={adicionar}
            returnKeyType="done"
          />
          <View style={styles.medAddAcoes}>
            <TouchableOpacity style={styles.medAddBtn} onPress={adicionar}>
              <Text style={styles.medAddBtnTexto}>+ Adicionar</Text>
            </TouchableOpacity>
            {mostrarAdd && onFecharAdd && (
              <TouchableOpacity onPress={onFecharAdd} hitSlop={8}>
                <Text style={styles.medAddFechar}>Concluir</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {ativos.map((m) => {
        const sev = severidadeDoMed(m.texto, interacoes);
        const pos = posologias[m.id];
        const txtPos = pos ? textoPosologia(pos) : "";
        const precisaAjuste = !!(
          pos?.ajusteRenal &&
          tfg &&
          pos.ajusteRenal.tfgCorte != null &&
          tfg.tfg < pos.ajusteRenal.tfgCorte
        );
        const on = sel.selecionados.has(m.id);
        const card = (
          <View style={[styles.medRow, sel.selecionando && { flex: 1 }]}>
            <View style={styles.medInfo}>
              <View style={styles.medTituloLinha}>
                <Text style={styles.medTexto}>{textoComDiaAtual(m)}</Text>
                {ehAntibiotico(m.texto, m.classe) && (
                  <View style={styles.badgeAtb}>
                    <Text style={styles.badgeAtbTexto}>ATB</Text>
                  </View>
                )}
                {sev && (sev === "moderada" || sev === "grave") && (
                  <View style={[styles.badgeInteracao, { backgroundColor: COR_SEVERIDADE[sev] }]}>
                    <Ionicons name="warning" size={11} color="#FFFFFF" />
                    <Text style={styles.badgeInteracaoTexto}>{rotuloSeveridade(sev)}</Text>
                  </View>
                )}
                {precisaAjuste && (
                  <Text style={styles.badgeAjuste}>⚠️ Ajuste renal</Text>
                )}
              </View>
              {editando && editClasseId === m.id ? (
                <TextInput
                  style={styles.medClasseInput}
                  value={classeDraft}
                  onChangeText={setClasseDraft}
                  onBlur={() => salvarClasse(m.id)}
                  autoFocus
                  placeholder="Classe"
                  placeholderTextColor={ClinicalColors.textMuted}
                />
              ) : (
                <TouchableOpacity
                  disabled={!editando}
                  onPress={() => {
                    setEditClasseId(m.id);
                    setClasseDraft(m.classe);
                  }}
                >
                  <Text
                    style={[
                      styles.medClasse,
                      {
                        backgroundColor: m.classe
                          ? corDaClasse(m.classe)
                          : ClinicalColors.textMuted,
                      },
                    ]}
                  >
                    {m.classe || "classificando…"}
                  </Text>
                </TouchableOpacity>
              )}
              {!!txtPos && (
                <Text style={styles.medPosologia}>
                  {txtPos}
                  {pos?.fonte ? ` · Fonte: ${pos.fonte}` : ""}
                </Text>
              )}
              {precisaAjuste && pos?.ajusteRenal?.recomendacao && (
                <Text style={styles.medAjusteObs}>{pos.ajusteRenal.recomendacao}</Text>
              )}
            </View>
            {editando && !sel.selecionando && (
              <TouchableOpacity
                onPress={() => onChange(medicamentos.filter((x) => x.id !== m.id))}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={16} color={ClinicalColors.danger} />
              </TouchableOpacity>
            )}
          </View>
        );
        if (!sel.selecionando)
          return (
            <TouchableOpacity
              key={m.id}
              activeOpacity={1}
              onLongPress={() => menuMedicamento(m)}
              delayLongPress={400}
            >
              {card}
            </TouchableOpacity>
          );
        return (
          <TouchableOpacity
            key={m.id}
            style={styles.selLinha}
            onPress={() => sel.alternar(m.id)}
            activeOpacity={0.7}
          >
            <CheckSelecao on={on} />
            {card}
          </TouchableOpacity>
        );
      })}

      {/* FEATURE: medicamentos suspensos (histórico preservado; "até D{N}"). */}
      {suspensos.length > 0 && (
        <View style={styles.suspensosBox}>
          <Text style={styles.suspensosLabel}>Suspensos</Text>
          {suspensos.map((m) => (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.6}
              onLongPress={() => reativarMedicamento(m)}
              delayLongPress={400}
            >
              <Text style={styles.suspensoTexto}>{textoComDiaAtual(m)}</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.suspensosDica}>Segure um item para reativar.</Text>
        </View>
      )}

      {sel.selecionando && (
        <BarraSelecao
          n={sel.selecionados.size}
          total={medicamentos.length}
          onTodos={() =>
            sel.setSelecionados(
              sel.selecionados.size === medicamentos.length
                ? new Set()
                : new Set(medicamentos.map((m) => m.id)),
            )
          }
          onExcluir={excluirSelecionados}
        />
      )}

      {(() => {
        const sig = interacoes
          .map((it) => `${it.medicamentoA}+${it.medicamentoB}`)
          .sort()
          .join(";");
        if (!interacoes.length || sel.selecionando || sig === interacoesFechadasSig) return null;
        return (
        <View style={styles.interacoesCard}>
          <View style={styles.interacoesTopo}>
            <Text style={styles.interacoesTitulo}>Interações identificadas ({interacoes.length})</Text>
            <TouchableOpacity onPress={() => setInteracoesFechadasSig(sig)} hitSlop={8}>
              <Ionicons name="close" size={18} color={ClinicalColors.textMuted} />
            </TouchableOpacity>
          </View>
          {interacoes.map((it, i) => (
            <View key={`${it.medicamentoA}-${it.medicamentoB}-${i}`} style={styles.interacaoItem}>
              <Text style={styles.interacaoNomes}>
                {it.medicamentoA} + {it.medicamentoB} —{" "}
                <Text style={{ color: COR_SEVERIDADE[it.severidade] }}>
                  {rotuloSeveridade(it.severidade)}
                </Text>
              </Text>
              {!!it.descricao && <Text style={styles.interacaoDesc}>{it.descricao}</Text>}
              {!!it.condutaRecomendada && (
                <Text style={styles.interacaoConduta}>{it.condutaRecomendada}</Text>
              )}
            </View>
          ))}
          <Text style={styles.interacoesRodape}>
            Interações identificadas com base em bulas FDA (openFDA) e fontes ANVISA. Não
            substitui avaliação clínica. O profissional de saúde é responsável pela decisão
            terapêutica.
          </Text>
        </View>
        );
      })()}

    </View>
  );
}

const styles = StyleSheet.create({
  // BUG 3: modal "Data da coleta?" dos labs sem data.
  modalDataFundo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalDataCaixa: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.card,
    padding: 20,
  },
  modalDataTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: ClinicalColors.text,
  },
  modalDataSub: {
    fontSize: 14,
    color: ClinicalColors.textSecondary,
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 19,
  },
  modalDataOpcao: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.badge,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 8,
  },
  modalDataOpcaoTxt: {
    fontSize: 15,
    fontWeight: "600",
    color: ClinicalColors.primary,
  },
  modalDataOutra: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  modalDataInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: ClinicalColors.border,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: ClinicalColors.text,
  },
  modalDataOk: {
    backgroundColor: ClinicalColors.primary,
    borderRadius: Radius.badge,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  modalDataOkOff: { opacity: 0.4 },
  modalDataOkTxt: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  modalDataCancelar: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  modalDataCancelarTxt: { fontSize: 14, color: ClinicalColors.textMuted },

  container: {
    flex: 1,
    backgroundColor: ClinicalColors.background,
  },
  containerConteudo: {
    paddingTop: 8,
    paddingHorizontal: 16,
    // paddingBottom é aplicado inline com insets.bottom (clear da tab bar flutuante).
  },
  bannerRecebido: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ClinicalColors.warningBg,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  bannerRecebidoTexto: {
    flex: 1,
    color: ClinicalColors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  alertaGraveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FF3B30",
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  alertaGraveTexto: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  aviso: { color: ClinicalColors.textMuted, fontSize: 15, marginTop: 24 },
  // Card de tendências laboratoriais (descritivo — ANVISA).
  alertasCard: {
    backgroundColor: "#FFF8E7",
    borderLeftWidth: 3,
    borderLeftColor: "#FF9500",
    borderRadius: Radius.card,
    padding: 14,
    marginBottom: 12,
  },
  alertasTitulo: {
    fontSize: 15,
    fontWeight: "700",
    color: ClinicalColors.text,
    marginBottom: 10,
  },
  alertaItem: { marginBottom: 10 },
  alertaDescricao: {
    fontSize: 14,
    fontWeight: "600",
    color: ClinicalColors.text,
  },
  alertaSerie: {
    fontSize: 13,
    color: ClinicalColors.textSecondary,
    marginTop: 2,
  },
  alertasRodape: {
    fontSize: 12,
    color: ClinicalColors.textMuted,
    fontStyle: "italic",
    marginTop: 2,
  },
  // Escores clínicos (Fase 3)
  escoreCard: {
    backgroundColor: ClinicalColors.background,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  escoreTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  escoreNome: {
    fontSize: 15,
    fontWeight: "700",
    color: ClinicalColors.text,
    flex: 1,
    paddingRight: 8,
  },
  escorePontosWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  escorePontos: {
    fontSize: 15,
    fontWeight: "700",
  },
  escoreDots: {
    fontSize: 12,
    marginLeft: 6,
    letterSpacing: 1,
  },
  escoreClassif: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 3,
  },
  escoreCriterios: {
    fontSize: 12,
    color: ClinicalColors.textMuted,
    marginTop: 4,
  },
  escoreFaltam: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    fontStyle: "italic",
    marginTop: 2,
  },
  escoreFonte: {
    fontSize: 11,
    color: "#8E8E93",
    marginTop: 4,
  },
  escoreDisclaimer: {
    fontSize: 11,
    color: "#8E8E93",
    fontStyle: "italic",
    marginTop: 2,
  },
  cabecalho: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  titulo: {
    flex: 1,
    fontSize: 24,
    fontWeight: "bold",
    color: ClinicalColors.text,
    paddingRight: 12,
  },
  acoesIcones: { flexDirection: "row", alignItems: "center", gap: 16 },
  iconeBtn: { padding: 8 },
  identificacao: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  identLinha: {
    color: ClinicalColors.textMuted,
    fontSize: 13,
    lineHeight: 21,
  },
  campoIdent: { marginBottom: 10 },
  campoIdentLabel: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    marginBottom: 3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  campoIdentValor: { color: ClinicalColors.text, fontSize: 17, fontWeight: "600" },
  campoIdentInputEditavel: {
    color: ClinicalColors.text,
    fontSize: 15,
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  campo: { marginBottom: 12 },
  campoLabel: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    marginBottom: 6,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  campoInput: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: ClinicalColors.text,
    fontSize: 15,
  },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: {
    borderWidth: 1,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusChipTexto: { fontSize: 13, fontWeight: "600" },
  acoesRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  botaoAcao: {
    flex: 1,
    borderRadius: Radius.card,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: BorderWidth.hairline,
  },
  botaoSalvar: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderColor: ClinicalColors.buttonPrimary,
  },
  botaoCancelar: {
    backgroundColor: "transparent",
    borderColor: ClinicalColors.border,
  },
  botaoAcaoTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  botaoCancelarTexto: {
    color: ClinicalColors.textMuted,
    fontSize: 15,
    fontWeight: "600",
  },
  botaoFoto: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.card,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 16,
  },
  botaoFotoTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  verEvolucao: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  verEvolucaoTxt: { color: ClinicalColors.primary, fontSize: 15, fontWeight: "600" },
  verEvolucaoBadge: { flex: 1, textAlign: "right", color: ClinicalColors.textMuted, fontSize: 13 },
  botoesCasoRow: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 24 },
  botaoPassarCaso: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#ECFAF1",
    borderWidth: 1,
    borderColor: "#B6E8C9",
    borderRadius: Radius.pill,
    paddingVertical: 15,
    paddingHorizontal: 8,
  },
  passarCasoIcone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#D2F2DF",
    alignItems: "center",
    justifyContent: "center",
  },
  botaoPassarCasoTexto: {
    color: "#0E7A5A",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  capturaRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  escanearRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 12 },
  botaoEscanear: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  botaoEscanearAtivo: { backgroundColor: ClinicalColors.primary },
  botaoAdicionarSecao: { backgroundColor: "#E5F7EE", paddingHorizontal: 14 },
  botaoAdicionarTexto: { color: "#34C759" },
  botaoEscanearTexto: { color: ClinicalColors.primary, fontSize: 14, fontWeight: "600" },
  botaoEscanearTextoAtivo: { color: "#fff" },
  botaoCaptura: { flex: 1, marginBottom: 0 },
  extraindo: {
    color: ClinicalColors.textMuted,
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  erroBox: {
    backgroundColor: StatusColors.pendente.bg,
    borderColor: StatusColors.pendente.text,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  avisoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FFF8E7",
    borderLeftWidth: 3,
    borderLeftColor: "#FF9500",
    borderRadius: Radius.badge,
    padding: 12,
    marginBottom: 14,
  },
  avisoTexto: { flex: 1, fontSize: 13, color: "#7A5B00", lineHeight: 18 },
  erroTitulo: {
    color: StatusColors.pendente.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  erroTexto: { color: StatusColors.pendente.text, fontSize: 13, lineHeight: 18 },
  badge: {
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeTexto: { fontSize: 12, fontWeight: "600" },
  secoes: { marginTop: 8 },
  secao: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    marginBottom: 12,
    overflow: "hidden",
  },
  secaoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  secaoHeaderTitulo: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: ClinicalColors.text,
    paddingRight: 12,
  },
  secaoChevron: { color: ClinicalColors.chevron, fontSize: 12 },
  secaoBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: BorderWidth.hairline,
    borderTopColor: ClinicalColors.border,
    paddingTop: 16,
  },
  anotacoesInput: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: ClinicalColors.text,
    fontSize: 15,
    minHeight: 72,
    textAlignVertical: "top",
    marginBottom: 8,
  },
  botaoSalvarAnotacao: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.badge,
    paddingVertical: 10,
    alignItems: "center",
  },
  botaoSalvarAnotacaoDesativado: { opacity: 0.5 },
  botaoSalvarConfirmado: { backgroundColor: "#2E7D32" },
  // Seleção múltipla (FEATURE 1) — compartilhado pelas seções de lista.
  selBotao: { paddingHorizontal: 6, paddingVertical: 4 },
  selBotaoTexto: { color: ClinicalColors.primary, fontSize: 14, fontWeight: "600" },
  selLinha: { flexDirection: "row", alignItems: "center" },
  selCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: ClinicalColors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  selCheckOn: {
    backgroundColor: ClinicalColors.primary,
    borderColor: ClinicalColors.primary,
  },
  selBarra: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: BorderWidth.hairline,
    borderTopColor: ClinicalColors.border,
  },
  selBarraTodos: { color: ClinicalColors.primary, fontSize: 14, fontWeight: "600" },
  selBarraExcluir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#991B1B",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.badge,
  },
  selBarraExcluirOff: { opacity: 0.4 },
  selBarraExcluirTexto: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  medLabelLinha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  botaoSalvarAnotacaoTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  anotacaoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.card,
    padding: 12,
    marginTop: 8,
  },
  anotacaoConteudo: { flex: 1, paddingRight: 12 },
  anotacaoHorario: {
    color: ClinicalColors.textMuted,
    fontSize: 11,
    marginBottom: 2,
  },
  anotacaoTexto: {
    color: ClinicalColors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
  },
  anotacaoCategoria: {
    alignSelf: "flex-start",
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 6,
  },
  anotacaoCategoriaTexto: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  anotacaoClassificando: {
    color: ClinicalColors.textMuted,
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 6,
  },
  anotacaoAcoes: { flexDirection: "row", gap: 12 },
  anotacaoIcone: { fontSize: 16 },
  campoLabelEspacado: { marginTop: 16 },
  secaoConteudo: { color: ClinicalColors.textSecondary, fontSize: 15, lineHeight: 22 },
  prosaTexto: {
    color: ClinicalColors.text,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "justify",
  },
  prosaInput: { minHeight: 120, textAlignVertical: "top", lineHeight: 22 },
  // Seção Imagem: card por exame.
  imgCard: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.card,
    padding: 12,
    marginTop: 8,
  },
  imgCardTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  imgNome: { flex: 1, fontSize: 14, fontWeight: "700", color: "#000" },
  imgCardAcoes: { flexDirection: "row", alignItems: "center", gap: 14 },
  imgMarcarTxt: { fontSize: 13, fontWeight: "600", color: ClinicalColors.primary },
  imgLaudo: {
    fontSize: 13,
    color: ClinicalColors.textSecondary,
    lineHeight: 19,
    marginTop: 4,
  },
  imgLaudoMarcado: { backgroundColor: "#FFF3B0", color: ClinicalColors.text },
  imgFrasesWrap: { marginTop: 6, gap: 4 },
  imgFrase: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  imgFraseOn: { backgroundColor: "#FFF3B0" },
  imgFraseTxt: { fontSize: 13, color: ClinicalColors.text, lineHeight: 19 },
  imgMarcarDica: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    fontStyle: "italic",
    marginTop: 8,
  },
  imgLaudoInput: { minHeight: 64, textAlignVertical: "top" },
  imgAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.pill,
  },
  imgAddTexto: { fontSize: 14, fontWeight: "600", color: ClinicalColors.primary },
  conteudoBlocos: { gap: 12 },
  uniGrupo: { gap: 4, marginBottom: 8 },
  bloco: { gap: 4 },
  blocoTitulo: {
    fontSize: 13,
    fontWeight: "700",
    color: ClinicalColors.primary,
    marginBottom: 2,
  },
  itemRow: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
  itemBullet: {
    color: ClinicalColors.primary,
    fontSize: 15,
    lineHeight: 22,
    width: 16,
  },
  itemTexto: {
    flex: 1,
    color: ClinicalColors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  itemTocavel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 3,
  },
  itemEditInput: { flex: 1, marginVertical: 2, paddingVertical: 6 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: ClinicalColors.border,
    borderRadius: Radius.badge,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipTexto: { color: ClinicalColors.text, fontSize: 14 },
  diaInternacao: {
    color: ClinicalColors.primary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22,
  },
  evoGrupo: {
    fontSize: 12,
    color: ClinicalColors.primary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 10,
  },
  evoLabel: {
    fontSize: 13,
    color: ClinicalColors.text,
    marginBottom: 6,
  },
  toggleLinha: { marginBottom: 14 },
  toggleChip: {
    backgroundColor: ClinicalColors.border,
    borderRadius: Radius.badge,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toggleChipAtivo: { backgroundColor: ClinicalColors.buttonPrimary },
  toggleChipTexto: { color: ClinicalColors.text, fontSize: 14 },
  toggleChipTextoAtivo: { color: ClinicalColors.textOnPrimary },
  // Exame físico com chips (Feature 1)
  exameBox: { marginBottom: 14 },
  exameChip: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: BorderWidth.hairline,
    borderColor: ClinicalColors.border,
  },
  exameChipAtivo: { backgroundColor: ClinicalColors.primary, borderColor: ClinicalColors.primary },
  // BUG 5: chips pessoais usam o estilo padrão (sem borda pontilhada verde).
  exameChipPessoal: {},
  exameChipTxt: { color: ClinicalColors.text, fontSize: 13 },
  exameChipTxtAtivo: { color: "#FFFFFF", fontWeight: "600" },
  verMaisChip: { paddingVertical: 7, paddingHorizontal: 10 },
  verMaisTxt: { color: ClinicalColors.primary, fontSize: 13, fontWeight: "600" },
  exameLivre: { marginTop: 8, minHeight: 40 },
  evoInput: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: ClinicalColors.text,
    fontSize: 15,
    minHeight: 64,
    textAlignVertical: "top",
  },
  evoObsDispositivo: { marginTop: 10 },

  // Diagnóstico principal / status clínico (header)
  diagnosticoBox: { marginBottom: 16 },
  diagnosticoPrincipal: {
    fontSize: 18,
    fontWeight: "700",
    color: ClinicalColors.text,
  },
  diagnosticoVazio: {
    fontSize: 15,
    color: ClinicalColors.textMuted,
    fontStyle: "italic",
  },
  motivoInternacao: {
    fontSize: 13,
    color: ClinicalColors.textMuted,
    lineHeight: 19,
    marginTop: 4,
  },
  statusClinicoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusClinicoChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusClinicoChipTexto: { fontSize: 13, fontWeight: "600" },

  // Cabeçalho de seção com botão "+"
  secaoHeaderToque: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  botaoMais: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: ClinicalColors.buttonPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  botaoMaisTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 22,
  },
  vazioTexto: { color: ClinicalColors.textMuted, fontSize: 14 },

  // Problemas ativos
  problemaCard: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  problemaTopo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  problemaTitulo: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: ClinicalColors.text,
    paddingRight: 8,
  },
  problemaMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniChip: {
    fontSize: 11,
    fontWeight: "600",
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: "hidden",
  },
  problemaObs: {
    fontSize: 13,
    color: ClinicalColors.textMuted,
    lineHeight: 18,
  },
  problemaConduta: {
    fontSize: 13,
    color: ClinicalColors.textMuted,
    lineHeight: 18,
    fontStyle: "italic",
  },

  // Formulário inline (problemas/pendências)
  formInline: { marginTop: 12, gap: 10 },
  formAcoes: { flexDirection: "row", gap: 12, marginTop: 4 },

  // Pendências
  pendenciaLinha: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: BorderWidth.hairline,
    borderBottomColor: ClinicalColors.border,
  },
  checkbox: { fontSize: 20, color: ClinicalColors.primary },
  pendenciaTexto: {
    flex: 1,
    fontSize: 15,
    color: ClinicalColors.text,
    lineHeight: 20,
  },
  pendenciaFeita: {
    textDecorationLine: "line-through",
    color: ClinicalColors.textMuted,
  },
  prioridadePonto: { width: 8, height: 8, borderRadius: 4 },

  // Barra do topo (Voltar + Modo Round)
  topoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  botaoRound: {
    backgroundColor: ClinicalColors.accent,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  botaoRoundTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 14,
    fontWeight: "700",
  },

  // Status clínico (seção própria)
  statusClinicoBox: { marginBottom: 16 },

  // Resumo Rápido
  resumoCard: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  resumoTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  resumoTitulo: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  resumoGerarBtn: {
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.primary,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 96,
    alignItems: "center",
  },
  resumoGerarTexto: {
    color: ClinicalColors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  resumoTextoLeitura: {
    color: ClinicalColors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  resumoAcoes: { flexDirection: "row", alignItems: "center", gap: 12 },
  resumoToggle: {
    color: ClinicalColors.primary,
    fontSize: 13,
    fontWeight: "600",
  },

  // Evolução laboratorial
  labBox: { marginTop: 16, gap: 10 },
  // Histórico de labs por data (LabsPorData).
  labHistHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labHistTitulo: { fontSize: 14, fontWeight: "700", color: ClinicalColors.text },
  labHistBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  labHistBtnTexto: { color: ClinicalColors.primary, fontSize: 14, fontWeight: "600" },
  labHojeBox: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.card,
    padding: 12,
  },
  labHojeTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  labHojeData: {
    fontSize: 12,
    fontWeight: "600",
    color: ClinicalColors.textMuted,
  },
  labSelToggle: { fontSize: 13, fontWeight: "600", color: ClinicalColors.primary },
  labChipSel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: ClinicalColors.border,
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  labChipSelOn: {
    borderColor: ClinicalColors.primary,
    backgroundColor: "#FFFFFF",
  },
  labSelBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: ClinicalColors.border,
  },
  labSelTodos: { fontSize: 13, fontWeight: "600", color: ClinicalColors.primary },
  labSelExcluir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: ClinicalColors.warning,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  labSelExcluirOff: { opacity: 0.4 },
  labSelExcluirTxt: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  labHojeWrap: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, columnGap: 14 },
  labHojeChip: { flexDirection: "row", alignItems: "baseline" },
  labHojeLabel: { fontSize: 13, color: ClinicalColors.textMuted },
  labHojeValor: { fontSize: 14, fontWeight: "700", color: ClinicalColors.text },
  labHojeSeta: { fontSize: 13, color: ClinicalColors.textMuted },
  labFormGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 8 },
  labFormCampo: { width: "47%" },
  labFormLabel: { fontSize: 12, color: ClinicalColors.textMuted, marginBottom: 4 },
  labFreeRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  labScanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  labPrevBox: { gap: 8 },
  labPrevLinha: { flexDirection: "row", alignItems: "center", gap: 10 },
  labPrevData: {
    fontSize: 13,
    fontWeight: "600",
    color: ClinicalColors.textMuted,
    width: 56,
  },
  labPrevValores: { flex: 1, fontSize: 13, color: ClinicalColors.textSecondary, lineHeight: 19 },
  labVerMais: { fontSize: 13, color: ClinicalColors.primary, fontWeight: "600", marginTop: 2 },
  // BUG 1: grupos de labs (HEMOGRAMA / BIOQUÍMICA / LÍQUOR / ...).
  labGrupo: { marginBottom: 10 },
  labGrupoLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: ClinicalColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  // BUG 3: modal de detalhe de uma data.
  labModalFundo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  labModalCaixa: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: 20,
    paddingBottom: 32,
  },
  labModalTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  labModalTitulo: { fontSize: 18, fontWeight: "700", color: ClinicalColors.text },
  labModalLinha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: BorderWidth.hairline,
    borderBottomColor: ClinicalColors.border,
  },
  labModalNome: { fontSize: 14, color: ClinicalColors.text },
  labModalValor: { fontSize: 14, fontWeight: "700" },
  // Unidade discreta após o valor (padrão visual dos sinais vitais).
  labModalUnidade: {
    fontSize: 12,
    fontWeight: "500",
    color: ClinicalColors.textMuted,
  },
  labAddBtn: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.primary,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingVertical: 10,
    alignItems: "center",
  },
  labAddTexto: {
    color: ClinicalColors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  labLinha: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.badge,
    padding: 10,
    gap: 4,
  },
  labLinhaTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labLinhaDir: { flexDirection: "row", alignItems: "center", gap: 10 },
  labExame: { fontSize: 14, fontWeight: "700", color: ClinicalColors.text },
  labTend: { fontSize: 13, fontWeight: "600" },
  labSerie: { fontSize: 14, color: ClinicalColors.text, lineHeight: 20 },
  // Referência laboratorial oficial (ontologia/LOINC).
  labRefRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  labRefTexto: { fontSize: 12, color: ClinicalColors.textMuted },
  labRefBadge: {
    fontSize: 11,
    fontWeight: "700",
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  labRefBadgeFora: { backgroundColor: "#FFF8E7", color: "#C77700" },
  labRefBadgeAtencao: { backgroundColor: "#FFE0B2", color: "#E65100" },
  labRefFonte: { fontSize: 10, color: ClinicalColors.textMuted },

  // Sinais vitais estruturados
  svBox: { marginTop: 8 },
  svGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  svCampo: { width: "47%", marginBottom: 4 },
  svDisplayRow: { flexDirection: "row", alignItems: "baseline", paddingVertical: 3 },
  svDisplayLabel: { width: 84, fontSize: 13, color: ClinicalColors.textMuted },
  svDisplayValor: { flex: 1, fontSize: 15, fontWeight: "600", color: ClinicalColors.text },
  svIntercorr: { fontSize: 14, color: ClinicalColors.textSecondary, marginTop: 8, lineHeight: 20 },
  svFraseBox: {
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    padding: 12,
    marginTop: 12,
  },
  svFraseLabel: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  svFrase: { fontSize: 14, color: ClinicalColors.text, lineHeight: 20 },

  // Checklist de alta
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: BorderWidth.hairline,
    borderBottomColor: ClinicalColors.border,
  },
  checkboxFeito: { color: "#166534" },
  checkItemTexto: {
    flex: 1,
    fontSize: 14,
    color: ClinicalColors.text,
    lineHeight: 20,
  },
  checkItemFeito: {
    color: "#166534",
    textDecorationLine: "line-through",
  },

  // Modo Round
  roundContainer: { flex: 1, backgroundColor: ClinicalColors.surface },
  roundSair: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  roundSairTexto: {
    color: ClinicalColors.primary,
    fontSize: 17,
    fontWeight: "600",
  },
  roundConteudo: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 8 },
  roundNome: {
    fontSize: 28,
    fontWeight: "bold",
    color: ClinicalColors.text,
  },
  roundLinhaTopo: {
    fontSize: 18,
    color: ClinicalColors.textMuted,
    marginTop: 6,
    marginBottom: 8,
  },
  roundBloco: { marginTop: 20 },
  roundSecaoTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: ClinicalColors.primary,
    marginBottom: 8,
  },
  roundTexto: {
    fontSize: 16,
    color: ClinicalColors.text,
    lineHeight: 24,
    marginBottom: 4,
  },
  roundItem: {
    fontSize: 16,
    color: ClinicalColors.text,
    lineHeight: 26,
  },

  // Campo em modo leitura (✏️ para editar)
  leituraRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
  },
  leituraTexto: { flex: 1, color: ClinicalColors.text, fontSize: 15, lineHeight: 20 },
  leituraVazio: { color: ClinicalColors.textMuted },
  lapisIcone: { fontSize: 15 },

  // Prescrição (texto livre + classe por IA)
  prescBox: { marginTop: 8 },
  medRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.badge,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  medInfo: { flex: 1, gap: 4 },
  medTituloLinha: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  medTexto: { fontSize: 14, color: ClinicalColors.text },
  // FEATURE: medicamentos suspensos.
  suspensosBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: BorderWidth.hairline,
    borderTopColor: ClinicalColors.border,
  },
  suspensosLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: ClinicalColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  suspensoTexto: {
    fontSize: 14,
    color: ClinicalColors.textMuted,
    paddingVertical: 5,
    textDecorationLine: "line-through",
  },
  suspensosDica: { fontSize: 11, color: ClinicalColors.textMuted, fontStyle: "italic", marginTop: 4 },
  badgeInteracao: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: Radius.badge,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeInteracaoTexto: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  // Badge ATB — mesma identidade do Passar o Caso (#FFEDE6 / #C2410C).
  badgeAtb: {
    backgroundColor: "#FFEDE6",
    borderRadius: Radius.badge,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeAtbTexto: { color: "#C2410C", fontSize: 10, fontWeight: "800" },
  badgeAjuste: {
    color: "#FF9500",
    fontSize: 11,
    fontWeight: "700",
  },
  medPosologia: { fontSize: 11, color: "#8E8E93" },
  medAjusteObs: { fontSize: 11, color: "#FF9500", fontStyle: "italic" },
  tfgNota: { fontSize: 11, color: "#8E8E93", marginBottom: 8 },
  interacoesCard: {
    backgroundColor: "#FFF8E7",
    borderLeftWidth: 3,
    borderLeftColor: "#FF9500",
    borderRadius: Radius.card,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  interacoesTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  interacoesTitulo: {
    fontSize: 14,
    fontWeight: "700",
    color: ClinicalColors.text,
  },
  interacaoItem: { marginBottom: 8 },
  interacaoNomes: { fontSize: 13, fontWeight: "600", color: ClinicalColors.text },
  interacaoDesc: { fontSize: 12, color: ClinicalColors.textMuted, marginTop: 1 },
  interacaoConduta: { fontSize: 12, color: ClinicalColors.text, marginTop: 2, fontStyle: "italic" },
  interacoesRodape: {
    fontSize: 11,
    color: "#8E8E93",
    fontStyle: "italic",
    marginTop: 2,
  },
  medClasse: {
    alignSelf: "flex-start",
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  medClasseInput: {
    alignSelf: "flex-start",
    minWidth: 140,
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: ClinicalColors.text,
    fontSize: 13,
  },
  medAddInput: { marginTop: 8 },
  medAddBox: {
    backgroundColor: ClinicalColors.background,
    borderRadius: Radius.card,
    padding: 10,
    marginBottom: 12,
  },
  medAddAcoes: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  medAddFechar: { color: ClinicalColors.textMuted, fontSize: 14, fontWeight: "600", paddingHorizontal: 8 },
  medAddBtn: {
    flex: 1,
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.primary,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingVertical: 10,
    alignItems: "center",
  },
  medAddBtnTexto: {
    color: ClinicalColors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
