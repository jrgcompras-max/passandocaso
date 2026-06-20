import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { salvarPushToken } from "./rede";

const PROJECT_ID = "e8fd9518-cd72-44e1-b428-777bce0bee42";

// Exibe alerta/som/badge com o app aberto. Protegido: o módulo nativo só existe
// a partir do build com expo-notifications (no build atual, isto vira no-op).
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // build sem módulo nativo
}

/** Pede permissão, obtém o Expo push token e salva no backend. null se falhar. */
export async function registrarPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const { status: existente } = await Notifications.getPermissionsAsync();
    let final = existente;
    if (existente !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== "granted") return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data;
    await salvarPushToken(token).catch(() => {});
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    return token;
  } catch {
    // build sem módulo nativo / permissão negada / sem rede
    return null;
  }
}

/**
 * Registra os listeners de notificação. `aoTocar` dispara quando o usuário toca
 * a notificação; `aoReceber` quando ela chega com o app aberto. Devolve cleanup.
 */
export function configurarListeners(
  aoTocar: (tipo: string) => void,
  aoReceber: (tipo: string) => void,
): () => void {
  const subs: { remove: () => void }[] = [];
  try {
    subs.push(
      Notifications.addNotificationResponseReceivedListener((resp) => {
        const tipo = String(resp?.notification?.request?.content?.data?.tipo || "");
        aoTocar(tipo);
      }),
    );
    subs.push(
      Notifications.addNotificationReceivedListener((notif) => {
        const tipo = String(notif?.request?.content?.data?.tipo || "");
        aoReceber(tipo);
      }),
    );
  } catch {
    // build sem módulo nativo
  }
  return () => {
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        // ignora
      }
    }
  };
}
