/**
 * ExpandCardModal
 * A reusable full-screen expand animation modal with bar chart + animated glow line.
 * Used by Steps, Calories, Creatine, and Body Weight cards.
 */
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import {
  View, Text, Pressable, Modal, ScrollView,
  Animated, Dimensions, Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline, Line as SvgLine } from "react-native-svg";
import type { ChartBar } from "@/lib/chart-utils";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

export interface StatCard {
  label: string;
  value: string;
  unit: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Background of the expanded modal (matches the card's accent colour). */
  bgColor: string;
  /** True = white text (dark background), false = dark text (light background). */
  isDark?: boolean;
  title: string;
  icon?: React.ReactNode;

  /** Period selector */
  period: 7 | 30 | 90;
  onPeriodChange: (p: 7 | 30 | 90) => void;
  /** Hide the period toggle (e.g. steps only has 7 days from HealthKit). */
  noPeriodSelector?: boolean;

  /** Pre-built chart bars (from buildChartBars). */
  chartBars: ChartBar[];
  chartMaxValue: number;
  /** If provided, draws a dashed goal line at this value. */
  goalValue?: number;
  chartLabel?: string;
  /** Colour of the animated glow line and goal dashes. Defaults to white. */
  glowColor?: string;

  stats: StatCard[];

  /** Hero area: big number, progress bar, etc. Rendered at top of scroll. */
  children?: React.ReactNode;
  /** Log entries rendered below the chart. */
  logSection?: React.ReactNode;
}

export function ExpandCardModal({
  visible, onClose,
  bgColor, isDark = false,
  title, icon,
  period, onPeriodChange, noPeriodSelector,
  chartBars, chartMaxValue, goalValue, chartLabel,
  glowColor = "white",
  stats,
  children, logSection,
}: Props) {
  const fg        = isDark ? "rgba(255,255,255," : "rgba(0,0,0,";
  const textMain  = isDark ? "#ffffff" : "#0a0a0a";
  const textMuted = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const statBg    = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const selectorBg = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const selectorActiveBg = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.18)";
  const barActive = isDark ? "#ffffff" : "#0a0a0a";
  const barMet    = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
  const barEmpty  = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";

  const expandAnim  = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const lineAnim    = useRef(new Animated.Value(0)).current;
  const [showing, setShowing]     = useState(false);
  const [chartWidth, setChartWidth] = useState(0);

  // Animate in when visible becomes true
  useEffect(() => {
    if (visible) {
      setShowing(true);
      expandAnim.setValue(0);
      contentAnim.setValue(0);
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

  // Compute SVG geometry from chart bars
  const { pts, pathLength, goalY } = useMemo(() => {
    if (chartWidth <= 0 || chartBars.length === 0) return { pts: "", pathLength: 0, goalY: 0 };
    const gap  = period === 30 ? 2 : 3;
    const barW = (chartWidth - gap * (chartBars.length - 1)) / chartBars.length;
    const H = 90, BH = 78;
    const coords = chartBars.map((b, i) => ({
      x: i * (barW + gap) + barW / 2,
      y: H - Math.max((b.value / chartMaxValue) * BH, b.value > 0 ? 3 : 2),
    }));
    const pts = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].x - coords[i-1].x, dy = coords[i].y - coords[i-1].y;
      len += Math.sqrt(dx*dx + dy*dy);
    }
    const gy = goalValue != null ? H - (goalValue / chartMaxValue) * BH : 0;
    return { pts, pathLength: Math.ceil(len) + 20, goalY: gy };
  }, [chartBars, chartWidth, chartMaxValue, period, goalValue]);

  // Trigger draw animation
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

  return (
    <Modal visible={showing} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }}>
        <Animated.View style={{
          position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
          backgroundColor: bgColor,
          transform: [{ scale }],
          borderRadius: borderRadius as any,
          overflow: "hidden",
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
                {/* Hero slot */}
                {children}

                {/* Stats row */}
                {stats.length > 0 && (
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                    {stats.map(s => (
                      <View key={s.label} style={{ flex: 1, backgroundColor: statBg, borderRadius: 16, padding: 12, alignItems: "center" }}>
                        <Text style={{ fontFamily: "Doto", fontSize: 24, color: textMain, lineHeight: 28 }}>{s.value}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: textMuted, letterSpacing: 0.5, marginTop: 2 }}>{s.unit}</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)", letterSpacing: 0.5, marginTop: 1 }}>{s.label}</Text>
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
                        backgroundColor: period === p ? selectorActiveBg : "transparent",
                      }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: period === p ? textMain : textMuted }}>
                          {p === 7 ? "7 Days" : p === 30 ? "30 Days" : "90 Days"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* Bar chart */}
                {chartBars.length > 0 && (
                  <View style={{ marginBottom: 24 }}>
                    {chartLabel && (
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: textMuted, letterSpacing: 0.6, marginBottom: 10 }}>
                        {period === 90 ? `${chartLabel} (WEEKLY AVG)` : chartLabel}
                      </Text>
                    )}
                    <View style={{ height: 90 }} onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
                      {/* Bars */}
                      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: barGap, height: 90, position: "absolute", left: 0, right: 0, top: 0 }}>
                        {chartBars.map((b, i) => {
                          const pct = b.value / chartMaxValue;
                          const metGoal = goalValue != null ? b.value >= goalValue : pct >= 0.9;
                          return (
                            <View key={i} style={{ flex: 1, justifyContent: "flex-end", height: 90 }}>
                              <View style={{
                                width: "100%", borderRadius: 3,
                                height: Math.max(pct * 78, b.value > 0 ? 3 : 2),
                                backgroundColor: b.isToday ? barActive : metGoal ? barMet : barEmpty,
                              }} />
                            </View>
                          );
                        })}
                      </View>

                      {/* SVG glow line + optional goal line */}
                      {pathLength > 0 && (
                        <Svg width={chartWidth} height={90} style={{ position: "absolute", left: 0, top: 0 }}>
                          {goalValue != null && (
                            <>
                              <SvgLine x1={0} y1={goalY} x2={chartWidth} y2={goalY} stroke={glowColor} strokeOpacity={0.25} strokeWidth={10} />
                              <SvgLine x1={0} y1={goalY} x2={chartWidth} y2={goalY} stroke={glowColor} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5,5" />
                            </>
                          )}
                          <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.07} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                          <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.2}  strokeWidth={9}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                          <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={0.5}  strokeWidth={4}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                          <AnimatedPolyline points={pts} fill="none" stroke={glowColor} strokeOpacity={1}    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={pathLength} strokeDashoffset={animDashOffset} />
                        </Svg>
                      )}
                    </View>

                    {/* X-axis labels */}
                    <View style={{ flexDirection: "row", gap: barGap, marginTop: 5 }}>
                      {chartBars.map((b, i) => (
                        <View key={i} style={{ flex: 1, alignItems: "center" }}>
                          {b.showLabel && (
                            <Text style={{ fontFamily: "Manrope-Bold", fontSize: period === 7 ? 9 : 8, color: b.isToday ? textMain : isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)" } as any} numberOfLines={1}>
                              {b.label}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>

                    {/* Goal legend */}
                    {goalValue != null && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                        <View style={{ width: 16, height: 2, backgroundColor: glowColor, opacity: 0.7 }} />
                        <Text style={{ fontFamily: "Manrope", fontSize: 10, color: textMuted }}>Goal: {goalValue.toLocaleString()}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Log section */}
                {logSection}
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
