import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { formatarNome } from "@/lib/formatarNome";
import { abreviarLab } from "@/lib/lab";
import {
  listarEvolucaoDiaria,
  type RegistroDiario,
} from "@/lib/salvarEvolucaoDiaria";
import { usePacientes } from "@/store/PacientesContext";

const DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// Labs onde a queda é ruim (subir = vermelho): default. Invertidos: queda ruim.
const INVERTIDOS = /^(hb|hemoglob|ht|hematocr|plaq)/i;

function partes(data: string) {
  // O backend serializa a coluna DATE como ISO com horário (ex.:
  // "2026-06-20T00:00:00.000Z"). Pegamos só "YYYY-MM-DD" (10 primeiros chars) e
  // construímos a data no fuso LOCAL — evita "NaN"/"undefined" e o off-by-one de
  // UTC (data aparecendo um dia antes).
  const [y, m, d] = String(data ?? "").slice(0, 10).split("-").map(Number);
  return { y, m, d, dt: new Date(y, m - 1, d) };
}
function rotuloData(data: string) {
  const { d, m, dt } = partes(data);
  return `${DIAS_SEM[dt.getDay()]}, ${d} ${MESES[m - 1]}`;
}
function diaInternacao(dataEntrada: string | undefined, data: string) {
  if (!dataEntrada) return null;
  const e = partes(dataEntrada).dt.getTime();
  const r = partes(data).dt.getTime();
  if (isNaN(e) || isNaN(r)) return null;
  return Math.floor((r - e) / 86_400_000) + 1;
}
function num(v: unknown): number | null {
  const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Seta de tendência de um lab comparando com o valor do dia anterior. */
function seta(exame: string, atual: string, anterior?: string) {
  const a = num(atual);
  const p = num(anterior);
  if (a == null || p == null) return null;
  const delta = a - p;
  if (Math.abs(delta) < Math.abs(p) * 0.1) return { icone: "→", cor: C.textMuted };
  const subiu = delta > 0;
  const invertido = INVERTIDOS.test(exame);
  // bom = verde, ruim = vermelho
  const ruim = invertido ? !subiu : subiu;
  return { icone: subiu ? "↑" : "↓", cor: ruim ? "#FF3B30" : "#34C759" };
}

const O2_ROTULO: Record<string, string> = {
  ar: "Ar ambiente",
  cateter: "Cateter",
  mascara: "Máscara",
  vm: "VM",
};

/** Linhas variável→valor dos sinais vitais (com unidades; omite vazios). */
function ssvvRows(sv: RegistroDiario["sinais_vitais"]): { label: string; valor: string }[] {
  if (!sv) return [];
  const v = (s?: string | null) => String(s ?? "").trim();
  const linhas: { label: string; valor: string }[] = [];
  if (v(sv.paSist) && v(sv.paDiast)) linhas.push({ label: "PA", valor: `${v(sv.paSist)}/${v(sv.paDiast)} mmHg` });
  if (v(sv.fc)) linhas.push({ label: "FC", valor: `${v(sv.fc)} bpm` });
  if (v(sv.fr)) linhas.push({ label: "FR", valor: `${v(sv.fr)} irpm` });
  if (v(sv.sato2)) {
    const modo = sv.o2 ? O2_ROTULO[String(sv.o2)] : "";
    linhas.push({ label: "SatO₂", valor: `${v(sv.sato2)}%${modo ? ` (${modo})` : ""}` });
  } else if (sv.o2 && O2_ROTULO[String(sv.o2)]) {
    linhas.push({ label: "O₂", valor: O2_ROTULO[String(sv.o2)] });
  }
  if (v(sv.temp)) linhas.push({ label: "Tax", valor: `${v(sv.temp)}°C` });
  if (v(sv.glicemia)) linhas.push({ label: "Glicemia", valor: `${v(sv.glicemia)} mg/dL` });
  if (v(sv.diurese)) linhas.push({ label: "Diurese", valor: `${v(sv.diurese)} mL/24h` });
  return linhas;
}

/** Mini sparkline com Views (sem dependência nativa). */
function Sparkline({ titulo, valores, unidade }: { titulo: string; valores: number[]; unidade?: string }) {
  if (valores.length < 2) return null;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amp = max - min || 1;
  const ult = valores[valores.length - 1];
  return (
    <View style={styles.spark}>
      <Text style={styles.sparkTitulo}>{titulo}</Text>
      <View style={styles.sparkBarras}>
        {valores.slice(-10).map((v, i) => (
          <View
            key={i}
            style={[styles.sparkBarra, { height: 6 + ((v - min) / amp) * 26 }]}
          />
        ))}
      </View>
      <Text style={styles.sparkValor}>
        {ult}
        {unidade || ""}
      </Text>
    </View>
  );
}

export default function TimelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getPaciente } = usePacientes();
  const paciente = getPaciente(id);

  const [dias, setDias] = useState(7);
  const [registros, setRegistros] = useState<RegistroDiario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    listarEvolucaoDiaria(id, dias).then((r) => {
      if (vivo) {
        setRegistros(r);
        setCarregando(false);
      }
    });
    return () => {
      vivo = false;
    };
  }, [id, dias]);

  // Séries ASC para os sparklines.
  const series = useMemo(() => {
    const asc = [...registros].reverse();
    const colher = (fn: (r: RegistroDiario) => unknown) =>
      asc.map((r) => num(fn(r))).filter((n): n is number => n != null);
    const lab = (nome: RegExp) =>
      asc
        .map((r) => {
          const labs = r.exames_laboratoriais || {};
          const k = Object.keys(labs).find((x) => nome.test(x));
          return k ? num(labs[k]) : null;
        })
        .filter((n): n is number => n != null);
    return {
      pa: colher((r) => r.sinais_vitais?.paSist),
      fc: colher((r) => r.sinais_vitais?.fc),
      sato2: colher((r) => r.sinais_vitais?.sato2),
      pcr: lab(/pcr|prote[íi]na c/i),
      cr: lab(/^cr|creatin/i),
    };
  }, [registros]);

  // Cards de dia, com placeholders para até 2 dias vazios entre registros.
  const itens = useMemo(() => {
    const out: any[] = [];
    for (let i = 0; i < registros.length; i++) {
      out.push({ tipo: "dia", reg: registros[i], ant: registros[i + 1] });
      const prox = registros[i + 1];
      if (prox) {
        const diff = Math.round(
          (partes(registros[i].data).dt.getTime() - partes(prox.data).dt.getTime()) / 86_400_000,
        );
        const faltam = diff - 1;
        if (faltam >= 1 && faltam <= 2) {
          for (let k = 1; k <= faltam; k++) {
            const t = new Date(partes(registros[i].data).dt.getTime() - k * 86_400_000);
            const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
            out.push({ tipo: "vazio", data: ds });
          }
        }
      }
    }
    return out;
  }, [registros]);

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

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {carregando ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : registros.length === 0 ? (
          <Text style={styles.vazio}>
            Ainda não há registros. O histórico começa a partir do próximo
            &quot;Passar o Caso&quot;.
          </Text>
        ) : (
          <>
            {/* Tendências (sparklines) */}
            {(series.pa.length > 1 ||
              series.fc.length > 1 ||
              series.sato2.length > 1 ||
              series.pcr.length > 1 ||
              series.cr.length > 1) && (
              <View style={styles.sparkCard}>
                <Text style={styles.secaoLabel}>Tendências</Text>
                <View style={styles.sparkRow}>
                  <Sparkline titulo="PA sist" valores={series.pa} />
                  <Sparkline titulo="FC" valores={series.fc} />
                  <Sparkline titulo="SatO₂" valores={series.sato2} unidade="%" />
                  <Sparkline titulo="PCR" valores={series.pcr} />
                  <Sparkline titulo="Creat" valores={series.cr} />
                </View>
              </View>
            )}

            {itens.map((it, idx) =>
              it.tipo === "vazio" ? (
                <View key={`v-${it.data}-${idx}`} style={styles.vazioDia}>
                  <Text style={styles.vazioDiaTxt}>{rotuloData(it.data)} · sem registro</Text>
                </View>
              ) : (
                <CardDia
                  key={it.reg.data}
                  reg={it.reg}
                  ant={it.ant}
                  dia={diaInternacao(paciente?.dataEntrada, it.reg.data)}
                  expandido={aberto === it.reg.data}
                  onToggle={() => setAberto(aberto === it.reg.data ? null : it.reg.data)}
                />
              ),
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CardDia({
  reg,
  ant,
  dia,
  expandido,
  onToggle,
}: {
  reg: RegistroDiario;
  ant?: RegistroDiario;
  dia: number | null;
  expandido: boolean;
  onToggle: () => void;
}) {
  const labs = reg.exames_laboratoriais || {};
  const labsAnt = ant?.exames_laboratoriais || {};
  const labEntries = Object.entries(labs);
  const ssvv = ssvvRows(reg.sinais_vitais);

  return (
    <TouchableOpacity style={styles.card} onPress={onToggle} activeOpacity={0.7}>
      <Text style={styles.cardData}>
        {rotuloData(reg.data)}
        {dia != null ? ` · Dia ${dia} de internação` : ""}
      </Text>

      {ssvv.length > 0 && (
        <>
          <View style={styles.sep} />
          <View style={styles.linhaLabel}>
            <Text style={styles.miniLabel}>SSVV</Text>
            <View style={styles.ssvvLista}>
              {ssvv.map((l) => (
                <View key={l.label} style={styles.ssvvRow}>
                  <Text style={styles.ssvvRowLabel}>{l.label}</Text>
                  <Text style={styles.ssvvRowValor}>{l.valor}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}

      {labEntries.length > 0 && (
        <>
          <View style={styles.sep} />
          <View style={styles.linhaLabel}>
            <Text style={styles.miniLabel}>Labs</Text>
            <View style={styles.labsWrap}>
              {(expandido ? labEntries : labEntries.slice(0, 4)).map(([k, v]) => {
                const s = seta(k, v, labsAnt[k]);
                return (
                  <Text key={k} style={styles.labItem}>
                    {abreviarLab(k)} {v}
                    {s ? <Text style={{ color: s.cor }}> {s.icone}</Text> : null}
                  </Text>
                );
              })}
            </View>
          </View>
        </>
      )}

      {!!reg.conduta && (
        <>
          <View style={styles.sep} />
          <View style={styles.linhaLabel}>
            <Text style={styles.miniLabel}>Conduta</Text>
            <Text style={styles.linhaTexto} numberOfLines={expandido ? undefined : 2}>
              {reg.conduta}
            </Text>
          </View>
        </>
      )}

      {expandido && (
        <>
          {!!reg.evolucao_beira_leito?.estadoGeralExame && (
            <DetalheExp label="Exame" texto={reg.evolucao_beira_leito.estadoGeralExame} />
          )}
          {!!reg.exames_imagem && <DetalheExp label="Imagem" texto={reg.exames_imagem} />}
          {!!(reg.problemas_ativos && reg.problemas_ativos.length) && (
            <DetalheExp label="Problemas" texto={reg.problemas_ativos.join(", ")} />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

function DetalheExp({ label, texto }: { label: string; texto: string }) {
  return (
    <>
      <View style={styles.sep} />
      <View style={styles.linhaLabel}>
        <Text style={styles.miniLabel}>{label}</Text>
        <Text style={styles.linhaTexto}>{texto}</Text>
      </View>
    </>
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
  secaoLabel: {
    fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 10,
  },
  sparkCard: { backgroundColor: C.surface, borderRadius: Radius.card, padding: 16, marginBottom: 12 },
  sparkRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  spark: { alignItems: "center", minWidth: 56 },
  sparkTitulo: { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  sparkBarras: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 32 },
  sparkBarra: { width: 4, borderRadius: 2, backgroundColor: C.primary },
  sparkValor: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: Radius.card, padding: 16, marginBottom: 8 },
  cardData: { fontSize: 15, fontWeight: "700", color: C.text },
  sep: { height: 0.5, backgroundColor: C.border, marginVertical: 10 },
  linhaLabel: { flexDirection: "row", gap: 10 },
  miniLabel: {
    width: 56, fontSize: 11, fontWeight: "600", color: C.textMuted,
    textTransform: "uppercase", letterSpacing: 0.5, paddingTop: 1,
  },
  linhaTexto: { flex: 1, fontSize: 14.5, color: C.textSecondary, lineHeight: 20 },
  ssvvLista: { flex: 1, gap: 2 },
  ssvvRow: { flexDirection: "row", alignItems: "baseline" },
  ssvvRowLabel: { width: 72, fontSize: 13, color: C.textMuted },
  ssvvRowValor: { flex: 1, fontSize: 14.5, fontWeight: "600", color: C.text },
  labsWrap: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  labItem: { fontSize: 14.5, color: C.textSecondary },
  vazioDia: {
    borderWidth: 1, borderColor: C.border, borderStyle: "dashed",
    borderRadius: Radius.card, paddingVertical: 10, alignItems: "center", marginBottom: 8,
  },
  vazioDiaTxt: { fontSize: 12, color: C.textMuted },
});
