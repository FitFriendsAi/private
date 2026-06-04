import { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs } from "@/lib/utils";
import Svg, { Circle, Polyline, Rect, Line } from "react-native-svg";
import {
  ArrowLeft, Scale, Dumbbell, ChevronDown, X, Flame, BarChart2,
  GitCompareArrows,
} from "lucide-react-native";

const LIME   = "#c8e84c";
const BLUE   = "#9bd1ff";
const PURPLE = "#d3a8ff";
const PINK   = "#f8c8dc";
const DOT: object = { fontFamily: "Doto" };

const PERIODS = ["1W", "1M", "3M", "1Y", "All"] as const;
type Period = typeof PERIODS[number];

function periodDays(p: Period): number {
  return p === "1W" ? 7 : p === "1M" ? 30 : p === "3M" ? 90 : p === "1Y" ? 365 : 9999;
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── SVG Text helper ───────────────────────────────────────────────────────────
function SvgText({ x, y, fontSize, fontWeight, fill, textAnchor, children }: any) {
  const { Text: T } = require("react-native-svg");
  return (
    <T x={x} y={y} fontSize={fontSize} fontWeight={fontWeight}
      fill={fill} textAnchor={textAnchor}>
      {children}
    </T>
  );
}

// ── Dual weight line chart (you vs friend) ────────────────────────────────────
function DualWeightLine({
  myData, theirData, myColor, theirColor, w, h = 110,
}: {
  myData: number[]; theirData: number[];
  myColor: string; theirColor: string;
  w: number; h?: number;
}) {
  if (w <= 0) return null;
  const combined = [...myData, ...theirData].filter(v => v > 0);
  if (combined.length === 0) return null;
  const pad = 8;
  const min = Math.min(...combined) - 2;
  const max = Math.max(...combined) + 2;
  const rng = max - min || 1;
  const len = Math.max(myData.length, theirData.length);

  const xOf = (i: number, n: number) =>
    pad + (n === 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
  const yOf = (v: number) => pad + ((max - v) / rng) * (h - pad * 2);

  const lineFor = (data: number[], color: string) => {
    if (data.length < 2) return null;
    const pts = data.map((v, i) => `${xOf(i, data.length)},${yOf(v)}`).join(" ");
    const last = data[data.length - 1];
    return (
      <Svg key={color}>
        <Polyline points={pts} fill="none" stroke={color}
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={xOf(data.length - 1, data.length)} cy={yOf(last)} r={4} fill={color} />
      </Svg>
    );
  };

  return (
    <Svg width={w} height={h}>
      {lineFor(theirData, theirColor)}
      {lineFor(myData, myColor)}
    </Svg>
  );
}

// ── Single weight line chart ──────────────────────────────────────────────────
function WeightLine({ data, color, w, h = 100 }: { data: number[]; color: string; w: number; h?: number }) {
  if (data.length < 2 || w <= 0) return null;
  const pad = 8;
  const min = Math.min(...data) - 2;
  const max = Math.max(...data) + 2;
  const rng = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + ((max - v) / rng) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const lastX = pad + (w - pad * 2);
  const lastY = pad + ((max - data[data.length - 1]) / rng) * (h - pad * 2);
  return (
    <Svg width={w} height={h}>
      <Polyline points={pts} fill="none" stroke={color}
        strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lastX} cy={lastY} r={4} fill={color} />
    </Svg>
  );
}

// ── Calorie bars (single or dual side-by-side) ────────────────────────────────
function CalorieBars({
  myData, theirData, myColor, theirColor, w, h = 90, showBoth = false,
}: {
  myData: { label: string; value: number }[];
  theirData?: { label: string; value: number }[];
  myColor: string; theirColor?: string;
  w: number; h?: number; showBoth?: boolean;
}) {
  if (w <= 0 || myData.length === 0) return null;
  const n      = myData.length;
  const gap    = n > 20 ? 1 : n > 10 ? 2 : 3;
  const labelH = 14;
  const chartH = h - labelH;
  const slotW  = (w - gap * (n - 1)) / n;

  const allVals = [
    ...myData.map(d => d.value),
    ...(showBoth && theirData ? theirData.map(d => d.value) : []),
  ].filter(v => v > 0);
  const maxV = allVals.length > 0 ? Math.max(...allVals) : 1;

  const showLabel = (i: number) => {
    if (n <= 7)  return true;
    if (n <= 15) return i === 0 || i === n - 1 || i % 3 === 0;
    if (n <= 31) return i === 0 || i === n - 1 || i % 7 === 0;
    return i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
  };

  return (
    <Svg width={w} height={h}>
      <Line x1={0} y1={chartH} x2={w} y2={chartH} stroke="#333" strokeWidth={1} />
      {myData.map((d, i) => {
        const slotX = i * (slotW + gap);
        if (showBoth && theirData) {
          // Side-by-side bars
          const bw   = (slotW - 2) / 2;
          const myH  = d.value > 0 ? Math.max(2, (d.value / maxV) * chartH) : 0;
          const thH  = theirData[i]?.value > 0 ? Math.max(2, (theirData[i].value / maxV) * chartH) : 0;
          return (
            <Svg key={i}>
              {myH > 0 && <Rect x={slotX} y={chartH - myH} width={bw} height={myH} rx={1} fill={myColor} />}
              {thH > 0 && <Rect x={slotX + bw + 2} y={chartH - thH} width={bw} height={thH} rx={1} fill={theirColor} />}
            </Svg>
          );
        }
        const bh = d.value > 0 ? Math.max(2, (d.value / maxV) * chartH) : 0;
        return bh > 0 ? (
          <Rect key={i} x={slotX} y={chartH - bh} width={Math.max(1, slotW)} height={bh} rx={2} fill={myColor} />
        ) : null;
      })}
      {myData.map((d, i) => {
        if (!showLabel(i)) return null;
        const slotX = i * (slotW + gap) + slotW / 2;
        return (
          <SvgText key={`l${i}`} x={slotX} y={h} fontSize={8} fontWeight="600"
            fill={i === n - 1 ? "#ffffff" : "#555555"} textAnchor="middle">
            {d.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ── Strength line (single or dual) ────────────────────────────────────────────
function StrengthLine({
  data, dates, color, w, h = 110,
}: {
  data: number[]; dates: string[]; color: string; w: number; h?: number;
}) {
  if (data.length < 1 || w <= 0) return null;
  const padTop = 24; const padBot = 16; const padL = 4; const padR = 4;
  const chartW = w - padL - padR;
  const chartH = h - padTop - padBot;
  const maxVal = Math.max(...data);
  const minVal = Math.min(...data);
  const range  = maxVal - minVal || 1;
  const isBodyweight = data.every(v => v === 0);
  const suffix = isBodyweight ? "reps" : "lbs";
  const xOf = (i: number) => data.length === 1
    ? padL + chartW / 2
    : padL + (i / (data.length - 1)) * chartW;
  const yOf = (v: number) => padTop + ((maxVal - v) / range) * chartH;

  if (data.length === 1) {
    return (
      <Svg width={w} height={h}>
        <Circle cx={xOf(0)} cy={padTop + chartH / 2} r={4} fill={color} />
        <SvgText x={w / 2} y={14} fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
          {`${data[0]} ${suffix}`}
        </SvgText>
      </Svg>
    );
  }
  const pts = data.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <Svg width={w} height={h}>
      <Polyline points={pts} fill="none" stroke={color}
        strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={xOf(data.length - 1)} cy={yOf(last)} r={4} fill={color} />
      <SvgText x={w / 2} y={14} fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
        {`${last} ${suffix} · PR ${maxVal}`}
      </SvgText>
    </Svg>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ initials, color, size = 56 }: { initials: string; color: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: size * 0.36, color: "#0a0a0a" }}>
        {initials}
      </Text>
    </View>
  );
}

// ── Legend chip ────────────────────────────────────────────────────────────────
function LegendChip({ color, label }: { color: string; label: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontFamily: "Manrope", fontSize: 11, color: palette.muted }}>{label}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FriendProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const friendId   = Number(userId);
  const router     = useRouter();
  const { user }   = useAuth();
  const { palette } = useTheme();
  const { card, cardBorder: border, text, muted, bg } = palette;

  const [period, setPeriod]             = useState<Period>("1M");
  const [compareMode, setCompareMode]   = useState(false);
  const [showExPicker, setShowExPicker] = useState(false);
  const [selectedEx, setSelectedEx]     = useState<any>(null);
  const [weightW, setWeightW]           = useState(0);
  const [calW, setCalW]                 = useState(0);
  const [strengthW, setStrengthW]       = useState(0);

  // ── Friend data ──
  const { data: friendCard } = useQuery<any>({
    queryKey: ["/api/friends", friendId],
    queryFn:  () => apiRequest("GET", `/api/friends/${friendId}`),
    enabled:  !!friendId,
  });

  const { data: friendMeasurements = [] } = useQuery<any[]>({
    queryKey: ["/api/friends", friendId, "measurements"],
    queryFn:  () => apiRequest("GET", `/api/friends/${friendId}/measurements`),
    enabled:  !!friendId,
  });

  const { data: friendSummary = [] } = useQuery<any[]>({
    queryKey: ["/api/friends", friendId, "food-log-summary", period],
    queryFn:  () => apiRequest("GET", `/api/friends/${friendId}/food-log/summary?period=${period}`),
    enabled:  !!friendId,
  });

  const { data: friendHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/friends", friendId, "exercise-history", selectedEx?.id],
    queryFn:  () => apiRequest("GET", `/api/friends/${friendId}/exercises/${selectedEx!.id}/history`),
    enabled:  !!friendId && selectedEx != null,
  });

  // ── My data (for compare mode) ──
  const { data: myMeasurements = [] } = useQuery<any[]>({
    queryKey: ["/api/measurements"],
    queryFn:  () => apiRequest("GET", "/api/measurements"),
    enabled:  compareMode,
  });

  const { data: mySummary = [] } = useQuery<any[]>({
    queryKey: ["/api/food-log/summary", period],
    queryFn:  () => apiRequest("GET", `/api/food-log/summary?period=${period}`),
    enabled:  compareMode,
  });

  const { data: myHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/exercises/history", selectedEx?.id],
    queryFn:  () => apiRequest("GET", `/api/exercises/${selectedEx!.id}/history`),
    enabled:  compareMode && selectedEx != null,
  });

  const { data: exercises = [] } = useQuery<any[]>({
    queryKey: ["/api/exercises"],
    queryFn:  () => apiRequest("GET", "/api/exercises"),
  });

  const { data: loggedIds = [] } = useQuery<number[]>({
    queryKey: ["/api/exercises/logged-ids"],
    queryFn:  () => apiRequest("GET", "/api/exercises/logged-ids"),
  });

  // ── Derived data ──
  const cutoff = useMemo(() => {
    if (period === "All") return "";
    const d = new Date();
    d.setDate(d.getDate() - periodDays(period));
    return d.toISOString().slice(0, 10);
  }, [period]);

  const filteredFriendMeasurements = friendMeasurements.filter((m: any) =>
    period === "All" || new Date(m.date + "T00:00:00") >= new Date(cutoff)
  );
  const friendWeightData = [...filteredFriendMeasurements].reverse().map((m: any) => gramsToLbs(m.weightGrams));

  const filteredMyMeasurements = myMeasurements.filter((m: any) =>
    period === "All" || new Date(m.date + "T00:00:00") >= new Date(cutoff)
  );
  const myWeightData = [...filteredMyMeasurements].reverse().map((m: any) => gramsToLbs(m.weightGrams));

  const friendCalData = friendSummary.map((d: any) => ({ label: d.label, value: d.calories }));
  const myCalData     = mySummary.map((d: any) => ({ label: d.label, value: d.calories }));

  const filteredFriendHistory = period === "All"
    ? friendHistory
    : friendHistory.filter((s: any) => s.date >= cutoff);

  const filteredMyHistory = period === "All"
    ? myHistory
    : myHistory.filter((s: any) => s.date >= cutoff);

  const friendStrengthData = filteredFriendHistory.map((s: any) => gramsToLbs(s.maxWeightGrams));
  const myStrengthData     = filteredMyHistory.map((s: any) => gramsToLbs(s.maxWeightGrams));

  // Calories averages
  const friendAvgCal = friendSummary.length > 0
    ? Math.round(friendSummary.reduce((s: number, d: any) => s + (d.calories ?? 0), 0) / friendSummary.length)
    : 0;
  const myAvgCal = mySummary.length > 0
    ? Math.round(mySummary.reduce((s: number, d: any) => s + (d.calories ?? 0), 0) / mySummary.length)
    : 0;

  const loggedIdSet = useMemo(() => new Set(loggedIds), [loggedIds]);
  const sortedExercises = useMemo(() => {
    return [...exercises].sort((a, b) => {
      const aH = loggedIdSet.has(a.id) ? 0 : 1;
      const bH = loggedIdSet.has(b.id) ? 0 : 1;
      return aH - bH;
    }).slice(0, 60);
  }, [exercises, loggedIdSet]);

  const myName     = user?.name ?? "You";
  const friendName = friendCard?.name ?? "Friend";
  const myInitial  = (myName[0] ?? "Y").toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 12 }}>
          <Pressable onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <ArrowLeft size={24} color={text} />
          </Pressable>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text, flex: 1 }}>
            {friendCard ? friendCard.name : "Profile"}
          </Text>
        </View>

        {/* ── Profile card ── */}
        {friendCard && (
          <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: card, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <Avatar initials={friendCard.initials} color={friendCard.color} size={64} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text }}>{friendCard.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <Flame size={13} color="#f97316" />
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
                    {friendCard.streak ?? 0} day streak
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ ...(DOT as any), fontSize: 26, color: text }}>
                  {(friendCard.points ?? 0).toLocaleString()}
                </Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted }}>pts</Text>
              </View>
            </View>

            {/* Compare toggle */}
            <Pressable
              onPress={() => setCompareMode(m => !m)}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                backgroundColor: compareMode ? LIME : "#1e1e1e",
                borderRadius: 14, paddingVertical: 12,
                borderWidth: 1, borderColor: compareMode ? LIME : border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <GitCompareArrows size={16} color={compareMode ? "#0a0a0a" : muted} />
              <Text style={{
                fontFamily: "Manrope-Bold", fontSize: 14,
                color: compareMode ? "#0a0a0a" : muted,
              }}>
                {compareMode ? "Comparing with you" : "Compare with me"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Period picker ── */}
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, marginBottom: 16 }}>
          {PERIODS.map(p => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={({ pressed }) => ({
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                backgroundColor: period === p ? "#ffffff" : "#1e1e1e",
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: period === p ? "#0a0a0a" : "#888888" }}>
                {p}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ paddingHorizontal: 16, gap: 12 }}>

          {/* ── BODY WEIGHT CARD ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Scale size={14} color={muted} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: muted, letterSpacing: 0.8 }}>
                  BODY WEIGHT
                </Text>
              </View>
              {compareMode && (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <LegendChip color={BLUE} label={friendCard?.name?.split(" ")[0] ?? "Them"} />
                  <LegendChip color={LIME} label="You" />
                </View>
              )}
            </View>

            {/* Stat row */}
            <View style={{ flexDirection: "row", gap: 16, marginBottom: 14 }}>
              <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>
                  {friendCard?.name?.split(" ")[0] ?? "THEIR"} CURRENT
                </Text>
                <Text style={{ ...(DOT as any), fontSize: 24, color: BLUE, marginTop: 4 }}>
                  {friendWeightData.length > 0 ? friendWeightData[friendWeightData.length - 1].toFixed(1) : "—"}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>lbs</Text>
              </View>
              {compareMode && (
                <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>YOUR CURRENT</Text>
                  <Text style={{ ...(DOT as any), fontSize: 24, color: LIME, marginTop: 4 }}>
                    {myWeightData.length > 0 ? myWeightData[myWeightData.length - 1].toFixed(1) : "—"}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>lbs</Text>
                </View>
              )}
            </View>

            {/* Chart */}
            <View onLayout={e => setWeightW(Math.floor(e.nativeEvent.layout.width))}>
              {compareMode ? (
                myWeightData.length >= 2 || friendWeightData.length >= 2 ? (
                  <DualWeightLine
                    myData={myWeightData} theirData={friendWeightData}
                    myColor={LIME} theirColor={BLUE}
                    w={weightW} h={110}
                  />
                ) : (
                  <EmptyChart icon={Scale} message="Not enough weight data to compare" muted={muted} />
                )
              ) : (
                friendWeightData.length >= 2 ? (
                  <WeightLine data={friendWeightData} color={BLUE} w={weightW} h={100} />
                ) : (
                  <EmptyChart icon={Scale} message="Not enough weight data" muted={muted} />
                )
              )}
            </View>
          </View>

          {/* ── CALORIES CARD ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <BarChart2 size={14} color={muted} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: muted, letterSpacing: 0.8 }}>
                  CALORIES
                </Text>
              </View>
              {compareMode && (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <LegendChip color={BLUE} label={friendCard?.name?.split(" ")[0] ?? "Them"} />
                  <LegendChip color={LIME} label="You" />
                </View>
              )}
            </View>

            {/* Avg stat row */}
            <View style={{ flexDirection: "row", gap: 16, marginBottom: 14 }}>
              <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>
                  {friendCard?.name?.split(" ")[0] ?? "THEIR"} AVG
                </Text>
                <Text style={{ ...(DOT as any), fontSize: 24, color: BLUE, marginTop: 4 }}>
                  {friendAvgCal > 0 ? friendAvgCal.toLocaleString() : "—"}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>kcal/day</Text>
              </View>
              {compareMode && (
                <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>YOUR AVG</Text>
                  <Text style={{ ...(DOT as any), fontSize: 24, color: LIME, marginTop: 4 }}>
                    {myAvgCal > 0 ? myAvgCal.toLocaleString() : "—"}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>kcal/day</Text>
                </View>
              )}
            </View>

            <View onLayout={e => setCalW(Math.floor(e.nativeEvent.layout.width))}>
              {friendCalData.length > 0 ? (
                <CalorieBars
                  myData={compareMode ? myCalData : friendCalData}
                  theirData={compareMode ? friendCalData : undefined}
                  myColor={compareMode ? LIME : BLUE}
                  theirColor={BLUE}
                  w={calW} h={90}
                  showBoth={compareMode}
                />
              ) : (
                <EmptyChart icon={BarChart2} message="No nutrition data logged yet" muted={muted} />
              )}
            </View>
          </View>

          {/* ── STRENGTH CARD ── */}
          <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Dumbbell size={14} color={muted} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: muted, letterSpacing: 0.8 }}>
                  STRENGTH
                </Text>
              </View>
              <Pressable
                onPress={() => setShowExPicker(true)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: text }}>
                  {selectedEx?.name ?? "Pick exercise"}
                </Text>
                <ChevronDown size={14} color={text} />
              </Pressable>
            </View>

            {compareMode && (
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                <LegendChip color={BLUE} label={friendCard?.name?.split(" ")[0] ?? "Them"} />
                <LegendChip color={LIME} label="You" />
              </View>
            )}

            {selectedEx == null ? (
              <EmptyChart icon={Dumbbell} message="Select an exercise to view strength progress" muted={muted} />
            ) : (
              <>
                {/* Stat row */}
                <View style={{ flexDirection: "row", gap: 16, marginBottom: 14 }}>
                  {friendStrengthData.length > 0 && (
                    <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>
                        {friendCard?.name?.split(" ")[0] ?? "THEIR"} MAX
                      </Text>
                      <Text style={{ ...(DOT as any), fontSize: 24, color: BLUE, marginTop: 4 }}>
                        {friendStrengthData.length > 0 ? Math.max(...friendStrengthData) : "—"}
                      </Text>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>lbs</Text>
                    </View>
                  )}
                  {compareMode && myStrengthData.length > 0 && (
                    <View style={{ backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border, flex: 1 }}>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5 }}>YOUR MAX</Text>
                      <Text style={{ ...(DOT as any), fontSize: 24, color: LIME, marginTop: 4 }}>
                        {myStrengthData.length > 0 ? Math.max(...myStrengthData) : "—"}
                      </Text>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>lbs</Text>
                    </View>
                  )}
                </View>

                {/* Chart(s) */}
                <View onLayout={e => setStrengthW(Math.floor(e.nativeEvent.layout.width))} style={{ gap: 8 }}>
                  {friendStrengthData.length > 0 ? (
                    <StrengthLine
                      data={friendStrengthData}
                      dates={filteredFriendHistory.map((s: any) => s.date)}
                      color={BLUE}
                      w={strengthW} h={110}
                    />
                  ) : (
                    <EmptyChart icon={Dumbbell} message={`${friendName} hasn't logged ${selectedEx.name}`} muted={muted} />
                  )}
                  {compareMode && (
                    myStrengthData.length > 0 ? (
                      <StrengthLine
                        data={myStrengthData}
                        dates={filteredMyHistory.map((s: any) => s.date)}
                        color={LIME}
                        w={strengthW} h={110}
                      />
                    ) : (
                      <View style={{ paddingTop: 4 }}>
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, textAlign: "center" }}>
                          No data for you on this exercise
                        </Text>
                      </View>
                    )
                  )}
                </View>
              </>
            )}
          </View>

        </View>
      </ScrollView>

      {/* ── Exercise picker modal ── */}
      <Modal visible={showExPicker} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: border }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>Pick Exercise</Text>
            <Pressable onPress={() => setShowExPicker(false)}>
              <X size={22} color={text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {loggedIds.length > 0 && (
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: LIME, letterSpacing: 0.8, marginBottom: 8 }}>
                WITH YOUR DATA
              </Text>
            )}
            {sortedExercises.map((ex: any, i: number) => {
              const hasData    = loggedIdSet.has(ex.id);
              const prevHas    = i > 0 ? loggedIdSet.has(sortedExercises[i - 1].id) : true;
              const showDiv    = !hasData && prevHas && loggedIds.length > 0;
              return (
                <View key={ex.id}>
                  {showDiv && (
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.8, marginBottom: 8, marginTop: 8 }}>
                      ALL EXERCISES
                    </Text>
                  )}
                  <Pressable
                    onPress={() => { setSelectedEx(ex); setShowExPicker(false); }}
                    style={({ pressed }) => ({
                      backgroundColor: card, borderRadius: 14, padding: 14,
                      borderWidth: 1, borderColor: hasData ? LIME : border,
                      marginBottom: 8, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>{ex.name}</Text>
                        {ex.primaryMuscle && (
                          <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, marginTop: 2 }}>
                            {ex.primaryMuscle}
                          </Text>
                        )}
                      </View>
                      {hasData && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LIME, marginLeft: 10 }} />}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────
function EmptyChart({ icon: Icon, message, muted }: { icon: any; message: string; muted: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
      <Icon size={28} color={muted} strokeWidth={1.5} />
      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted, textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}
