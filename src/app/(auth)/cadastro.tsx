import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  AuthBotao,
  AuthErro,
  AuthInput,
  AuthLink,
  AuthScreen,
  AuthTitulo,
} from "@/components/auth";
import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";
import { useAuth } from "@/store/AuthContext";

const CATEGORIAS = [
  { valor: "medico", rotulo: "Médico", icone: "person-outline" },
  { valor: "residente", rotulo: "Residente", icone: "school-outline" },
  { valor: "estudante", rotulo: "Estudante", icone: "book-outline" },
  { valor: "enfermeiro", rotulo: "Enfermeiro", icone: "heart-outline" },
  { valor: "outro", rotulo: "Outro", icone: "ellipsis-horizontal-outline" },
] as const;

export default function CadastroScreen() {
  const router = useRouter();
  const { cadastrar } = useAuth();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function onCadastrar() {
    setErro(null);
    if (!nome.trim() || !email.trim() || !senha) {
      setErro("Preencha todos os campos.");
      return;
    }
    if (senha.length < 6) {
      setErro("A senha deve ter ao menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não coincidem.");
      return;
    }
    if (!categoria) {
      setErro("Selecione o que você é.");
      return;
    }
    setCarregando(true);
    try {
      await cadastrar(nome.trim(), email.trim(), senha, categoria);
      // O gate em app/_layout.tsx redireciona para a home após o cadastro.
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao cadastrar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTitulo texto="Criar conta" sub="30 dias grátis, sem cartão." />
      <AuthInput
        rotulo="Nome"
        value={nome}
        onChangeText={setNome}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        placeholder="Seu nome"
      />
      <AuthInput
        rotulo="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="seu@email.com"
      />
      <AuthInput
        rotulo="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        textContentType="newPassword"
        placeholder="mínimo 6 caracteres"
      />
      <AuthInput
        rotulo="Confirmar senha"
        value={confirmar}
        onChangeText={setConfirmar}
        secureTextEntry
        textContentType="newPassword"
        placeholder="repita a senha"
        returnKeyType="go"
        onSubmitEditing={onCadastrar}
      />
      <Text style={styles.label}>Eu sou...</Text>
      <View style={styles.grid}>
        {CATEGORIAS.map((c) => {
          const sel = categoria === c.valor;
          return (
            <TouchableOpacity
              key={c.valor}
              style={[styles.catBtn, sel && styles.catBtnSel]}
              onPress={() => setCategoria(c.valor)}
              activeOpacity={0.7}
            >
              <Ionicons name={c.icone} size={22} color={sel ? C.primary : C.textMuted} />
              <Text style={[styles.catTxt, sel && styles.catTxtSel]}>{c.rotulo}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <AuthErro texto={erro} />
      <AuthBotao titulo="Criar conta" onPress={onCadastrar} carregando={carregando} />
      <AuthLink texto="Já tenho conta — entrar" onPress={() => router.back()} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
    marginTop: 8,
    marginBottom: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catBtn: {
    width: "31%",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F2F2F7",
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingVertical: 14,
  },
  catBtnSel: { backgroundColor: "#E5F0FF", borderColor: C.primary },
  catTxt: { fontSize: 12, fontWeight: "600", color: C.textMuted },
  catTxtSel: { color: C.primary },
});

