import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModalEspecialidade } from "@/components/ModalEspecialidade";
import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import {
  type ChipPessoal,
  fixarChip,
  listarPessoais,
  removerChip,
} from "@/lib/chips";
import * as rede from "@/lib/rede";
import { useAuth } from "@/store/AuthContext";

/** Rótulos das seções do exame físico (chips aprendidos). */
const SECAO_CHIP_LABEL: Record<string, string> = {
  estado_geral: "Estado geral",
  neurologico: "Neurológico",
  cardiovascular: "Cardiovascular",
  respiratorio: "Respiratório",
  abdominal: "Abdominal",
  membros: "Membros e extremidades",
  pele: "Pele e mucosas",
};

const CATEGORIA_LABEL: Record<string, string> = {
  medico: "Médico",
  residente: "Residente",
  estudante: "Estudante",
  enfermeiro: "Enfermeiro",
  outro: "Outro",
};
const CATEGORIA_COR: Record<string, { bg: string; fg: string }> = {
  medico: { bg: "#E5F0FF", fg: "#007AFF" },
  residente: { bg: "#E5F7EE", fg: "#34C759" },
  estudante: { bg: "#F3E5FF", fg: "#AF52DE" },
  enfermeiro: { bg: "#FFE5E5", fg: "#FF3B30" },
  outro: { bg: "#F2F2F7", fg: "#8E8E93" },
};

function iniciais(nome: string) {
  return (nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

export default function PerfilScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { usuario, sair, atualizarUsuario } = useAuth();

  const [nomeEx, setNomeEx] = useState(usuario?.nome_exibicao || usuario?.nome || "");
  const [esp, setEsp] = useState(usuario?.especialidade || "");
  const [subesp, setSubesp] = useState(usuario?.subespecialidade || "");
  const [crm, setCrm] = useState(usuario?.crm || "");
  const [anoRes, setAnoRes] = useState<number | null>(usuario?.ano_residencia ?? null);
  const [instituicao, setInstituicao] = useState(usuario?.instituicao_formacao || "");
  const [espModal, setEspModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [contagem, setContagem] = useState({ conexoes: 0, grupos: 0 });

  const categoria = usuario?.categoria || "medico";
  const cor = CATEGORIA_COR[categoria] || CATEGORIA_COR.outro;

  // Funcionalidades clínicas (toggles). Default ATIVADO (escores !== false).
  const escoresAtivado = usuario?.features_ativas?.escores !== false;
  const [salvandoFeature, setSalvandoFeature] = useState(false);

  // Chips do exame físico aprendidos (Feature 2): fixar / remover.
  const [chipsPessoais, setChipsPessoais] = useState<Record<string, ChipPessoal[]>>({});
  const recarregarChips = () => listarPessoais().then(setChipsPessoais);
  useEffect(() => {
    void recarregarChips();
  }, []);
  const removerChipPessoal = async (secao: string, texto: string) => {
    setChipsPessoais((m) => ({
      ...m,
      [secao]: (m[secao] || []).filter((c) => c.texto !== texto),
    }));
    await removerChip(secao, texto);
  };
  const fixarChipPessoal = async (secao: string, texto: string, fixado: boolean) => {
    setChipsPessoais((m) => ({
      ...m,
      [secao]: (m[secao] || []).map((c) => (c.texto === texto ? { ...c, fixado } : c)),
    }));
    await fixarChip(secao, texto, fixado);
  };
  const secoesComChips = Object.keys(chipsPessoais).filter(
    (s) => (chipsPessoais[s] || []).length > 0,
  );
  const alternarEscores = async (valor: boolean) => {
    if (salvandoFeature) return;
    setSalvandoFeature(true);
    const base = usuario?.features_ativas || {};
    atualizarUsuario({ features_ativas: { ...base, escores: valor } });
    try {
      await rede.atualizarFeatures({ escores: valor });
    } catch {
      atualizarUsuario({ features_ativas: { ...base, escores: !valor } });
      Alert.alert("Não foi possível salvar", "Verifique a conexão e tente novamente.");
    } finally {
      setSalvandoFeature(false);
    }
  };

  useEffect(() => {
    Promise.all([
      rede.listarConexoes().catch(() => []),
      rede.listarGrupos().catch(() => []),
    ]).then(([cx, gr]) => setContagem({ conexoes: cx.length, grupos: gr.length }));
  }, []);

  const salvar = async () => {
    const mudancas: Record<string, unknown> = {};
    const set = (chave: string, valor: any, original: any) => {
      if ((valor || "") !== (original || "")) mudancas[chave] = valor || null;
    };
    set("nome_exibicao", nomeEx.trim(), usuario?.nome_exibicao || usuario?.nome);
    set("especialidade", esp.trim(), usuario?.especialidade);
    set("subespecialidade", subesp.trim(), usuario?.subespecialidade);
    set("crm", crm.trim(), usuario?.crm);
    set("instituicao_formacao", instituicao.trim(), usuario?.instituicao_formacao);
    if ((anoRes ?? null) !== (usuario?.ano_residencia ?? null)) mudancas.ano_residencia = anoRes;
    if (Object.keys(mudancas).length === 0) {
      Alert.alert("Perfil", "Nada para salvar.");
      return;
    }
    setSalvando(true);
    try {
      await rede.atualizarPerfil(mudancas);
      atualizarUsuario(mudancas);
      Alert.alert("Perfil", "Alterações salvas.");
    } catch (e: any) {
      Alert.alert("Erro", e.message);
    } finally {
      setSalvando(false);
    }
  };

  // Badge de trial.
  let badge = { txt: "", bg: "#DBEAFE", fg: "#1E40AF" };
  if (usuario) {
    if (usuario.plano === "ativo") badge = { txt: "Assinante ativo", bg: "#DCFCE7", fg: "#166534" };
    else if (usuario.expirado) badge = { txt: "Trial expirado", bg: "#FEE2E2", fg: "#991B1B" };
    else {
      const d = usuario.diasRestantes ?? 0;
      const t = `${d} ${d === 1 ? "dia restante" : "dias restantes"}`;
      badge = d <= 7 ? { txt: t, bg: "#FEF3C7", fg: "#B45309" } : { txt: t, bg: "#DCFCE7", fg: "#166534" };
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topo}>
        <Text style={styles.titulo}>Perfil</Text>
        <TouchableOpacity onPress={salvar} disabled={salvando} hitSlop={8}>
          <Text style={styles.salvar}>{salvando ? "Salvando…" : "Salvar"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} keyboardShouldPersistTaps="handled">
        {/* IDENTIDADE */}
        <View style={styles.identidade}>
          <TouchableOpacity
            style={styles.avatar}
            onPress={() => Alert.alert("Foto de perfil", "Em breve: adicionar foto.")}
          >
            <Text style={styles.avatarTxt}>{iniciais(nomeEx)}</Text>
          </TouchableOpacity>
          <View style={[styles.catBadge, { backgroundColor: cor.bg }]}>
            <Text style={[styles.catBadgeTxt, { color: cor.fg }]}>
              {CATEGORIA_LABEL[categoria] || "Profissional"}
            </Text>
          </View>
        </View>

        <Text style={styles.secaoLabel}>Identidade</Text>
        <View style={styles.cardCampos}>
          <Campo rotulo="Nome de exibição" valor={nomeEx} onChange={setNomeEx} placeholder="Seu nome" />
          <View style={styles.sep} />
          <View style={styles.campoLeitura}>
            <Text style={styles.campoRotulo}>E-mail</Text>
            <Text style={styles.campoValorLeitura}>{usuario?.email}</Text>
          </View>
        </View>

        {/* DADOS PROFISSIONAIS */}
        <Text style={styles.secaoLabel}>Dados profissionais</Text>
        <View style={styles.cardCampos}>
          <TouchableOpacity style={styles.campoToque} onPress={() => setEspModal(true)}>
            <Text style={styles.campoRotulo}>Especialidade</Text>
            <View style={styles.campoToqueDir}>
              <Text style={[styles.campoValorLeitura, !esp && styles.placeholder]}>
                {esp || "Definir"}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={C.chevron} />
            </View>
          </TouchableOpacity>
          <View style={styles.sep} />
          <Campo rotulo="Subespecialidade" valor={subesp} onChange={setSubesp} placeholder="Opcional" />
          <View style={styles.sep} />
          <Campo rotulo="CRM" valor={crm} onChange={setCrm} placeholder="Opcional" autoCapitalize="characters" />
          {categoria === "residente" && (
            <>
              <View style={styles.sep} />
              <View style={styles.campoLeitura}>
                <Text style={styles.campoRotulo}>Ano de residência</Text>
                <View style={styles.anosRow}>
                  {[1, 2, 3].map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.anoChip, anoRes === a && styles.anoChipSel]}
                      onPress={() => setAnoRes(anoRes === a ? null : a)}
                    >
                      <Text style={[styles.anoChipTxt, anoRes === a && styles.anoChipTxtSel]}>{a}º</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          )}
          <View style={styles.sep} />
          <Campo
            rotulo="Instituição de formação"
            valor={instituicao}
            onChange={setInstituicao}
            placeholder="Opcional"
          />
        </View>

        {/* MINHA REDE */}
        <Text style={styles.secaoLabel}>Minha rede</Text>
        <TouchableOpacity style={styles.redeCard} onPress={() => router.navigate("/rede")}>
          <Ionicons name="people" size={24} color={C.primary} />
          <Text style={styles.redeTxt}>
            {contagem.conexoes} {contagem.conexoes === 1 ? "conexão" : "conexões"} ·{" "}
            {contagem.grupos} {contagem.grupos === 1 ? "grupo" : "grupos"}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={C.chevron} />
        </TouchableOpacity>

        {/* CONTA */}
        <Text style={styles.secaoLabel}>Conta</Text>
        <View style={styles.cardCampos}>
          <View style={styles.campoLeitura}>
            <Text style={styles.campoRotulo}>Assinatura</Text>
            {!!badge.txt && (
              <View style={[styles.trialBadge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.trialBadgeTxt, { color: badge.fg }]}>{badge.txt}</Text>
              </View>
            )}
          </View>
        </View>
        {/* FUNCIONALIDADES CLÍNICAS */}
        <Text style={styles.secaoLabel}>Funcionalidades clínicas</Text>
        <View style={styles.cardCampos}>
          <View style={styles.featureRow}>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitulo}>Escores clínicos</Text>
              <Text style={styles.featureSub}>
                Exibe CURB-65, SOFA, Child-Pugh e CHA₂DS₂-VASc na ficha do paciente.
              </Text>
            </View>
            <Switch
              value={escoresAtivado}
              onValueChange={alternarEscores}
              disabled={salvandoFeature}
              trackColor={{ true: C.accent, false: "#E5E5EA" }}
            />
          </View>
        </View>

        {/* CHIPS DO EXAME FÍSICO (aprendidos) */}
        {secoesComChips.length > 0 && (
          <>
            <Text style={styles.secaoLabel}>Chips do exame físico</Text>
            <View style={styles.cardCampos}>
              {secoesComChips.map((secao, idx) => (
                <View key={secao}>
                  {idx > 0 && <View style={styles.sep} />}
                  <View style={styles.chipSecaoBox}>
                    <Text style={styles.chipSecaoTitulo}>
                      {SECAO_CHIP_LABEL[secao] || secao}
                    </Text>
                    {(chipsPessoais[secao] || []).map((c) => (
                      <View key={c.texto} style={styles.chipLinha}>
                        <TouchableOpacity
                          onPress={() => fixarChipPessoal(secao, c.texto, !c.fixado)}
                          hitSlop={6}
                        >
                          <Ionicons
                            name={c.fixado ? "star" : "star-outline"}
                            size={18}
                            color={c.fixado ? "#FF9500" : C.textMuted}
                          />
                        </TouchableOpacity>
                        <Text style={styles.chipLinhaTxt}>{c.texto}</Text>
                        <TouchableOpacity
                          onPress={() => void removerChipPessoal(secao, c.texto)}
                          hitSlop={6}
                        >
                          <Ionicons name="trash-outline" size={17} color="#FF3B30" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <TouchableOpacity style={styles.sairBtn} onPress={() => void sair()}>
          <Text style={styles.sairTxt}>Sair da conta</Text>
        </TouchableOpacity>
      </ScrollView>

      <ModalEspecialidade
        visivel={espModal}
        titulo="Sua especialidade"
        rotuloPular="Cancelar"
        onConfirmar={(v) => { setEsp(v); setEspModal(false); }}
        onPular={() => setEspModal(false)}
      />
    </View>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  placeholder,
  autoCapitalize,
}: {
  rotulo: string;
  valor: string;
  onChange: (t: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
}) {
  return (
    <View style={styles.campoLeitura}>
      <Text style={styles.campoRotulo}>{rotulo}</Text>
      <TextInput
        style={styles.campoInput}
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.textMuted}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: 60, paddingHorizontal: 16 },
  topo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  titulo: { fontSize: 28, fontWeight: "700", color: C.text, letterSpacing: -0.5 },
  salvar: { color: C.primary, fontSize: 17, fontWeight: "600" },
  identidade: { alignItems: "center", marginBottom: 12 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  avatarTxt: { color: "#fff", fontSize: 26, fontWeight: "800" },
  catBadge: { borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  catBadgeTxt: { fontSize: 13, fontWeight: "700" },
  secaoLabel: {
    fontSize: 11, fontWeight: "600", color: C.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginTop: 20, marginBottom: 8, marginLeft: 4,
  },
  cardCampos: { backgroundColor: C.surface, borderRadius: Radius.card, paddingHorizontal: 14 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  featureInfo: { flex: 1, paddingRight: 12 },
  featureTitulo: { fontSize: 15, fontWeight: "600", color: C.text },
  featureSub: { fontSize: 12.5, color: C.textMuted, marginTop: 3, lineHeight: 17 },
  chipSecaoBox: { paddingVertical: 12 },
  chipSecaoTitulo: { fontSize: 13, fontWeight: "700", color: C.textMuted, marginBottom: 6 },
  chipLinha: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  chipLinhaTxt: { flex: 1, fontSize: 14, color: C.text },
  sep: { height: 0.5, backgroundColor: C.border },
  campoLeitura: { paddingVertical: 12 },
  campoToque: { paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  campoToqueDir: { flexDirection: "row", alignItems: "center", gap: 6 },
  campoRotulo: { fontSize: 12, color: C.textMuted, marginBottom: 4 },
  campoInput: { fontSize: 16, color: C.text, padding: 0 },
  campoValorLeitura: { fontSize: 16, color: C.text },
  placeholder: { color: C.textMuted },
  anosRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  anoChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: C.background,
  },
  anoChipSel: { backgroundColor: "#E5F0FF" },
  anoChipTxt: { fontSize: 15, fontWeight: "600", color: C.textMuted },
  anoChipTxtSel: { color: C.primary },
  redeCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface,
    borderRadius: Radius.card, padding: 16,
  },
  redeTxt: { flex: 1, fontSize: 16, fontWeight: "500", color: C.text },
  trialBadge: { alignSelf: "flex-start", borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 5, marginTop: 2 },
  trialBadgeTxt: { fontSize: 13, fontWeight: "700" },
  sairBtn: {
    marginTop: 16, borderWidth: 1, borderColor: "#FECACA", borderRadius: Radius.card,
    paddingVertical: 14, alignItems: "center",
  },
  sairTxt: { color: "#FF3B30", fontSize: 15, fontWeight: "700" },
});
