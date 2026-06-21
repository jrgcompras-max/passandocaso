import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { diaDeInternacao, hojeISO } from "@/lib/datas";
import { calcularEscores } from "@/lib/escoresClinicos";
import { formatarNome } from "@/lib/formatarNome";
import { type CasoData, montarCaso } from "@/lib/passarCaso";
import { useAuth } from "@/store/AuthContext";
import { usePacientes } from "@/store/PacientesContext";
import { type Paciente } from "@/types/paciente";

/** "Nome abreviado · Idade · Leito · D+". */
function subtitulo(p: Paciente): string {
  const dia = diaDeInternacao(p.dataEntrada);
  return [
    formatarNome(p.nomeCompleto) || "Sem nome",
    p.idade != null ? `${p.idade}a` : null,
    p.leito ? `Leito ${p.leito}` : null,
    dia != null ? `D${dia}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Card branco com label de seção (só renderiza se houver conteúdo). */
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Bullets({ itens }: { itens: string[] }) {
  return (
    <>
      {itens.map((t, i) => (
        <View key={i} style={s.bulletLinha}>
          <Text style={s.bullet}>•</Text>
          <Text style={s.bulletTexto}>{t}</Text>
        </View>
      ))}
    </>
  );
}

function Chips({ itens }: { itens: string[] }) {
  return (
    <View style={s.chipsWrap}>
      {itens.map((t, i) => (
        <View key={i} style={s.chip}>
          <Text style={s.chipTexto}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PassarCaso() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { carregado, getPaciente } = usePacientes();
  const { usuario } = useAuth();
  const paciente = getPaciente(id);
  const escoresAtivado = usuario?.features_ativas?.escores !== false;
  const hoje = hojeISO();

  const caso: CasoData | null = useMemo(
    () => (paciente ? montarCaso(paciente, hoje) : null),
    [paciente, hoje],
  );
  const escores = useMemo(
    () => (paciente && escoresAtivado ? calcularEscores(paciente, hoje).filter((e) => e.calculavel) : []),
    [paciente, hoje, escoresAtivado],
  );

  return (
    <View style={s.container}>
      <View style={[s.topo, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={s.voltar} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={C.primary} />
          <Text style={s.voltarTxt}>Voltar</Text>
        </TouchableOpacity>
        <Text style={s.titulo}>Passar o Caso</Text>
        <Text style={s.sub}>{paciente ? subtitulo(paciente) : carregado ? "Paciente não encontrado" : "Carregando…"}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {!caso ? null : (
          <>
            {!!caso.hda && (
              <Card label="HDA">
                <Text style={s.hdaTexto}>{caso.hda}</Text>
              </Card>
            )}

            {caso.atual.length > 0 && (
              <Card label="Atual">
                <Bullets itens={caso.atual} />
              </Card>
            )}

            {caso.comorbidades.length > 0 && (
              <Card label="Comorbidades">
                <Chips itens={caso.comorbidades} />
              </Card>
            )}

            {caso.muc.length > 0 && (
              <Card label="MUC">
                <Chips itens={caso.muc} />
              </Card>
            )}

            {caso.ssvvAlterados.length > 0 && (
              <Card label="Sinais vitais alterados">
                <View style={s.chipsWrap}>
                  {caso.ssvvAlterados.map((v, i) => (
                    <View key={i} style={s.ssvvBadge}>
                      <Text style={s.ssvvBadgeTxt}>
                        {v.label} {v.valor}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {caso.exameFisico.length > 0 && (
              <Card label="Exame físico">
                {caso.exameFisico.map((sec) => (
                  <View key={sec.label} style={s.exameSecao}>
                    <Text style={s.exameSecaoLabel}>{sec.label}</Text>
                    <Chips itens={sec.itens} />
                  </View>
                ))}
              </Card>
            )}

            {caso.labsAlterados.length > 0 && (
              <Card label="Labs alterados">
                {caso.labsAlterados.map((l, i) => (
                  <View key={i} style={s.labLinha}>
                    <Text style={s.labNome}>{l.exame}</Text>
                    <Text style={[s.labValor, { color: l.seta === "alta" ? "#A32D2D" : "#1A6B8A" }]}>
                      {l.valor} {l.seta === "alta" ? "↑" : "↓"}
                    </Text>
                  </View>
                ))}
              </Card>
            )}

            {caso.antibioticos.length > 0 && (
              <Card label="Antibióticos">
                {caso.antibioticos.map((a, i) => (
                  <View key={i} style={s.atbLinha}>
                    <View style={s.atbBadge}>
                      <Text style={s.atbBadgeTxt}>ATB</Text>
                    </View>
                    <Text style={s.atbNome}>{a}</Text>
                  </View>
                ))}
              </Card>
            )}

            {caso.avaliacao.length > 0 && (
              <Card label="Avaliação">
                <Bullets itens={caso.avaliacao} />
              </Card>
            )}

            {caso.conduta.length > 0 && (
              <Card label="Conduta proposta">
                {caso.conduta.map((c, i) => (
                  <View key={i} style={s.bulletLinha}>
                    <Text style={s.numero}>{i + 1}.</Text>
                    <Text style={s.bulletTexto}>{c}</Text>
                  </View>
                ))}
              </Card>
            )}

            {escores.length > 0 && (
              <Card label="Escores">
                {escores.map((e) => (
                  <View key={e.id} style={s.labLinha}>
                    <Text style={s.labNome}>{e.sigla}</Text>
                    <Text style={s.escoreValor}>
                      {e.pontos}/{e.maxPontos} · {e.classificacao.split(" · ")[0]}
                    </Text>
                  </View>
                ))}
                <Text style={s.disclaimer}>
                  Escore calculado com base nos dados inseridos. Não substitui avaliação clínica.
                </Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topo: { paddingHorizontal: 16, paddingBottom: 10 },
  voltar: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  voltarTxt: { color: C.primary, fontSize: 17 },
  titulo: { fontSize: 26, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: C.textMuted, marginTop: 2 },

  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: Radius.card,
    padding: 12,
    marginBottom: 6,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  hdaTexto: { fontSize: 15, color: C.text, lineHeight: 21 },
  bulletLinha: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
  bullet: { color: C.primary, fontSize: 15, lineHeight: 21 },
  numero: { color: C.primary, fontSize: 14, fontWeight: "700", lineHeight: 21, minWidth: 18 },
  bulletTexto: { flex: 1, fontSize: 15, color: C.text, lineHeight: 21 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.background, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  chipTexto: { fontSize: 13, color: C.text },
  ssvvBadge: { backgroundColor: "#FCEBEB", borderRadius: Radius.badge, paddingHorizontal: 10, paddingVertical: 5 },
  ssvvBadgeTxt: { color: "#A32D2D", fontSize: 13, fontWeight: "600" },
  exameSecao: { marginBottom: 8 },
  exameSecaoLabel: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary, marginBottom: 5 },
  labLinha: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  labNome: { fontSize: 14, color: C.text, flex: 1 },
  labValor: { fontSize: 14, fontWeight: "700" },
  escoreValor: { fontSize: 13, fontWeight: "600", color: C.text },
  atbLinha: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  atbBadge: { backgroundColor: "#FFEDE6", borderRadius: Radius.badge, paddingHorizontal: 7, paddingVertical: 2 },
  atbBadgeTxt: { color: "#C2410C", fontSize: 11, fontWeight: "800" },
  atbNome: { flex: 1, fontSize: 14, color: C.text },
  disclaimer: { fontSize: 11, color: C.textMuted, fontStyle: "italic", marginTop: 8 },
});
