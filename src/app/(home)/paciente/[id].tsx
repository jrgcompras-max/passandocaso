import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    BorderWidth,
    ClinicalColors,
    Radius,
} from "@/constants/clinicalTheme";

export default function Paciente() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [foto, setFoto] = useState<string | null>(null);
  const [extraindo, setExtraindo] = useState(false);
  const [dados, setDados] = useState({
    motivoInternacao: "",
    comorbidades: "",
    examesRecentes: "",
    sinaisVitais: "",
    intercorrencias: "",
  });

  const processarResultado = (result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled) {
      setFoto(result.assets[0].uri);
      extrairDados(result.assets[0].base64 || "");
    }
  };

  const tirarFoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: true,
    });
    processarResultado(result);
  };

  const escolherDaGaleria = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      base64: true,
    });
    processarResultado(result);
  };

  const extrairDados = async (base64: string) => {
    setExtraindo(true);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: "Analise esta tela de prontuário médico e extraia as informações em JSON com os campos: motivoInternacao, comorbidades, examesRecentes, sinaisVitais, intercorrencias. Responda APENAS com o JSON, sem texto adicional.",
                },
              ],
            },
          ],
        }),
      });
      const data = await response.json();
      const texto = data.content[0].text;
      const json = JSON.parse(texto);
      setDados(json);
    } catch (e) {
      console.log("Erro ao extrair:", e);
    }
    setExtraindo(false);
  };

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity
        style={styles.botaoVoltar}
        onPress={() => router.back()}
      >
        <Text style={styles.botaoVoltarTexto}>← Voltar</Text>
      </TouchableOpacity>

      <Text style={styles.titulo}>Paciente {id}</Text>

      <TouchableOpacity style={styles.botaoFoto} onPress={tirarFoto}>
        <Text style={styles.botaoFotoTexto}>📷 Fotografar Prontuário</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.botaoFoto} onPress={escolherDaGaleria}>
        <Text style={styles.botaoFotoTexto}>🖼️ Escolher da Galeria</Text>
      </TouchableOpacity>

      {foto && <Image source={{ uri: foto }} style={styles.preview} />}

      {extraindo && (
        <Text style={styles.extraindo}>
          ⏳ Extraindo dados do prontuário...
        </Text>
      )}

      {dados.motivoInternacao !== "" && (
        <View style={styles.secoes}>
          <Secao
            titulo="Motivo da Internação"
            conteudo={dados.motivoInternacao}
          />
          <Secao titulo="Comorbidades" conteudo={dados.comorbidades} />
          <Secao titulo="Exames Recentes" conteudo={dados.examesRecentes} />
          <Secao titulo="Sinais Vitais" conteudo={dados.sinaisVitais} />
          <Secao titulo="Intercorrências" conteudo={dados.intercorrencias} />
        </View>
      )}
    </ScrollView>
  );
}

function Secao({ titulo, conteudo }: { titulo: string; conteudo: string }) {
  return (
    <View style={styles.secao}>
      <Text style={styles.secaoTitulo}>{titulo}</Text>
      <Text style={styles.secaoConteudo}>{conteudo}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ClinicalColors.background,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  botaoVoltar: { marginBottom: 16 },
  botaoVoltarTexto: { color: ClinicalColors.primary, fontSize: 16 },
  titulo: {
    fontSize: 24,
    fontWeight: "bold",
    color: ClinicalColors.text,
    marginBottom: 24,
  },
  botaoFoto: {
    backgroundColor: ClinicalColors.buttonPrimary,
    borderRadius: Radius.card,
    padding: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  botaoFotoTexto: { color: ClinicalColors.text, fontSize: 16, fontWeight: "600" },
  preview: {
    width: "100%",
    height: 200,
    borderRadius: Radius.card,
    marginBottom: 16,
  },
  extraindo: {
    color: ClinicalColors.textMuted,
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  secoes: { marginTop: 8 },
  secao: {
    backgroundColor: ClinicalColors.surface,
    borderRadius: Radius.card,
    borderWidth: BorderWidth.hairline,
    borderColor: ClinicalColors.border,
    padding: 16,
    marginBottom: 12,
  },
  secaoTitulo: {
    fontSize: 11,
    color: ClinicalColors.textMuted,
    marginBottom: 6,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  secaoConteudo: { color: ClinicalColors.text, fontSize: 15, lineHeight: 22 },
});
