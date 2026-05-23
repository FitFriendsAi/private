/**
 * ExpandCardModal
 * Reusable full-screen expand modal: bar chart + animated glow line.
 * Features: y-axis labels, horizontal grid lines, tap-bar tooltip.
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { View, Text, Pressable, Modal, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline, Line as SvgLine } from "react-native-svg";
import type { ChartBar } from "@/lib/chart-utils";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const Y_AXIS_W = 34; // px reserved for y-axis labels
const CHART_H  = 90;
const BAR_MAX_H = 78;

/** Compact number formatter for y-axis ticks */
function yFmt(v: number): string {
  if (v === 0) return "0";
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000)  return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (v % 1 === 0) return v.toString();
  return v.toFixed(1);
}

export interface StatCard { label: string; value: string; unit: string }

interface Props {
  visible: boolean;
  onClose: () => void;
  bgColor: string;
  isDark?: boolean;
  title: string;
  icon?: React.ReactNode;

  period: 7 | 30 | 90;
  onPeriodChange: (p: 7 | 30 | 90) => void;
  noPeriodSelector?: boolean;

  chartBars: ChartBar[];
  chartMaxValue: number;
  goalValue?: number;
  chartLabel?: string;
  glowColor?: string;
  /** Format the tooltip value label. Defaults to compact number. */
  formatValue?: (v: number) => string;

  stats: StatCard[];
  children?: React.ReactNode;
  logSection?: React.ReactNode;
}

export function ExpandCardModal({
  visible, onClose,
  bgColor, isDark = false,
  title, icon,
  period, onPeriodChange, noPeriodSelector,
  chartBars, chartMaxValue, goalValue, chartLabel,
  glowColor = "white",
  formatValue,
  stats, children, logSection,
}: Props) {
  // ── Derived colours ──────────────────────────────────────────────
  const fg             = isDark ? "rgba(255,255,255," : "rgba(0,0,0,";
  const textMain       = isDark ? "#ffffff" : "#0a0a0a";
  const textMuted      = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const statBg         = isDark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.1)";
  const selectorBg     = isDark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.1)";
  const selectorActive = isDark ? "rgba(255,255,255,0.2)"  : "rgba(0,0,0,0.18)";
  const barActive      = isDark ? "#ffffff" : "#0a0a0a";
  const barMet         = isDark ? "rgba(255,255,255,0.5)"  : "rgba(0,0,0,0.5)";
  const barEmpty       = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
  const gridColor      = isDark ? "rgba(255,255,255,1)"    : "rgba(0,0,0,1)";
  const tipBg          = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.88)";
  const tipText        = isDark ? "#0a0a0a" : "#ffffff";
  const axisMuted      = isDark ? "rgba(255,255,255,0.3)"  : "rgba(0,0,0,0.3)";

  const fmtTip = formatValue ?? yFmt;

  // ── Animation refs ───────────────────────────────────────────────
  const expandAnim  = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const lineAnim    = useRef(new Animated.Value(0)).current;

  const [showing,     setShowing]    = useState(false);
  const [chartWidth,  setChartWidth] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Reset selection on period change
  useEffect(() => { setSelectedIdx(null); }, [period]);

  // Animate in
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

  const scale       = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] });
  const borderRadius = expandAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [999, 40, 0] });

  // ── SVG geometry ─────────────────────────────────────────────────
  const { pts, pathLength, goalY } = useMemo(() => {
    if (chartWidth <= 0 || chartBars.length === 0) return { pts: "", pathLength: 0, goalY: 0 };
    const gap  = period === 30 ? 2 : 3;
    const barW = (chartWidth - gap * (chartBars.length - 1)) / chartBars.length;
    const coords = chartBars.map((b, i) => ({
      x: i * (barW + gap) + barW / 2,
      y: CHART_H - Math.max((b.value / chartMaxValue) * BAR_MAX_H, b.value > 0 ? 3 : 2),
    }));
    const pts = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].x - coords[i-1].x, dy = coords[i].y - coords[i-1].y;
      len += Math.sqrt(dx*dx + dy*dy);
    }
    const gy = goalValue != null ? CHART_H - (goalValue / chartMaxValue) * BAR_MAX_H : 0;
    return { pts, pathLength: Math.ceil(len) + 20, goalY: gy };
  }, [chartBars, chartWidth, chartMaxValue, period, goalValue]);

  // Draw animation
  useEffect(() => {
    if (pathLength > 0 && visible) {
      lineAnim.setValue(0);
      Animated.timing(lineAnim, {
        toValue: 1, duration: 1400, useNativeDriver: false,
        easing: Easing.out(Easing.cubic), delay: 200,
      }).start();
    }
  }, [pathLength, visible, period]);

  const animDashOffset = (lineAnim as any).interpolate({ inputRange: [0, 1], outputRange: [pathLength, 0] });
  const barGap = period === 30 ? 2 : 3;

  // ── Y-axis ticks ─────────────────────────────────────────────────
  const yTicks = [
    { label: yFmt(chartMaxValue),     top: 4   },  // ~100%
    { label: yFmt(chartMaxValue / 2), top: 41  },  // ~50%
    { label: "0",                     top: 76  },  // 0%
  ];

  // ── Tooltip helper ───────────────────────────────────────────────
  function renderTooltip() {
    if (selectedIdx === null || chartWidth <= 0) return null;
    const b = chartBars[selectedIdx];
    if (!b || b.value === 0) return null;
    const gap  = period === 30 ? 2 : 3;
    const barW = (chartWidth - gap * (chartBars.length - 1)) / chartBars.length;
    const cx   = selectedIdx * (barW + gap) + barW / 2;
    const barH = Math.max((b.value / chartMaxValue) * BAR_MAX_H, 3);
    const tipW = 80;
    const tipX = Math.max(0, Math.min(cx - tipW / 2, chartWidth - tipW));
    const tipTop = Math.max(2, CHART_H - barH - 40);
    return (
      <View pointerEvents="none" style={{ position: "absolute", left: tipX, top: tipTop, width: tipW, alignItems: "center" }}>
        <View style={{ backgroundColor: tipBg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}>
          <Text style={{ color: tipText, fontSize: 11, fontFamily: "Manrope-Bold", textAlign: "center" }}>
            {fmtTip(b.value)}
          </Text>
        </View>
        {/* Arrow */}
        <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderStyle: "solid", borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: tipBg }} />
      </View>
    );
  }

  return (
    <Modal visible={showing} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }}>
        <Animated.View style={{
          position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
          backgroundColor: bgColor, transform: [{ scale }],
          borderRadius: borderRadius as any, overflow: "hidden",
        }}>
          <Animated.View style={{ flex: 1, opacity: contentAnim }}>
            <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>

              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {icon}
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: textMain }}>{title}</Text>
                </View>
                <Pressable onPress={close} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${fg}0.12)`, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: textMain, lineHeight: 20 }}>×</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
                {children}

                {/* Stats row */}
                {stats.length > 0 && (
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                    {stats.map(s => (
                      <View key={s.label} style={{ flex: 1, backgroundColor: statBg, borderRadius: 16, padding: 12, alignItems: "center" }}>
                        <Text style={{ fontFamily: "Doto", fontSize: 24, color: textMain, lineHeight: 28 }}>{s.value}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: textMuted, letterSpacing: 0.5, marginTop: 2 }}>{s.unit}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: axisMuted, letterSpacing: 0.5, marginTop: 1 }}>{s.label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Period selector */}
                {!noPeriodSelector && (
                  <View style={{ flexDirection: "row", backgroundColor: selectorBg, borderRadius: 12, padding: 3, marginBottom: 20 }}>
                    {([7, 30, 90] as const).map(p => (
                      <Pressable key={p} onPress={() => onPeriodChange(p)} style={{
                        flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center",
                        backgroundColor: period === p ? selectorActive : "transparent",
                      }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: period === p ? textMain : textMuted }}>
                          {p === 7 ? "7 Days" : p === 30 ? "30 Days" : "90 Days"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* Chart */}
                {chartBars.length > 0 && (
                  <View style={{ marginBottom: 24 }}>
                    {chartLabel && (
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: textMuted, letterSpacing: 0.6, marginBottom: 10 }}>
                        {period === 90 ? `${chartLabel} (WEEKLY AVG)` : chartLabel}
                      </Text>
                    )}

                    {/* Y-axis + Chart row */}
                    <View style={{ flexDirection: "row" }}>
                      {/* Y-axis */}
                      <View style={{ width: Y_AXIS_W, height: CHART_H, marginRight: 4 }}>
                        {yTicks.map(t => (
                          <Text key={t.label} style={{ position: "absolute", top: t.top, right: 2, fontFamily: "Manrope-Bold", fontSize: 8, color: axisMuted, textAlign: "right" }}>
                            {t.label}
                          </Text>
                        ))}
                      </View>

                      {/* Chart area */}
                      <View style={{ flex: 1, height: CHART_H }} onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
                        {/* Bars (Pressable columns) */}
                        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: CHART_H, position: "absolute", left: 0, right: 0, top: 0 }}>
                          {chartBars.map((b, i) => {
                            const pct     = b.value / chartMaxValue;
                            const metGoal = goalValue != null ? b.value >= goalValue : pct >= 0.9;
                            const dimmed  = selectedIdx !== null && selectedIdx !== i;
                            return (
                              <Pressable
                                key={i}
                                onPress={() => setSelectedIdx(prev => prev === i ? null : i)}
                                style={{ flex: 1, justifyContent: "flex-end", height: CHART_H }}
                              >
                                <View style={{
                                  width: "100%", borderRadius: 3,
                                  height: Math.max(pct * BAR_MAX_H, b.value > 0 ? 3 : 2),
                                  backgroundColor: b.isToday ? barActive : metGoal ? barMet : barEmpty,
                                  opacity: dimmed ? 0.3 : 1,
                                }} />
                              </Pressable>
                            );
                          })}
                        </View>

                        {/* SVG: grid lines + goal + glow */}
                        {chartWidth > 0 && (
                          <Svg width={chartWidth} height={CHART_H} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
                            {/* Horizontal grid lines at 100% and 50% */}
                            <SvgLine x1={0} y1={CHART_H - BAR_MAX_H}      x2={chartWidth} y2={CHART_H - BAR_MAX_H}      stroke={gridColor} strokeOpacity={0.07} strokeWidth={1} />
                            <SvgLine x1={0} y1={CHART_H - BAR_MAX_H / 2}  x2={chartWidth} y2={CHART_H - BAR_MAX_H / 2}  stroke={gridColor} strokeOpacity={0.07} strokeWidth={1} />

                            {/* Goal line */}
                            {goalValue != null && (
                              <>
                                <SvgLine x1={0} y1={goalY} x2={chartWidth} y2={goalY} stroke={glowColor} strokeOpacity={0.25} strokeWidth={10} />
                                <SvgLine x1={0} y1={goalY} x2={chartWidth} y2={goalY} stroke={glowColor} strokeOpacity={0.6}  strokeWidth={1.5} strokeDasharray="5,5" />
                              </>
                            )}

                            {/* Animated glow line */}
                            {pathLength > 0 && (
                              <>
                                <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.07} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                                <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.2}  strokeWidth={9}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                                <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.5}  strokeWidth={4}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                                <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={1}    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                              </>
                            )}
                          </Svg>
                        )}

                        {/* Tap tooltip */}
                        {renderTooltip()}
                      </View>
                    </View>

                    {/* X-axis labels (offset to align with chart, past y-axis) */}
                    <View style={{ flexDirection: "row", gap: barGap, marginTop: 5, marginLeft: Y_AXIS_W + 4 }}>
                      {chartBars.map((b, i) => (
                        <View key={i} style={{ flex: 1, alignItems: "center" }}>
                          {b.showLabel && (
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: period === 7 ? 9 : 8, color: b.isToday ? textMain : axisMuted } as any} numberOfLines={1}>
                              {b.label}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>

                    {/* Goal legend */}
                    {goalValue != null && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginLeft: Y_AXIS_W + 4 }}>
                        <View style={{ width: 16, height: 2, backgroundColor: glowColor, opacity: 0.7 }} />
                        <Text style={{ fontFamily: "Manrope", fontSize: 10, color: textMuted }}>Goal: {goalValue.toLocaleString()}</Text>
                      </View>
                    )}
                  </View>
                )}

                {logSection}
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
