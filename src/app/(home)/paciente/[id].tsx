import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    LayoutAnimation,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

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
  DISPOSITIVOS,
  EVOLUCAO_VAZIA,
  OPC_ALIMENTACAO,
  OPC_CONSCIENCIA,
  OPC_DIURESE,
  OPC_EVACUACAO,
  OPC_ORIENTACAO,
  type Opcao,
} from "@/constants/evolucao";
import { CHECKLIST_ALTA } from "@/constants/checklistAlta";
import { SECOES } from "@/constants/secoes";
import { categorizarAnotacao } from "@/lib/categorizarAnotacao";
import { classificarMedicamento } from "@/lib/classificarMedicamento";
import { diaDeInternacao, formatarDataBR, hojeISO } from "@/lib/datas";
import { extrairDadosImagem } from "@/lib/extrairDadosImagem";
import { formatarNome } from "@/lib/formatarNome";
import { gerarResumoIA } from "@/lib/gerarResumoIA";
import { converterParaJpegBase64 } from "@/lib/imagem";
import { agruparPorExame, TENDENCIA_INFO } from "@/lib/lab";
import { montarDadosParaResumo } from "@/lib/resumoPaciente";
import { fraseSinaisVitais, O2_OPCOES, SV_VAZIO } from "@/lib/sinaisVitais";
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
    atualizarProblemas,
    atualizarPendencias,
    atualizarEvolucao,
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
  const [statusForm, setStatusForm] = useState<StatusType>("naoVisitado");
  const [diagnosticoForm, setDiagnosticoForm] = useState("");
  const [motivoForm, setMotivoForm] = useState("");

  // Modo Round (apresentação) e geração de resumo por IA.
  const [modoRound, setModoRound] = useState(false);
  const [gerandoResumo, setGerandoResumo] = useState(false);

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
    atualizarPaciente(id, {
      nomeCompleto: nomeForm.trim(),
      idade: idadeNum != null && Number.isNaN(idadeNum) ? null : idadeNum,
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
      <View style={styles.topoBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.botaoVoltarTexto}>← Voltar</Text>
        </TouchableOpacity>
        {!!paciente && !editando && (
          <TouchableOpacity
            style={styles.botaoRound}
            onPress={() => setModoRound(true)}
          >
            <Text style={styles.botaoRoundTexto}>🎯 Modo Round</Text>
          </TouchableOpacity>
        )}
      </View>

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
                            borderColor: cor.text,
                            backgroundColor: ativo ? cor.bg : "transparent",
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

              <ProblemasSecao
                problemas={paciente.problemas ?? []}
                onChange={(lista) => atualizarProblemas(id, lista)}
              />
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
    <>
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
          secaoId={item.id}
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
          extra={
            item.id === "examesLaboratoriais" ? (
              <LabEvolucao
                resultados={paciente?.resultadosLab ?? []}
                onChange={(lista) =>
                  atualizarPaciente(id, { resultadosLab: lista })
                }
              />
            ) : item.id === "prescricaoHospitalar" ? (
              <PrescricaoSecao
                medicamentos={paciente?.medicamentos ?? []}
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
      )}
      ListFooterComponent={
        mostrarSecoes ? (
          <>
            <EvolucaoBeiraLeitoSecao
              key={hoje}
              evolucao={paciente?.evolucoes?.[hoje] ?? EVOLUCAO_VAZIA}
              onSalvar={(evo) => atualizarEvolucao(id, hoje, evo)}
            />
            <CondutaSecao
              key={`conduta-${hoje}`}
              evolucao={paciente?.evolucoes?.[hoje] ?? EVOLUCAO_VAZIA}
              onSalvar={(evo) => atualizarEvolucao(id, hoje, evo)}
            />
            {mostrarChecklistAlta && (
              <ChecklistAltaSecao
                checklist={paciente?.checklistAlta ?? {}}
                onChange={(c) => atualizarPaciente(id, { checklistAlta: c })}
              />
            )}
            <TouchableOpacity
              style={styles.botaoPassarCaso}
              onPress={() =>
                router.push({ pathname: "/evolucao/[id]", params: { id } })
              }
            >
              <Text style={styles.botaoPassarCasoTexto}>📋 Passar o Caso</Text>
            </TouchableOpacity>
          </>
        ) : null
      }
    />
    {paciente && (
      <ModoRound
        visivel={modoRound}
        paciente={paciente}
        dia={diaInternacao}
        hoje={hoje}
        onSair={() => setModoRound(false)}
      />
    )}
    </>
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
 * Visão unificada de "Comorbidades e MUC": junta o que veio da foto (extraído)
 * com as anotações digitadas, no MESMO formato (bullets), agrupadas em
 * Comorbidades e Medicações de uso contínuo. Anotações têm 🗑️ para remover.
 */
function ComorbidadesUnificado({
  extraido,
  anotacoes,
  onExcluir,
}: {
  extraido: string;
  anotacoes: Anotacao[];
  onExcluir: (a: Anotacao) => void;
}) {
  const blocos =
    parseBlocos(extraido) ??
    (extraido.trim() ? [{ titulo: "", itens: dividirItens(extraido) }] : []);
  const comorbExtra: string[] = [];
  const mucExtra: string[] = [];
  for (const b of blocos) {
    const alvo = /medica|muc/i.test(b.titulo ?? "") ? mucExtra : comorbExtra;
    alvo.push(...b.itens);
  }
  const comorbAnot = anotacoes.filter((a) => a.categoria !== "medicacao");
  const mucAnot = anotacoes.filter((a) => a.categoria === "medicacao");

  const grupo = (titulo: string, extras: string[], anots: Anotacao[]) => {
    if (!extras.length && !anots.length) return null;
    return (
      <View style={styles.uniGrupo}>
        <Text style={styles.blocoTitulo}>{titulo}</Text>
        {extras.map((t, i) => (
          <View key={`e${i}`} style={styles.itemRow}>
            <Text style={styles.itemBullet}>•</Text>
            <Text style={styles.itemTexto}>{t}</Text>
          </View>
        ))}
        {anots.map((a) => (
          <View key={a.id} style={styles.itemRow}>
            <Text style={styles.itemBullet}>•</Text>
            <Text style={styles.itemTexto}>{a.texto}</Text>
            <TouchableOpacity onPress={() => onExcluir(a)} hitSlop={8}>
              <Text style={styles.anotacaoIcone}>🗑️</Text>
            </TouchableOpacity>
          </View>
        ))}
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
  extra,
  onSalvarAnotacoes,
  onExtraido,
}: {
  titulo: string;
  instrucao: string;
  secaoId: SecaoId;
  anotacoes: Anotacao[];
  extraido: string;
  medicacao?: boolean;
  /** Conteúdo estruturado extra renderizado no fim do corpo da seção. */
  extra?: React.ReactNode;
  onSalvarAnotacoes: (lista: Anotacao[]) => void;
  onExtraido: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [extraindo, setExtraindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

          {secaoId === "comorbidadesMedicacoes" ? (
            // Unificado: foto + anotações no mesmo formato (bullets), agrupados.
            <ComorbidadesUnificado
              extraido={extraido}
              anotacoes={anotacoes}
              onExcluir={excluirAnotacao}
            />
          ) : (
            <>
              {anotacoesVisiveis.map((a) => (
                <View key={a.id} style={styles.anotacaoCard}>
                  <View style={styles.anotacaoConteudo}>
                    {!!a.horario && (
                      <Text style={styles.anotacaoHorario}>{a.horario}</Text>
                    )}
                    <Text style={styles.anotacaoTexto}>{a.texto}</Text>
                    {categorias &&
                      (() => {
                        const cat = categorias.find(
                          (c) => c.chave === a.categoria,
                        );
                        return cat ? (
                          <TouchableOpacity
                            onPress={() => alternarCategoria(a)}
                            style={[
                              styles.anotacaoCategoria,
                              { backgroundColor: cat.cor },
                            ]}
                          >
                            <Text style={styles.anotacaoCategoriaTexto}>
                              {cat.label}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={styles.anotacaoClassificando}>
                            classificando…
                          </Text>
                        );
                      })()}
                  </View>
                  <View style={styles.anotacaoAcoes}>
                    <TouchableOpacity onPress={() => editarAnotacao(a)} hitSlop={8}>
                      <Text style={styles.anotacaoIcone}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => excluirAnotacao(a)} hitSlop={8}>
                      <Text style={styles.anotacaoIcone}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
                Informações do sistema
              </Text>
              <ConteudoExtraido texto={extraido} medicacao={medicacao} />
            </>
          )}

          {extra}
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
          onChangeText={onChangeText}
          onBlur={() => {
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
          <Text style={styles.lapisIcone}>✏️</Text>
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
        onChangeText={setTexto}
        onBlur={() => {
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
          onChangeText={setTexto}
          onBlur={salvar}
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
          <Text style={styles.lapisIcone}>✏️</Text>
        </TouchableOpacity>
      )}
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
            label="Estado geral (subjetivo / queixas)"
            value={evo.estadoGeral}
            placeholder="Ex: refere dor abdominal, sem queixas..."
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
                  <Text
                    style={[
                      styles.toggleChipTexto,
                      ativo && styles.toggleChipTextoAtivo,
                    ]}
                  >
                    {ativo ? "☑ " : "☐ "}
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {evo.dispositivos.map((d) => (
            <View key={d} style={styles.evoObsDispositivo}>
              <CampoLeitura
                label={d}
                value={evo.dispositivosObs[d] ?? ""}
                onChange={(t) =>
                  aplicar({ dispositivosObs: { ...evo.dispositivosObs, [d]: t } })
                }
                placeholder="Observações..."
                multiline
              />
            </View>
          ))}

          <Text style={styles.evoGrupo}>Exame Físico</Text>
          <CampoTexto
            label="Estado geral (objetivo)"
            value={evo.estadoGeralExame ?? ""}
            placeholder="Ex: REG, LOC, MUC, AAA"
            onChangeText={(t) => aplicar({ estadoGeralExame: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Neurológico"
            value={evo.neurologico ?? ""}
            placeholder="Ex: Glasgow 15, PIRF, sem déficits focais"
            onChangeText={(t) => aplicar({ neurologico: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Cardiovascular"
            value={evo.cardiovascular ?? ""}
            placeholder="Ex: AC RR 2T BNF, sem sopros"
            onChangeText={(t) => aplicar({ cardiovascular: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Respiratório"
            value={evo.respiratorio ?? ""}
            placeholder="Ex: AP MV+ bilat simétrico, sem RA"
            onChangeText={(t) => aplicar({ respiratorio: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Abdominal"
            value={evo.abdominal ?? ""}
            placeholder="Ex: Abdome flácido, indolor, RHA+"
            onChangeText={(t) => aplicar({ abdominal: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Membros inferiores"
            value={evo.mmii ?? ""}
            placeholder="Ex: MMII sem edema, panturrilhas livres"
            onChangeText={(t) => aplicar({ mmii: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
          <CampoTexto
            label="Extremidades"
            value={evo.extremidades ?? ""}
            placeholder="Ex: Extremidades aquecidas, TEC < 3s"
            onChangeText={(t) => aplicar({ extremidades: t }, false)}
            onBlur={() => onSalvar(evo)}
          />
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
  const [aberto, setAberto] = useState(false);
  const [evo, setEvo] = useState(evolucao);
  useEffect(() => setEvo(evolucao), [evolucao]);

  return (
    <View style={styles.secao}>
      <TouchableOpacity
        style={styles.secaoHeader}
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.secaoHeaderTitulo}>Conduta do Dia</Text>
        <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {aberto && (
        <View style={styles.secaoBody}>
          <CampoTexto
            value={evo.condutaDoDia}
            placeholder="Condutas definidas na discussão com o preceptor..."
            onChangeText={(t) => setEvo((e) => ({ ...e, condutaDoDia: t }))}
            onBlur={() => onSalvar(evo)}
          />
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
function ProblemasSecao({
  problemas,
  onChange,
}: {
  problemas: Problema[];
  onChange: (lista: Problema[]) => void;
}) {
  const [aberto, setAberto] = useState(true);
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
          <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.botaoMais} onPress={abrirNovo} hitSlop={8}>
          <Text style={styles.botaoMaisTexto}>+</Text>
        </TouchableOpacity>
      </View>

      {aberto && (
        <View style={styles.secaoBody}>
          {problemas.length === 0 && !mostrarForm && (
            <Text style={styles.vazioTexto}>Nenhum problema ativo.</Text>
          )}

          {problemas.map((p) => {
            const cor = PrioridadeColors[p.prioridade];
            return (
              <View
                key={p.id}
                style={[
                  styles.problemaCard,
                  { backgroundColor: cor.bg, borderLeftColor: cor.border },
                ]}
              >
                <View style={styles.problemaTopo}>
                  <Text style={styles.problemaTitulo}>{p.titulo}</Text>
                  <View style={styles.anotacaoAcoes}>
                    <TouchableOpacity onPress={() => abrirEdicao(p)} hitSlop={8}>
                      <Text style={styles.anotacaoIcone}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => excluir(p)} hitSlop={8}>
                      <Text style={styles.anotacaoIcone}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.problemaMeta}>
                  <Text
                    style={[
                      styles.miniChip,
                      { color: cor.text, borderColor: cor.text },
                    ]}
                  >
                    {PROBLEMA_STATUS_LABEL[p.status]}
                  </Text>
                  <Text
                    style={[
                      styles.miniChip,
                      { color: cor.text, borderColor: cor.text },
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
          })}

          {mostrarForm && (
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
  const [aberto, setAberto] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [descForm, setDescForm] = useState("");
  const [prioForm, setPrioForm] = useState<Prioridade>("media");

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
          <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.botaoMais} onPress={abrirNovo} hitSlop={8}>
          <Text style={styles.botaoMaisTexto}>+</Text>
        </TouchableOpacity>
      </View>

      {aberto && (
        <View style={styles.secaoBody}>
          {pendencias.length === 0 && !mostrarForm && (
            <Text style={styles.vazioTexto}>Nenhuma pendência.</Text>
          )}

          {pendencias.map((p) => {
            const cor = PrioridadeColors[p.prioridade];
            return (
              <View key={p.id} style={styles.pendenciaLinha}>
                <TouchableOpacity onPress={() => alternar(p)} hitSlop={8}>
                  <Text style={styles.checkbox}>{p.feito ? "☑" : "☐"}</Text>
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
                  <Text style={styles.anotacaoIcone}>🗑️</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {mostrarForm && (
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
  const [aberto, setAberto] = useState(false);
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
              <Text style={styles.resumoGerarTexto}>✨ Gerar</Text>
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

/**
 * Evolução laboratorial por data: formulário para inserir exame/data/valor e
 * exibição por exame com a série temporal e a tendência (↓ queda / ↑ alta / →).
 */
function LabEvolucao({
  resultados,
  onChange,
}: {
  resultados: ResultadoLab[];
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
    onChange(resultados.filter((r) => r.exame.trim() !== nome));

  const series = agruparPorExame(resultados);

  return (
    <View style={styles.labBox}>
      <TouchableOpacity
        style={styles.labAddBtn}
        onPress={() => setMostrarForm((v) => !v)}
      >
        <Text style={styles.labAddTexto}>📅 Adicionar resultado por data</Text>
      </TouchableOpacity>

      {mostrarForm && (
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
        <Text style={styles.vazioTexto}>Nenhum resultado por data ainda.</Text>
      ) : (
        series.map((s) => {
          const info = s.tendencia ? TENDENCIA_INFO[s.tendencia] : null;
          return (
            <View key={s.exame} style={styles.labLinha}>
              <View style={styles.labLinhaTopo}>
                <Text style={styles.labExame}>{s.exame}</Text>
                <View style={styles.labLinhaDir}>
                  {info && (
                    <Text style={[styles.labTend, { color: info.cor }]}>
                      {info.icone} {info.rotulo}
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => removerExame(s.exame)}
                    hitSlop={8}
                  >
                    <Text style={styles.anotacaoIcone}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.labSerie}>
                {s.pontos
                  .map((p) => `${p.valor} (${formatarDataBR(p.data).slice(0, 5)})`)
                  .join("  →  ")}
              </Text>
            </View>
          );
        })
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
              value={sv[c.k]}
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
  const [aberto, setAberto] = useState(true);
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
        <Text style={styles.secaoChevron}>{aberto ? "▲" : "▼"}</Text>
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
                <Text style={[styles.checkbox, feito && styles.checkboxFeito]}>
                  {feito ? "☑" : "☐"}
                </Text>
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

/** Um bloco rotulado dentro do Modo Round (fontes maiores). */
function RoundBloco({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.roundBloco}>
      <Text style={styles.roundSecaoTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

/**
 * Modo Round: tela fullscreen, visual limpo e fontes maiores, para apresentar o
 * caso segurando o celular. Mostra o essencial em ordem de apresentação.
 */
function ModoRound({
  visivel,
  paciente,
  dia,
  hoje,
  onSair,
}: {
  visivel: boolean;
  paciente: PacienteModel;
  dia: number | null;
  hoje: string;
  onSair: () => void;
}) {
  const problemas = (paciente.problemas ?? []).filter(
    (p) => p.status !== "resolvido",
  );
  const evo = paciente.evolucoes?.[hoje];
  const frase = fraseSinaisVitais(paciente.sinaisVitais?.[hoje]);
  const series = agruparPorExame(paciente.resultadosLab ?? []);
  const statusClinicoLabel = paciente.statusClinico
    ? StatusClinicoColors[paciente.statusClinico].label
    : null;
  const linhaTopo = [
    paciente.idade != null ? `${paciente.idade} anos` : null,
    dia != null ? `D${dia} de internação` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={onSair}>
      <View style={styles.roundContainer}>
        <TouchableOpacity style={styles.roundSair} onPress={onSair}>
          <Text style={styles.roundSairTexto}>← Sair do Modo Round</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.roundConteudo}>
          <Text style={styles.roundNome}>
            {paciente.nomeCompleto || "Sem nome"}
          </Text>
          {!!linhaTopo && <Text style={styles.roundLinhaTopo}>{linhaTopo}</Text>}

          {!!paciente.diagnosticoPrincipal && (
            <RoundBloco titulo="Diagnóstico principal">
              <Text style={styles.roundTexto}>
                {paciente.diagnosticoPrincipal}
              </Text>
            </RoundBloco>
          )}
          {!!statusClinicoLabel && (
            <RoundBloco titulo="Status clínico">
              <Text style={styles.roundTexto}>{statusClinicoLabel}</Text>
            </RoundBloco>
          )}
          {problemas.length > 0 && (
            <RoundBloco titulo="Problemas ativos">
              {problemas.map((p) => (
                <Text key={p.id} style={styles.roundItem}>
                  • {p.titulo}
                  {p.conduta?.trim() ? ` — ${p.conduta.trim()}` : ""}
                </Text>
              ))}
            </RoundBloco>
          )}
          {(!!frase || !!evo?.estadoGeral?.trim()) && (
            <RoundBloco titulo="Últimas 24h">
              {!!evo?.estadoGeral?.trim() && (
                <Text style={styles.roundTexto}>{evo.estadoGeral.trim()}</Text>
              )}
              {!!frase && <Text style={styles.roundTexto}>{frase}</Text>}
            </RoundBloco>
          )}
          {series.length > 0 && (
            <RoundBloco titulo="Exames relevantes">
              {series.map((s) => {
                const info = s.tendencia ? TENDENCIA_INFO[s.tendencia] : null;
                return (
                  <Text key={s.exame} style={styles.roundItem}>
                    • {s.exame}: {s.pontos.map((p) => p.valor).join(" → ")}
                    {info ? ` ${info.icone}` : ""}
                  </Text>
                );
              })}
            </RoundBloco>
          )}
          {!!evo?.condutaDoDia?.trim() && (
            <RoundBloco titulo="Conduta do dia">
              <Text style={styles.roundTexto}>{evo.condutaDoDia.trim()}</Text>
            </RoundBloco>
          )}
        </ScrollView>
      </View>
    </Modal>
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
function PrescricaoSecao({
  medicamentos,
  onChange,
}: {
  medicamentos: Medicamento[];
  onChange: (l: Medicamento[]) => void;
}) {
  const [texto, setTexto] = useState("");
  const [editClasseId, setEditClasseId] = useState<string | null>(null);
  const [classeDraft, setClasseDraft] = useState("");

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

  return (
    <View style={styles.prescBox}>
      <Text style={[styles.campoLabel, styles.campoLabelEspacado]}>
        Medicamentos (classe definida pela IA)
      </Text>
      {medicamentos.map((m) => (
        <View key={m.id} style={styles.medRow}>
          <View style={styles.medInfo}>
            <Text style={styles.medTexto}>{m.texto}</Text>
            {editClasseId === m.id ? (
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
          </View>
          <TouchableOpacity
            onPress={() => onChange(medicamentos.filter((x) => x.id !== m.id))}
            hitSlop={8}
          >
            <Text style={styles.anotacaoIcone}>🗑️</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TextInput
        style={[styles.campoInput, styles.medAddInput]}
        value={texto}
        onChangeText={setTexto}
        placeholder="Ex.: Ceftriaxona 1g EV 1x/dia D5/7"
        placeholderTextColor={ClinicalColors.textMuted}
      />
      <TouchableOpacity style={styles.medAddBtn} onPress={adicionar}>
        <Text style={styles.medAddBtnTexto}>+ Adicionar medicamento</Text>
      </TouchableOpacity>
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
  acoesIcones: { flexDirection: "row", alignItems: "center", gap: 16 },
  iconeBtn: { padding: 8 },
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
    alignItems: "center",
    marginBottom: 16,
  },
  botaoFotoTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  botaoPassarCaso: {
    backgroundColor: ClinicalColors.accent,
    borderRadius: Radius.card,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  botaoPassarCasoTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 17,
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
    fontWeight: "500",
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
  botaoSalvarAnotacaoTexto: {
    color: ClinicalColors.textOnPrimary,
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
  secaoConteudo: { color: ClinicalColors.text, fontSize: 15, lineHeight: 22 },
  conteudoBlocos: { gap: 12 },
  uniGrupo: { gap: 4, marginBottom: 8 },
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
  toggleChipTextoAtivo: { color: ClinicalColors.textOnPrimary },
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
    fontSize: 14,
    color: ClinicalColors.textMuted,
    lineHeight: 20,
    marginTop: 4,
  },
  statusClinicoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusClinicoChip: {
    borderWidth: 1,
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
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
    borderLeftWidth: 4,
    borderRadius: Radius.badge,
    padding: 12,
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
    fontWeight: "700",
    color: ClinicalColors.text,
    paddingRight: 8,
  },
  problemaMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniChip: {
    fontSize: 11,
    fontWeight: "600",
    borderWidth: 1,
    borderRadius: Radius.badge,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  problemaObs: {
    fontSize: 13,
    color: ClinicalColors.text,
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
    fontSize: 14,
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
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    borderWidth: 1,
    borderRadius: 12,
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

  // Sinais vitais estruturados
  svBox: { marginTop: 8 },
  svGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  svCampo: { width: "47%", marginBottom: 4 },
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
  medTexto: { fontSize: 14, color: ClinicalColors.text },
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
  medAddBtn: {
    backgroundColor: ClinicalColors.background,
    borderColor: ClinicalColors.primary,
    borderWidth: BorderWidth.hairline,
    borderRadius: Radius.badge,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 8,
  },
  medAddBtnTexto: {
    color: ClinicalColors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
