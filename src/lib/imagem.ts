import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Converte qualquer imagem (PNG, HEIC, etc.) para JPEG e devolve o base64.
 * Redimensiona para no máximo 1280px de largura e comprime (0.5) para manter o
 * payload bem abaixo do limite da API — sem perder legibilidade do cabeçalho.
 */
export async function converterParaJpegBase64(uri: string): Promise<string> {
  const imagem = await ImageManipulator.manipulate(uri)
    .resize({ width: 1280 })
    .renderAsync();
  const resultado = await imagem.saveAsync({
    compress: 0.5,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return resultado.base64 ?? "";
}
