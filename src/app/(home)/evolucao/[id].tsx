import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ClinicalColors, Radius } from "@/constants/clinicalTheme";
import { diaDeInternacao, hojeISO } from "@/lib/datas";
import { formatarNome } from "@/lib/formatarNome";
import { montarTextoEvolucao } from "@/lib/gerarEvolucao";
import { salvarEvolucao } from "@/lib/salvarEvolucao";
import { usePacientes } from "@/store/PacientesContext";
import { type Paciente } from "@/types/paciente";

type SalvamentoStatus = "ocioso" | "salvando" | "salvo" | "erro";

/** Linha de identificação: "Nome · Idade anos · Leito X · D{dia}". */
function identificacaoLinha(p: Paciente): string {
  const dia = diaDeInternacao(p.dataEntrada);
  return [
    formatarNome(p.nomeCompleto) || "Sem nome",
    p.idade != null ? `${p.idade} anos` : null,
    p.leito ? `Leito ${p.leito}` : null,
    dia != null ? `D${dia}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function Evolucao() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { carregado, getPaciente } = usePacientes();
  const paciente = getPaciente(id);

  const [texto, setTexto] = useState("");
  const [gerando, setGerando] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [salvamento, setSalvamento] = useState<SalvamentoStatus>("ocioso");

  // Salva a evolução no backend (best-effort) com o medicoId fixo + data de hoje.
  const persistir = async (textoFinal: string) => {
    if (!paciente || !textoFinal.trim()) return;
    setSalvamento("salvando");
    const ok = await salvarEvolucao({
      pacienteId: paciente.id,
      nome: paciente.nomeCompleto,
      texto: textoFinal,
    });
    setSalvamento(ok ? "salvo" : "erro");
  };

  const gerar = () => {
    if (!paciente) return;
    setGerando(true);
    // Texto determinístico no formato exato — sem passar pela IA (que reformata).
    const base = montarTextoEvolucao(paciente, hojeISO());
    setTexto(base);
    setGerando(false);
    persistir(base);
  };

  // Gera uma vez ao abrir (quando o paciente já carregou).
  useEffect(() => {
    if (paciente) gerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregado, id]);

  const copiar = async () => {
    await Clipboard.setStringAsync(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
    // Persiste a versão atual (capturando edições manuais antes de copiar).
    persistir(texto);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.voltar} onPress={() => router.back()}>
        <Text style={styles.voltarTexto}>← Voltar</Text>
      </TouchableOpacity>

      <Text style={styles.titulo}>Passar o Caso</Text>
      <Text style={styles.subtitulo}>
        {paciente
          ? identificacaoLinha(paciente)
          : carregado
            ? "Paciente não encontrado"
            : "Carregando..."}
      </Text>

      {gerando && (
        <View style={styles.statusLinha}>
          <ActivityIndicator color={ClinicalColors.primary} />
          <Text style={styles.statusTexto}>Montando o caso...</Text>
        </View>
      )}

      <TextInput
        style={styles.editor}
        value={texto}
        multiline
        editable={false}
        placeholder="O texto da passagem de caso aparecerá aqui."
        placeholderTextColor={ClinicalColors.textMuted}
        textAlignVertical="top"
      />

      <View style={styles.rodapeInfo}>
        <Text style={styles.aviso}>
          Revise o texto antes de copiar. Gerado a partir dos dados do paciente.
        </Text>
        {salvamento !== "ocioso" && (
          <Text style={styles.salvoStatus}>
            {salvamento === "salvando"
              ? "Salvando…"
              : salvamento === "salvo"
                ? "✓ Salvo na nuvem"
                : "⚠️ Não salvo (offline)"}
          </Text>
        )}
      </View>

      <View style={styles.acoes}>
        <TouchableOpacity
          style={[styles.botao, styles.botaoSecundario]}
          onPress={gerar}
          disabled={gerando || !paciente}
        >
          <Text style={styles.botaoSecundarioTexto}>↻ Gerar de novo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.botao, styles.botaoPrimario]}
          onPress={copiar}
          disabled={gerando || !texto}
        >
          <Text style={styles.botaoPrimarioTexto}>
            {copiado ? "✓ Copiado!" : "📋 Copiar"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ClinicalColors.background,
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  voltar: { marginBottom: 12 },
  voltarTexto: { color: ClinicalColors.primary, fontSize: 16 },
  titulo: { fontSize: 24, fontWeight: "bold", color: ClinicalColors.text },
  subtitulo: {
    fontSize: 14,
    color: ClinicalColors.textMuted,
    marginTop: 2,
    marginBottom: 12,
  },
  statusLinha: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  statusTexto: { color: ClinicalColors.textMuted, fontSize: 14 },
  editor: {
    flex: 1,
    backgroundColor: ClinicalColors.surface,
    borderColor: ClinicalColors.border,
    borderWidth: 0.5,
    borderRadius: Radius.card,
    padding: 14,
    color: ClinicalColors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  rodapeInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10,
    marginBottom: 12,
  },
  aviso: {
    flex: 1,
    color: ClinicalColors.textMuted,
    fontSize: 12,
  },
  salvoStatus: {
    color: ClinicalColors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  acoes: { flexDirection: "row", gap: 12 },
  botao: {
    flex: 1,
    borderRadius: Radius.card,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 0.5,
  },
  botaoSecundario: {
    backgroundColor: "transparent",
    borderColor: ClinicalColors.primary,
  },
  botaoSecundarioTexto: {
    color: ClinicalColors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  botaoPrimario: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderColor: ClinicalColors.buttonPrimary,
  },
  botaoPrimarioTexto: {
    color: ClinicalColors.textOnPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
});
