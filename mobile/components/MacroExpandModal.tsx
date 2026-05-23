/**
 * MacroExpandModal — shared expanded view for Protein / Carbs / Fat cards.
 * Dark background with three staggered coloured glow lines.
 * Features: y-axis labels, grid lines, tap-bar tooltip showing all 3 macros.
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

const CHART_H  = 90;
const BAR_MAX_H = 78;
const Y_AXIS_W  = 34;

function yFmt(v: number): string {
  if (v === 0) return "0";
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (v % 1 === 0) return v.toString();
  return v.toFixed(1);
}

interface DayMacro { date: string; calories: number; protein: number; carbs: number; fat: number }

interface Props {
  visible: boolean;
  onClose: () => void;
  period: 7 | 30 | 90;
  onPeriodChange: (p: 7 | 30 | 90) => void;
  history: DayMacro[];
  todayProtein: number; todayCarbs: number; todayFat: number;
  targetProtein: number; targetCarbs: number; targetFat: number;
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

  const [showing,     setShowing]    = useState(false);
  const [chartW,      setChartW]     = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => { setSelectedIdx(null); }, [period]);

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

  const scale        = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] });
  const borderRadius = expandAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [999, 40, 0] });

  const proteinBars = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.protein })), period), [history, period]);
  const carbsBars   = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.carbs   })), period), [history, period]);
  const fatBars     = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.fat     })), period), [history, period]);

  const macroMax = useMemo(() => Math.max(
    ...proteinBars.map(b => b.value),
    ...carbsBars.map(b => b.value),
    ...fatBars.map(b => b.value),
    1,
  ), [proteinBars, carbsBars, fatBars]);

  const { ptsP, ptsC, ptsF, pathLen } = useMemo(() => {
    if (chartW <= 0 || proteinBars.length === 0) return { ptsP: "", ptsC: "", ptsF: "", pathLen: 0 };
    const gap  = period === 30 ? 2 : 3;
    const barW = (chartW - gap * (proteinBars.length - 1)) / proteinBars.length;
    const cx   = (i: number) => i * (barW + gap) + barW / 2;
    const cy   = (v: number) => CHART_H - Math.max((v / macroMax) * BAR_MAX_H, v > 0 ? 3 : 2);
    const pts  = (bars: typeof proteinBars) => bars.map((b, i) => `${cx(i).toFixed(1)},${cy(b.value).toFixed(1)}`).join(" ");
    const coords = proteinBars.map((_, i) => ({ x: cx(i), y: cy(proteinBars[i].value) }));
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].x - coords[i-1].x, dy = coords[i].y - coords[i-1].y;
      len += Math.sqrt(dx*dx + dy*dy);
    }
    return { ptsP: pts(proteinBars), ptsC: pts(carbsBars), ptsF: pts(fatBars), pathLen: Math.ceil(len) + 20 };
  }, [proteinBars, carbsBars, fatBars, chartW, macroMax, period]);

  // Stagger the three animations
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

  const dashOffset = (a: Animated.Value) => (a as any).interpolate({ inputRange: [0, 1], outputRange: [pathLen, 0] });
  const barGap = period === 30 ? 2 : 3;

  const nonZero = (bars: typeof proteinBars) => bars.filter(b => b.value > 0);
  const avg = (bars: typeof proteinBars) => nonZero(bars).length ? Math.round(nonZero(bars).reduce((s, b) => s + b.value, 0) / nonZero(bars).length) : 0;
  const avgProtein = avg(proteinBars), avgCarbs = avg(carbsBars), avgFat = avg(fatBars);

  const yTicks = [
    { label: yFmt(macroMax),     top: 4  },
    { label: yFmt(macroMax / 2), top: 41 },
    { label: "0",                top: 76 },
  ];

  function renderTooltip() {
    if (selectedIdx === null || chartW <= 0) return null;
    const pb = proteinBars[selectedIdx];
    const cb = carbsBars[selectedIdx];
    const fb = fatBars[selectedIdx];
    if (!pb) return null;
    const hasData = pb.value > 0 || cb?.value > 0 || fb?.value > 0;
    if (!hasData) return null;

    const gap  = period === 30 ? 2 : 3;
    const barW = (chartW - gap * (proteinBars.length - 1)) / proteinBars.length;
    const cx   = selectedIdx * (barW + gap) + barW / 2;
    const total = (pb.value || 0) + (cb?.value || 0) + (fb?.value || 0);
    const totalMax = macroMax * 3;
    const barH = Math.max((total / totalMax) * BAR_MAX_H, 3);

    const tipW = 112;
    const tipX = Math.max(0, Math.min(cx - tipW / 2, chartW - tipW));
    const tipTop = Math.max(2, CHART_H - barH - 70); // 70px: tip height ~58px + 6 arrow + 6 gap

    return (
      <View pointerEvents="none" style={{ position: "absolute", left: tipX, top: tipTop, width: tipW, alignItems: "center" }}>
        <View style={{ backgroundColor: "rgba(20,20,20,0.95)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: tipW }}>
          {[
            { label: "Protein", value: Math.round(pb.value || 0), color: LIME },
            { label: "Carbs",   value: Math.round(cb?.value || 0), color: BLUE },
            { label: "Fat",     value: Math.round(fb?.value || 0), color: PURPLE },
          ].map(r => (
            <View key={r.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: r.color }} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{r.label}</Text>
              </View>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: r.color }}>{r.value}g</Text>
            </View>
          ))}
        </View>
        <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderStyle: "solid", borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "rgba(20,20,20,0.95)" }} />
      </View>
    );
  }

  return (
    <Modal visible={showing} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
        <Animated.View style={{
          position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
          backgroundColor: BG, transform: [{ scale }],
          borderRadius: borderRadius as any, overflow: "hidden",
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

                {/* Today hero */}
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
                      <View style={{ width: "100%", height: 3, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                        <View style={{ width: `${Math.min(m.target > 0 ? (m.val / m.target) * 100 : 0, 100)}%`, height: "100%", backgroundColor: m.color, borderRadius: 2 }} />
                      </View>
                    </View>
                  ))}
                </View>

                {/* Avg stats */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                  {[
                    { label: "AVG PROTEIN", value: avgProtein || "—", unit: "g/day", color: LIME },
                    { label: "AVG CARBS",   value: avgCarbs   || "—", unit: "g/day", color: BLUE },
                    { label: "AVG FAT",     value: avgFat     || "—", unit: "g/day", color: PURPLE },
                  ].map(s => (
                    <View key={s.label} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 10, alignItems: "center" }}>
                      <Text style={{ fontFamily: "Doto", fontSize: 22, color: s.color, lineHeight: 26 }}>{String(s.value)}</Text>
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

                {/* Y-axis + Chart */}
                <View style={{ flexDirection: "row" }}>
                  {/* Y-axis */}
                  <View style={{ width: Y_AXIS_W, height: CHART_H, marginRight: 4 }}>
                    {yTicks.map(t => (
                      <Text key={t.label} style={{ position: "absolute", top: t.top, right: 2, fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(255,255,255,0.28)", textAlign: "right" }}>
                        {t.label}
                      </Text>
                    ))}
                  </View>

                  {/* Chart area */}
                  <View style={{ flex: 1, height: CHART_H }} onLayout={e => setChartW(e.nativeEvent.layout.width)}>
                    {/* Gray bars (total macros combined), Pressable */}
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: CHART_H, position: "absolute", left: 0, right: 0, top: 0 }}>
                      {proteinBars.map((b, i) => {
                        const total    = (b.value || 0) + (carbsBars[i]?.value || 0) + (fatBars[i]?.value || 0);
                        const totalMax = macroMax * 3;
                        const pct      = total / totalMax;
                        const dimmed   = selectedIdx !== null && selectedIdx !== i;
                        return (
                          <Pressable
                            key={i}
                            onPress={() => setSelectedIdx(prev => prev === i ? null : i)}
                            style={{ flex: 1, justifyContent: "flex-end", height: CHART_H }}
                          >
                            <View style={{
                              width: "100%", borderRadius: 3,
                              height: Math.max(pct * BAR_MAX_H, total > 0 ? 3 : 2),
                              backgroundColor: b.isToday ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                              opacity: dimmed ? 0.3 : 1,
                            }} />
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* SVG: grid lines + three glow lines */}
                    {chartW > 0 && (
                      <Svg width={chartW} height={CHART_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
                        {/* Grid lines */}
                        <SvgLine x1={0} y1={CHART_H - BAR_MAX_H}     x2={chartW} y2={CHART_H - BAR_MAX_H}     stroke="white" strokeOpacity={0.07} strokeWidth={1} />
                        <SvgLine x1={0} y1={CHART_H - BAR_MAX_H / 2} x2={chartW} y2={CHART_H - BAR_MAX_H / 2} stroke="white" strokeOpacity={0.07} strokeWidth={1} />

                        {/* Protein — LIME */}
                        {pathLen > 0 && <>
                          <AnimatedPolyline points={ptsP} fill="none" stroke={LIME} strokeOpacity={0.08} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                          <AnimatedPolyline points={ptsP} fill="none" stroke={LIME} strokeOpacity={0.35} strokeWidth={5}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                          <AnimatedPolyline points={ptsP} fill="none" stroke={LIME} strokeOpacity={1}    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(limeAnim)} />
                          {/* Carbs — BLUE */}
                          <AnimatedPolyline points={ptsC} fill="none" stroke={BLUE} strokeOpacity={0.08} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                          <AnimatedPolyline points={ptsC} fill="none" stroke={BLUE} strokeOpacity={0.35} strokeWidth={5}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                          <AnimatedPolyline points={ptsC} fill="none" stroke={BLUE} strokeOpacity={1}    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(blueAnim)} />
                          {/* Fat — PURPLE */}
                          <AnimatedPolyline points={ptsF} fill="none" stroke={PURPLE} strokeOpacity={0.08} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                          <AnimatedPolyline points={ptsF} fill="none" stroke={PURPLE} strokeOpacity={0.35} strokeWidth={5}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                          <AnimatedPolyline points={ptsF} fill="none" stroke={PURPLE} strokeOpacity={1}    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLen} strokeDashoffset={dashOffset(purpleAnim)} />
                        </>}
                      </Svg>
                    )}

                    {/* Tap tooltip */}
                    {renderTooltip()}
                  </View>
                </View>

                {/* X-axis labels */}
                <View style={{ flexDirection: "row", gap: barGap, marginTop: 5, marginLeft: Y_AXIS_W + 4 }}>
                  {proteinBars.map((b, i) => (
                    <View key={i} style={{ flex: 1, alignItems: "center" }}>
                      {b.showLabel && (
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: period === 7 ? 9 : 8, color: b.isToday ? "#ffffff" : "rgba(255,255,255,0.3)" } as any} numberOfLines={1}>{b.label}</Text>
                      )}
                    </View>
                  ))}
                </View>

                {/* Colour legend */}
                <View style={{ flexDirection: "row", gap: 16, marginTop: 14, marginBottom: 8, marginLeft: Y_AXIS_W + 4 }}>
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
