/**
 * PlateCalculator — full-screen modal tool. Pick a bar weight (25 or 45 lb),
 * enter a target weight, see exactly which plates go on each side.
 *
 * Standard per-side plate set: 45/35/25/10/5/2.5 lb, loaded largest-first
 * (closest to the collar) — the same order lifters actually load a bar in.
 */
import { useState, useMemo } from "react";
import { View, Text, Pressable, Modal, TextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X, Minus, Plus } from "lucide-react-native";

const LIME = "#c8e84c";
const DARK = "#111111";
const CARD = "#1a1a1a";
const MUTED = "#888888";

const BAR_WEIGHTS = [45, 25] as const;
type BarWeight = (typeof BAR_WEIGHTS)[number];

// Per-side plate inventory, largest first (load order). Color is purely for
// visual distinction between sizes, not a claim about any real gym's set.
const PLATE_SPEC: { weight: number; color: string; height: number }[] = [
  { weight: 45,  color: "#4C8CE8", height: 104 },
  { weight: 35,  color: "#E8C84C", height: 94 },
  { weight: 25,  color: "#4CE87C", height: 84 },
  { weight: 10,  color: "#e8e8e8", height: 68 },
  { weight: 5,   color: "#2a2a2a", height: 56 },
  { weight: 2.5, color: "#E84C4C", height: 44 },
];
const PLATE_SIZES = PLATE_SPEC.map(p => p.weight);
const PLATE_COLOR: Record<number, string> = Object.fromEntries(PLATE_SPEC.map(p => [p.weight, p.color]));
const PLATE_HEIGHT: Record<number, number> = Object.fromEntries(PLATE_SPEC.map(p => [p.weight, p.height]));

const QUICK_ADJUST = [-45, -10, -5, 5, 10, 45];

/** Greedily fill one side with the largest plates first; returns load order (innermost first). */
function calculatePlates(targetLbs: number, barLbs: number): { plates: number[]; perSide: number; achievedTotal: number } {
  const perSideTarget = (targetLbs - barLbs) / 2;
  if (perSideTarget <= 0) return { plates: [], perSide: 0, achievedTotal: barLbs };
  let remaining = perSideTarget;
  const plates: number[] = [];
  for (const size of PLATE_SIZES) {
    while (remaining + 1e-6 >= size) {
      plates.push(size);
      remaining -= size;
    }
  }
  const perSide = plates.reduce((s, p) => s + p, 0);
  return { plates, perSide, achievedTotal: barLbs + perSide * 2 };
}

function PlateStack({ plates, side }: { plates: number[]; side: "left" | "right" }) {
  const ordered = side === "left" ? [...plates].reverse() : plates;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {ordered.map((w, i) => (
        <View
          key={i}
          style={{
            width: 15, height: PLATE_HEIGHT[w], borderRadius: 3,
            backgroundColor: PLATE_COLOR[w],
            marginLeft: i === 0 ? 0 : 2,
            borderWidth: 1, borderColor: "rgba(0,0,0,0.3)",
          }}
        />
      ))}
    </View>
  );
}

function plateSummary(plates: number[]): string {
  const counts = new Map<number, number>();
  for (const p of plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([w, n]) => `${n}×${w % 1 === 0 ? w : w.toFixed(1)}`)
    .join("  ");
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function PlateCalculator({ visible, onClose }: Props) {
  const [barWeight, setBarWeight] = useState<BarWeight>(45);
  const [targetText, setTargetText] = useState("135");

  const target = parseFloat(targetText) || 0;
  const { plates, perSide, achievedTotal } = useMemo(
    () => calculatePlates(target, barWeight),
    [target, barWeight]
  );
  const exact = Math.abs(achievedTotal - target) < 0.01;

  const adjust = (delta: number) => {
    const next = Math.max(barWeight, (parseFloat(targetText) || 0) + delta);
    setTargetText(String(next));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          {/* Header */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20, paddingVertical: 14,
            borderBottomWidth: 1, borderBottomColor: "#222",
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 17, color: "#fff" }}>
              Plate Calculator
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <X size={22} color="#fff" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {/* Bar weight toggle */}
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: MUTED, marginBottom: 8 }}>
              BAR WEIGHT
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
              {BAR_WEIGHTS.map(w => {
                const active = barWeight === w;
                return (
                  <Pressable
                    key={w}
                    onPress={() => setBarWeight(w)}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: "center",
                      backgroundColor: active ? LIME : CARD,
                      borderWidth: 1, borderColor: active ? LIME : "#2a2a2a",
                    }}
                  >
                    <Text style={{
                      fontFamily: "Manrope-Bold", fontSize: 15,
                      color: active ? "#0a0a0a" : "#fff",
                    }}>
                      {w} lb bar
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Target weight input */}
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: MUTED, marginBottom: 8 }}>
              TARGET WEIGHT
            </Text>
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              backgroundColor: CARD, borderRadius: 16, paddingVertical: 14,
              borderWidth: 1, borderColor: "#2a2a2a", marginBottom: 10,
            }}>
              <TextInput
                value={targetText}
                onChangeText={setTargetText}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={{
                  fontFamily: "Manrope-ExtraBold", fontSize: 40, color: "#fff",
                  textAlign: "center", minWidth: 120,
                }}
              />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: MUTED, marginLeft: 4 }}>
                lbs
              </Text>
            </View>

            {/* Quick adjust */}
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 28 }}>
              {QUICK_ADJUST.map(d => (
                <Pressable
                  key={d}
                  onPress={() => adjust(d)}
                  style={({ pressed }) => ({
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2,
                    paddingVertical: 9, borderRadius: 10,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  {d > 0 ? <Plus size={11} color={LIME} /> : <Minus size={11} color="#ff8a8a" />}
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: d > 0 ? LIME : "#ff8a8a" }}>
                    {Math.abs(d)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Barbell visual */}
            <View style={{
              backgroundColor: CARD, borderRadius: 20, paddingVertical: 32,
              borderWidth: 1, borderColor: "#2a2a2a", marginBottom: 16,
              alignItems: "center",
            }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {/* left collar */}
                  <View style={{ width: 6, height: 20, backgroundColor: "#555", borderRadius: 2 }} />
                  <PlateStack plates={plates} side="left" />
                  {/* bar */}
                  <View style={{ width: 90, height: 10, backgroundColor: "#777", marginHorizontal: 2 }} />
                  <PlateStack plates={plates} side="right" />
                  <View style={{ width: 6, height: 20, backgroundColor: "#555", borderRadius: 2 }} />
                </View>
              </ScrollView>
            </View>

            {/* Breakdown */}
            <View style={{
              backgroundColor: CARD, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: "#2a2a2a",
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: plates.length > 0 ? 10 : 0 }}>
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: MUTED }}>
                  Each side ({barWeight} lb bar)
                </Text>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>
                  {perSide.toFixed(perSide % 1 === 0 ? 0 : 1)} lbs
                </Text>
              </View>
              {plates.length > 0 && (
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: LIME, marginBottom: 10 }}>
                  {plateSummary(plates)}
                </Text>
              )}
              {target === barWeight && (
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: MUTED }}>
                  That's just the bar — no plates needed.
                </Text>
              )}
              {target > 0 && target < barWeight && (
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#f8c86a" }}>
                  Can't go below the bar's own weight ({barWeight} lbs).
                </Text>
              )}
              {target > barWeight && !exact && (
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#f8c86a" }}>
                  Closest achievable with standard plates: {achievedTotal.toFixed(1)} lbs
                </Text>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
