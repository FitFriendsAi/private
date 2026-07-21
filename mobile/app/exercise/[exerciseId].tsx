import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Dimensions, Image, Animated, Easing,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";
import { ChevronLeft, Dumbbell, TrendingUp, ListOrdered } from "lucide-react-native";
import { apiRequest } from "@/lib/api";
import { gramsToLbs } from "@/lib/utils";

// Animated SVG polyline for the glow line
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// ── Theme ──────────────────────────────────────────────────────────────────────
const LIME  = "#C8E84C";
const DARK  = "#111111";
const CARD  = "#1A1A1A";
const MUTED = "#888888";

// ── Metric definitions ─────────────────────────────────────────────────────────
type Metric = "heaviest" | "e1rm" | "bestSetVol" | "sessionVol" | "totalReps";

const METRICS: { key: Metric; label: string; short: string }[] = [
  { key: "heaviest",    label: "Heaviest Weight",   short: "Heaviest" },
  { key: "e1rm",        label: "Est. 1-Rep Max",    short: "1RM" },
  { key: "bestSetVol",  label: "Best Set Volume",   short: "Best Set" },
  { key: "sessionVol",  label: "Session Volume",    short: "Volume" },
  { key: "totalReps",   label: "Total Reps",        short: "Reps" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function gToLbs(g: number) { return Math.round(gramsToLbs(g) * 10) / 10; }

function getMetricValue(row: any, metric: Metric): number {
  switch (metric) {
    case "heaviest":   return gToLbs(row.maxWeightGrams);
    case "e1rm":       return gToLbs(row.e1rmGrams);
    case "bestSetVol": return gToLbs(row.bestSetVolume);
    case "sessionVol": return gToLbs(row.sessionVolume);
    case "totalReps":  return row.totalReps;
  }
}

function formatMetricValue(val: number, metric: Metric): string {
  if (metric === "totalReps") return `${val} reps`;
  if (metric === "bestSetVol" || metric === "sessionVol") return `${val.toLocaleString()} lbs`;
  return `${val} lbs`;
}

function muscleColor(muscle: string): string {
  const m = (muscle || "").toLowerCase();
  if (m.includes("chest"))                     return "#E84C4C";
  if (m.includes("back") || m.includes("lat")) return "#4C8CE8";
  if (m.includes("quad") || m.includes("leg")) return "#E8C84C";
  if (m.includes("hamstring"))                 return "#E87C4C";
  if (m.includes("shoulder") || m.includes("delt")) return "#8CE84C";
  if (m.includes("bicep"))                     return "#4CE8C8";
  if (m.includes("tricep"))                    return "#C84CE8";
  if (m.includes("glute"))                     return "#E84C8C";
  if (m.includes("core") || m.includes("abs")) return "#4CE84C";
  if (m.includes("calf"))                      return "#E8E84C";
  return LIME;
}

// ── Bar chart with animated glow line ─────────────────────────────────────────
const CHART_H = 160;

function BarChart({
  data, metric, width,
}: { data: any[]; metric: Metric; width: number }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const lineAnim = useRef(new Animated.Value(0)).current;

  const values  = data.map(d => getMetricValue(d, metric));
  const maxVal  = Math.max(...values, 0.001);
  const minVal  = Math.min(...values);
  const spread  = maxVal - minVal;
  const axisMax = maxVal + Math.max(spread * 0.08, 1);
  const axisMin = Math.max(0, minVal - Math.max(spread * 0.08, 1));
  const axisRange = Math.max(axisMax - axisMin, 0.001);

  const Y_AXIS_W = 40;
  const chartW  = width - Y_AXIS_W - 8;
  // Fit all bars without scrolling — bar width shrinks for large datasets
  const BAR_GAP_PX = data.length > 30 ? 1 : data.length > 15 ? 2 : 3;
  const barW    = Math.max(2, Math.floor((chartW - BAR_GAP_PX * (data.length - 1)) / data.length));

  // SVG polyline: connect top-center of each bar
  const { pts, pathLength } = useMemo(() => {
    if (data.length < 2) return { pts: "", pathLength: 0 };
    const coords = data.map((_, i) => {
      const v    = values[i];
      const barH = v === 0 ? 3 : Math.max(((v - axisMin) / axisRange) * CHART_H, 4);
      const x    = i * (barW + BAR_GAP_PX) + barW / 2;
      const y    = CHART_H - barH;
      return { x, y };
    });
    const ptsStr = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].x - coords[i - 1].x;
      const dy = coords[i].y - coords[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return { pts: ptsStr, pathLength: Math.ceil(len) + 10 };
  }, [values.join(","), barW, axisMin, axisRange, BAR_GAP_PX]);

  // Re-animate whenever the displayed metric changes
  useEffect(() => {
    if (pathLength > 0) {
      lineAnim.setValue(0);
      Animated.timing(lineAnim, {
        toValue:        1,
        duration:       1300,
        useNativeDriver: false,
        easing:         Easing.out(Easing.cubic),
        delay:          80,
      }).start();
    }
  }, [pathLength, metric]);

  const animDashOffset = (lineAnim as any).interpolate({
    inputRange:  [0, 1],
    outputRange: [pathLength, 0],
  });

  const formatAxis = (v: number) =>
    metric === "totalReps"
      ? Math.round(v).toString()
      : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();

  const selVal  = selectedIdx !== null ? values[selectedIdx] : null;
  const selDate = selectedIdx !== null ? data[selectedIdx].date : null;

  return (
    <View style={{ width, marginBottom: 8 }}>
      {/* Tooltip */}
      <View style={{ height: 36, alignItems: "center", justifyContent: "center" }}>
        {selVal !== null && (
          <View style={{
            backgroundColor: CARD, borderRadius: 8, paddingHorizontal: 12,
            paddingVertical: 6, borderWidth: 1, borderColor: LIME + "40",
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: LIME }}>
              {formatMetricValue(selVal, metric)}
              <Text style={{ color: MUTED, fontFamily: "Manrope", fontSize: 11 }}>
                {"  "}{selDate}
              </Text>
            </Text>
          </View>
        )}
      </View>

      {/* Chart area */}
      <View style={{ flexDirection: "row" }}>
        {/* Y-axis labels */}
        <View style={{ width: Y_AXIS_W, height: CHART_H, justifyContent: "space-between", paddingBottom: 2 }}>
          {[axisMax, axisMin + axisRange / 2, axisMin].map((v, i) => (
            <Text key={i} style={{
              fontFamily: "Manrope", fontSize: 10, color: MUTED,
              textAlign: "right", paddingRight: 6,
            }}>{formatAxis(v)}</Text>
          ))}
        </View>

        {/* Bars + SVG glow overlay (no ScrollView so glow line spans all bars) */}
        <View style={{ width: chartW, height: CHART_H }}>
          {/* Bars */}
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: CHART_H, position: "absolute", left: 0, top: 0 }}>
            {data.map((row, i) => {
              const v       = values[i];
              const barH    = v === 0 ? 3 : Math.max(((v - axisMin) / axisRange) * CHART_H, 4);
              const isSel   = selectedIdx === i;
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelectedIdx(isSel ? null : i)}
                  style={{
                    width: barW, marginRight: BAR_GAP_PX,
                    height: CHART_H, justifyContent: "flex-end",
                  }}
                >
                  <View style={{
                    width: barW, height: barH,
                    borderRadius: 3,
                    backgroundColor: isSel ? LIME : LIME + "55",
                  }} />
                </Pressable>
              );
            })}
          </View>

          {/* SVG glow line — 4 layers for neon bloom, drawn left → right */}
          {pathLength > 0 && (
            <Svg
              width={chartW} height={CHART_H}
              style={{ position: "absolute", left: 0, top: 0 }}
              pointerEvents="none"
            >
              {/* Outer haze */}
              <AnimatedPolyline
                points={pts} fill="none"
                stroke={LIME + "18"} strokeWidth={18}
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={pathLength}
                strokeDashoffset={animDashOffset}
              />
              {/* Mid bloom */}
              <AnimatedPolyline
                points={pts} fill="none"
                stroke={LIME + "40"} strokeWidth={9}
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={pathLength}
                strokeDashoffset={animDashOffset}
              />
              {/* Inner glow */}
              <AnimatedPolyline
                points={pts} fill="none"
                stroke={LIME + "99"} strokeWidth={3.5}
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={pathLength}
                strokeDashoffset={animDashOffset}
              />
              {/* Sharp core */}
              <AnimatedPolyline
                points={pts} fill="none"
                stroke={LIME} strokeWidth={1.5}
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={pathLength}
                strokeDashoffset={animDashOffset}
              />
            </Svg>
          )}
        </View>
      </View>

      {/* X-axis labels — first / middle / last */}
      {data.length > 0 && (
        <View style={{ flexDirection: "row", marginLeft: Y_AXIS_W, marginTop: 4 }}>
          <Text style={{ fontFamily: "Manrope", fontSize: 10, color: MUTED, flex: 1 }}>
            {data[0].date.slice(5)}
          </Text>
          {data.length > 2 && (
            <Text style={{ fontFamily: "Manrope", fontSize: 10, color: MUTED, textAlign: "center", flex: 1 }}>
              {data[Math.floor(data.length / 2)].date.slice(5)}
            </Text>
          )}
          <Text style={{ fontFamily: "Manrope", fontSize: 10, color: MUTED, textAlign: "right", flex: 1 }}>
            {data[data.length - 1].date.slice(5)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Personal records banner ────────────────────────────────────────────────────
// ── How-to instructions ─────────────────────────────────────────────────────
function InstructionsCard({ instructions }: { instructions: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!instructions.length) return null;

  const COLLAPSED_COUNT = 3;
  const visible = expanded ? instructions : instructions.slice(0, COLLAPSED_COUNT);
  const hasMore = instructions.length > COLLAPSED_COUNT;

  return (
    <View style={{
      backgroundColor: CARD, borderRadius: 16, padding: 16,
      marginBottom: 20, borderWidth: 1, borderColor: "#2a2a2a",
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <ListOrdered size={14} color={LIME} />
        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>
          How To
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {visible.map((step, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View style={{
              width: 20, height: 20, borderRadius: 10,
              backgroundColor: LIME + "22", alignItems: "center", justifyContent: "center",
              marginTop: 1,
            }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: LIME }}>
                {i + 1}
              </Text>
            </View>
            <Text style={{ flex: 1, fontFamily: "Manrope", fontSize: 13, color: "#ddd", lineHeight: 19 }}>
              {step}
            </Text>
          </View>
        ))}
      </View>
      {hasMore && (
        <Pressable
          onPress={() => setExpanded(e => !e)}
          style={({ pressed }) => ({ marginTop: 12, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: LIME }}>
            {expanded ? "Show less" : `Show ${instructions.length - COLLAPSED_COUNT} more steps`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function PRBanner({ history }: { history: any[] }) {
  if (!history.length) return null;
  const maxW    = Math.max(...history.map(h => h.maxWeightGrams));
  const maxE1rm = Math.max(...history.map(h => h.e1rmGrams));
  const maxVol  = Math.max(...history.map(h => h.sessionVolume));

  const prs = [
    { label: "Best Weight",  value: `${gToLbs(maxW)} lbs` },
    { label: "Best 1RM Est", value: `${gToLbs(maxE1rm)} lbs` },
    { label: "Best Volume",  value: `${gToLbs(maxVol).toLocaleString()} lbs` },
  ];

  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
      {prs.map(pr => (
        <View key={pr.label} style={{
          flex: 1, backgroundColor: CARD, borderRadius: 12,
          padding: 12, alignItems: "center",
          borderWidth: 1, borderColor: LIME + "20",
        }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: LIME }}>
            {pr.value}
          </Text>
          <Text style={{ fontFamily: "Manrope", fontSize: 10, color: MUTED, marginTop: 2 }}>
            {pr.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Achievement badge pill ─────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 8, paddingVertical: 3,
      borderRadius: 20,
      backgroundColor: color + "22",
      borderWidth: 1, borderColor: color + "60",
    }}>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color }}>
        {label}
      </Text>
    </View>
  );
}

// ── Session history list ───────────────────────────────────────────────────────
function SessionList({ history }: { history: any[] }) {
  if (!history.length) return null;

  // Compute all-time records across the full history
  const maxWeight = Math.max(...history.map(h => h.maxWeightGrams));
  const maxVolume = Math.max(...history.map(h => h.sessionVolume));
  const maxE1rm   = Math.max(...history.map(h => h.e1rmGrams));

  // Award badge to the MOST RECENT session that holds each record
  const byRecent   = [...history].sort((a, b) => (a.date < b.date ? 1 : -1));
  const weightPRDate = byRecent.find(h => h.maxWeightGrams === maxWeight)?.date;
  const volumePRDate = byRecent.find(h => h.sessionVolume  === maxVolume)?.date;
  const e1rmPRDate   = byRecent.find(h => h.e1rmGrams      === maxE1rm)?.date;

  // Show last 10, most-recent first
  const recent = byRecent.slice(0, 10);

  return (
    <View>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#fff", marginBottom: 10 }}>
        Recent Sessions
      </Text>
      {recent.map((row) => {
        const isWeightPR = row.date === weightPRDate;
        const isVolumePR = row.date === volumePRDate;
        const isE1rmPR   = row.date === e1rmPRDate;
        const hasBadge   = isWeightPR || isVolumePR || isE1rmPR;

        return (
          <View key={row.date} style={{
            backgroundColor: CARD, borderRadius: 14, padding: 14,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: hasBadge ? LIME + "30" : "#222",
          }}>
            {/* Date + badges row */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#fff" }}>
                {row.date}
              </Text>
              {isWeightPR && <Badge label="🏋️ Weight PR" color={LIME} />}
              {isE1rmPR   && <Badge label="💪 1RM PR"    color="#9bd1ff" />}
              {isVolumePR && <Badge label="📈 Vol PR"    color="#d3a8ff" />}
            </View>

            {/* Per-set chips */}
            {row.setsData && row.setsData.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {row.setsData.map((s: { reps: number; weightGrams: number }, si: number) => (
                  <View key={si} style={{
                    paddingHorizontal: 9, paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: "#252525",
                    borderWidth: 1, borderColor: "#333",
                  }}>
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#fff" }}>
                      <Text style={{ color: LIME }}>{s.reps}</Text>
                      <Text style={{ color: MUTED }}> × </Text>
                      <Text>{gToLbs(s.weightGrams)} lbs</Text>
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              /* Fallback if setsData not yet available */
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: MUTED }}>
                {row.sets} sets · {row.totalReps} reps
              </Text>
            )}

            {/* Summary line */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
              <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED }}>
                {row.sets} sets · {row.totalReps} total reps
              </Text>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: LIME }}>
                {gToLbs(row.maxWeightGrams)} lbs best
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Strength level constants ───────────────────────────────────────────────────
const LEVEL_COLORS = ["#555", "#888", "#E89C4C", "#E8C84C", "#4CE87C", LIME] as const;
const LEVEL_LABELS = ["Untrained", "Beginner", "Novice", "Intermediate", "Advanced", "Elite"] as const;
const BAR_ZONE_COLORS = ["#2a2a2a", "#3a3020", "#3a3320", "#1a3a28", "#2a4a20", LIME + "30"] as const;

// ── Strength level card ────────────────────────────────────────────────────────
function StrengthLevelCard({
  standard, cardWidth, exerciseId,
}: {
  standard: any;
  cardWidth: number;
  exerciseId: string;
}) {
  // "per_arm" = user logs one dumbbell's weight; "combined" = user logs both arms summed
  const [logMode, setLogMode] = useState<"per_arm" | "combined">("per_arm");

  useEffect(() => {
    if (!standard?.perArm) return;
    AsyncStorage.getItem(`strength_log_mode_${exerciseId}`).then(v => {
      if (v === "combined" || v === "per_arm") setLogMode(v);
    });
  }, [exerciseId, standard?.perArm]);

  const toggleLogMode = useCallback(async (mode: "per_arm" | "combined") => {
    setLogMode(mode);
    await AsyncStorage.setItem(`strength_log_mode_${exerciseId}`, mode);
  }, [exerciseId]);

  if (!standard?.hasStandard || !standard.bestE1rmGrams) return null;

  const { thresholds: rawThresholds, bestE1rmGrams: rawE1rm, perArm } = standard;
  const lbs = (g: number) => Math.round(g * 0.00220462);

  // When the exercise is per-arm but the user logs combined weight, halve their
  // logged weight so it compares correctly against the per-arm thresholds.
  // Equivalently (and cleaner for display), double the thresholds when showing
  // in "combined" mode so everything is expressed in the same unit the user sees.
  const displayFactor = perArm && logMode === "combined" ? 2 : 1;
  const comparisonE1rm = perArm && logMode === "combined" ? rawE1rm / 2 : rawE1rm;

  const thresholds = {
    beginner:     rawThresholds.beginner     * displayFactor,
    novice:       rawThresholds.novice       * displayFactor,
    intermediate: rawThresholds.intermediate * displayFactor,
    advanced:     rawThresholds.advanced     * displayFactor,
    elite:        rawThresholds.elite        * displayFactor,
  };

  // Recompute level based on (possibly halved) comparison weight
  const thresholdArr = [thresholds.beginner, thresholds.novice, thresholds.intermediate, thresholds.advanced, thresholds.elite];
  let levelIndex = 0;
  for (let i = thresholdArr.length - 1; i >= 0; i--) {
    if (rawE1rm >= thresholdArr[i]) { levelIndex = i + 1; break; }
  }
  const levelName  = LEVEL_LABELS[levelIndex];
  const color      = LEVEL_COLORS[levelIndex] as string;
  const nextLevelName  = levelIndex < LEVEL_LABELS.length - 1 ? LEVEL_LABELS[levelIndex + 1] : null;
  const nextLevelGrams = levelIndex < thresholdArr.length ? thresholdArr[levelIndex] : null;

  // Bar dimensions
  const BAR_W = cardWidth - 32;
  const BAR_H = 12;
  // Scale: 0 → elite * 1.4 so there's always room beyond elite
  const scaleMax = thresholds.elite * 1.4;
  const toX = (g: number) => Math.max(0, Math.min(BAR_W, (g / scaleMax) * BAR_W));
  // Marker always uses raw logged weight (already in the correct display unit)
  const markerX = toX(rawE1rm);

  // Zone boundaries (left edge of each colored segment)
  const zones = [
    { to: thresholds.beginner,     bg: BAR_ZONE_COLORS[0] },
    { to: thresholds.novice,       bg: BAR_ZONE_COLORS[1] },
    { to: thresholds.intermediate, bg: BAR_ZONE_COLORS[2] },
    { to: thresholds.advanced,     bg: BAR_ZONE_COLORS[3] },
    { to: thresholds.elite,        bg: BAR_ZONE_COLORS[4] },
    { to: scaleMax,                bg: BAR_ZONE_COLORS[5] },
  ];

  const thresholdEntries = [
    { label: "Beginner",     g: thresholds.beginner },
    { label: "Novice",       g: thresholds.novice },
    { label: "Intermediate", g: thresholds.intermediate },
    { label: "Advanced",     g: thresholds.advanced },
    { label: "Elite",        g: thresholds.elite },
  ];

  // "to go" is always expressed in display units (rawE1rm is already in display units)
  const toGo = nextLevelGrams ? nextLevelGrams - rawE1rm : 0;

  return (
    <View style={{
      backgroundColor: CARD, borderRadius: 16, padding: 16,
      marginBottom: 20, borderWidth: 1,
      borderColor: color + "40",
    }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: perArm ? 10 : 12 }}>
        <TrendingUp size={14} color={color} />
        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>
          How You Compare
        </Text>
        <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED, marginLeft: "auto" as any }}>
          vs. general population
        </Text>
      </View>

      {/* Per-arm / combined toggle — only for dumbbell exercises */}
      {perArm && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED, marginBottom: 6 }}>
            How do you log this exercise?
          </Text>
          <View style={{
            flexDirection: "row",
            backgroundColor: "#222",
            borderRadius: 10,
            padding: 3,
          }}>
            {(["per_arm", "combined"] as const).map(mode => {
              const active = logMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => toggleLogMode(mode)}
                  style={{
                    flex: 1, paddingVertical: 7, borderRadius: 8,
                    alignItems: "center",
                    backgroundColor: active ? "#333" : "transparent",
                  }}
                >
                  <Text style={{
                    fontFamily: active ? "Manrope-Bold" : "Manrope",
                    fontSize: 12,
                    color: active ? "#fff" : MUTED,
                  }}>
                    {mode === "per_arm" ? "Per arm (one dumbbell)" : "Combined (both arms)"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Level badge */}
      <View style={{ alignItems: "center", marginBottom: 16 }}>
        <View style={{
          paddingHorizontal: 16, paddingVertical: 6,
          borderRadius: 20, backgroundColor: color + "22",
          borderWidth: 1, borderColor: color + "60",
          marginBottom: 4,
        }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color }}>
            {levelName}
          </Text>
        </View>
        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#fff" }}>
          {lbs(rawE1rm)} lbs est. 1RM{perArm && logMode === "combined" ? " (combined)" : perArm ? " (per arm)" : ""}
        </Text>
        {nextLevelName && toGo > 0 && (
          <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED, marginTop: 2 }}>
            {lbs(toGo)} lbs to {nextLevelName}
          </Text>
        )}
      </View>

      {/* Progress bar */}
      <View style={{ width: BAR_W, height: BAR_H + 48, position: "relative" }}>
        {/* Colored zone segments */}
        <View style={{
          position: "absolute", top: 16, left: 0,
          width: BAR_W, height: BAR_H,
          borderRadius: BAR_H / 2, overflow: "hidden",
          flexDirection: "row",
        }}>
          {zones.map((z, i) => {
            const prevTo = i === 0 ? 0 : zones[i - 1].to;
            const segW = toX(z.to) - toX(prevTo);
            return segW > 0 ? (
              <View key={i} style={{ width: segW, backgroundColor: z.bg }} />
            ) : null;
          })}
        </View>

        {/* Threshold tick marks */}
        {thresholdEntries.map((t) => {
          const x = toX(t.g);
          return (
            <View
              key={t.label}
              style={{
                position: "absolute",
                left: x - 0.5,
                top: 12,
                width: 1,
                height: BAR_H + 4,
                backgroundColor: "rgba(255,255,255,0.25)",
              }}
            />
          );
        })}

        {/* User marker triangle + pin */}
        <View style={{
          position: "absolute",
          left: markerX - 5,
          top: 4,
          alignItems: "center",
          width: 10,
        }}>
          {/* Downward-pointing triangle */}
          <View style={{
            width: 0, height: 0,
            borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 9,
            borderLeftColor: "transparent", borderRightColor: "transparent",
            borderTopColor: "#fff",
          }} />
          <View style={{ width: 2, height: BAR_H + 4, backgroundColor: "#fff" }} />
        </View>

        {/* Tick labels */}
        <View style={{ position: "absolute", top: BAR_H + 24, left: 0, width: BAR_W }}>
          {thresholdEntries.map((t, i) => {
            const x = toX(t.g);
            const SHORT = ["Bgn", "Nov", "Int", "Adv", "Eli"];
            return (
              <View
                key={t.label}
                style={{ position: "absolute", left: x - 12, width: 26, alignItems: "center" }}
              >
                <Text style={{ fontFamily: "Manrope", fontSize: 9, color: MUTED }}>
                  {SHORT[i]}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Reference table */}
      <View style={{ marginTop: 4, gap: 3 }}>
        {thresholdEntries.map((t, i) => {
          const isCurrentLevel = levelIndex === i + 1;
          const isNextLevel = nextLevelName === t.label;
          return (
            <View key={t.label} style={{
              flexDirection: "row", justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 2,
              paddingHorizontal: isCurrentLevel ? 6 : 0,
              borderRadius: 6,
              backgroundColor: isCurrentLevel ? color + "15" : "transparent",
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor: isCurrentLevel ? color : MUTED + "40",
                }} />
                <Text style={{
                  fontFamily: isCurrentLevel ? "Manrope-Bold" : "Manrope",
                  fontSize: 11,
                  color: isCurrentLevel ? color : MUTED,
                }}>
                  {t.label}
                </Text>
                {isNextLevel && (
                  <Text style={{ fontFamily: "Manrope", fontSize: 9, color: MUTED + "80" }}>← next</Text>
                )}
              </View>
              <Text style={{
                fontFamily: isCurrentLevel ? "Manrope-Bold" : "Manrope",
                fontSize: 11,
                color: isCurrentLevel ? "#fff" : MUTED,
              }}>
                {lbs(t.g)} lbs
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ExerciseDetailPage() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const router  = useRouter();
  const [metric, setMetric] = useState<Metric>("heaviest");
  const { width } = Dimensions.get("window");

  const { data: exercise, isLoading: loadEx } = useQuery({
    queryKey: [`/api/exercises/${exerciseId}`],
    queryFn:  () => apiRequest<any>("GET", `/api/exercises/${exerciseId}`),
    enabled:  !!exerciseId,
  });

  const { data: gifData } = useQuery({
    queryKey: [`/api/exercises/${exerciseId}/gif`],
    queryFn:  () => apiRequest<{ gifUrl: string | null; instructions: string[] }>("GET", `/api/exercises/${exerciseId}/gif`),
    enabled:  !!exerciseId,
  });

  const { data: history = [], isLoading: loadHist } = useQuery({
    queryKey: [`/api/exercises/${exerciseId}/history`],
    queryFn:  () => apiRequest<any[]>("GET", `/api/exercises/${exerciseId}/history`),
    enabled:  !!exerciseId,
  });

  const { data: strengthStandard } = useQuery({
    queryKey: [`/api/exercises/${exerciseId}/strength-standard`],
    queryFn:  () => apiRequest<any>("GET", `/api/exercises/${exerciseId}/strength-standard`),
    enabled:  !!exerciseId,
  });

  const mColor = exercise ? muscleColor(exercise.primaryMuscle ?? "") : LIME;
  const isReps = metric === "totalReps";

  if (loadEx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: DARK, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={LIME} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK }} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: "#222",
      }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 12 })}
        >
          <ChevronLeft size={24} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#fff" }} numberOfLines={1}>
            {exercise?.name ?? "Exercise"}
          </Text>
          {exercise?.primaryMuscle && (
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: mColor, marginTop: 1 }}>
              {exercise.primaryMuscle}
              {exercise.category ? ` · ${exercise.category}` : ""}
            </Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 }}>
        {/* Exercise image / GIF */}
        <View style={{
          backgroundColor: gifData?.gifUrl ? "#ffffff" : CARD, borderRadius: 16, overflow: "hidden",
          marginBottom: 20, height: 220,
          alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: gifData?.gifUrl ? "#e8e8e8" : "#2a2a2a",
        }}>
          {gifData?.gifUrl ? (
            <Image
              source={{ uri: gifData.gifUrl }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="contain"
            />
          ) : (
            <View style={{ alignItems: "center", gap: 12 }}>
              <View style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: mColor + "20",
                alignItems: "center", justifyContent: "center",
              }}>
                <Dumbbell size={32} color={mColor} />
              </View>
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: MUTED }}>
                {exercise?.primaryMuscle ?? "Exercise"}
              </Text>
            </View>
          )}
        </View>

        {/* How-to instructions */}
        <InstructionsCard instructions={gifData?.instructions ?? []} />

        {/* Personal records */}
        <PRBanner history={history} />

        {/* Strength level vs. population */}
        {strengthStandard?.hasStandard && history.length > 0 && (
          <StrengthLevelCard standard={strengthStandard} cardWidth={width - 32} exerciseId={exerciseId!} />
        )}

        {/* Metric selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 16 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {METRICS.map(m => {
            const active = m.key === metric;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMetric(m.key)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: active ? LIME : CARD,
                  borderWidth: 1,
                  borderColor: active ? LIME : "#333",
                }}
              >
                <Text style={{
                  fontFamily: "Manrope-SemiBold", fontSize: 13,
                  color: active ? DARK : MUTED,
                }}>
                  {m.short}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Chart */}
        {loadHist ? (
          <View style={{ height: CHART_H + 60, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={LIME} />
          </View>
        ) : history.length === 0 ? (
          <View style={{
            height: CHART_H + 60, alignItems: "center", justifyContent: "center",
            backgroundColor: CARD, borderRadius: 16,
            borderWidth: 1, borderColor: "#222", marginBottom: 20,
          }}>
            <Dumbbell size={36} color={MUTED} />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: MUTED, marginTop: 12 }}>
              No sessions logged yet
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: MUTED + "99", marginTop: 4 }}>
              Complete a workout to see your progress
            </Text>
          </View>
        ) : (
          <View style={{
            backgroundColor: CARD, borderRadius: 16, padding: 16,
            borderWidth: 1, borderColor: "#222", marginBottom: 20,
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff", marginBottom: 4 }}>
              {METRICS.find(m => m.key === metric)?.label}
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED, marginBottom: 12 }}>
              {isReps ? "reps per session" : "lbs per session"}
              {" · "}{history.length} session{history.length !== 1 ? "s" : ""}
            </Text>
            <BarChart data={history} metric={metric} width={width - 64} />
          </View>
        )}

        {/* Session history */}
        <SessionList history={history} />
      </ScrollView>
    </SafeAreaView>
  );
}
