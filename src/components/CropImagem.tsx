import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClinicalColors as C, Radius } from "@/constants/clinicalTheme";

/**
 * Corte (crop) da imagem antes do scan. O médico arrasta os cantos para
 * selecionar a área de interesse — elimina informações de outras seções que
 * aparecem na foto, reduzindo misrouting na extração. UI simples e funcional,
 * via expo-image-manipulator (OTA, sem build nativo novo).
 */

type CropCtx = {
  recortar: (uri: string) => Promise<string | null>;
  /** Captura múltiplas páginas (câmera → crop → revisão), em ordem. */
  capturarPaginas: () => Promise<string[]>;
};
const CropContext = createContext<CropCtx>({
  // Diagnóstico: se este default for usado, o provider não está envolvendo a tela.
  recortar: async (u) => {
    Alert.alert("Crop indisponível", "CropProvider não está envolvendo esta tela.");
    return u;
  },
  capturarPaginas: async () => [],
});

/** Hook: `const recortar = useCrop()` → `await recortar(uri)` (null = refazer/cancelar). */
export function useCrop(): (uri: string) => Promise<string | null> {
  return useContext(CropContext).recortar;
}
/** Hook: captura de laudo com várias páginas → array de URIs cortadas (em ordem). */
export function useCapturaPaginas(): () => Promise<string[]> {
  return useContext(CropContext).capturarPaginas;
}

export function CropProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<{
    uri: string;
    resolver: (r: string | null) => void;
  } | null>(null);

  const recortar = (uri: string) =>
    new Promise<string | null>((resolver) => setPedido({ uri, resolver }));

  // Captura UMA página: câmera → crop; "Tirar de novo" reabre a câmera (loop).
  const capturarUma = async (): Promise<string | null> => {
    for (;;) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return null;
      const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
      if (r.canceled) return null;
      const cortada = await recortar(r.assets[0].uri);
      if (cortada) return cortada;
    }
  };

  // ── Multi-página (laudo com várias fotos) ──────────────────────────────────
  const [paginas, setPaginas] = useState<string[] | null>(null);
  const resolverPaginas = useRef<((p: string[]) => void) | null>(null);

  const capturarPaginas = async (): Promise<string[]> => {
    const primeira = await capturarUma();
    if (!primeira) return [];
    return new Promise<string[]>((resolve) => {
      resolverPaginas.current = resolve;
      setPaginas([primeira]);
    });
  };
  const adicionarPagina = async () => {
    const nova = await capturarUma();
    if (nova) setPaginas((p) => [...(p ?? []), nova]);
  };
  const finalizarPaginas = () => {
    resolverPaginas.current?.(paginas ?? []);
    resolverPaginas.current = null;
    setPaginas(null);
  };
  const cancelarPaginas = () => {
    resolverPaginas.current?.([]);
    resolverPaginas.current = null;
    setPaginas(null);
  };

  return (
    <CropContext.Provider value={{ recortar, capturarPaginas }}>
      {children}
      {pedido && (
        <CropModal
          uri={pedido.uri}
          onConfirm={(u) => {
            pedido.resolver(u);
            setPedido(null);
          }}
          onCancel={() => {
            pedido.resolver(null);
            setPedido(null);
          }}
        />
      )}
      {/* Revisão das páginas — escondida enquanto o crop está aberto. */}
      {paginas && !pedido && (
        <PaginasModal
          paginas={paginas}
          onAdicionar={adicionarPagina}
          onRemover={(i) => setPaginas((p) => (p ? p.filter((_, j) => j !== i) : p))}
          onFinalizar={finalizarPaginas}
          onCancelar={cancelarPaginas}
        />
      )}
    </CropContext.Provider>
  );
}

/** Revisão das páginas do laudo: miniaturas, remover, adicionar, finalizar. */
function PaginasModal({
  paginas,
  onAdicionar,
  onRemover,
  onFinalizar,
  onCancelar,
}: {
  paginas: string[];
  onAdicionar: () => void;
  onRemover: (i: number) => void;
  onFinalizar: () => void;
  onCancelar: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={pg.fundo}>
        <View style={[pg.caixa, { paddingBottom: insets.bottom + 16 }]}>
          <View style={pg.topo}>
            <Text style={pg.titulo}>
              {paginas.length} {paginas.length === 1 ? "página" : "páginas"}
            </Text>
            <TouchableOpacity onPress={onCancelar} hitSlop={8}>
              <Ionicons name="close" size={24} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            {paginas.map((uri, i) => (
              <View key={i} style={pg.thumbWrap}>
                <Image source={{ uri }} style={pg.thumb} resizeMode="cover" />
                <Text style={pg.thumbNum}>Página {i + 1}</Text>
                <TouchableOpacity style={pg.thumbX} onPress={() => onRemover(i)} hitSlop={6}>
                  <Ionicons name="close-circle" size={22} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={pg.addCard} onPress={onAdicionar}>
              <Ionicons name="add" size={28} color={C.primary} />
              <Text style={pg.addTxt}>Adicionar{"\n"}página</Text>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity style={pg.btnFinal} onPress={onFinalizar}>
            <Ionicons name="checkmark" size={18} color="#FFF" />
            <Text style={pg.btnFinalTxt}>Finalizar e extrair</Text>
          </TouchableOpacity>
        </View>
    </View>
  );
}

const MIN = 48; // tamanho mínimo do retângulo (em px de tela)
const HANDLE = 28;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type Rect = { x: number; y: number; w: number; h: number };

function CropModal({
  uri,
  onConfirm,
  onCancel,
}: {
  uri: string;
  onConfirm: (uri: string) => void;
  onCancel: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [imgDim, setImgDim] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [processando, setProcessando] = useState(false);

  // Caixa de exibição: cabe a imagem inteira, deixando espaço para os botões.
  const boxW = screenW;
  const boxH = screenH - insets.top - insets.bottom - 140;
  const dim = imgDim;
  const escala = dim ? Math.min(boxW / dim.w, boxH / dim.h) : 1; // display px por image px
  const dispW = dim ? dim.w * escala : 0;
  const dispH = dim ? dim.h * escala : 0;
  const offX = (boxW - dispW) / 2;
  const offY = (boxH - dispH) / 2;

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setImgDim({ w, h }),
      () => setImgDim({ w: 1000, h: 1000 }),
    );
  }, [uri]);

  // Retângulo inicial = imagem inteira (com pequeno respiro).
  useEffect(() => {
    if (!dim) return;
    const m = 12;
    setRect({ x: m, y: m, w: dispW - 2 * m, h: dispH - 2 * m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim, dispW, dispH]);

  const rectRef = useRef<Rect | null>(rect);
  rectRef.current = rect;
  const inicio = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  const makeCorner = (cx: "l" | "r", cy: "t" | "b") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        if (rectRef.current) inicio.current = { ...rectRef.current };
      },
      onPanResponderMove: (_e, g) => {
        const s = inicio.current;
        let { x, y, w, h } = s;
        if (cx === "l") {
          const nx = clamp(s.x + g.dx, 0, s.x + s.w - MIN);
          x = nx;
          w = s.x + s.w - nx;
        } else {
          w = clamp(s.w + g.dx, MIN, dispW - s.x);
        }
        if (cy === "t") {
          const ny = clamp(s.y + g.dy, 0, s.y + s.h - MIN);
          y = ny;
          h = s.y + s.h - ny;
        } else {
          h = clamp(s.h + g.dy, MIN, dispH - s.y);
        }
        setRect({ x, y, w, h });
      },
    });

  // PanResponders estáveis por canto.
  const cantos = useRef({
    tl: makeCorner("l", "t"),
    tr: makeCorner("r", "t"),
    bl: makeCorner("l", "b"),
    br: makeCorner("r", "b"),
  });
  // Recria quando as dimensões de exibição mudam (clamp depende delas).
  cantos.current = {
    tl: makeCorner("l", "t"),
    tr: makeCorner("r", "t"),
    bl: makeCorner("l", "b"),
    br: makeCorner("r", "b"),
  };

  const confirmar = async () => {
    if (!rect || !dim || processando) return;
    setProcessando(true);
    try {
      const crop = {
        originX: Math.max(0, Math.round(rect.x / escala)),
        originY: Math.max(0, Math.round(rect.y / escala)),
        width: Math.min(dim.w, Math.round(rect.w / escala)),
        height: Math.min(dim.h, Math.round(rect.h / escala)),
      };
      const out = await ImageManipulator.manipulate(uri).crop(crop).renderAsync();
      const saved = await out.saveAsync({ format: SaveFormat.JPEG });
      onConfirm(saved.uri);
    } catch {
      // Em falha, usa a imagem original (não bloqueia o scan).
      onConfirm(uri);
    }
  };

  const pronto = !!dim && !!rect;

  return (
    <View style={[s.fundo, { paddingTop: Math.max(insets.top, 24) }]}>
        <Text style={s.titulo}>Selecione a área do exame</Text>

        <View style={{ width: boxW, height: boxH }}>
          {!pronto ? (
            <ActivityIndicator color="#FFF" style={{ marginTop: 60 }} />
          ) : (
            <>
              <Image
                source={{ uri }}
                style={{ position: "absolute", left: offX, top: offY, width: dispW, height: dispH }}
                resizeMode="contain"
              />
              {/* Escurece fora do retângulo. */}
              <View style={[s.dim, { left: offX, top: offY, width: dispW, height: rect.y }]} />
              <View style={[s.dim, { left: offX, top: offY + rect.y + rect.h, width: dispW, height: dispH - rect.y - rect.h }]} />
              <View style={[s.dim, { left: offX, top: offY + rect.y, width: rect.x, height: rect.h }]} />
              <View style={[s.dim, { left: offX + rect.x + rect.w, top: offY + rect.y, width: dispW - rect.x - rect.w, height: rect.h }]} />
              {/* Moldura. */}
              <View style={[s.moldura, { left: offX + rect.x, top: offY + rect.y, width: rect.w, height: rect.h }]} />
              {/* Cantos arrastáveis. */}
              {(
                [
                  ["tl", rect.x, rect.y],
                  ["tr", rect.x + rect.w, rect.y],
                  ["bl", rect.x, rect.y + rect.h],
                  ["br", rect.x + rect.w, rect.y + rect.h],
                ] as const
              ).map(([k, hx, hy]) => (
                <View
                  key={k}
                  {...cantos.current[k].panHandlers}
                  style={[
                    s.canto,
                    { left: offX + hx - HANDLE / 2, top: offY + hy - HANDLE / 2 },
                  ]}
                />
              ))}
            </>
          )}
        </View>

        <View style={[s.barra, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={s.btnSec} onPress={onCancel} disabled={processando}>
            <Ionicons name="camera-reverse-outline" size={18} color="#FFF" />
            <Text style={s.btnSecTxt}>Tirar de novo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnPrim} onPress={confirmar} disabled={processando || !pronto}>
            {processando ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color="#FFF" />
                <Text style={s.btnPrimTxt}>Confirmar corte</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
    </View>
  );
}

const s = StyleSheet.create({
  fundo: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 1000, elevation: 1000 },
  titulo: { color: "#FFF", fontSize: 16, fontWeight: "600", textAlign: "center", paddingVertical: 12 },
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  moldura: { position: "absolute", borderWidth: 2, borderColor: "#FFF" },
  canto: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: "#FFF",
  },
  barra: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  btnSec: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: Radius.badge,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  btnSecTxt: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  btnPrim: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: Radius.badge,
    backgroundColor: C.primary,
  },
  btnPrimTxt: { color: "#FFF", fontSize: 15, fontWeight: "700" },
});

const pg = StyleSheet.create({
  fundo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    zIndex: 1000,
    elevation: 1000,
  },
  caixa: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: 20,
  },
  topo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  titulo: { fontSize: 18, fontWeight: "700", color: C.text },
  thumbWrap: { marginRight: 10, alignItems: "center" },
  thumb: { width: 92, height: 120, borderRadius: 8, backgroundColor: "#EEE" },
  thumbNum: { fontSize: 11, color: C.textMuted, marginTop: 4 },
  thumbX: { position: "absolute", top: -6, right: -6, backgroundColor: "#A32D2D", borderRadius: 11 },
  addCard: {
    width: 92,
    height: 120,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addTxt: { fontSize: 12, color: C.primary, fontWeight: "600", textAlign: "center", marginTop: 2 },
  btnFinal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radius.badge,
    backgroundColor: C.primary,
  },
  btnFinalTxt: { color: "#FFF", fontSize: 16, fontWeight: "700" },
});
