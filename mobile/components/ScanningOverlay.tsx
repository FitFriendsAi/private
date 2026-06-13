import { useEffect, useRef } from "react";
import { View, Text, Image, Animated, Easing } from "react-native";

/**
 * Full-cover overlay shown while Claude reads a nutrition-label / meal photo.
 * Displays the captured image with an animated scan line + glow sweeping over
 * it, a framed reticle, and a pulsing status label. Works on web (RN-Web) using
 * the Animated API — no native module required.
 */
export function ScanningOverlay({
  visible,
  imageUri,
  label,
  accent,
  text,
  muted,
  card,
  border,
}: {
  visible: boolean;
  imageUri: string | null;
  label: string;
  accent: string;
  text: string;
  muted: string;
  card: string;
  border: string;
}) {
  const FRAME_H = 300;
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const sweepLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(sweep, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => { sweepLoop.stop(); pulseLoop.stop(); };
  }, [visible, sweep, pulse]);

  if (!visible) return null;

  // Move the line+trailing band across the frame; leave 2px so the line stays visible.
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME_H - 2] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  // L-shaped corner brackets for the scanner reticle
  const Corner = ({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) => {
    const base: any = { position: "absolute", width: 26, height: 26, borderColor: accent };
    const edge = 3;
    if (pos === "tl") Object.assign(base, { top: 10, left: 10, borderTopWidth: edge, borderLeftWidth: edge, borderTopLeftRadius: 8 });
    if (pos === "tr") Object.assign(base, { top: 10, right: 10, borderTopWidth: edge, borderRightWidth: edge, borderTopRightRadius: 8 });
    if (pos === "bl") Object.assign(base, { bottom: 10, left: 10, borderBottomWidth: edge, borderLeftWidth: edge, borderBottomLeftRadius: 8 });
    if (pos === "br") Object.assign(base, { bottom: 10, right: 10, borderBottomWidth: edge, borderRightWidth: edge, borderBottomRightRadius: 8 });
    return <View style={base} pointerEvents="none" />;
  };

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,8,8,0.82)", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}
      pointerEvents="auto"
    >
      <View style={{ width: "100%", maxWidth: 420 }}>
        {/* Scan frame */}
        <View style={{ height: FRAME_H, borderRadius: 18, overflow: "hidden", backgroundColor: card, borderWidth: 1, borderColor: border }}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} resizeMode="cover" style={{ width: "100%", height: "100%", opacity: 0.92 }} />
          ) : null}

          {/* Sweeping line + trailing glow band */}
          <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, transform: [{ translateY }] }} pointerEvents="none">
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 64, backgroundColor: accent, opacity: 0.16 }} />
            <View
              style={{
                height: 2.5, backgroundColor: accent,
                shadowColor: accent, shadowOpacity: 0.95, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
              }}
            />
          </Animated.View>

          <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
        </View>

        {/* Status */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 }}>
          <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, opacity: dotOpacity }} />
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>{label}</Text>
        </View>
        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, textAlign: "center", marginTop: 6 }}>
          Powered by Claude Vision
        </Text>
      </View>
    </View>
  );
}
