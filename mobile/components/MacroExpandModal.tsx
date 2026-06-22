/**
 * MacroExpandModal — expanded view for Protein / Carbs / Fat.
 * Tap a macro card to isolate that macro with color-coded bars + target line.
 * "All" view shows stacked colored bars (protein/carbs/fat).
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Rect, Line as SvgLine, Polyline } from "react-native-svg";
import { buildChartBars } from "@/lib/chart-utils";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const LIME   = "#c8e84c";
const BLUE   = "#9bd1ff";
const PURPLE = "#d3a8ff";
const BG     = "#0d0d0d";

const CHART_H  = 120;
const BAR_MAX_H = 105;
const MINI_H   = 100;
const MINI_BAR = 85;
const Y_AXIS_W  = 34;

type MacroFilter = "all" | "protein" | "carbs" | "fat";
const MACRO_COLOR: Record<string, string> = { protein: LIME, carbs: BLUE, fat: PURPLE };

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

  const [showing, setShowing] = useState(false);
  const [chartW, setChartW] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<MacroFilter>("all");
  const [showPercent, setShowPercent] = useState(false);

  useEffect(() => { setSelectedIdx(null); }, [period, filter, showPercent]);

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
    ]).start(() => { setShowing(false); setFilter("all"); onClose(); });
  }, [onClose]);

  const scale        = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] });
  const borderRadius = expandAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [999, 40, 0] });

  const proteinBars = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.protein })), period), [history, period]);
  const carbsBars   = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.carbs   })), period), [history, period]);
  const fatBars     = useMemo(() => buildChartBars(history.map(d => ({ date: d.date, value: d.fat     })), period), [history, period]);

  const todayShares = useMemo(() => {
    const p = todayProtein * 4, c = todayCarbs * 4, f = todayFat * 9, t = p + c + f;
    const s = (x: number) => t > 0 ? Math.round((x / t) * 100) : 0;
    return { protein: s(p), carbs: s(c), fat: s(f) };
  }, [todayProtein, todayCarbs, todayFat]);

  const nonZero = (bars: typeof proteinBars) => bars.filter(b => b.value > 0 && !b.isToday);
  const avg = (bars: typeof proteinBars) => nonZero(bars).length ? Math.round(nonZero(bars).reduce((s, b) => s + b.value, 0) / nonZero(bars).length) : 0;
  const avgProtein = avg(proteinBars), avgCarbs = avg(carbsBars), avgFat = avg(fatBars);

  const barGap = period === 30 ? 2 : 3;

  const pctBars = useMemo(() => {
    if (!showPercent) return { protein: proteinBars, carbs: carbsBars, fat: fatBars };
    const p: typeof proteinBars = [], c: typeof carbsBars = [], f: typeof fatBars = [];
    for (let i = 0; i < proteinBars.length; i++) {
      const pCal = proteinBars[i].value * 4;
      const cCal = (carbsBars[i]?.value ?? 0) * 4;
      const fCal = (fatBars[i]?.value ?? 0) * 9;
      const total = pCal + cCal + fCal;
      const share = (x: number) => total > 0 ? (x / total) * 100 : 0;
      p.push({ ...proteinBars[i], value: share(pCal) });
      c.push({ ...carbsBars[i], value: share(cCal) });
      f.push({ ...fatBars[i], value: share(fCal) });
    }
    return { protein: p, carbs: c, fat: f };
  }, [showPercent, proteinBars, carbsBars, fatBars]);

  const activeBarsForFilter = filter === "protein" ? pctBars.protein : filter === "carbs" ? pctBars.carbs : pctBars.fat;

  const avgPct = useMemo(() => {
    if (!showPercent || filter === "all") return { protein: 0, carbs: 0, fat: 0 };
    const nz = (bars: typeof proteinBars) => bars.filter(b => b.value > 0);
    const a = (bars: typeof proteinBars) => { const v = nz(bars); return v.length ? Math.round(v.reduce((s, b) => s + b.value, 0) / v.length) : 0; };
    return { protein: a(pctBars.protein), carbs: a(pctBars.carbs), fat: a(pctBars.fat) };
  }, [showPercent, filter, pctBars]);

  const macroCards = [
    { key: "protein" as MacroFilter, label: "PROTEIN", val: todayProtein, target: targetProtein, color: LIME, avg: avgProtein, share: todayShares.protein },
    { key: "carbs" as MacroFilter, label: "CARBS", val: todayCarbs, target: targetCarbs, color: BLUE, avg: avgCarbs, share: todayShares.carbs },
    { key: "fat" as MacroFilter, label: "FAT", val: todayFat, target: targetFat, color: PURPLE, avg: avgFat, share: todayShares.fat },
  ];

  const targetShares = useMemo(() => {
    const pCal = targetProtein * 4, cCal = targetCarbs * 4, fCal = targetFat * 9;
    const total = pCal + cCal + fCal;
    if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
    return { protein: Math.round((pCal / total) * 100), carbs: Math.round((cCal / total) * 100), fat: Math.round((fCal / total) * 100) };
  }, [targetProtein, targetCarbs, targetFat]);

  // Chart data depends on filter + percent mode
  const { chartMax, goalLineY, goalLabel } = useMemo(() => {
    if (showPercent && filter !== "all") {
      const targetPct = (targetShares as any)[filter] as number;
      const y = targetPct > 0 ? (1 - targetPct / 50) * BAR_MAX_H + (CHART_H - BAR_MAX_H) : null;
      return { chartMax: 50, goalLineY: y, goalLabel: `${targetPct}%` };
    }
    if (showPercent) {
      return { chartMax: 100, goalLineY: null, goalLabel: "" };
    }
    if (filter !== "all") {
      const target = filter === "protein" ? targetProtein : filter === "carbs" ? targetCarbs : targetFat;
      const bars = filter === "protein" ? proteinBars : filter === "carbs" ? carbsBars : fatBars;
      const m = Math.max(...bars.map(b => b.value), target, 1);
      return { chartMax: m, goalLineY: target > 0 ? (1 - target / m) * BAR_MAX_H + (CHART_H - BAR_MAX_H) : null, goalLabel: `${target}g` };
    }
    const stackedMax = Math.max(
      ...proteinBars.map((b, i) => b.value + (carbsBars[i]?.value ?? 0) + (fatBars[i]?.value ?? 0)),
      1,
    );
    return { chartMax: stackedMax, goalLineY: null, goalLabel: "" };
  }, [filter, showPercent, targetShares, proteinBars, carbsBars, fatBars, targetProtein, targetCarbs, targetFat]);

  const pctSuffix = showPercent ? "%" : "";
  const yTicks = [
    { label: yFmt(chartMax) + pctSuffix, top: 4 },
    { label: yFmt(chartMax / 2) + pctSuffix, top: CHART_H / 2 - 5 },
    { label: "0" + pctSuffix, top: CHART_H - 14 },
  ];

  function renderSingleMacroBars() {
    if (chartW <= 0 || proteinBars.length === 0 || filter === "all") return null;
    const bars = showPercent ? activeBarsForFilter : (filter === "protein" ? proteinBars : filter === "carbs" ? carbsBars : fatBars);
    const color = MACRO_COLOR[filter];
    return (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: CHART_H, position: "absolute", left: 0, right: 0, top: 0 }}>
        {bars.map((b, i) => {
          const h = chartMax > 0 ? Math.max((b.value / chartMax) * BAR_MAX_H, b.value > 0 ? 3 : 1) : 1;
          const dimmed = selectedIdx !== null && selectedIdx !== i;
          return (
            <Pressable key={i} onPress={() => setSelectedIdx(prev => prev === i ? null : i)} style={{ flex: 1, justifyContent: "flex-end", height: CHART_H }}>
              <View style={{ width: "100%", borderRadius: 3, height: h, backgroundColor: color, opacity: dimmed ? 0.25 : b.isToday ? 1 : 0.7 }} />
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderMiniChart(label: string, bars: typeof proteinBars, color: string, target: number, targetPct: number, showTooltip: boolean) {
    if (chartW <= 0 || bars.length === 0) return null;
    const isPct = showPercent;
    const displayBars = isPct ? (() => {
      const out: typeof bars = [];
      for (let i = 0; i < bars.length; i++) {
        const pCal = proteinBars[i].value * 4;
        const cCal = (carbsBars[i]?.value ?? 0) * 4;
        const fCal = (fatBars[i]?.value ?? 0) * 9;
        const total = pCal + cCal + fCal;
        const macroVal = label === "Protein" ? pCal : label === "Carbs" ? cCal : fCal;
        out.push({ ...bars[i], value: total > 0 ? (macroVal / total) * 100 : 0 });
      }
      return out;
    })() : bars;
    const max = isPct ? 100 : Math.max(...bars.map(b => b.value), target, 1);
    const goalVal = isPct ? targetPct : target;
    const goalY = goalVal > 0 ? (1 - goalVal / max) * MINI_BAR + (MINI_H - MINI_BAR) : null;
    const suffix = isPct ? "%" : "g";

    const n = displayBars.length;
    const barW = n > 0 ? (chartW - barGap * (n - 1)) / n : 0;

    return (
      <View key={label} style={{ marginBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{label.toUpperCase()}</Text>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color }}>
            {isPct ? (label === "Protein" ? todayShares.protein : label === "Carbs" ? todayShares.carbs : todayShares.fat) + "%" : (label === "Protein" ? todayProtein : label === "Carbs" ? todayCarbs : todayFat) + "g"}
          </Text>
          {goalVal > 0 && (
            <Text style={{ fontFamily: "Manrope", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>/ {goalVal}{suffix} goal</Text>
          )}
        </View>
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: Y_AXIS_W, height: MINI_H, marginRight: 4 }}>
            <Text style={{ position: "absolute", top: 1, right: 2, fontFamily: "Manrope-Bold", fontSize: 7, color: "rgba(255,255,255,0.25)", textAlign: "right" }}>{yFmt(max)}{isPct ? "%" : ""}</Text>
            <Text style={{ position: "absolute", top: MINI_H - 12, right: 2, fontFamily: "Manrope-Bold", fontSize: 7, color: "rgba(255,255,255,0.25)", textAlign: "right" }}>0</Text>
          </View>
          <View style={{ flex: 1, height: MINI_H }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: MINI_H, position: "absolute", left: 0, right: 0, top: 0 }}>
              {displayBars.map((b, i) => {
                const h = max > 0 ? Math.max((b.value / max) * MINI_BAR, b.value > 0 ? 2 : 1) : 1;
                const dimmed = selectedIdx !== null && selectedIdx !== i;
                const highlighted = selectedIdx === i;
                return (
                  <Pressable key={i} onPress={() => setSelectedIdx(prev => prev === i ? null : i)} style={{ flex: 1, justifyContent: "flex-end", height: MINI_H }}>
                    <View style={{
                      width: "100%", borderRadius: 2, height: h, backgroundColor: color,
                      opacity: dimmed ? 0.2 : highlighted ? 1 : b.isToday ? 1 : 0.65,
                    }} />
                  </Pressable>
                );
              })}
            </View>
            {goalY != null && chartW > 0 && (
              <Svg width={chartW} height={MINI_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
                <SvgLine x1={0} y1={goalY} x2={chartW} y2={goalY} stroke={color} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="4,3" />
              </Svg>
            )}

            {/* Tooltip — only on the first chart (Protein) to avoid three tooltips */}
            {showTooltip && selectedIdx !== null && selectedIdx < n && (() => {
              const cx = selectedIdx * (barW + barGap) + barW / 2;
              const pVal = isPct ? (pctBars.protein[selectedIdx]?.value ?? 0) : (proteinBars[selectedIdx]?.value ?? 0);
              const cVal = isPct ? (pctBars.carbs[selectedIdx]?.value ?? 0) : (carbsBars[selectedIdx]?.value ?? 0);
              const fVal = isPct ? (pctBars.fat[selectedIdx]?.value ?? 0) : (fatBars[selectedIdx]?.value ?? 0);
              const tipW = 120;
              const tipX = Math.max(0, Math.min(cx - tipW / 2, chartW - tipW));
              return (
                <View pointerEvents="none" style={{ position: "absolute", left: tipX, top: 0, width: tipW, alignItems: "center" }}>
                  <View style={{ backgroundColor: "rgba(20,20,20,0.95)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: tipW }}>
                    {[
                      { l: "Protein", v: pVal, c: LIME },
                      { l: "Carbs", v: cVal, c: BLUE },
                      { l: "Fat", v: fVal, c: PURPLE },
                    ].map(r => (
                      <View key={r.l} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: r.c }} />
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{r.l}</Text>
                        </View>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: r.c }}>{Math.round(r.v)}{isPct ? "%" : "g"}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 5, borderStyle: "solid", borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "rgba(20,20,20,0.95)" }} />
                </View>
              );
            })()}
          </View>
        </View>
      </View>
    );
  }

  function renderTooltip() {
    if (selectedIdx === null || chartW <= 0) return null;
    const pb = proteinBars[selectedIdx];
    const cb = carbsBars[selectedIdx];
    const fb = fatBars[selectedIdx];
    if (!pb) return null;

    const n = proteinBars.length;
    const barW = (chartW - barGap * (n - 1)) / n;
    const cx = selectedIdx * (barW + barGap) + barW / 2;

    const rows = filter === "all"
      ? [
          { label: "Protein", value: showPercent ? (pctBars.protein[selectedIdx]?.value ?? 0) : pb.value, color: LIME },
          { label: "Carbs", value: showPercent ? (pctBars.carbs[selectedIdx]?.value ?? 0) : (cb?.value ?? 0), color: BLUE },
          { label: "Fat", value: showPercent ? (pctBars.fat[selectedIdx]?.value ?? 0) : (fb?.value ?? 0), color: PURPLE },
        ]
      : [{ label: filter.charAt(0).toUpperCase() + filter.slice(1), value: showPercent ? (activeBarsForFilter[selectedIdx]?.value ?? 0) : ((filter === "protein" ? pb : filter === "carbs" ? cb : fb)?.value ?? 0), color: MACRO_COLOR[filter] }];

    const tipW = filter === "all" ? 112 : 90;
    const tipX = Math.max(0, Math.min(cx - tipW / 2, chartW - tipW));

    return (
      <View pointerEvents="none" style={{ position: "absolute", left: tipX, top: 2, width: tipW, alignItems: "center" }}>
        <View style={{ backgroundColor: "rgba(20,20,20,0.95)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: tipW }}>
          {rows.map(r => (
            <View key={r.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: r.color }} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{r.label}</Text>
              </View>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: r.color }}>{Math.round(r.value)}{showPercent ? "%" : "g"}</Text>
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

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: "#ffffff" }}>Macros</Text>
                <Pressable onPress={close} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#ffffff", lineHeight: 20 }}>×</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

                {/* Tappable macro cards */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24, marginTop: 8 }}>
                  {macroCards.map(m => {
                    const active = filter === m.key;
                    const pctTarget = m.target > 0 ? Math.round((m.val / m.target) * 100) : 0;
                    return (
                      <Pressable
                        key={m.key}
                        onPress={() => setFilter(prev => prev === m.key ? "all" : m.key)}
                        style={{
                          flex: 1, backgroundColor: active ? `${m.color}15` : "rgba(255,255,255,0.07)",
                          borderRadius: 18, padding: 14, alignItems: "center",
                          borderWidth: active ? 1.5 : 0, borderColor: active ? `${m.color}55` : "transparent",
                        }}
                      >
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: active ? m.color : "rgba(255,255,255,0.4)", letterSpacing: 0.7, marginBottom: 6 }}>{m.label}</Text>
                        <Text style={{ fontFamily: "Doto", fontSize: 28, color: m.color, lineHeight: 32 }}>{showPercent ? m.share : m.val}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{showPercent ? "% of macros" : `/ ${m.target}g`}</Text>
                        <View style={{ width: "100%", height: 3, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                          <View style={{ width: `${Math.min(pctTarget, 100)}%`, height: "100%", backgroundColor: m.color, borderRadius: 2 }} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Avg stats */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                  {macroCards.filter(m => filter === "all" || filter === m.key).map(m => {
                    const isPct = showPercent;
                    const displayAvg = isPct ? (avgPct as any)[m.key] : m.avg;
                    const diff = !isPct && m.avg > 0 ? m.avg - m.target : null;
                    return (
                      <View key={m.key} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 10, alignItems: "center" }}>
                        <Text style={{ fontFamily: "Doto", fontSize: 22, color: m.color, lineHeight: 26 }}>{displayAvg || "—"}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5, marginTop: 2 }}>{isPct ? "% avg" : "g/day avg"}</Text>
                        {!isPct && (
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
                            Goal: {m.target}g
                          </Text>
                        )}
                        {diff != null && (
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: diff > 0 ? LIME : diff < 0 ? "#ff6b6b" : "rgba(255,255,255,0.3)", marginTop: 1 }}>
                            {diff > 0 ? "+" : ""}{diff}g
                          </Text>
                        )}
                      </View>
                    );
                  })}
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

                {/* Grams / Percent toggle */}
                <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 3, marginBottom: 16, alignSelf: "flex-start" }}>
                  {([{ key: false, label: "Grams" }, { key: true, label: "Percent" }] as const).map(opt => (
                    <Pressable key={opt.label} onPress={() => setShowPercent(opt.key)} style={{
                      paddingVertical: 7, paddingHorizontal: 16, borderRadius: 10, alignItems: "center",
                      backgroundColor: showPercent === opt.key ? "rgba(255,255,255,0.15)" : "transparent",
                    }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: showPercent === opt.key ? "#ffffff" : "rgba(255,255,255,0.4)" }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {filter === "all" ? (
                  <>
                    {/* Small multiples — one chart per macro */}
                    <View onLayout={e => { if (chartW === 0) setChartW(e.nativeEvent.layout.width - Y_AXIS_W - 4); }}>
                      {renderMiniChart("Protein", proteinBars, LIME, targetProtein, targetShares.protein, true)}
                      {renderMiniChart("Carbs", carbsBars, BLUE, targetCarbs, targetShares.carbs, false)}
                      {renderMiniChart("Fat", fatBars, PURPLE, targetFat, targetShares.fat, false)}
                    </View>
                    {/* Shared x-axis labels */}
                    <View style={{ flexDirection: "row", gap: barGap, marginLeft: Y_AXIS_W + 4 }}>
                      {proteinBars.map((b, i) => (
                        <View key={i} style={{ flex: 1, alignItems: "center" }}>
                          {b.showLabel && (
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: period === 7 ? 9 : 8, color: b.isToday ? "#ffffff" : "rgba(255,255,255,0.3)" } as any} numberOfLines={1}>{b.label}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    {/* Chart label */}
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 0.6, marginBottom: 10 }}>
                      {showPercent ? `${filter.toUpperCase()} (% OF MACRO CALORIES)` : `${filter.toUpperCase()} (g)`}
                    </Text>

                    {/* Y-axis + Chart */}
                    <View style={{ flexDirection: "row" }}>
                      <View style={{ width: Y_AXIS_W, height: CHART_H, marginRight: 4 }}>
                        {yTicks.map(t => (
                          <Text key={t.label + t.top} style={{ position: "absolute", top: t.top, right: 2, fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(255,255,255,0.28)", textAlign: "right" }}>
                            {t.label}
                          </Text>
                        ))}
                      </View>

                      <View style={{ flex: 1, height: CHART_H }} onLayout={e => setChartW(e.nativeEvent.layout.width)}>
                        {renderSingleMacroBars()}

                        {/* Grid lines */}
                        {chartW > 0 && (
                          <Svg width={chartW} height={CHART_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
                            <SvgLine x1={0} y1={CHART_H - BAR_MAX_H} x2={chartW} y2={CHART_H - BAR_MAX_H} stroke="white" strokeOpacity={0.07} strokeWidth={1} />
                            <SvgLine x1={0} y1={CHART_H - BAR_MAX_H / 2} x2={chartW} y2={CHART_H - BAR_MAX_H / 2} stroke="white" strokeOpacity={0.07} strokeWidth={1} />
                          </Svg>
                        )}

                        {/* Goal target line */}
                        {goalLineY != null && chartW > 0 && (
                          <Svg width={chartW} height={CHART_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
                            <SvgLine x1={0} y1={goalLineY} x2={chartW} y2={goalLineY} stroke={MACRO_COLOR[filter] ?? "#fff"} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="5,4" />
                          </Svg>
                        )}
                        {goalLineY != null && (
                          <View pointerEvents="none" style={{ position: "absolute", right: 0, top: (goalLineY ?? 0) - 14 }}>
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: MACRO_COLOR[filter] ?? "#fff" }}>
                              Goal {goalLabel}
                            </Text>
                          </View>
                        )}

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

                    {/* Legend */}
                    <View style={{ flexDirection: "row", gap: 16, marginTop: 14, marginBottom: 8, marginLeft: Y_AXIS_W + 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <View style={{ width: 16, height: 3, borderRadius: 1, backgroundColor: MACRO_COLOR[filter] }} />
                        <Text style={{ fontFamily: "Manrope", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</Text>
                      </View>
                    </View>
                  </>
                )}

              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
