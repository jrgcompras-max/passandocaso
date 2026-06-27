import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  ClinicalColors as C,
  Radius,
  StatusClinicoColors,
  StatusColors,
} from "@/constants/clinicalTheme";
import { formatarNome } from "@/lib/formatarNome";
import { type CasoData } from "@/lib/passarCaso";
import { type Paciente } from "@/types/paciente";

/** Chaves das seções acessíveis pela grade do hub. */
export type SecaoGrid =
  | "clinico"
  | "labs"
  | "imagem"
  | "prescricao"
  | "evolucao"
  | "beiraLeito";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Configuração da grade — ícone colorido + label por seção. A cor tem
 * significado de área clínica (não é decorativa); o fundo do card é sempre
 * branco, a cor fica só no ícone.
 */
export const GRID_SECOES: { key: SecaoGrid; label: string; icon: IconName; cor: string }[] = [
  { key: "clinico", label: "Clínico", icon: "medkit-outline", cor: "#007AFF" },
  { key: "labs", label: "Labs", icon: "flask-outline", cor: "#AF52DE" },
  { key: "imagem", label: "Imagem", icon: "scan-outline", cor: "#FF9500" },
  { key: "prescricao", label: "Prescrição", icon: "medical-outline", cor: "#FF6B6B" },
  { key: "evolucao", label: "Evolução", icon: "trending-up-outline", cor: "#34C759" },
  { key: "beiraLeito", label: "Beira-Leito", icon: "bed-outline", cor: "#0A4D68" },
];

/**
 * Tela hub da ficha do paciente: header compacto, card de resumo do dia, dois
 * botões de ação e a grade de acesso às seções. Reaproveita os dados do
 * "Passar o Caso" (montarCaso) para o resumo — labs e SSVV só os alterados.
 */
export function HubPaciente({
  paciente,
  caso,
  diaInternacao,
  registrosCount,
  ordemSecoes,
  destaques,
  onEditar,
  onAbrirSecao,
  onEvolucaoMedica,
  onPassarCaso,
}: {
  paciente: Paciente;
  caso: CasoData;
  diaInternacao: number | null;
  /** Nº de registros na timeline (detalhe do card Evolução). */
  registrosCount?: number;
  /** Ordem das seções na grade (Fase 2 — aprendizado). Default: GRID_SECOES. */
  ordemSecoes?: SecaoGrid[];
  /** Seções em destaque (Fase 2 — 2 mais acessadas). */
  destaques?: SecaoGrid[];
  onEditar: () => void;
  onAbrirSecao: (key: SecaoGrid) => void;
  onEvolucaoMedica: () => void;
  onPassarCaso: () => void;
}) {
  const sc = paciente.statusClinico ? StatusClinicoColors[paciente.statusClinico] : null;
  const statusFluxo = StatusColors[paciente.status];
  const problemaPrincipal =
    (paciente.diagnosticoPrincipal || "").trim() || caso.atual[0] || "";

  const subtitulo = [
    paciente.idade != null ? `${paciente.idade} anos` : null,
    paciente.leito ? `Leito ${paciente.leito}` : null,
    diaInternacao != null ? `D${diaInternacao}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const ordem = ordemSecoes?.length
    ? ordemSecoes
        .map((k) => GRID_SECOES.find((g) => g.key === k))
        .filter((g): g is (typeof GRID_SECOES)[number] => !!g)
    : GRID_SECOES;
  const ehDestaque = (k: SecaoGrid) => !!destaques?.includes(k);

  // Detalhe sutil por card: transforma a grade de "menu" em resumo navegável.
  // `alerta` = vermelho (fora da referência); senão cinza. null = sem detalhe.
  const detalheSecao = (k: SecaoGrid): { texto: string; alerta?: boolean } | null => {
    const n = (qtd: number, sing: string, plur: string) =>
      `${qtd} ${qtd === 1 ? sing : plur}`;
    switch (k) {
      case "clinico": {
        const q = caso.atual.length;
        return q ? { texto: n(q, "problema", "problemas") } : null;
      }
      case "labs": {
        const q = caso.labsAlterados.length;
        return q ? { texto: n(q, "alterado", "alterados"), alerta: true } : null;
      }
      case "imagem": {
        const q = caso.imagem.length;
        return q ? { texto: n(q, "laudo", "laudos") } : null;
      }
      case "prescricao": {
        const q = paciente.medicamentos?.length ?? 0;
        return q ? { texto: `${q} med${q === 1 ? "" : "s"}` } : null;
      }
      case "evolucao": {
        const q = registrosCount ?? 0;
        return q ? { texto: n(q, "registro", "registros") } : null;
      }
      case "beiraLeito": {
        const q = caso.ssvvAlterados.length;
        return q ? { texto: `${q} SV alt.`, alerta: true } : null;
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* HEADER compacto */}
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.nome} numberOfLines={1}>
            {formatarNome(paciente.nomeCompleto) || "Sem nome"}
          </Text>
          {!!subtitulo && <Text style={styles.subtitulo}>{subtitulo}</Text>}
        </View>
        <View style={[styles.badge, { backgroundColor: statusFluxo.bg }]}>
          <Text style={[styles.badgeTxt, { color: statusFluxo.text }]}>
            {statusFluxo.label}
          </Text>
        </View>
        <TouchableOpacity onPress={onEditar} hitSlop={8} accessibilityLabel="Editar paciente">
          <Ionicons name="create-outline" size={26} color="#1A6B8A" />
        </TouchableOpacity>
      </View>

      {/* CARD DE RESUMO DO DIA */}
      <View style={styles.cardResumo}>
        {sc && (
          <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: sc.text }]} />
            <Text style={[styles.statusPillTxt, { color: sc.text }]}>{sc.label}</Text>
          </View>
        )}

        {!!problemaPrincipal && (
          <Text style={styles.problema}>{problemaPrincipal}</Text>
        )}

        {caso.antibioticos.length > 0 && (
          <View style={styles.atbRow}>
            {caso.antibioticos.map((a, i) => (
              <View key={`${a}-${i}`} style={styles.atbBadge}>
                <Text style={styles.atbTag}>ATB</Text>
                <Text style={styles.atbNome} numberOfLines={1}>{a}</Text>
              </View>
            ))}
          </View>
        )}

        {caso.labsAlterados.length > 0 && (
          <View style={styles.linhasBox}>
            {caso.labsAlterados.map((l, i) => {
              const alto = l.seta === "alta";
              const cor = alto ? "#FF3B30" : "#007AFF";
              return (
                <View key={`${l.exame}-${i}`} style={styles.linha}>
                  <Text style={styles.linhaNome}>{l.exame}</Text>
                  <Text style={[styles.linhaValor, { color: cor }]}>
                    {l.valor} {alto ? "↑" : "↓"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {caso.ssvvAlterados.length > 0 && (
          <View style={styles.linhasBox}>
            {caso.ssvvAlterados.map((s, i) => (
              <View key={`${s.label}-${i}`} style={styles.linha}>
                <Text style={styles.linhaNome}>{s.label}</Text>
                <Text style={[styles.linhaValor, { color: "#FF3B30" }]}>{s.valor}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* GRADE DE SEÇÕES — 2 linhas que crescem para preencher a tela (cards
          ficam mais altos quando há espaço, em vez de deixar um buraco). */}
      <View style={styles.grid}>
        {[0, 1].map((linha) => (
          <View key={linha} style={styles.gridLinha}>
            {ordem.slice(linha * 3, linha * 3 + 3).map((g) => {
              const det = detalheSecao(g.key);
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.gridCard, ehDestaque(g.key) && styles.gridCardDestaque]}
                  activeOpacity={0.8}
                  onPress={() => onAbrirSecao(g.key)}
                >
                  <View style={[styles.gridIcone, { backgroundColor: g.cor + "1A" }]}>
                    <Ionicons name={g.icon} size={24} color={g.cor} />
                  </View>
                  <Text style={styles.gridLabel}>{g.label}</Text>
                  {det && (
                    <Text
                      style={[styles.gridDetalhe, det.alerta && styles.gridDetalheAlerta]}
                      numberOfLines={1}
                    >
                      {det.texto}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* BOTÕES DE AÇÃO (rodapé) */}
      <View style={styles.botoesRow}>
        <TouchableOpacity style={styles.botaoAcao} activeOpacity={0.85} onPress={onEvolucaoMedica}>
          <Ionicons name="document-text-outline" size={16} color="#0E7A5A" />
          <Text style={styles.botaoAcaoTxt}>Evolução Médica</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.botaoAcao} activeOpacity={0.85} onPress={onPassarCaso}>
          <Ionicons name="albums-outline" size={16} color="#0E7A5A" />
          <Text style={styles.botaoAcaoTxt}>Passar o Caso</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // flex:1 deixa o hub preencher a tela (o grid cresce; botões no rodapé).
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  headerInfo: { flex: 1 },
  nome: { fontSize: 24, fontWeight: "700", color: C.text, letterSpacing: -0.4 },
  subtitulo: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  badge: { borderRadius: Radius.badge, paddingHorizontal: 9, paddingVertical: 3 },
  badgeTxt: { fontSize: 12, fontWeight: "700" },

  cardResumo: {
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    borderWidth: 0.5,
    borderColor: C.border,
    padding: 14,
    gap: 10,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillTxt: { fontSize: 13, fontWeight: "700" },
  problema: { fontSize: 15, fontWeight: "600", color: C.text, lineHeight: 20 },

  atbRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  atbBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF0EE",
    borderRadius: Radius.pill,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 3,
    maxWidth: "100%",
  },
  atbTag: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    backgroundColor: "#FF6B6B",
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  atbNome: { fontSize: 13, fontWeight: "600", color: "#A3392E", flexShrink: 1 },

  linhasBox: { gap: 5 },
  linha: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linhaNome: { fontSize: 14, color: C.textSecondary },
  linhaValor: { fontSize: 14, fontWeight: "700" },

  botoesRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  botaoAcao: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#E5F7EE",
    borderRadius: Radius.card,
    paddingVertical: 13,
  },
  botaoAcaoTxt: { fontSize: 14, fontWeight: "700", color: "#0E7A5A" },

  grid: {
    flex: 1,
    gap: 8,
    marginTop: 12,
  },
  gridLinha: {
    flexDirection: "row",
    flex: 1,
    gap: 8,
  },
  gridCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: Radius.card,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  gridCardDestaque: { borderWidth: 1.2, borderColor: C.primary },
  gridIcone: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  gridLabel: { fontSize: 12.5, fontWeight: "600", color: C.text },
  gridDetalhe: { fontSize: 11, fontWeight: "600", color: C.textMuted },
  gridDetalheAlerta: { color: "#A3392E" },
});
