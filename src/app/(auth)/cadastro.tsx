import { useRouter } from "expo-router";
import { useState } from "react";

import {
  AuthBotao,
  AuthErro,
  AuthInput,
  AuthLink,
  AuthScreen,
  AuthTitulo,
} from "@/components/auth";
import { useAuth } from "@/store/AuthContext";

export default function CadastroScreen() {
  const router = useRouter();
  const { cadastrar } = useAuth();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
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
    setCarregando(true);
    try {
      await cadastrar(nome.trim(), email.trim(), senha);
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
      <AuthErro texto={erro} />
      <AuthBotao titulo="Criar conta" onPress={onCadastrar} carregando={carregando} />
      <AuthLink texto="Já tenho conta — entrar" onPress={() => router.back()} />
    </AuthScreen>
  );
}
