const { Expo } = require("expo-server-sdk");

const expo = new Expo();

/**
 * Envia uma push notification via Expo Push API. Best-effort: ignora token
 * ausente/inválido e nunca lança (não pode derrubar a rota que a chamou).
 * `dados` vai no payload (ex.: { tipo: "passagem_recebida" }).
 */
async function enviarPush(token, titulo, corpo, dados = {}) {
  if (!token || !Expo.isExpoPushToken(token)) return;
  try {
    await expo.sendPushNotificationsAsync([
      { to: token, sound: "default", title: titulo, body: corpo, data: dados },
    ]);
  } catch (e) {
    console.error("Erro ao enviar push:", e.message);
  }
}

module.exports = { enviarPush };
