import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Dimensions, Image, Animated, Easing,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";
import { ChevronLeft, Dumbbell } from "lucide-react-native";
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
    queryFn:  () => apiRequest<{ gifUrl: string | null }>("GET", `/api/exercises/${exerciseId}/gif`),
    enabled:  !!exerciseId,
  });

  const { data: history = [], isLoading: loadHist } = useQuery({
    queryKey: [`/api/exercises/${exerciseId}/history`],
    queryFn:  () => apiRequest<any[]>("GET", `/api/exercises/${exerciseId}/history`),
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
          backgroundColor: CARD, borderRadius: 16, overflow: "hidden",
          marginBottom: 20, height: 220,
          alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: "#2a2a2a",
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

        {/* Personal records */}
        <PRBanner history={history} />

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
