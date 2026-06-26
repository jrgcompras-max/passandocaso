import { Ionicons } from "@expo/vector-icons";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
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

type CropCtx = { recortar: (uri: string) => Promise<string | null> };
const CropContext = createContext<CropCtx>({ recortar: async (u) => u });

/** Hook: `const recortar = useCrop()` → `await recortar(uri)` (null = refazer/cancelar). */
export function useCrop(): (uri: string) => Promise<string | null> {
  return useContext(CropContext).recortar;
}

export function CropProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<{
    uri: string;
    resolver: (r: string | null) => void;
  } | null>(null);

  const recortar = (uri: string) =>
    new Promise<string | null>((resolver) => setPedido({ uri, resolver }));

  return (
    <CropContext.Provider value={{ recortar }}>
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
    </CropContext.Provider>
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
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
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
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "#000" },
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
