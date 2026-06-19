import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import {
  AuthBotao,
  AuthErro,
  AuthInput,
  AuthLink,
  AuthScreen,
  AuthTitulo,
} from "@/components/auth";
import { useAuth } from "@/store/AuthContext";

export default function LoginScreen() {
  const router = useRouter();
  const { entrar } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function onEntrar() {
    setErro(null);
    if (!email.trim() || !senha) {
      setErro("Preencha e-mail e senha.");
      return;
    }
    setCarregando(true);
    try {
      await entrar(email.trim(), senha);
      // O redirecionamento para a home é feito pelo gate em app/_layout.tsx.
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao entrar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTitulo texto="Entrar" sub="Acesse sua conta para continuar." />
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
        returnKeyType="next"
      />
      <AuthInput
        rotulo="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        placeholder="••••••"
        returnKeyType="go"
        onSubmitEditing={onEntrar}
      />
      <AuthErro texto={erro} />
      <AuthBotao titulo="Entrar" onPress={onEntrar} carregando={carregando} />
      <View style={{ marginTop: 8 }}>
        <AuthLink
          texto="Esqueci minha senha"
          onPress={() => router.push("/recuperar")}
        />
        <AuthLink
          texto="Criar uma conta"
          onPress={() => router.push("/cadastro")}
        />
      </View>
    </AuthScreen>
  );
}
