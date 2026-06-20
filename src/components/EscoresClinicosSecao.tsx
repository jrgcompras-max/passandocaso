import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import {
  calcularEscores,
  COR_FAIXA,
  type Escore,
  type ItemEscore,
} from "@/lib/escoresClinicos";
import { apiFetch } from "@/lib/sessao";
import { type Paciente } from "@/types/paciente";

/**
 * Seção "Escores Clínicos" (Fase 3 — UI rica). Grid 2×2 de cards com badge por
 * faixa; tocar abre o detalhe (critérios, campos faltantes editáveis e histórico
 * temporal). No primeiro acesso exibe um consentimento (flag persistida).
 *
 * Regulatório: os escores são CALCULADOS, não interpretados. Disclaimer fixo.
 */

const TIPO_BACKEND: Record<Escore["id"], string> = {
  curb65: "CURB65",
  sofa: "SOFA",
  childPugh: "CHILD_PUGH",
  chadsvasc: "CHA2DS2_VASC",
};

const DISCLAIMER =
  "Escore calculado com base nos dados inseridos. Não substitui avaliação clínica. " +
  "O profissional de saúde é responsável pela decisão terapêutica.";

const CHAVE_CONSENT = "escores_consentimento_v1";

/** Há diagnóstico hepático na ficha? (gate do Child-Pugh) */
function temDiagnosticoHepatico(p: Paciente): boolean {
  const alvo = /cirrose|hepat|child|insufici[êe]ncia h|ascite|encefalopatia/i;
  const fontes: string[] = [];
  if (p.dadosClinicos?.comorbidades) fontes.push(p.dadosClinicos.comorbidades);
  for (const pr of p.problemas || []) fontes.push(pr.titulo);
  if (p.diagnosticoPrincipal) fontes.push(p.diagnosticoPrincipal);
  if (p.motivoInternacao) fontes.push(p.motivoInternacao);
  const sc = [p.secoes?.comorbidades?.extraido, p.secoes?.comorbidadesMedicacoes?.extraido];
  for (const s of sc) if (s) fontes.push(s);
  return alvo.test(fontes.join(" | "));
}

/** Descritor de input para um critério ausente (campo faltante). */
type CampoFalt = {
  chave: string;
  label: string;
  tipo: "num" | "consciencia" | "sexo" | "ascite";
};

/** Mapeia o rótulo de um critério ao campo editável correspondente. */
function campoDoItem(item: ItemEscore): CampoFalt | null {
  const l = item.label.toLowerCase();
  if (l.includes("confus") || l.includes("consci") || l.includes("encefalop"))
    return { chave: "consciencia", label: "Nível de consciência", tipo: "consciencia" };
  if (l.includes("ureia")) return { chave: "ureia", label: "Ureia (mg/dL)", tipo: "num" };
  if (l.includes("fr ")) return { chave: "fr", label: "Freq. respiratória (irpm)", tipo: "num" };
  if (l.includes("pas") || l.includes("pam") || l.includes("cardiovascular"))
    return { chave: "pa", label: "PA (sist/diast, ex.: 110/70)", tipo: "num" };
  if (l.includes("idade")) return { chave: "idade", label: "Idade (anos)", tipo: "num" };
  if (l.includes("respirat")) return { chave: "sato2", label: "SatO₂ (%)", tipo: "num" };
  if (l.includes("plaqueta")) return { chave: "plaquetas", label: "Plaquetas (/mm³)", tipo: "num" };
  if (l.includes("bilirrubina")) return { chave: "bilirrubina", label: "Bilirrubina total (mg/dL)", tipo: "num" };
  if (l.includes("albumina")) return { chave: "albumina", label: "Albumina (g/dL)", tipo: "num" };
  if (l.includes("inr")) return { chave: "inr", label: "INR", tipo: "num" };
  if (l.includes("renal") || l.includes("creatinina")) return { chave: "creatinina", label: "Creatinina (mg/dL)", tipo: "num" };
  if (l.includes("ascite")) return { chave: "ascite", label: "Ascite", tipo: "ascite" };
  if (l.includes("sexo")) return { chave: "sexo", label: "Sexo", tipo: "sexo" };
  return null;
}

/** Aplica os valores manuais a um clone da ficha (para recálculo misto). */
function injetarManuais(
  paciente: Paciente,
  hoje: string,
  valores: Record<string, string>,
): Paciente {
  const p: Paciente = JSON.parse(JSON.stringify(paciente));
  p.resultadosLab = p.resultadosLab || [];
  p.sinaisVitais = p.sinaisVitais || {};
  p.sinaisVitais[hoje] = { ...(p.sinaisVitais[hoje] || ({} as never)) };
  p.evolucoes = p.evolucoes || {};
  p.evolucoes[hoje] = { ...(p.evolucoes[hoje] || ({} as never)) };
  const labKey: Record<string, string> = {
    ureia: "Ureia",
    creatinina: "Creatinina",
    plaquetas: "Plaquetas",
    bilirrubina: "Bilirrubina total",
    albumina: "Albumina",
    inr: "INR",
  };
  const sv = p.sinaisVitais[hoje] as unknown as Record<string, string>;
  const evo = p.evolucoes[hoje] as unknown as Record<string, string>;
  for (const [chave, val] of Object.entries(valores)) {
    const v = (val || "").trim();
    if (!v) continue;
    if (labKey[chave]) {
      p.resultadosLab.push({ id: `man-${chave}-${hoje}`, exame: labKey[chave], data: hoje, valor: v });
    } else if (chave === "fr" || chave === "sato2") {
      sv[chave] = v;
    } else if (chave === "pa") {
      const m = v.match(/(\d+)\D+(\d+)/);
      if (m) {
        sv.paSist = m[1];
        sv.paDiast = m[2];
      }
    } else if (chave === "idade") {
      p.idade = Number(v) || p.idade;
    } else if (chave === "sexo") {
      p.sexo = v.toUpperCase().startsWith("F") ? "F" : "M";
    } else if (chave === "consciencia") {
      evo.nivelConsciencia = v; // "lucido" | "torporoso" | "comatoso"
    } else if (chave === "ascite") {
      evo.abdominal = `${evo.abdominal || ""} ascite ${v === "grave" ? "volumosa" : v}`.trim();
    }
  }
  return p;
}

type HistPonto = { valor_total: number; calculado_em: string };

export function EscoresClinicosSecao({
  paciente,
  pacienteId,
  hoje,
}: {
  paciente: Paciente;
  pacienteId: string;
  hoje: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [consentNecessario, setConsentNecessario] = useState(false);
  const [detalhe, setDetalhe] = useState<Escore | null>(null);

  const mostrarHepatico = useMemo(() => temDiagnosticoHepatico(paciente), [paciente]);
  // Todos os escores aplicáveis (Child-Pugh só com diagnóstico hepático).
  const escores = useMemo(() => {
    const todos = calcularEscores(paciente, hoje);
    return todos.filter((e) => e.id !== "childPugh" || mostrarHepatico);
  }, [paciente, hoje, mostrarHepatico]);

  // Consentimento de primeiro acesso (flag persistida no dispositivo).
  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CHAVE_CONSENT).then((v) => {
      if (vivo && v !== "1") setConsentNecessario(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const aceitarConsentimento = () => {
    AsyncStorage.setItem(CHAVE_CONSENT, "1");
    setConsentNecessario(false);
  };

  return (
    <View style={s.secao}>
      <TouchableOpacity style={s.header} onPress={() => setAberto((v) => !v)} activeOpacity={0.7}>
        <Text style={s.headerTitulo}>Escores Clínicos ({escores.length})</Text>
        <Ionicons name={aberto ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </TouchableOpacity>

      {aberto && (
        <View style={s.body}>
          <View style={s.grid}>
            {escores.map((e) => (
              <EscoreCard key={e.id} escore={e} onAbrir={() => setDetalhe(e)} />
            ))}
          </View>
          <Text style={s.disclaimer}>{DISCLAIMER}</Text>
        </View>
      )}

      {/* Detalhe do escore (critérios + campos faltantes + histórico) */}
      <Modal visible={!!detalhe} animationType="slide" transparent onRequestClose={() => setDetalhe(null)}>
        {detalhe && (
          <EscoreDetalhe
            escore={detalhe}
            paciente={paciente}
            pacienteId={pacienteId}
            hoje={hoje}
            onFechar={() => setDetalhe(null)}
          />
        )}
      </Modal>

      {/* Consentimento de primeiro acesso */}
      <Modal visible={consentNecessario && aberto} animationType="fade" transparent>
        <View style={s.modalFundo}>
          <View style={s.consentCard}>
            <Ionicons name="information-circle" size={30} color={C.primary} />
            <Text style={s.consentTitulo}>Escores clínicos</Text>
            <Text style={s.consentTexto}>{DISCLAIMER}</Text>
            <TouchableOpacity style={s.botaoPrimario} onPress={aceitarConsentimento}>
              <Text style={s.botaoPrimarioTexto}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Card compacto (badge por faixa) no grid 2×2. */
function EscoreCard({ escore, onAbrir }: { escore: Escore; onAbrir: () => void }) {
  const cor = COR_FAIXA[escore.faixa];
  const faltantes = escore.itens.filter((i) => i.ausente).length;
  return (
    <TouchableOpacity style={[s.card, { borderTopColor: cor }]} onPress={onAbrir} activeOpacity={0.8}>
      <View style={s.cardTopo}>
        <Text style={s.cardNome} numberOfLines={1}>
          {escore.nome}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
      </View>
      <Text style={[s.cardPontos, { color: cor }]}>
        {escore.calculavel ? `${escore.pontos}/${escore.maxPontos}` : "—"}
      </Text>
      <View style={[s.cardBadge, { backgroundColor: cor }]}>
        <Text style={s.cardBadgeTexto} numberOfLines={1}>
          {escore.calculavel ? escore.classificacao.split(" · ")[0] : "Dados insuficientes"}
        </Text>
      </View>
      {faltantes > 0 && (
        <Text style={s.cardFaltante}>
          {faltantes} {faltantes === 1 ? "campo faltante" : "campos faltantes"}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/** Conteúdo do modal de detalhe de um escore. */
function EscoreDetalhe({
  escore,
  paciente,
  pacienteId,
  hoje,
  onFechar,
}: {
  escore: Escore;
  paciente: Paciente;
  pacienteId: string;
  hoje: string;
  onFechar: () => void;
}) {
  const [manuais, setManuais] = useState<Record<string, string>>({});
  const [recalculado, setRecalculado] = useState<Escore | null>(null);
  const [historico, setHistorico] = useState<HistPonto[]>([]);
  const [salvando, setSalvando] = useState(false);

  const atual = recalculado || escore;
  const cor = COR_FAIXA[atual.faixa];
  const tipo = TIPO_BACKEND[escore.id];
  const camposFaltantes = atual.itens
    .filter((i) => i.ausente)
    .map(campoDoItem)
    .filter((c): c is CampoFalt => !!c);
  // Deduplica (ex.: PA aparece em mais de um critério).
  const camposUnicos = camposFaltantes.filter(
    (c, i, arr) => arr.findIndex((x) => x.chave === c.chave) === i,
  );

  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/pacientes/${pacienteId}/escores/${tipo}/historico`)
      .then((r) => (r.ok ? r.json() : { historico: [] }))
      .then((j) => {
        if (vivo) setHistorico(Array.isArray(j.historico) ? j.historico : []);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [pacienteId, tipo]);

  const recalcular = () => {
    const pInj = injetarManuais(paciente, hoje, manuais);
    const novo = calcularEscores(pInj, hoje).find((e) => e.id === escore.id) || null;
    setRecalculado(novo);
  };

  const salvar = async () => {
    if (!atual.calculavel) return;
    setSalvando(true);
    try {
      await apiFetch(`/api/pacientes/${pacienteId}/escores/${tipo}`, {
        method: "POST",
        body: JSON.stringify({
          valorTotal: atual.pontos,
          classificacao: atual.classificacao,
          fonte: recalculado ? "misto" : "auto",
          camposFaltantes: atual.itens.filter((i) => i.ausente).map((i) => i.label),
          detalhes: { criterios: atual.itens, maxPontos: atual.maxPontos, faixa: atual.faixa, referencia: atual.fonte },
        }),
      });
      // Recarrega o histórico para refletir o novo ponto.
      const r = await apiFetch(`/api/pacientes/${pacienteId}/escores/${tipo}/historico`);
      if (r.ok) {
        const j = await r.json();
        setHistorico(Array.isArray(j.historico) ? j.historico : []);
      }
    } catch {
      // best-effort
    } finally {
      setSalvando(false);
    }
  };

  return (
    <View style={s.modalFundo}>
      <View style={s.detalheCard}>
        <View style={s.detalheHeader}>
          <Text style={s.detalheTitulo}>{atual.nome}</Text>
          <TouchableOpacity onPress={onFechar} hitSlop={10}>
            <Ionicons name="close" size={24} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          <View style={s.detalheResumo}>
            <Text style={[s.detalhePontos, { color: cor }]}>
              {atual.calculavel ? `${atual.pontos}/${atual.maxPontos}` : "—"}
            </Text>
            <View style={[s.cardBadge, { backgroundColor: cor }]}>
              <Text style={s.cardBadgeTexto}>
                {atual.calculavel ? atual.classificacao : "Dados insuficientes"}
              </Text>
            </View>
          </View>

          {/* Critérios */}
          <Text style={s.secTitulo}>Critérios</Text>
          {atual.itens.map((it, i) => (
            <View key={i} style={s.criterioLinha}>
              <Ionicons
                name={it.ausente ? "remove-circle-outline" : it.marcado ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={it.ausente ? C.textMuted : it.marcado ? COR_FAIXA[atual.faixa] : C.textMuted}
              />
              <Text style={[s.criterioLabel, it.ausente && s.criterioAusente]}>{it.label}</Text>
              <Text style={s.criterioPontos}>
                {it.ausente ? "faltante" : `+${it.pontos}`}
              </Text>
            </View>
          ))}

          {/* Campos faltantes */}
          {camposUnicos.length > 0 && (
            <>
              <Text style={s.secTitulo}>Preencher dados faltantes</Text>
              {camposUnicos.map((c) => (
                <CampoEntrada
                  key={c.chave}
                  campo={c}
                  valor={manuais[c.chave] || ""}
                  onChange={(v) => setManuais((m) => ({ ...m, [c.chave]: v }))}
                />
              ))}
              <TouchableOpacity style={s.botaoSecundario} onPress={recalcular}>
                <Text style={s.botaoSecundarioTexto}>Recalcular com dados informados</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Histórico temporal */}
          {historico.length >= 2 && (
            <>
              <Text style={s.secTitulo}>Evolução do escore</Text>
              <HistoricoBarras pontos={historico} cor={cor} max={atual.maxPontos} />
            </>
          )}

          <Text style={s.detalheFonte}>Fonte: {atual.fonte}</Text>
          <Text style={s.disclaimer}>{DISCLAIMER}</Text>
        </ScrollView>

        {atual.calculavel && (
          <TouchableOpacity style={s.botaoPrimario} onPress={salvar} disabled={salvando}>
            <Text style={s.botaoPrimarioTexto}>{salvando ? "Salvando…" : "Salvar escore"}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function CampoEntrada({
  campo,
  valor,
  onChange,
}: {
  campo: CampoFalt;
  valor: string;
  onChange: (v: string) => void;
}) {
  const opcoes =
    campo.tipo === "consciencia"
      ? [
          ["lucido", "Lúcido"],
          ["torporoso", "Torporoso"],
          ["comatoso", "Comatoso"],
        ]
      : campo.tipo === "sexo"
        ? [
            ["M", "Masculino"],
            ["F", "Feminino"],
          ]
        : campo.tipo === "ascite"
          ? [
              ["ausente", "Ausente"],
              ["leve", "Leve"],
              ["grave", "Moderada/refratária"],
            ]
          : null;

  return (
    <View style={s.campoBox}>
      <Text style={s.campoLabel}>{campo.label}</Text>
      {opcoes ? (
        <View style={s.opcoesLinha}>
          {opcoes.map(([v, rot]) => (
            <TouchableOpacity
              key={v}
              style={[s.opcaoChip, valor === v && s.opcaoChipAtivo]}
              onPress={() => onChange(v)}
            >
              <Text style={[s.opcaoChipTexto, valor === v && s.opcaoChipTextoAtivo]}>{rot}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <TextInput
          style={s.campoInput}
          value={valor}
          onChangeText={onChange}
          keyboardType="numbers-and-punctuation"
          placeholder="—"
          placeholderTextColor={C.textMuted}
        />
      )}
    </View>
  );
}

/** Mini gráfico de barras do histórico (sem dependências, como os sparklines). */
function HistoricoBarras({ pontos, cor, max }: { pontos: HistPonto[]; cor: string; max: number }) {
  const vals = pontos.map((p) => p.valor_total);
  const ult = vals[vals.length - 1];
  return (
    <View style={s.histBox}>
      <View style={s.histBarras}>
        {vals.slice(-12).map((v, i) => (
          <View key={i} style={[s.histBarra, { height: 6 + (Math.max(0, v) / (max || 1)) * 34, backgroundColor: cor }]} />
        ))}
      </View>
      <Text style={s.histLegenda}>
        {vals.length} medições · atual {ult}/{max}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  secao: { backgroundColor: C.surface, borderRadius: Radius.card, marginBottom: 12, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitulo: { flex: 1, fontSize: 17, fontWeight: "600", color: C.text },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 14,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: {
    width: "48%",
    backgroundColor: C.background,
    borderRadius: 12,
    borderTopWidth: 3,
    padding: 12,
    marginBottom: 12,
  },
  cardTopo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardNome: { flex: 1, fontSize: 13, fontWeight: "700", color: C.text },
  cardPontos: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  cardBadge: { alignSelf: "flex-start", borderRadius: Radius.badge, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  cardBadgeTexto: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  cardFaltante: { fontSize: 10, color: C.textMuted, marginTop: 6 },
  disclaimer: { fontSize: 11, color: C.textMuted, fontStyle: "italic", marginTop: 4 },

  modalFundo: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  detalheCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 28,
  },
  detalheHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  detalheTitulo: { fontSize: 19, fontWeight: "700", color: C.text },
  detalheResumo: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  detalhePontos: { fontSize: 30, fontWeight: "800" },
  secTitulo: { fontSize: 13, fontWeight: "700", color: C.textMuted, marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  criterioLinha: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  criterioLabel: { flex: 1, fontSize: 14, color: C.text },
  criterioAusente: { color: C.textMuted },
  criterioPontos: { fontSize: 13, fontWeight: "600", color: C.textMuted },
  campoBox: { marginBottom: 10 },
  campoLabel: { fontSize: 13, color: C.textSecondary, marginBottom: 4 },
  campoInput: {
    backgroundColor: C.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: C.text,
  },
  opcoesLinha: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opcaoChip: {
    backgroundColor: C.background,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  opcaoChipAtivo: { backgroundColor: C.primary, borderColor: C.primary },
  opcaoChipTexto: { fontSize: 13, color: C.text },
  opcaoChipTextoAtivo: { color: "#FFFFFF", fontWeight: "600" },
  histBox: { marginTop: 4 },
  histBarras: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 44 },
  histBarra: { flex: 1, borderRadius: 2, minWidth: 6 },
  histLegenda: { fontSize: 11, color: C.textMuted, marginTop: 6 },
  detalheFonte: { fontSize: 11, color: C.textMuted, marginTop: 14 },

  botaoPrimario: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 14 },
  botaoPrimarioTexto: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  botaoSecundario: {
    backgroundColor: C.background,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
    borderWidth: 0.5,
    borderColor: C.primary,
  },
  botaoSecundarioTexto: { color: C.primary, fontSize: 14, fontWeight: "600" },
  consentCard: {
    backgroundColor: C.surface,
    margin: 24,
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    alignSelf: "center",
    marginTop: "auto",
    marginBottom: "auto",
  },
  consentTitulo: { fontSize: 18, fontWeight: "700", color: C.text, marginTop: 8 },
  consentTexto: { fontSize: 13, color: C.textSecondary, textAlign: "center", marginTop: 8, lineHeight: 19 },
});
