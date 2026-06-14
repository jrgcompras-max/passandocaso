import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Converte qualquer imagem (PNG, HEIC, etc.) para JPEG e devolve o base64.
 * Garante que o que enviamos à API de visão seja sempre um formato suportado,
 * independente do que a câmera ou a galeria retornarem.
 */
export async function converterParaJpegBase64(uri: string): Promise<string> {
  const imagem = await ImageManipulator.manipulate(uri).renderAsync();
  const resultado = await imagem.saveAsync({
    format: SaveFormat.JPEG,
    base64: true,
  });
  return resultado.base64 ?? "";
}
