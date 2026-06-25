import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { formatarNome } from "@/lib/formatarNome";
import { abreviarLab, GRUPOS_LAB, grupoLab, ordemLab } from "@/lib/lab";
import {
  classificarLabSync,
  DISCLAIMER_ABIM,
  carregarReferencias,
} from "@/lib/labsReferencia";
import { usePacientes } from "@/store/PacientesContext";
import { type SinaisVitaisDia } from "@/types/paciente";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const AZUL = C.primary;
const VERMELHO = "#D14343";

function partes(data: string) {
  // Backend serializa DATE como ISO com horário; pega só "YYYY-MM-DD" e monta no
  // fuso LOCAL (evita o off-by-one de UTC).
  const [y, m, d] = String(data ?? "").slice(0, 10).split("-").map(Number);
  return { y, m, d, dt: new Date(y, m - 1, d) };
}
/** "15/06" para os rótulos de data. */
function rotuloCurto(data: string) {
  const { d, m } = partes(data);
  return `${String(d).padStart(2, "0")}/${MESES[m - 1]}`;
}
function num(v: unknown): number | null {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Gráfico de linha desenhado só com Views (sem react-native-svg): cada segmento
 * é um retângulo fino rotacionado entre dois pontos. Suporta várias linhas
 * (ex.: PA sistólica + diastólica) com escala Y compartilhada.
 */
function GraficoLinha({
  linhas,
  largura,
  altura,
  espessura = 2,
  pontos = false,
}: {
  linhas: { valores: number[]; cor: string }[];
  largura: number;
  altura: number;
  espessura?: number;
  pontos?: boolean;
}) {
  const todos = linhas.flatMap((l) => l.valores);
  if (!todos.length) return <View style={{ width: largura, height: altura }} />;
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const amp = max - min;
  const pad = espessura + 1;
  const py = (v: number) => {
    const frac = amp === 0 ? 0.5 : (v - min) / amp; // série constante → meio
    return pad + (1 - frac) * (altura - 2 * pad);
  };

  return (
    <View style={{ width: largura, height: altura }}>
      {linhas.map((l, li) => {
        const vs = l.valores;
        if (vs.length === 1) {
          return (
            <View
              key={li}
              style={{
                position: "absolute",
                left: largura / 2 - 3,
                top: py(vs[0]) - 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: l.cor,
              }}
            />
          );
        }
        const dx = vs.length > 1 ? largura / (vs.length - 1) : 0;
        const pts = vs.map((v, i) => ({ x: i * dx, y: py(v) }));
        return (
          <View key={li} style={StyleSheet.absoluteFill}>
            {pts.slice(1).map((b, i) => {
              const a = pts[i];
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: mx - len / 2,
                    top: my - espessura / 2,
                    width: len,
                    height: espessura,
                    borderRadius: espessura / 2,
                    backgroundColor: l.cor,
                    transform: [{ rotate: `${ang}rad` }],
                  }}
                />
              );
            })}
            {pontos &&
              pts.map((p, i) => (
                <View
                  key={`p${i}`}
                  style={{
                    position: "absolute",
                    left: p.x - 2.5,
                    top: p.y - 2.5,
                    width: 5,
                    height: 5,
                    borderRadius: 2.5,
                    backgroundColor: l.cor,
                  }}
                />
              ))}
          </View>
        );
      })}
    </View>
  );
}

// ── Sinais vitais: definição dos parâmetros e leitura das séries ──────────────
type SerieVital = { valores: number[]; ultimo: string | null };
const VITAIS: { key: string; label: string; unidade: string }[] = [
  { key: "pa", label: "PA", unidade: "mmHg" },
  { key: "fc", label: "FC", unidade: "bpm" },
  { key: "temp", label: "Tax", unidade: "°C" },
  { key: "sato2", label: "SatO₂", unidade: "%" },
  { key: "fr", label: "FR", unidade: "irpm" },
];

function CardVital({
  cfg,
  pa,
  serie,
  largura,
}: {
  cfg: { key: string; label: string; unidade: string };
  pa?: { sist: number[]; diast: number[]; ultimo: string | null };
  serie?: SerieVital;
  largura: number;
}) {
  const ehPA = cfg.key === "pa";
  const ultimo = ehPA ? pa?.ultimo : serie?.ultimo;
  const linhas = ehPA
    ? [
        { valores: pa?.sist ?? [], cor: AZUL },
        { valores: pa?.diast ?? [], cor: "#7FB3E0" },
      ]
    : [{ valores: serie?.valores ?? [], cor: AZUL }];
  const nPontos = ehPA
    ? Math.max(pa?.sist.length ?? 0, pa?.diast.length ?? 0)
    : serie?.valores.length ?? 0;

  return (
    <View style={styles.vitalCard}>
      <View style={styles.vitalTopo}>
        <Text style={styles.vitalLabel}>{cfg.label}</Text>
        <Text style={styles.vitalValor}>
          {ultimo ?? "—"}
          <Text style={styles.vitalUnidade}> {cfg.unidade}</Text>
        </Text>
      </View>
      <GraficoLinha linhas={linhas} largura={largura} altura={72} />
      {nPontos < 2 && (
        <Text style={styles.insuf}>dados insuficientes para tendência</Text>
      )}
    </View>
  );
}

type LabSelecionado = { nome: string; serie: { data: string; valor: string }[] };

// ── Labs: BUG 2 — lista limpa (valor + seta colorida); toque abre modal. ──────
function LinhaLab({
  nome,
  serie,
  sexo,
  idade,
  onAbrir,
}: {
  nome: string;
  serie: { data: string; valor: string }[];
  sexo?: "M" | "F";
  idade?: number;
  onAbrir: () => void;
}) {
  const ultimo = serie[serie.length - 1];
  // Valor: alto = ↑ vermelho, baixo = ↓ azul, normal = preto sem seta (BUG 3).
  const c = classificarLabSync(nome, ultimo?.valor ?? "", sexo, idade);
  return (
    <TouchableOpacity style={styles.labRow} onPress={onAbrir} activeOpacity={0.6}>
      <Text style={styles.labNome}>{abreviarLab(nome)}</Text>
      <Text style={[styles.labValor, { color: c.cor }]}>
        {num(ultimo?.valor) ?? ultimo?.valor}
        {c.seta !== "→" ? ` ${c.seta}` : ""}
      </Text>
      <Ionicons name="chevron-forward" size={15} color={C.textMuted} />
    </TouchableOpacity>
  );
}

/** Modal do lab (BUG 2): gráfico de linha completo + tabela de valores por data. */
function ModalLab({
  lab,
  sexo,
  idade,
  largura,
  onFechar,
}: {
  lab: LabSelecionado | null;
  sexo?: "M" | "F";
  idade?: number;
  largura: number;
  onFechar: () => void;
}) {
  const serie = lab?.serie ?? [];
  const valores = serie.map((p) => num(p.valor)).filter((n): n is number => n != null);
  const ultimo = serie[serie.length - 1];
  const c = classificarLabSync(lab?.nome ?? "", ultimo?.valor ?? "", sexo, idade);
  const fora = c.status === "alto" || c.status === "baixo";
  // Linha vermelha se alterado (último fora), azul se normal (BUG 2).
  const cor = fora ? VERMELHO : AZUL;
  return (
    <Modal visible={!!lab} transparent animationType="slide" onRequestClose={onFechar}>
      <View style={styles.modalFundo}>
        <View style={styles.modalCaixa}>
          <View style={styles.modalTopo}>
            <Text style={styles.modalTitulo}>{lab ? abreviarLab(lab.nome) : ""}</Text>
            <TouchableOpacity onPress={onFechar} hitSlop={8}>
              <Ionicons name="close" size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <GraficoLinha linhas={[{ valores, cor }]} largura={largura} altura={130} espessura={2} pontos />
          {valores.length < 2 && (
            <Text style={styles.insuf}>dados insuficientes para tendência</Text>
          )}
          <ScrollView style={{ maxHeight: 240, marginTop: 12 }}>
            {[...serie].reverse().map((p, i) => {
              const cc = classificarLabSync(lab?.nome ?? "", p.valor, sexo, idade);
              return (
                <View key={i} style={styles.labHistLinha}>
                  <Text style={styles.labHistData}>{rotuloCurto(p.data)}</Text>
                  <Text style={[styles.labHistValor, { color: cc.cor }]}>
                    {num(p.valor) ?? p.valor}
                    {cc.seta !== "→" ? ` ${cc.seta}` : ""}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function TimelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { getPaciente } = usePacientes();
  const paciente = getPaciente(id);
  const sexo = paciente?.sexo ?? undefined;
  const idade = paciente?.idade ?? undefined;

  const [dias, setDias] = useState(7);
  const [refsOk, setRefsOk] = useState(false);
  const [labSel, setLabSel] = useState<LabSelecionado | null>(null);

  // Carrega as referências ABIM (cache global) uma vez.
  useEffect(() => {
    carregarReferencias().finally(() => setRefsOk(true));
  }, []);

  const larguraGrafico = width - 64; // padding da tela (16) + do card (16) dos dois lados

  // BUG 4: a fonte dos gráficos é o histórico POR DATA do próprio paciente
  // (sinaisVitais + resultadosLab), que tem todos os valores por dia — e não os
  // snapshots esparsos. Janela = últimos N dias (aba).
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (dias - 1));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [dias]);

  // Sinais vitais por data (ASC) dentro da janela.
  const svDias = useMemo(
    () =>
      Object.entries(paciente?.sinaisVitais ?? {})
        .filter(([d]) => d.slice(0, 10) >= cutoff)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([data, sv]) => ({ data, sv })),
    [paciente?.sinaisVitais, cutoff],
  );

  const vitais = useMemo(() => {
    const serie = (fn: (s: SinaisVitaisDia) => string | null | undefined): SerieVital => {
      const valores = svDias.map(({ sv }) => num(fn(sv))).filter((n): n is number => n != null);
      let ultimo: string | null = null;
      for (let i = svDias.length - 1; i >= 0; i--) {
        const x = fn(svDias[i].sv);
        if (x != null && String(x).trim()) {
          ultimo = String(x).trim();
          break;
        }
      }
      return { valores, ultimo };
    };
    const sist = svDias.map(({ sv }) => num(sv?.paSist)).filter((n): n is number => n != null);
    const diast = svDias.map(({ sv }) => num(sv?.paDiast)).filter((n): n is number => n != null);
    let paUltimo: string | null = null;
    for (let i = svDias.length - 1; i >= 0; i--) {
      const s = svDias[i].sv;
      if (s?.paSist?.trim() && s?.paDiast?.trim()) {
        paUltimo = `${s.paSist.trim()}/${s.paDiast.trim()}`;
        break;
      }
    }
    const outros: Record<string, SerieVital> = {
      fc: serie((s) => s?.fc),
      temp: serie((s) => s?.temp),
      sato2: serie((s) => s?.sato2),
      fr: serie((s) => s?.fr),
    };
    return { pa: { sist, diast, ultimo: paUltimo }, outros };
  }, [svDias]);

  // Labs por exame (ASC) dentro da janela, agrupados por tipo na ordem canônica.
  const gruposLab = useMemo(() => {
    const janela = (paciente?.resultadosLab ?? [])
      .filter((r) => String(r.valor ?? "").trim() && r.data.slice(0, 10) >= cutoff)
      .sort((a, b) => a.data.localeCompare(b.data));
    const mapa = new Map<string, { data: string; valor: string }[]>();
    const nomeCanonico = new Map<string, string>();
    for (const r of janela) {
      const chave = abreviarLab(r.exame);
      if (!nomeCanonico.has(chave)) nomeCanonico.set(chave, r.exame);
      const arr = mapa.get(chave) ?? [];
      arr.push({ data: r.data, valor: String(r.valor) });
      mapa.set(chave, arr);
    }
    const porGrupo = new Map<string, { chave: string; nome: string; serie: { data: string; valor: string }[] }[]>();
    for (const [chave, serie] of mapa) {
      const nome = nomeCanonico.get(chave) || chave;
      const g = grupoLab(nome);
      const lista = porGrupo.get(g) ?? [];
      lista.push({ chave, nome, serie });
      porGrupo.set(g, lista);
    }
    return GRUPOS_LAB.filter((g) => porGrupo.has(g)).map((g) => ({
      grupo: g,
      labs: (porGrupo.get(g) || []).sort(
        (a, b) => ordemLab(a.chave) - ordemLab(b.chave) || a.chave.localeCompare(b.chave),
      ),
    }));
  }, [paciente?.resultadosLab, cutoff]);

  const vitaisComDados = VITAIS.filter((cfg) =>
    cfg.key === "pa"
      ? vitais.pa.sist.length > 0 || vitais.pa.diast.length > 0
      : (vitais.outros[cfg.key]?.valores.length ?? 0) > 0,
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topo, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.voltar} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={C.primary} />
          <Text style={styles.voltarTxt}>Voltar</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>Evolução</Text>
        <Text style={styles.sub}>{formatarNome(paciente?.nomeCompleto || "")}</Text>
        <View style={styles.periodo}>
          {[7, 14, 30].map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.pill, dias === d && styles.pillAtivo]}
              onPress={() => setDias(d)}
            >
              <Text style={[styles.pillTxt, dias === d && styles.pillTxtAtivo]}>{d}D</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}>
        {!refsOk ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : vitaisComDados.length === 0 && gruposLab.length === 0 ? (
          <Text style={styles.vazio}>
            Sem sinais vitais ou labs registrados nos últimos {dias} dias.
          </Text>
        ) : (
          <>
            {/* SEÇÃO 1 — SINAIS VITAIS */}
            {vitaisComDados.length > 0 && (
              <View style={styles.secao}>
                <Text style={styles.secaoLabel}>Sinais Vitais</Text>
                {vitaisComDados.map((cfg) => (
                  <CardVital
                    key={cfg.key}
                    cfg={cfg}
                    pa={cfg.key === "pa" ? vitais.pa : undefined}
                    serie={cfg.key === "pa" ? undefined : vitais.outros[cfg.key]}
                    largura={larguraGrafico}
                  />
                ))}
              </View>
            )}

            {/* SEÇÃO 2 — LABS */}
            {gruposLab.length > 0 && (
              <View style={styles.secao}>
                <Text style={styles.secaoLabel}>Labs</Text>
                {gruposLab.map(({ grupo, labs }) => (
                  <View key={grupo} style={styles.grupoCard}>
                    <Text style={styles.grupoLabel}>{grupo}</Text>
                    {labs.map(({ chave, nome, serie }) => (
                      <LinhaLab
                        key={chave}
                        nome={nome}
                        serie={serie}
                        sexo={sexo}
                        idade={idade}
                        onAbrir={() => setLabSel({ nome, serie })}
                      />
                    ))}
                  </View>
                ))}
                <Text style={styles.disclaimer}>{DISCLAIMER_ABIM}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <ModalLab
        lab={labSel}
        sexo={sexo}
        idade={idade}
        largura={larguraGrafico}
        onFechar={() => setLabSel(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topo: { paddingHorizontal: 16, paddingBottom: 10 },
  voltar: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  voltarTxt: { color: C.primary, fontSize: 17 },
  titulo: { fontSize: 28, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: C.textMuted, marginTop: 2 },
  periodo: { flexDirection: "row", gap: 8, marginTop: 12 },
  pill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: Radius.pill, backgroundColor: "#F2F2F7" },
  pillAtivo: { backgroundColor: C.primary },
  pillTxt: { fontSize: 14, fontWeight: "600", color: C.textMuted },
  pillTxtAtivo: { color: "#fff" },
  vazio: { color: C.textMuted, fontSize: 15, textAlign: "center", marginTop: 40, lineHeight: 22, paddingHorizontal: 16 },

  secao: { marginBottom: 16 },
  secaoLabel: {
    fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 10,
  },

  // Sinais vitais
  vitalCard: { backgroundColor: C.surface, borderRadius: Radius.card, padding: 16, marginBottom: 8 },
  vitalTopo: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
  vitalLabel: { fontSize: 14, fontWeight: "600", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  vitalValor: { fontSize: 22, fontWeight: "700", color: C.text },
  vitalUnidade: { fontSize: 13, fontWeight: "500", color: C.textMuted },

  // Labs
  grupoCard: { backgroundColor: C.surface, borderRadius: Radius.card, padding: 12, marginBottom: 8 },
  grupoLabel: {
    fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 6,
  },
  labRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  labNome: { width: 72, fontSize: 14.5, fontWeight: "600", color: C.text },
  labValor: { flex: 1, fontSize: 14.5, fontWeight: "700", color: C.text },
  labHist: { marginTop: 10, gap: 2 },
  labHistLinha: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 4, borderTopWidth: 0.5, borderTopColor: C.border,
  },
  labHistData: { fontSize: 13, color: C.textMuted },
  labHistValor: { fontSize: 14, fontWeight: "600", color: C.text },

  disclaimer: { fontSize: 11, color: C.textMuted, fontStyle: "italic", marginTop: 4 },
  insuf: { fontSize: 11, color: C.textMuted, fontStyle: "italic", marginTop: 6 },

  // BUG 2: modal do lab (gráfico completo + tabela por data).
  modalFundo: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCaixa: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: 20,
    paddingBottom: 32,
  },
  modalTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitulo: { fontSize: 18, fontWeight: "700", color: C.text },
});
