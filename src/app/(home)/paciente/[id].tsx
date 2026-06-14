import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import {
    BorderWidth,
    ClinicalColors,
    Radius,
    StatusColors,
    type StatusType,
} from "@/constants/clinicalTheme";
import {
  DISPOSITIVOS,
  EVOLUCAO_VAZIA,
  OPC_ALIMENTACAO,
  OPC_CONSCIENCIA,
  OPC_DIURESE,
  OPC_EVACUACAO,
  OPC_ORIENTACAO,
  type Opcao,
} from "@/constants/evolucao";
import { SECOES } from "@/constants/secoes";
import { diaDeInternacao, hojeISO } from "@/lib/datas";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { usePacientes } from "@/store/PacientesContext";
import {
  type Anotacao,
  type DadosClinicos,
  type EvolucaoBeiraLeito,
  type SecaoId,
} from "@/types/paciente";

const STATUS_OPCOES = Object.keys(StatusColors) as StatusType[];

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

/** Um agrupamento clínico do conteúdo extraído: rótulo opcional + itens. */
type Bloco = { titulo?: string; itens: string[] };

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

export default function Paciente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    carregado,
    getPaciente,
    atualizarSecao,
    atualizarPaciente,
    atualizarEvolucao,
    removerPaciente,
  } = usePacientes();
  const paciente = getPaciente(id);
  const diaInternacao = paciente ? diaDeInternacao(paciente.dataEntrada) : null;

  // Edição
  const [editando, setEditando] = useState(false);
  const [nomeForm, setNomeForm] = useState("");
  const [idadeForm, setIdadeForm] = useState("");
  const [leitoForm, setLeitoForm] = useState("");
  const [setorForm, setSetorForm] = useState("");
  const [entradaForm, setEntradaForm] = useState("");
  const [prontuarioForm, setProntuarioForm] = useState("");
  const [statusForm, setStatusForm] = useState<StatusType>("pendente");

  // Leito editável inline na área de identificação (preenchimento manual).
  const [leitoInline, setLeitoInline] = useState("");
  useEffect(() => {
    setLeitoInline(paciente?.leito ?? "");
  }, [paciente?.leito]);

  const iniciarEdicao = () => {
    if (!paciente) return;
    setNomeForm(paciente.nomeCompleto);
    setIdadeForm(paciente.idade != null ? String(paciente.idade) : "");
    setLeitoForm(paciente.leito);
    setSetorForm(paciente.setor);
    setEntradaForm(paciente.dataEntrada);
    setProntuarioForm(paciente.numeroProntuario);
    setStatusForm(paciente.status);
    setEditando(true);
  };

  const salvarEdicao = () => {
    const idadeTexto = idadeForm.trim();
    const idadeNum = idadeTexto === "" ? null : Number(idadeTexto);
    atualizarPaciente(id, {
      nomeCompleto: nomeForm.trim(),
      idade: idadeNum != null && Number.isNaN(idadeNum) ? null : idadeNum,
      leito: leitoForm.trim(),
      setor: setorForm.trim(),
      dataEntrada: entradaForm.trim(),
      numeroProntuario: prontuarioForm.trim(),
      status: statusForm,
    });
    setEditando(false);
  };

  const salvarLeitoInline = () => {
    if (leitoInline.trim() !== (paciente?.leito ?? "")) {
      atualizarPaciente(id, { leito: leitoInline.trim() });
    }
  };

  const confirmarExclusao = () => {
    Alert.alert(
      "Excluir paciente",
      `Remover ${paciente?.nomeCompleto || "este paciente"} da rotina? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            removerPaciente(id);
            router.back();
          },
        },
      ],
    );
  };

  const dados = paciente?.dadosClinicos;

  const cabecalho = (
    <>
      <TouchableOpacity style={styles.botaoVoltar} onPress={() => router.back()}>
        <Text style={styles.botaoVoltarTexto}>← Voltar</Text>
      </TouchableOpacity>

      {!paciente ? (
        <Text style={styles.aviso}>
          {carregado ? "Paciente não encontrado." : "Carregando..."}
        </Text>
      ) : (
        <>
          <View style={styles.cabecalho}>
            <Text style={styles.titulo}>
              {paciente.nomeCompleto || "Sem nome"}
            </Text>
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
          </View>

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
              <View style={styles.identificacao}>
                <View style={styles.campoIdent}>
                  <Text style={styles.campoIdentLabel}>Leito ✏️</Text>
                  <TextInput
                    style={styles.campoIdentInputEditavel}
                    value={leitoInline}
                    onChangeText={setLeitoInline}
                    onBlur={salvarLeitoInline}
                    placeholder="Ex: 306-4"
                    placeholderTextColor={ClinicalColors.textMuted}
                  />
                </View>

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
                    Entrada: {paciente.dataEntrada}
                  </Text>
                )}
                {diaInternacao != null && (
                  <Text style={styles.diaInternacao}>
                    Dia {diaInternacao} de internação
                  </Text>
                )}
                <Text style={styles.identLinha}>
                  Acompanhamento: {paciente.diasAcompanhamento.length}{" "}
                  {paciente.diasAcompanhamento.length === 1 ? "dia" : "dias"}
                </Text>
              </View>

              <View style={styles.acoesRow}>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoEditar]}
                  onPress={iniciarEdicao}
                >
                  <Text style={styles.botaoEditarTexto}>✏️ Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botaoAcao, styles.botaoExcluir]}
                  onPress={confirmarExclusao}
                >
                  <Text style={styles.botaoExcluirTexto}>🗑️ Excluir</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.botaoPassarCaso}
                onPress={() =>
                  router.push({
                    pathname: "/evolucao/[id]",
                    params: { id },
                  })
                }
              >
                <Text style={styles.botaoPassarCasoTexto}>
                  📋 Passar o Caso
                </Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </>
  );

  // As seções só aparecem no modo de visualização de um paciente existente.
  const mostrarSecoes = !!paciente && !editando;
  const hoje = hojeISO();

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.containerConteudo}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={cabecalho}
      data={mostrarSecoes ? SECOES : []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <SecaoExpansivel
          titulo={item.titulo}
          instrucao={item.instrucao}
          medicacao={item.medicacao}
          anotacoes={normalizarAnotacoes(paciente?.secoes?.[item.id]?.anotacoes)}
          extraido={
            paciente?.secoes?.[item.id]?.extraido ||
            extraidoLegado(dados, item.id)
          }
          onSalvarAnotacoes={(lista) =>
            atualizarSecao(id, item.id, { anotacoes: lista })
          }
          onExtraido={(t) => atualizarSecao(id, item.id, { extraido: t })}
        />
      )}
      ListFooterComponent={
        mostrarSecoes ? (
          <EvolucaoBeiraLeitoSecao
            key={hoje}
            evolucao={paciente?.evolucoes?.[hoje] ?? EVOLUCAO_VAZIA}
            onSalvar={(evo) => atualizarEvolucao(id, hoje, evo)}
          />
        ) : null
      }
    />
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
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
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
function ConteudoExtraido({
  texto,
  medicacao,
}: {
  texto: string;
  medicacao?: boolean;
}) {
  if (!texto) return <Text style={styles.secaoConteudo}>—</Text>;

  const blocos = parseBlocos(texto) ?? [
    { titulo: "", itens: dividirItens(texto) },
  ];

  return (
    <View style={styles.conteudoBlocos}>
      {blocos.map((bloco, i) => (
        <View key={i} style={styles.bloco}>
          {!!bloco.titulo && (
            <Text style={styles.blocoTitulo}>{bloco.titulo}</Text>
          )}
          {medicacao || ehMedicacao(bloco.titulo) ? (
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
 * Card de seção clínica expansível. Começa fechado; ao tocar no cabeçalho abre,
 * revelando o botão de câmera (foto → extração por IA), uma área de anotações
 * livres e o conteúdo extraído pela IA logo abaixo.
 */
function SecaoExpansivel({
  titulo,
  instrucao,
  anotacoes,
  extraido,
  medicacao,
  onSalvarAnotacoes,
  onExtraido,
}: {
  titulo: string;
  instrucao: string;
  anotacoes: Anotacao[];
  extraido: string;
  medicacao?: boolean;
  onSalvarAnotacoes: (lista: Anotacao[]) => void;
  onExtraido: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [extraindo, setExtraindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
      onSalvarAnotacoes([nova, ...anotacoes]);
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

  const processarUri = async (uri: string) => {
    setExtraindo(true);
    setErro(null);
    try {
      const base64 = await converterParaJpegBase64(uri);
      const json = await extrairDadosImagem<{ blocos: Bloco[] }>(
        base64,
        `${instrucao} ${SUFIXO_JSON}`,
      );
      onExtraido(JSON.stringify(json.blocos ?? []));
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      console.log("Erro ao extrair seção:", e);
      setErro(mensagem);
    }
    setExtraindo(false);
  };

  const fotografar = async () => {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      setErro(
        "Permissão de câmera negada. Habilite o acesso à câmera nas configurações do dispositivo.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) processarUri(result.assets[0].uri);
  };

  const escolherArquivo = async () => {
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissao.granted) {
      setErro(
        "Permissão de galeria negada. Habilite o acesso às fotos nas configurações do dispositivo.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled) processarUri(result.assets[0].uri);
  };

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>{titulo}</Text>
        <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {aberto && (
        <View style={styles.secaoBody}>
          <View style={styles.capturaRow}>
            <TouchableOpacity
              style={[styles.botaoFoto, styles.botaoCaptura]}
              onPress={fotografar}
            >
              <Text style={styles.botaoFotoTexto}>📷 Fotografar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.botaoFoto, styles.botaoCaptura]}
              onPress={escolherArquivo}
            >
              <Text style={styles.botaoFotoTexto}>🖼️ Arquivo</Text>
            </TouchableOpacity>
          </View>

          {extraindo && (
            <Text style={styles.extraindo}>⏳ Extraindo dados...</Text>
          )}

          {erro && (
            <View style={styles.erroBox}>
              <Text style={styles.erroTitulo}>⚠️ Erro ao extrair dados</Text>
              <Text style={styles.erroTexto}>{erro}</Text>
            </View>
          )}

          <Text style={styles.campoLabel}>Anotações</Text>
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

          {anotacoesVisiveis.map((a) => (
            <View key={a.id} style={styles.anotacaoCard}>
              <View style={styles.anotacaoConteudo}>
                {!!a.horario && (
                  <Text style={styles.anotacaoHorario}>{a.horario}</Text>
                )}
                <Text style={styles.anotacaoTexto}>{a.texto}</Text>
              </View>
              <View style={styles.anotacaoAcoes}>
                <TouchableOpacity
                  onPress={() => editarAnotacao(a)}
                  hitSlop={8}
                >
                  <Text style={styles.anotacaoIcone}>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => excluirAnotacao(a)}
                  hitSlop={8}
                >
                  <Text style={styles.anotacaoIcone}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
            Informações do sistema
          </Text>
          <ConteudoExtraido texto={extraido} medicacao={medicacao} />
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
              <Text style={styles.toggleChipTexto}>{o.rotulo}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Campo de texto livre (multilinha) com label opcional e salvamento no onBlur. */
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
  return (
    <View style={styles.campo}>
      {!!label && <Text style={styles.evoLabel}>{label}</Text>}
      <TextInput
        style={styles.evoInput}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder ?? "Digite..."}
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
  const [aberto, setAberto] = useState(false);
  const [evo, setEvo] = useState(evolucao);

  // Resync se a evolução do dia mudar (ex.: virada de data).
  useEffect(() => setEvo(evolucao), [evolucao]);

  const aplicar = (patch: Partial<EvolucaoBeiraLeito>, persistir = true) => {
    const novo = { ...evo, ...patch };
    setEvo(novo);
    if (persistir) onSalvar(novo);
  };

  const selecionarUnico = (
    campo: "nivelConsciencia" | "orientacao" | "alimentacao" | "diurese" | "evacuacao",
    valor: string,
  ) => {
    aplicar({ [campo]: evo[campo] === valor ? null : valor });
  };

  const toggleDispositivo = (d: string) => {
    const marcado = evo.dispositivos.includes(d);
    aplicar({
      dispositivos: marcado
        ? evo.dispositivos.filter((x) => x !== d)
        : [...evo.dispositivos, d],
    });
  };

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>Evolução Beira-Leito</Text>
        <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {aberto && (
        <View style={styles.secaoBody}>
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
            label="Estado geral"
            value={evo.estadoGeral}
            placeholder="Descreva o estado geral..."
            onChangeText={(t) => aplicar({ estadoGeral: t }, false)}
            onBlur={() => onSalvar(evo)}
          />

          <Text style={styles.evoGrupo}>Alimentação e Eliminações</Text>
          <ToggleLinha
            label="Alimentação"
            opcoes={OPC_ALIMENTACAO}
            valor={evo.alimentacao}
            onSelecionar={(v) => selecionarUnico("alimentacao", v)}
          />
          <ToggleLinha
            label="Diurese"
            opcoes={OPC_DIURESE}
            valor={evo.diurese}
            onSelecionar={(v) => selecionarUnico("diurese", v)}
          />
          <ToggleLinha
            label="Evacuação"
            opcoes={OPC_EVACUACAO}
            valor={evo.evacuacao}
            onSelecionar={(v) => selecionarUnico("evacuacao", v)}
          />

          <Text style={styles.evoGrupo}>Invasões e Dispositivos</Text>
          <View style={styles.chipsWrap}>
            {DISPOSITIVOS.map((d) => {
              const ativo = evo.dispositivos.includes(d);
              return (
                <TouchableOpacity
                  key={d}
                  onPress={() => toggleDispositivo(d)}
                  style={[styles.toggleChip, ativo && styles.toggleChipAtivo]}
                >
                  <Text style={styles.toggleChipTexto}>
                    {ativo ? "☑ " : "☐ "}
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {evo.dispositivos.map((d) => (
            <View key={d} style={styles.evoObsDispositivo}>
              <Text style={styles.evoLabel}>{d}</Text>
              <TextInput
                style={styles.evoInput}
                value={evo.dispositivosObs[d] ?? ""}
                onChangeText={(t) =>
                  aplicar(
                    { dispositivosObs: { ...evo.dispositivosObs, [d]: t } },
                    false,
                  )
                }
                onBlur={() => onSalvar(evo)}
                placeholder="Observações..."
                placeholderTextColor={ClinicalColors.textMuted}
                multiline
              />
            </View>
          ))}

          <Text style={styles.evoGrupo}>Achados do Exame Físico</Text>
          <CampoTexto
            value={evo.exameFisico}
            placeholder="Descreva os achados do exame físico..."
            onChangeText={(t) => aplicar({ exameFisico: t }, false)}
            onBlur={() => onSalvar(evo)}
          />

          <Text style={styles.evoGrupo}>Conduta do Dia</Text>
          <CampoTexto
            value={evo.condutaDoDia}
            placeholder="Condutas definidas na discussão com o preceptor..."
            onChangeText={(t) => aplicar({ condutaDoDia: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ClinicalColors.background,
  },
  containerConteudo: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  botaoVoltar: { marginBottom: 16 },
  botaoVoltarTexto: { color: ClinicalColors.primary, fontSize: 16 },
  aviso: { color: ClinicalColors.textMuted, fontSize: 15, marginTop: 24 },
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
  identificacao: {
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.card,
    padding: 16,
    marginBottom: 16,
  },
  identLinha: {
    color: ClinicalColors.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  campoIdent: { marginBottom: 10 },
  campoIdentLabel: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    marginBottom: 2,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  campoIdentValor: { color: ClinicalColors.text, fontSize: 15 },
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
  botaoEditar: {
    backgroundColor: "transparent",
    borderColor: ClinicalColors.primary,
  },
  botaoEditarTexto: {
    color: ClinicalColors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  botaoExcluir: {
    backgroundColor: StatusColors.pendente.bg,
    borderColor: StatusColors.pendente.text,
  },
  botaoExcluirTexto: {
    color: StatusColors.pendente.text,
    fontSize: 15,
    fontWeight: "600",
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
    color: ClinicalColors.text,
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
    alignItems: "center",
    marginBottom: 16,
  },
  botaoFotoTexto: { color: ClinicalColors.text, fontSize: 16, fontWeight: "600" },
  botaoPassarCaso: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.card,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 24,
  },
  botaoPassarCasoTexto: {
    color: ClinicalColors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  capturaRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
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
    borderWidth: BorderWidth.hairline,
    borderColor: ClinicalColors.border,
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
    fontSize: 15,
    fontWeight: "600",
    color: ClinicalColors.text,
    paddingRight: 12,
  },
  secaoChevron: { color: ClinicalColors.textMuted, fontSize: 12 },
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
  botaoSalvarAnotacaoTexto: {
    color: ClinicalColors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  anotacaoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
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
    color: ClinicalColors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  anotacaoAcoes: { flexDirection: "row", gap: 12 },
  anotacaoIcone: { fontSize: 16 },
  campoLabelEspacado: { marginTop: 16 },
  secaoConteudo: { color: ClinicalColors.text, fontSize: 15, lineHeight: 22 },
  conteudoBlocos: { gap: 12 },
  bloco: { gap: 4 },
  blocoTitulo: {
    fontSize: 13,
    fontWeight: "700",
    color: ClinicalColors.primary,
    marginBottom: 2,
  },
  itemRow: { flexDirection: "row", paddingRight: 4 },
  itemBullet: {
    color: ClinicalColors.primary,
    fontSize: 15,
    lineHeight: 22,
    width: 16,
  },
  itemTexto: {
    flex: 1,
    color: ClinicalColors.text,
    fontSize: 15,
    lineHeight: 22,
  },
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
});
