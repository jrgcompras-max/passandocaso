import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import {
  AuthBotao,
  AuthErro,
  AuthInput,
  AuthLink,
  AuthScreen,
  AuthTitulo,
} from "@/components/auth";
import { ClinicalColors as C } from "@/constants/clinicalTheme";
import { useAuth } from "@/store/AuthContext";

export default function RecuperarScreen() {
  const router = useRouter();
  const { recuperar } = useAuth();
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function onRecuperar() {
    setErro(null);
    if (!email.trim()) {
      setErro("Informe seu e-mail.");
      return;
    }
    setCarregando(true);
    try {
      await recuperar(email.trim());
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao solicitar recuperação.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <AuthScreen>
      <AuthTitulo
        texto="Recuperar senha"
        sub="Enviaremos um link de redefinição por e-mail."
      />
      {enviado ? (
        <>
          <Text style={{ color: C.text, fontSize: 15, lineHeight: 22, marginBottom: 16 }}>
            Se houver uma conta com este e-mail, você receberá um link para
            redefinir a senha. Verifique sua caixa de entrada e o spam.
          </Text>
          <AuthBotao titulo="Voltar ao login" onPress={() => router.back()} />
        </>
      ) : (
        <>
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
            returnKeyType="go"
            onSubmitEditing={onRecuperar}
          />
          <AuthErro texto={erro} />
          <AuthBotao titulo="Enviar link" onPress={onRecuperar} carregando={carregando} />
          <AuthLink texto="Voltar ao login" onPress={() => router.back()} />
        </>
      )}
    </AuthScreen>
  );
}
