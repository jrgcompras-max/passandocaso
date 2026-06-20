import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";

/** Casca das telas de autenticação: fundo clínico, marca no topo e teclado. */
export function AuthScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAwareScrollView
      style={styles.fundo}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 },
      ]}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={20}
    >
      <View style={styles.marca}>
        <Ionicons name="medkit" size={40} color={C.primary} style={styles.marcaIcone} />
        <Text style={styles.marcaNome}>Passando Caso</Text>
      </View>
      {children}
    </KeyboardAwareScrollView>
  );
}

export function AuthTitulo({ texto, sub }: { texto: string; sub?: string }) {
  return (
    <View style={styles.cabecalho}>
      <Text style={styles.titulo}>{texto}</Text>
      {sub ? <Text style={styles.subtitulo}>{sub}</Text> : null}
    </View>
  );
}

export function AuthInput({
  rotulo,
  ...rest
}: TextInputProps & { rotulo: string }) {
  return (
    <View style={styles.campo}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <TextInput
        placeholderTextColor={C.textMuted}
        style={styles.input}
        {...rest}
      />
    </View>
  );
}

export function AuthBotao({
  titulo,
  onPress,
  carregando,
  variante = "primario",
}: {
  titulo: string;
  onPress: () => void;
  carregando?: boolean;
  variante?: "primario" | "secundario";
}) {
  const sec = variante === "secundario";
  return (
    <Pressable
      onPress={onPress}
      disabled={carregando}
      style={({ pressed }) => [
        styles.botao,
        sec && styles.botaoSec,
        (pressed || carregando) && { opacity: 0.7 },
      ]}
    >
      {carregando ? (
        <ActivityIndicator color={sec ? C.primary : C.textOnPrimary} />
      ) : (
        <Text style={[styles.botaoTxt, sec && styles.botaoTxtSec]}>{titulo}</Text>
      )}
    </Pressable>
  );
}

export function AuthErro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <Text style={styles.erro}>{texto}</Text>;
}

export function AuthLink({
  texto,
  onPress,
}: {
  texto: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.link} hitSlop={8}>
      <Text style={styles.linkTxt}>{texto}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "center" },
  marca: { alignItems: "center", marginBottom: 36 },
  marcaIcone: { fontSize: 40, marginBottom: 6 },
  marcaNome: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.3 },
  cabecalho: { marginBottom: 20 },
  titulo: { fontSize: 26, fontWeight: "700", color: C.text },
  subtitulo: { fontSize: 15, color: C.textMuted, marginTop: 4 },
  campo: { marginBottom: 16 },
  rotulo: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 6 },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: Radius.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: C.text,
  },
  botao: {
    backgroundColor: C.buttonPrimary,
    borderRadius: Radius.card,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 52,
  },
  botaoSec: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  botaoTxt: { color: C.textOnPrimary, fontSize: 16, fontWeight: "700" },
  botaoTxtSec: { color: C.primary },
  erro: {
    color: "#991B1B",
    backgroundColor: "#FEE2E2",
    borderRadius: Radius.badge,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  link: { alignItems: "center", paddingVertical: 14 },
  linkTxt: { color: C.primary, fontSize: 15, fontWeight: "600" },
});
