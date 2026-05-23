import React, { useState, useMemo } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  useColorScheme, Dimensions, Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Dumbbell } from "lucide-react-native";
import { apiRequest } from "@/lib/api";
import { gramsToLbs } from "@/lib/utils";

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
  if (m.includes("chest"))                  return "#E84C4C";
  if (m.includes("back") || m.includes("lat")) return "#4C8CE8";
  if (m.includes("quad") || m.includes("leg")) return "#E8C84C";
  if (m.includes("hamstring"))              return "#E87C4C";
  if (m.includes("shoulder") || m.includes("delt")) return "#8CE84C";
  if (m.includes("bicep"))                  return "#4CE8C8";
  if (m.includes("tricep"))                 return "#C84CE8";
  if (m.includes("glute"))                  return "#E84C8C";
  if (m.includes("core") || m.includes("abs")) return "#4CE84C";
  if (m.includes("calf"))                   return "#E8E84C";
  return LIME;
}

// ── Mini bar chart ─────────────────────────────────────────────────────────────
const CHART_H = 160;
const BAR_GAP = 3;

function BarChart({
  data, metric, width,
}: { data: any[]; metric: Metric; width: number }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const values = data.map(d => getMetricValue(d, metric));
  const maxVal  = Math.max(...values, 0.001);
  const minVal  = Math.min(...values);
  const spread  = maxVal - minVal;
  // pad 8% top and bottom so bars aren't flush with edges
  const axisMax = maxVal + Math.max(spread * 0.08, 1);
  const axisMin = Math.max(0, minVal - Math.max(spread * 0.08, 1));
  const axisRange = Math.max(axisMax - axisMin, 0.001);

  const Y_AXIS_W = 40;
  const chartW   = width - Y_AXIS_W - 16;
  const barW     = Math.max(4, Math.floor((chartW - BAR_GAP * data.length) / data.length));

  const formatAxis = (v: number) =>
    metric === "totalReps"
      ? Math.round(v).toString()
      : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString();

  const selVal = selectedIdx !== null ? values[selectedIdx] : null;
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
        {/* Y-axis */}
        <View style={{ width: Y_AXIS_W, height: CHART_H, justifyContent: "space-between", paddingBottom: 2 }}>
          {[axisMax, axisMin + axisRange / 2, axisMin].map((v, i) => (
            <Text key={i} style={{
              fontFamily: "Manrope", fontSize: 10, color: MUTED,
              textAlign: "right", paddingRight: 6,
            }}>{formatAxis(v)}</Text>
          ))}
        </View>

        {/* Bars */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: CHART_H }}>
            {data.map((row, i) => {
              const v      = values[i];
              const barH   = v === 0
                ? 3
                : Math.max(((v - axisMin) / axisRange) * CHART_H, 4);
              const isSelected = selectedIdx === i;
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelectedIdx(isSelected ? null : i)}
                  style={{
                    width: barW, marginRight: BAR_GAP,
                    height: CHART_H, justifyContent: "flex-end",
                  }}
                >
                  <View style={{
                    width: barW, height: barH,
                    borderRadius: 3,
                    backgroundColor: isSelected ? LIME : LIME + "70",
                  }} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* X-axis labels — show first, middle, last */}
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
  const maxW   = Math.max(...history.map(h => h.maxWeightGrams));
  const maxE1rm = Math.max(...history.map(h => h.e1rmGrams));
  const maxVol = Math.max(...history.map(h => h.sessionVolume));

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

// ── Session history list ───────────────────────────────────────────────────────
function SessionList({ history }: { history: any[] }) {
  if (!history.length) return null;
  const reversed = [...history].reverse().slice(0, 10);
  return (
    <View>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#fff", marginBottom: 10 }}>
        Recent Sessions
      </Text>
      {reversed.map((row, i) => (
        <View key={i} style={{
          backgroundColor: CARD, borderRadius: 12, padding: 14,
          marginBottom: 8, flexDirection: "row", alignItems: "center",
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#fff" }}>
              {row.date}
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: MUTED, marginTop: 2 }}>
              {row.sets} sets · {row.totalReps} reps
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: LIME }}>
              {gToLbs(row.maxWeightGrams)} lbs
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 11, color: MUTED }}>
              best weight
            </Text>
          </View>
        </View>
      ))}
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
