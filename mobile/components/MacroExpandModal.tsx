/**
 * MacroExpandModal
 * Expands from any of the Protein / Carbs / Fat cards to a full-screen macro
 * history view. Dark background with three coloured glow lines (one per macro).
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline, Line as SvgLine } from "react-native-svg";
import { buildChartBars } from "@/lib/chart-utils";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const LIME   = "#c8e84c";
const BLUE   = "#9bd1ff";
const PURPLE = "#d3a8ff";
const BG     = "#0d0d0d";

interface DayMacro {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  period: 7 | 30 | 90;
  onPeriodChange: (p: 7 | 30 | 90) => void;
  history: DayMacro[];
  /** Today's totals */
  todayProtein: number;
  todayCarbs: number;
  todayFat: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
}

export function MacroExpandModal({
  visible, onClose,
  period, onPeriodChange,
  history,
  todayProtein, todayCarbs, todayFat,
  targetProtein, targetCarbs, targetFat,
}: Props) {
  const expandAnim  = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const limeAnim    = useRef(new Animated.Value(0)).current;
  const blueAnim    = useRef(new Animated.Value(0)).current;
  const purpleAnim  = useRef(new Animated.Value(0)).current;
  const [showing, setShowing] = useState(false);
  const [chartW, setChartW]   = useState(0);

  useEffect(() => {
    if (visible) {
      setShowing(true);
      expandAnim.setValue(0); contentAnim.setValue(0);
      Animated.sequence([
        Animated.spring(expandAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 12 }),
        Animated.timing(contentAnim, { toValue: 1, duration: 200, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      ]).start();
    }
  }, [visible]);

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(expandAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(contentAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => { setShowing(false); onClose(); });
  }, [onClose]);

  const scale = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] });
  const borderRadius = expandAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [999, 40, 0] });

  // Build per-macro chart bars
  const proteinBars = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.protein })), period), [history, period]);
  const carbsBars   = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.carbs   })), period), [history, period]);
  const fatBars     = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.fat     })), period), [history, period]);

  // Max across all three macros so they share the same scale
  const macroMax = useMemo(() => Math.max(
    ...proteinBars.map(b => b.value),
    ...carbsBars.map(b => b.value),
    ...fatBars.map(b => b.value),
    1,
  ), [proteinBars, carbsBars, fatBars]);

  // SVG geometry for all three lines
  const { ptsP, ptsC, ptsF, pathLen } = useMemo(() => {
    if (chartW <= 0 || proteinBars.length === 0) return { ptsP: "", ptsC: "", ptsF: "", pathLen: 0 };
    const gap = period === 30 ? 2 : 3;
    const barW = (chartW - gap * (proteinBars.length - 1)) / proteinBars.length;
    const H = 90, BH = 78;
    const cx = (i: number) => i * (barW + gap) + barW / 2;
    const cy = (v: number) => H - Math.max((v / macroMax) * BH, v > 0 ? 3 : 2);
    const pts = (bars: typeof proteinBars) => bars.map((b, i) => `${cx(i).toFixed(1)},${cy(b.value).toFixed(1)}`).join(" ");
    // path length approximated from protein line (all same x-spacing)
    const coords = proteinBars.map((_, i) => ({ x: cx(i), y: cy(proteinBars[i].value) }));
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].x - coords[i-1].x, dy = coords[i].y - coords[i-1].y;
      len += Math.sqrt(dx*dx + dy*dy);
    }
    return { ptsP: pts(proteinBars), ptsC: pts(carbsBars), ptsF: pts(fatBars), pathLen: Math.ceil(len) + 20 };
  }, [proteinBars, carbsBars, fatBars, chartW, macroMax, period]);

  // Stagger the three line animations
  useEffect(() => {
    if (pathLen > 0 && visible) {
      [limeAnim, blueAnim, purpleAnim].forEach(a => a.setValue(0));
      Animated.stagger(280, [
        Animated.timing(limeAnim,   { toValue: 1, duration: 1200, useNativeDriver: false, easing: Easing.out(Easing.cubic), delay: 200 }),
        Animated.timing(blueAnim,   { toValue: 1, duration: 1200, useNativeDriver: false, easing: Easing.out(Easing.cubic) }),
        Animated.timing(purpleAnim, { toValue: 1, duration: 1200, useNativeDriver: false, easing: Easing.out(Easing.cubic) }),
      ]).start();
    }
  }, [pathLen, visible, period]);

  const dashOffset = (anim: Animated.Value) => (anim as any).interpolate({ inputRange: [0, 1], outputRange: [pathLen, 0] });
  const barGap = period === 30 ? 2 : 3;

  // Stats
  const avgProtein = proteinBars.length ? Math.round(proteinBars.reduce((s, b) => s + b.value, 0) / proteinBars.filter(b => b.value > 0).length || 0) : 0;
  const avgCarbs   = carbsBars.length   ? Math.round(carbsBars.reduce((s, b) => s + b.value, 0)   / carbsBars.filter(b => b.value > 0).length   || 0) : 0;
  const avgFat     = fatBars.length     ? Math.round(fatBars.reduce((s, b) => s + b.value, 0)     / fatBars.filter(b => b.value > 0).length     || 0) : 0;

  return (
    <Modal visible={showing} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
        <Animated.View style={{
          position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
          backgroundColor: BG,
          transform: [{ scale }],
          borderRadius: borderRadius as any,
          overflow: "hidden",
        }}>
          <Animated.View style={{ flex: 1, opacity: contentAnim }}>
            <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>

              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: "#ffffff" }}>Macros</Text>
                <Pressable onPress={close} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#ffffff", lineHeight: 20 }}>×</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

                {/* Today hero — three macro pills */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24, marginTop: 8 }}>
                  {[
                    { label: "PROTEIN", val: todayProtein, target: targetProtein, color: LIME },
                    { label: "CARBS",   val: todayCarbs,   target: targetCarbs,   color: BLUE },
                    { label: "FAT",     val: todayFat,     target: targetFat,     color: PURPLE },
                  ].map(m => (
                    <View key={m.label} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 18, padding: 14, alignItems: "center" }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: 0.7, marginBottom: 6 }}>{m.label}</Text>
                      <Text style={{ fontFamily: "Doto", fontSize: 28, color: m.color, lineHeight: 32 }}>{m.val}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>/ {m.target}g</Text>
                      {/* progress bar */}
                      <View style={{ width: "100%", height: 3, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                        <View style={{ width: `${Math.min(m.target > 0 ? (m.val / m.target) * 100 : 0, 100)}%`, height: "100%", backgroundColor: m.color, borderRadius: 2 }} />
                      </View>
                    </View>
                  ))}
                </View>

                {/* Avg stats */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                  {[
                    { label: "AVG PROTEIN", value: String(avgProtein || "—"), unit: "g/day", color: LIME },
                    { label: "AVG CARBS",   value: String(avgCarbs   || "—"), unit: "g/day", color: BLUE },
                    { label: "AVG FAT",     value: String(avgFat     || "—"), unit: "g/day", color: PURPLE },
                  ].map(s => (
                    <View key={s.label} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 10, alignItems: "center" }}>
                      <Text style={{ fontFamily: "Doto", fontSize: 22, color: s.color, lineHeight: 26 }}>{s.value}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5, marginTop: 2 }}>{s.unit}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 7, color: "rgba(255,255,255,0.25)", letterSpacing: 0.5, marginTop: 1 }}>{s.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Period selector */}
                <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 3, marginBottom: 20 }}>
                  {([7, 30, 90] as const).map(p => (
                    <Pressable key={p} onPress={() => onPeriodChange(p)} style={{
                      flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center",
                      backgroundColor: period === p ? "rgba(255,255,255,0.15)" : "transparent",
                    }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: period === p ? "#ffffff" : "rgba(255,255,255,0.4)" }}>
                        {p === 7 ? "7 Days" : p === 30 ? "30 Days" : "90 Days"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Chart label */}
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 0.6, marginBottom: 10 }}>
                  {period === 90 ? "MACROS (WEEKLY AVG)" : "DAILY MACROS (g)"}
                </Text>

                {/* Chart */}
                <View style={{ height: 90 }} onLayout={e => setChartW(e.nativeEvent.layout.width)}>
                  {/* Gray bars = total combined macros */}
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: 90, position: "absolute", left: 0, right: 0, top: 0 }}>
                    {proteinBars.map((b, i) => {
                      const total = (b.value || 0) + (carbsBars[i]?.value || 0) + (fatBars[i]?.value || 0);
                      const totalMax = macroMax * 3;
                      const pct = total / totalMax;
                      return (
                        <View key={i} style={{ flex: 1, justifyContent: "flex-end", height: 90 }}>
                          <View style={{ width: "100%", borderRadius: 3, height: Math.max(pct * 78, total > 0 ? 3 : 2), backgroundColor: b.isToday ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)" }} />
                        </View>
                      );
                    })}
                  </View>

                  {/* Three glow lines */}
                  {pathLen > 0 && (
                    <Svg width={chartW} height={90} style={{ position: "absolute", left: 0, top: 0 }}>
                      {/* Protein — LIME */}
                      <AnimatedPolyline points={ptsP} fill="none" stroke={`${LIME}20`} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                      <AnimatedPolyline points={ptsP} fill="none" stroke={`${LIME}60`} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                      <AnimatedPolyline points={ptsP} fill="none" stroke={LIME} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                      {/* Carbs — BLUE */}
                      <AnimatedPolyline points={ptsC} fill="none" stroke={`${BLUE}20`} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                      <AnimatedPolyline points={ptsC} fill="none" stroke={`${BLUE}60`} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                      <AnimatedPolyline points={ptsC} fill="none" stroke={BLUE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                      {/* Fat — PURPLE */}
                      <AnimatedPolyline points={ptsF} fill="none" stroke={`${PURPLE}20`} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                      <AnimatedPolyline points={ptsF} fill="none" stroke={`${PURPLE}60`} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                      <AnimatedPolyline points={ptsF} fill="none" stroke={PURPLE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                    </Svg>
                  )}
                </View>

                {/* X-axis labels */}
                <View style={{ flexDirection: "row", gap: barGap, marginTop: 5, marginBottom: 14 }}>
                  {proteinBars.map((b, i) => (
                    <View key={i} style={{ flex: 1, alignItems: "center" }}>
                      {b.showLabel && (
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: period === 7 ? 9 : 8, color: b.isToday ? "#ffffff" : "rgba(255,255,255,0.3)" } as any} numberOfLines={1}>{b.label}</Text>
                      )}
                    </View>
                  ))}
                </View>

                {/* Colour legend */}
                <View style={{ flexDirection: "row", gap: 16, marginBottom: 8 }}>
                  {[{ label: "Protein", color: LIME }, { label: "Carbs", color: BLUE }, { label: "Fat", color: PURPLE }].map(l => (
                    <View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <View style={{ width: 16, height: 2, backgroundColor: l.color }} />
                      <Text style={{ fontFamily: "Manrope", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{l.label}</Text>
                    </View>
                  ))}
                </View>

              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
