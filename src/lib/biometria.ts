import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Desbloqueio biométrico (Face ID / Touch ID).
 *
 * O módulo nativo `expo-local-authentication` é carregado de forma DEFENSIVA:
 * se o build atual não tiver o módulo (ex.: um update OTA antes do build novo
 * com a dependência), todas as funções retornam "indisponível" em vez de
 * quebrar o app.
 */
type LA = typeof import("expo-local-authentication");

const FLAG_KEY = "@passandocaso/biometria";

let _mod: LA | null | undefined;
function modulo(): LA | null {
  if (_mod === undefined) {
    try {
      _mod = require("expo-local-authentication") as LA;
    } catch {
      _mod = null;
    }
  }
  return _mod;
}

/** Há hardware biométrico com biometria cadastrada e utilizável no aparelho? */
export async function biometriaDisponivel(): Promise<boolean> {
  const LA = modulo();
  if (!LA) return false;
  try {
    return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Nome amigável do método disponível (Face ID / Touch ID / Biometria). */
export async function nomeBiometria(): Promise<string> {
  const LA = modulo();
  if (!LA) return "Biometria";
  try {
    const tipos = await LA.supportedAuthenticationTypesAsync();
    if (tipos.includes(LA.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
    if (tipos.includes(LA.AuthenticationType.FINGERPRINT)) return "Touch ID";
  } catch {
    // ignora — cai no genérico
  }
  return "Biometria";
}

/** O usuário ligou o desbloqueio biométrico? */
export async function biometriaAtivada(): Promise<boolean> {
  return (await AsyncStorage.getItem(FLAG_KEY)) === "1";
}

/** Pede a biometria. Retorna true se autenticou com sucesso. */
export async function autenticarBiometria(
  motivo = "Desbloquear o Passando Caso",
): Promise<boolean> {
  const LA = modulo();
  if (!LA) return false;
  try {
    const r = await LA.authenticateAsync({
      promptMessage: motivo,
      cancelLabel: "Usar senha",
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

/** Liga o desbloqueio — exige uma autenticação bem-sucedida antes de gravar. */
export async function ativarBiometria(): Promise<boolean> {
  const ok = await autenticarBiometria("Confirme para ativar o desbloqueio");
  if (ok) await AsyncStorage.setItem(FLAG_KEY, "1");
  return ok;
}

/** Desliga o desbloqueio. */
export async function desativarBiometria(): Promise<void> {
  await AsyncStorage.removeItem(FLAG_KEY);
}
