/**
 * ImageCropModal — web-compatible square crop/position/zoom tool.
 * On native iOS/Android, expo-image-picker's allowsEditing handles this;
 * this component is for the Expo web build where that feature is a no-op.
 *
 * User can drag to reposition and scroll-wheel / pinch to zoom.
 * "Save" crops the visible square to a canvas and returns a data URL.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { View, Text, Pressable, Modal, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X, ZoomIn, ZoomOut, Check } from "lucide-react-native";

const FRAME = 320;

interface Props {
  visible: boolean;
  imageUri: string | null;
  onSave: (croppedUri: string) => void;
  onCancel: () => void;
}

export function ImageCropModal({ visible, imageUri, onSave, onCancel }: Props) {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<any>(null);

  useEffect(() => {
    if (!visible || !imageUri) return;
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
    if (Platform.OS === "web") {
      const img = new (window as any).Image();
      img.onload = () => { setImgW(img.naturalWidth); setImgH(img.naturalHeight); };
      img.src = imageUri;
    }
  }, [visible, imageUri]);

  const onMouseDown = useCallback((e: any) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX ?? e.touches?.[0]?.clientX ?? 0, y: e.clientY ?? e.touches?.[0]?.clientY ?? 0 };
  }, []);

  const onMouseMove = useCallback((e: any) => {
    if (!dragging.current) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    setOffsetX(prev => prev + (x - lastPos.current.x));
    setOffsetY(prev => prev + (y - lastPos.current.y));
    lastPos.current = { x, y };
  }, []);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  const onWheel = useCallback((e: any) => {
    e.preventDefault();
    setScale(prev => Math.max(0.5, Math.min(5, prev - e.deltaY * 0.002)));
  }, []);

  const zoomIn = () => setScale(prev => Math.min(5, prev + 0.25));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.25));

  const handleSave = useCallback(() => {
    if (Platform.OS !== "web" || !imageUri) { onSave(imageUri ?? ""); return; }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = FRAME;
      canvas.height = FRAME;
      const ctx = canvas.getContext("2d")!;
      const img = new (window as any).Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const displayW = img.naturalWidth * scale;
        const displayH = img.naturalHeight * scale;
        const fitScale = FRAME / Math.min(displayW, displayH) * scale;
        const drawW = img.naturalWidth * fitScale;
        const drawH = img.naturalHeight * fitScale;
        const dx = (FRAME - drawW) / 2 + offsetX * (fitScale / scale);
        const dy = (FRAME - drawH) / 2 + offsetY * (fitScale / scale);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, FRAME, FRAME);
        ctx.drawImage(img, dx, dy, drawW, drawH);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        onSave(dataUrl);
      };
      img.src = imageUri;
    } catch {
      onSave(imageUri);
    }
  }, [imageUri, scale, offsetX, offsetY, onSave]);

  if (!visible || !imageUri) return null;

  const fitScale = imgW > 0 && imgH > 0 ? FRAME / Math.min(imgW, imgH) : 1;
  const displayW = imgW * fitScale * scale;
  const displayH = imgH * fitScale * scale;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <SafeAreaView style={{ flex: 1, width: "100%" }} edges={["top", "bottom"]}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 }}>
            <Pressable onPress={onCancel} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 15, color: "#888" }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: "#fff" }}>Position Photo</Text>
            <Pressable onPress={handleSave} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1 })}>
              <Check size={16} color="#c8e84c" />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: "#c8e84c" }}>Save</Text>
            </Pressable>
          </View>

          {/* Crop area */}
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <View
              ref={containerRef}
              style={{
                width: FRAME, height: FRAME, overflow: "hidden",
                borderRadius: 16, borderWidth: 2, borderColor: "rgba(200,232,76,0.4)",
                backgroundColor: "#000",
              }}
              {...(Platform.OS === "web" ? {
                onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp,
                onTouchStart: onMouseDown, onTouchMove: onMouseMove, onTouchEnd: onMouseUp,
                onWheel,
              } as any : {})}
            >
              {Platform.OS === "web" ? (
                <img
                  src={imageUri}
                  draggable={false}
                  style={{
                    width: displayW, height: displayH,
                    transform: `translate(${(FRAME - displayW) / 2 + offsetX}px, ${(FRAME - displayH) / 2 + offsetY}px)`,
                    userSelect: "none" as any,
                    pointerEvents: "none" as any,
                  }}
                />
              ) : null}
            </View>

            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 14, textAlign: "center" }}>
              Drag to reposition · Scroll to zoom
            </Text>
          </View>

          {/* Zoom controls */}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 20, paddingBottom: 20 }}>
            <Pressable onPress={zoomOut} style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)",
              alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1,
            })}>
              <ZoomOut size={20} color="#fff" />
            </Pressable>
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{Math.round(scale * 100)}%</Text>
            </View>
            <Pressable onPress={zoomIn} style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)",
              alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1,
            })}>
              <ZoomIn size={20} color="#fff" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
