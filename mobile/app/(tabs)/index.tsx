import { useState, useRef, useCallback } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View, Text, Pressable, Modal, TextInput, Platform, Alert, Animated, Dimensions, StatusBar } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useHealth } from "@/hooks/use-health";
import { todayStr, gramsToLbs, mlToOz, ozToMl } from "@/lib/utils";
import {
  Droplets, Pill, Heart, Zap, TrendingDown, TrendingUp,
  ChevronRight, Dumbbell, Flame, Plus, Minus,
} from "lucide-react-native";
import Svg, { Circle, Polyline, Line as SvgLine } from "react-native-svg";

const HR_RED = "#c0202c";

// ── Accent colours (match web CSS vars) ─────────────────────────
const LIME  = "#c8e84c";
const PINK  = "#f8c8dc";
const BLUE  = "#9bd1ff";
const PURPLE = "#d3a8ff";

// Doto — Google's LED dot-matrix display font, matches web .dot class exactly.
const DOT: object = { fontFamily: "Doto" };

// ── Mock data (friends) ──────────────────────────────────────────
const MOCK_FRIENDS = [
  { initials: "MR", name: "Maya",   color: PINK },
  { initials: "JK", name: "Jordan", color: LIME },
  { initials: "SQ", name: "Sam",    color: BLUE },
  { initials: "LP", name: "Leo",    color: "#ffb88c" },
  { initials: "AV", name: "Ana",    color: PURPLE },
];
const STEP_GOAL = 10_000;

// ── CircleRing (calories card) ───────────────────────────────────
function CircleRing({
  progress, size = 44, strokeWidth = 5, color = "#0a0a0a",
}: { progress: number; size?: number; strokeWidth?: number; color?: string }) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(progress, 1) * circ;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r}
        stroke="rgba(0,0,0,0.15)" strokeWidth={strokeWidth} fill="none" />
      {progress > 0 && (
        <Circle cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </Svg>
  );
}

// ── Weight sparkline ─────────────────────────────────────────────
function WeightSparkline({
  measurements,
  color = "#0a0a0a",
  w = 100,
  h = 44,
}: {
  measurements: any[];
  color?: string;
  w?: number;
  h?: number;
}) {
  const pts = [...measurements].reverse().slice(-12);
  const pad = 4;

  // Not enough data — show a flat dashed placeholder
  if (pts.length < 2) {
    const midY = h / 2;
    return (
      <Svg width={w} height={h}>
        <SvgLine
          x1={pad} y1={midY} x2={w - pad} y2={midY}
          stroke={color} strokeWidth="1.5"
          strokeDasharray="4,4" opacity={0.35}
        />
        {pts.length === 1 && (
          <Circle
            cx={(w - pad * 2) / 2 + pad} cy={midY}
            r={3} fill={color} opacity={0.6}
          />
        )}
      </Svg>
    );
  }

  const values = pts.map((m: any) => gramsToLbs(m.weightGrams));
  const minV   = Math.min(...values) - 2;
  const maxV   = Math.max(...values) + 2;
  const range  = maxV - minV || 1;
  const points = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (w - pad * 2),
    y: pad + ((maxV - v) / range)      * (h - pad * 2),
  }));
  const last = points[points.length - 1];
  return (
    <Svg width={w} height={h}>
      <Polyline
        points={points.map(p => `${p.x},${p.y}`).join(" ")}
        fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.7}
      />
      <Circle cx={last.x} cy={last.y} r={3.5} fill={color} opacity={0.9} />
    </Svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "GOOD MORNING";
  if (h < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}
function relativeDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ── Main component ───────────────────────────────────────────────
export default function DashboardScreen() {
  const today = todayStr(); // recomputed on every render so date resets correctly at midnight
  const { user }               = useAuth();
  const { palette }            = useTheme();
  const qc                     = useQueryClient();
  const router                 = useRouter();
  const health                 = useHealth();

  // ── Queries ──
  const { data: targets }          = useQuery<any>({ queryKey: ["/api/targets"],     queryFn: () => apiRequest("GET", "/api/targets") });
  const { data: foodLog    = [] }  = useQuery<any[]>({ queryKey: ["/api/food-log",  today], queryFn: () => apiRequest("GET", `/api/food-log?date=${today}`) });
  const { data: water      = [] }  = useQuery<any[]>({ queryKey: ["/api/water",     today], queryFn: () => apiRequest("GET", `/api/water?date=${today}`) });
  const { data: supplements = [] } = useQuery<any[]>({ queryKey: ["/api/supplements", today], queryFn: () => apiRequest("GET", `/api/supplements?date=${today}`) });
  const { data: goals       = [] } = useQuery<any[]>({ queryKey: ["/api/goals"],    queryFn: () => apiRequest("GET", "/api/goals") });
  const { data: measurements = [] }= useQuery<any[]>({ queryKey: ["/api/measurements"], queryFn: () => apiRequest("GET", "/api/measurements") });
  const { data: recentWorkouts = [] } = useQuery<any[]>({ queryKey: ["/api/workouts"], queryFn: () => apiRequest("GET", "/api/workouts?limit=35") });

  // ── Derived values ──
  const totals = foodLog.reduce((acc: any, e: any) => ({
    calories: acc.calories + (e.caloriesActual ?? 0),
    protein:  acc.protein  + (e.proteinActual  ?? 0),
    carbs:    acc.carbs    + (e.carbsActual    ?? 0),
    fat:      acc.fat      + (e.fatActual      ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const targetWaterOz = mlToOz(targets?.waterMl ?? 2500);
  const targetCups    = Math.max(Math.round(targetWaterOz / 8), 8);

  const creatineGrams = supplements
    .filter((s: any) => s.supplement === "creatine")
    .reduce((sum: number, s: any) => sum + (s.amountG ?? 0), 0);
  const creatineDone  = creatineGrams >= 5;

  const calTarget = targets?.calories ?? 2200;
  const calPct    = Math.min(totals.calories / calTarget, 1);

  const latestWeight = measurements[0];
  const prevWeight   = measurements.find((_: any, i: number, arr: any[]) => {
    const daysAgo = (Date.now() - new Date(arr[i].date + "T00:00:00").getTime()) / 86400000;
    return daysAgo >= 6;
  });
  const weeklyChange = latestWeight && prevWeight
    ? gramsToLbs(latestWeight.weightGrams) - gramsToLbs(prevWeight.weightGrams)
    : null;

  const workoutDates = new Set(recentWorkouts.map((w: any) => w.date));

  // 5-week calendar (35 days back from today)
  const calDays: { date: string; hasWorkout: boolean; isToday: boolean }[] = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    calDays.push({ date: ds, hasWorkout: workoutDates.has(ds), isToday: ds === today });
  }

  // Streak — use local date to match how workouts are stored
  let streak = 0;
  for (let i = 0; i <= 60; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (workoutDates.has(ds)) streak++;
    else if (i > 0) break;
  }

  const activeGoals = (goals as any[]).filter((g: any) => g.isActive);
  // Workout calendar dots always sit on a hardcoded white card,
  // so they need a dark fill regardless of which theme is active.
  const dotAccent   = "#1a1a1a";

  // ── Water: display count straight from server query ─────────────
  const waterCups = Math.round(
    mlToOz(water.reduce((s: number, e: any) => s + (e.amountMl ?? 0), 0)) / 8
  );

  // ── Mutations ──
  // Simple fire-and-refetch — no optimistic updates, no delta state.
  // Localhost round-trips are fast enough that the brief refresh is invisible.
  const addWater = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/water", { date: today, amountMl: ozToMl(8) }),
    onSuccess: () => {
      if (health.authorized) health.writeWater(0.2366); // 8 oz ≈ 0.2366 L
    },
    onError:   (e: any) => console.error("❌ addWater failed:", e?.message ?? e),
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/water", today] }),
  });

  const removeWater = useMutation({
    mutationFn: (entryId: number) =>
      apiRequest("DELETE", `/api/water/${entryId}`),
    onSuccess: () => console.log("✅ water removed"),
    onError:   (e: any) => console.error("❌ removeWater failed:", e?.message ?? e),
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/water", today] }),
  });

  // ── Water history expanded view ──────────────────────────────────
  const [waterOpen,    setWaterOpen]    = useState(false);
  const [waterPeriod,  setWaterPeriod]  = useState<7 | 30 | 90>(30);
  const expandAnim   = useRef(new Animated.Value(0)).current;
  const contentAnim  = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = Dimensions.get("window");

  const { data: waterHistory = [] } = useQuery<{ date: string; totalMl: number }[]>({
    queryKey: ["/api/water/history", waterPeriod],
    queryFn:  () => apiRequest("GET", `/api/water/history?days=${waterPeriod}`),
    enabled:  waterOpen,
  });

  const openWaterHistory = useCallback(() => {
    setWaterOpen(true);
    expandAnim.setValue(0);
    contentAnim.setValue(0);
    Animated.sequence([
      Animated.spring(expandAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 12 }),
      Animated.timing(contentAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [expandAnim, contentAnim]);

  const closeWaterHistory = useCallback(() => {
    Animated.parallel([
      Animated.timing(contentAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(expandAnim,  { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setWaterOpen(false));
  }, [expandAnim, contentAnim]);

  // Derived water history stats
  const historyWithMl   = waterHistory.map(d => ({ ...d, cups: Math.round(mlToOz(d.totalMl) / 8) }));
  const avgCups         = historyWithMl.length
    ? Math.round(historyWithMl.reduce((s, d) => s + d.cups, 0) / historyWithMl.length)
    : 0;
  const bestCups        = historyWithMl.length ? Math.max(...historyWithMl.map(d => d.cups)) : 0;
  const goalMetDays     = historyWithMl.filter(d => d.cups >= targetCups).length;
  const maxBarCups      = Math.max(bestCups, targetCups, 1);

  // Modal state for editing the water goal (cups)
  const [waterEditOpen, setWaterEditOpen]   = useState(false);
  const [waterEditCups, setWaterEditCups]   = useState("");
  const [waterGoalSaving, setWaterGoalSaving] = useState(false);

  function openWaterEditor() {
    setWaterEditCups(String(targetCups));
    setWaterEditOpen(true);
  }

  // Direct async save — no useMutation wrapper so there are no hidden
  // callback-ordering surprises.
  async function saveWaterGoal() {
    const parsed = parseInt(waterEditCups, 10);
    const cups   = Number.isFinite(parsed) && parsed > 0
      ? Math.min(40, parsed)
      : targetCups;
    setWaterGoalSaving(true);
    try {
      const data = await apiRequest<any>("PATCH", "/api/targets", {
        waterMl: Math.round(ozToMl(cups * 8)),
      });
      qc.setQueryData(["/api/targets"], data);
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      setWaterEditOpen(false);
    } catch (err: any) {
      console.error("saveWaterGoal failed:", err);
      Alert.alert("Could not save goal", err?.message ?? "Please try again");
    } finally {
      setWaterGoalSaving(false);
    }
  }

  const addCreatine = useMutation({
    mutationFn: () => apiRequest("POST", "/api/supplements", { date: today, supplement: "creatine", amountG: 2.5 }),
    onSuccess: () => console.log("✅ creatine added"),
    onError:   (e: any) => console.error("❌ addCreatine failed:", e?.message ?? e),
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/supplements", today] }),
  });

  const removeCreatine = useMutation({
    mutationFn: () => {
      const last = [...supplements].reverse().find(
        (s: any) => s.supplement === "creatine" && s.id > 0
      ) as any;
      if (!last) return Promise.resolve();
      return apiRequest("DELETE", `/api/supplements/${last.id}`);
    },
    onSuccess: () => console.log("✅ creatine removed"),
    onError:   (e: any) => console.error("❌ removeCreatine failed:", e?.message ?? e),
    onSettled: () => qc.invalidateQueries({ queryKey: ["/api/supplements", today] }),
  });

  // ── Palette shorthand ──
  const bg     = palette.bg;
  const card   = palette.card;
  const border = palette.cardBorder;
  const text   = palette.text;
  const muted  = palette.muted;
  const sec    = "#2a2a2a";   // secondary fill for bars/empties (all themes dark now)

  // ── Render ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, marginBottom: 4 }}>
          <View>
            <Text style={{ fontSize: 11, color: muted, fontFamily: "Manrope-Bold", letterSpacing: 0.8, textTransform: "uppercase" }}>
              {getGreeting()}
            </Text>
            <Text style={{ fontSize: 32, fontFamily: "Manrope-ExtraBold", color: text, letterSpacing: -0.5, marginTop: 2, lineHeight: 36 }}>
              {user?.name?.split(" ")[0] ?? ""}
            </Text>
          </View>
          {latestWeight && (
            <View style={{ backgroundColor: "#ffffff", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, alignItems: "flex-end" }}>
              <Text style={{ fontSize: 10, color: "#888888", fontFamily: "Manrope-Bold", letterSpacing: 0.8 }}>
                BODY WEIGHT
              </Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                <Text style={{ ...(DOT as any), fontSize: 26, color: "#0a0a0a", lineHeight: 30 }}>
                  {gramsToLbs(latestWeight.weightGrams)}
                </Text>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#888888" }}>lbs</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Streak + Calories ───────────────────────────────────── */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>

          {/* Streak */}
          <View style={{ flex: 1, backgroundColor: card, borderRadius: 24, padding: 16, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View>
                <Text style={{ fontSize: 11, color: muted, fontFamily: "Manrope-Bold", letterSpacing: 0.8 }}>STREAK</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                  <Text style={{ ...(DOT as any), fontSize: 36, color: LIME, lineHeight: 40 }}>{streak}</Text>
                  <Text style={{ fontSize: 12, color: muted, fontFamily: "Manrope-SemiBold" }}>DAYS</Text>
                </View>
              </View>
              <Flame size={20} color={LIME} />
            </View>
            {/* 7-day weekly dots */}
            <View style={{ flexDirection: "row", gap: 4, marginTop: 12 }}>
              {Array.from({ length: 7 }).map((_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                const on = workoutDates.has(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
                return (
                  <View key={i} style={{
                    flex: 1, aspectRatio: 1, maxWidth: 10, borderRadius: 10,
                    backgroundColor: on ? LIME : sec,
                  }} />
                );
              })}
            </View>
          </View>

          {/* Calories — accent-coloured card (white on white theme, pink on pink theme, etc.) */}
          <View style={{ flex: 1, backgroundColor: palette.accent, borderRadius: 24, padding: 16, justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Text style={{ fontSize: 11, fontFamily: "Manrope-ExtraBold", letterSpacing: 0.8, color: "rgba(0,0,0,0.65)" }}>
                CALORIES
              </Text>
              <CircleRing size={44} strokeWidth={5} progress={calPct} color="#0a0a0a" />
            </View>
            <View>
              <Text style={{ ...(DOT as any), fontSize: 36, color: "#0a0a0a", lineHeight: 40 }}>
                {Math.round(totals.calories).toLocaleString()}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "rgba(0,0,0,0.55)", marginTop: 4 }}>
                / {Math.round(calTarget)} kcal
              </Text>
            </View>
          </View>
        </View>

        {/* ── Macro bars ──────────────────────────────────────────── */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          {([
            { label: "PROTEIN", val: Math.round(totals.protein), target: Math.round(targets?.proteinG ?? 0), color: LIME   },
            { label: "CARBS",   val: Math.round(totals.carbs),   target: Math.round(targets?.carbsG   ?? 0), color: BLUE   },
            { label: "FAT",     val: Math.round(totals.fat),     target: Math.round(targets?.fatG     ?? 0), color: PURPLE },
          ] as const).map(m => (
            <View key={m.label} style={{ flex: 1, backgroundColor: card, borderRadius: 20, padding: 12, borderWidth: 1, borderColor: border }}>
              <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.8 }}>{m.label}</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2, marginTop: 4 }}>
                <Text style={{ ...(DOT as any), fontSize: 20, color: m.color }}>{m.val}</Text>
                <Text style={{ fontSize: 9, fontFamily: "Manrope-Bold", color: muted }}>/{m.target}g</Text>
              </View>
              <View style={{ height: 4, backgroundColor: sec, borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                <View style={{
                  width: `${Math.min(m.target > 0 ? (m.val / m.target) * 100 : 0, 100)}%`,
                  height: "100%", backgroundColor: m.color, borderRadius: 2,
                }} />
              </View>
            </View>
          ))}
        </View>

        {/* ── Heart Rate ──────────────────────────────────────────── */}
        <View style={{
          backgroundColor: HR_RED, borderRadius: 24,
          padding: 18, marginBottom: 10, overflow: "hidden",
        }}>
          {/* subtle top-highlight shimmer */}
          <View style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 70,
            backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 24,
          }} pointerEvents="none" />

          {/* Header row */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Heart size={16} color="#fff" fill="#fff" />
              <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: "#fff" }}>Heart rate</Text>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/settings")}
              style={({ pressed }) => ({
                backgroundColor: "#ffffff", borderRadius: 20,
                paddingHorizontal: 18, paddingVertical: 8,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#1a1a1a" }}>Connect</Text>
            </Pressable>
          </View>

          {/* AVG reading + helper text */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
            <View>
              <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: "rgba(255,255,255,0.55)", letterSpacing: 0.8 }}>AVG</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <Text style={{ ...(DOT as any), fontSize: 36, color: "#fff", lineHeight: 40 }}>—</Text>
                <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: "rgba(255,255,255,0.6)" }}>BPM</Text>
              </View>
            </View>
            <View style={{ flex: 1, paddingTop: 6 }}>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: "Manrope", lineHeight: 18 }}>
                Tap Connect to pair your{"\n"}Apple Health or HR monitor
              </Text>
            </View>
          </View>

          {/* SVG chart — flat dashed white line until data arrives */}
          <Svg width="100%" height={44} style={{ marginBottom: 8 }}>
            <SvgLine
              x1="0" y1="22" x2="100%" y2="22"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1.5"
              strokeDasharray="5,5"
            />
            <SvgLine
              x1="0" y1="42" x2="100%" y2="42"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
              strokeDasharray="3,6"
            />
          </Svg>

          {/* Time axis labels */}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {["12AM", "4AM", "8AM", "12PM", "4PM", "8PM", "12AM"].map((t, i) => (
              <Text key={i} style={{ fontSize: 9, fontFamily: "Manrope-SemiBold", color: "rgba(255,255,255,0.38)" }}>
                {t}
              </Text>
            ))}
          </View>
        </View>

        {/* ── Water + Steps ───────────────────────────────────────── */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>

          {/* Water card */}
          <Pressable onPress={openWaterHistory} style={{ flex: 1, backgroundColor: BLUE, borderRadius: 24, padding: 14 }}>
            {/* Header row */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Droplets size={14} color="rgba(0,0,0,0.6)" />
                </View>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#0a0a0a", letterSpacing: 0.6 }}>WATER</Text>
              </View>
              <Pressable onPress={openWaterEditor} hitSlop={8}>
                <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: "rgba(0,0,0,0.4)" }}>{targetCups} cup goal</Text>
              </Pressable>
            </View>

            {/* Cup count */}
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginBottom: 8 }}>
              <Text style={{ ...(DOT as any), fontSize: 28, color: "#0a0a0a", lineHeight: 32 }}>{waterCups}</Text>
              <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: "rgba(0,0,0,0.45)" }}>/ {targetCups}</Text>
            </View>

            {/* Segmented bar — cap at 12 segments so it never overflows */}
            <View style={{ flexDirection: "row", gap: 2, marginBottom: 14 }}>
              {Array.from({ length: Math.min(targetCups, 12) }).map((_, i) => (
                <View key={i} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  backgroundColor: i < Math.min(waterCups, 12) ? "#ffffff" : "rgba(255,255,255,0.3)",
                }} />
              ))}
            </View>

            {/* +/- buttons */}
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable
                onPress={() => {
                  const last = [...water].reverse().find((e: any) => e.id > 0);
                  if (last) removeWater.mutate(last.id);
                }}
                disabled={waterCups === 0 || removeWater.isPending}
                style={({ pressed }) => ({
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: "rgba(0,0,0,0.12)",
                  alignItems: "center", justifyContent: "center",
                  opacity: (pressed || waterCups === 0) ? 0.3 : 1,
                })}
              >
                <Minus size={16} color="rgba(0,0,0,0.55)" />
              </Pressable>
              <Pressable
                onPress={() => addWater.mutate(undefined as any)}
                disabled={addWater.isPending}
                style={({ pressed }) => ({
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: "rgba(0,0,0,0.12)",
                  alignItems: "center", justifyContent: "center",
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Plus size={16} color="rgba(0,0,0,0.55)" />
              </Pressable>
            </View>
          </Pressable>

          {/* Steps */}
          <View style={{ flex: 1, backgroundColor: card, borderRadius: 24, padding: 16, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", letterSpacing: 0.8, color: muted }}>STEPS</Text>
              <Zap size={14} color={LIME} />
            </View>

            {!health.available || !health.authorized ? (
              /* ── Not connected state ── */
              <View style={{ flex: 1, justifyContent: "space-between" }}>
                <Text style={{ ...(DOT as any), fontSize: 28, color: muted, lineHeight: 32 }}>—</Text>
                <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted, marginTop: 4, marginBottom: 10, lineHeight: 14 }}>
                  {health.available
                    ? "Connect Health to track steps"
                    : Platform.OS === "ios"
                    ? "HealthKit unavailable"
                    : "Steps not available on this device"}
                </Text>
                {health.available && (
                  <Pressable
                    onPress={health.authorize}
                    style={({ pressed }) => ({
                      backgroundColor: "#ffffff", borderRadius: 14,
                      paddingVertical: 7, alignItems: "center",
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#0a0a0a" }}>
                      Connect
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              /* ── Connected — real data ── */
              <>
                <Text style={{ ...(DOT as any), fontSize: 28, color: text, lineHeight: 32 }}>
                  {(health.todaySteps ?? 0).toLocaleString()}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted, marginBottom: 10 }}>
                  / {STEP_GOAL.toLocaleString()} goal
                </Text>
                {/* 7-day bar chart */}
                {health.weekSteps.length > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 40 }}>
                    {health.weekSteps.map((day, i) => {
                      const maxS  = Math.max(...health.weekSteps.map(d => d.steps), 1);
                      const barH  = Math.max(4, Math.round((day.steps / maxS) * 36));
                      const isToday = i === health.weekSteps.length - 1;
                      return (
                        <View key={day.date} style={{
                          flex: 1, height: barH, borderRadius: 3,
                          backgroundColor: LIME,
                          opacity: isToday ? 1 : 0.35 + (day.steps / maxS) * 0.65,
                        }} />
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 40 }}>
                    {Array.from({ length: 7 }).map((_, i) => (
                      <View key={i} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: muted, opacity: 0.2 }} />
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* ── Workout Calendar — always white ─────────────────────── */}
        <View style={{ backgroundColor: "#ffffff", borderRadius: 24, padding: 18, marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: "#0a0a0a" }}>Workouts</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 12, color: "#888888", fontFamily: "Manrope-SemiBold" }}>
                {recentWorkouts.length} sessions
              </Text>
              <ChevronRight size={12} color="#888888" />
            </View>
          </View>
          {/* Day-of-week headers */}
          <View style={{ flexDirection: "row", marginBottom: 6 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 9, color: "#aaaaaa", fontFamily: "Manrope-Bold" }}>{d}</Text>
              </View>
            ))}
          </View>
          {/* 5 × 7 dot grid */}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {calDays.map((d, i) => (
              <View key={i} style={{ width: "14.28%", alignItems: "center", marginBottom: 6 }}>
                <View style={{
                  width: 14, height: 14, borderRadius: 7,
                  backgroundColor: d.hasWorkout || d.isToday ? dotAccent : "#e8e8e8",
                  borderWidth: d.isToday ? 2 : 0,
                  borderColor: d.isToday ? dotAccent : "transparent",
                }} />
              </View>
            ))}
          </View>
          {/* Last workout row */}
          {recentWorkouts[0] && (
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#eeeeee", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Dumbbell size={16} color={PINK} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#0a0a0a" }}>
                  {recentWorkouts[0].name}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: "#aaaaaa", fontFamily: "Manrope" }}>
                {relativeDate(recentWorkouts[0].date)}
              </Text>
            </View>
          )}
        </View>

        {/* ── Body Weight — always white ───────────────────────────── */}
        {latestWeight && (
          <View style={{ backgroundColor: "#ffffff", borderRadius: 24, padding: 18, marginBottom: 10 }}>
            <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#aaaaaa", letterSpacing: 0.8, marginBottom: 8 }}>
              BODY WEIGHT
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                  <Text style={{ ...(DOT as any), fontSize: 42, color: "#0a0a0a", lineHeight: 46 }}>
                    {gramsToLbs(latestWeight.weightGrams)}
                  </Text>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#888888" }}>lbs</Text>
                </View>
                {weeklyChange !== null && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                    {weeklyChange < 0
                      ? <TrendingDown size={14} color="#22c55e" />
                      : weeklyChange > 0
                      ? <TrendingUp size={14} color="#ef4444" />
                      : null}
                    <Text style={{
                      fontSize: 12, fontFamily: "Manrope-Bold",
                      color: weeklyChange < 0 ? "#22c55e" : weeklyChange > 0 ? "#ef4444" : "#888888",
                    }}>
                      {weeklyChange === 0
                        ? "No change this week"
                        : `${weeklyChange > 0 ? "+" : ""}${weeklyChange.toFixed(1)} lbs this week`}
                    </Text>
                  </View>
                )}
              </View>
              <WeightSparkline measurements={measurements} />
            </View>
          </View>
        )}

        {/* ── Creatine + Active Goal ───────────────────────────────── */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>

          {/* Creatine card */}
          <View style={{ flex: 1, backgroundColor: LIME, borderRadius: 24, padding: 14 }}>
            {/* Header row */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.1)", alignItems: "center", justifyContent: "center" }}>
                  <Pill size={14} color="#0a0a0a" />
                </View>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#0a0a0a", letterSpacing: 0.6 }}>CREATINE</Text>
              </View>
              {creatineGrams > 0 && (
                <Text style={{ ...(DOT as any), fontSize: 16, color: "#0a0a0a" }}>
                  {creatineGrams % 1 === 0 ? creatineGrams : creatineGrams.toFixed(1)}g
                </Text>
              )}
            </View>

            {/* Status */}
            <Text style={{ fontSize: 12, fontFamily: "Manrope", color: "rgba(0,0,0,0.55)", marginBottom: 8 }}>
              {creatineGrams === 0 ? "Tap + to add 2.5g" : creatineDone ? "Dose reached ✓" : "Tap + for more"}
            </Text>

            {/* Progress bar */}
            <View style={{ flexDirection: "row", gap: 3, marginBottom: 14 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={i} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  backgroundColor: creatineGrams >= (i + 1) * 2.5 ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)",
                }} />
              ))}
            </View>

            {/* +/- buttons */}
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable
                onPress={() => removeCreatine.mutate(undefined)}
                disabled={creatineGrams === 0 || removeCreatine.isPending}
                style={({ pressed }) => ({
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: "rgba(0,0,0,0.1)",
                  alignItems: "center", justifyContent: "center",
                  opacity: (pressed || creatineGrams === 0) ? 0.3 : 1,
                })}
              >
                <Minus size={16} color="rgba(0,0,0,0.55)" />
              </Pressable>
              <Pressable
                onPress={() => addCreatine.mutate(undefined)}
                disabled={addCreatine.isPending}
                style={({ pressed }) => ({
                  width: 38, height: 38, borderRadius: 19,
                  backgroundColor: "rgba(0,0,0,0.1)",
                  alignItems: "center", justifyContent: "center",
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Plus size={16} color="rgba(0,0,0,0.55)" />
              </Pressable>
            </View>
          </View>

          {/* Active goal (or empty state) */}
          {activeGoals[0] ? (
            <View style={{
              flex: 1, backgroundColor: card, borderRadius: 24, padding: 16,
              borderWidth: 1, borderColor: border, justifyContent: "space-between",
            }}>
              {/* Label + deadline */}
              <View>
                <Text style={{ fontSize: 10, color: muted, fontFamily: "Manrope-Bold", letterSpacing: 0.8, marginBottom: 6 }}>
                  ACTIVE GOAL
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: text, lineHeight: 18 }} numberOfLines={2}>
                  {activeGoals[0].label}
                </Text>
                {activeGoals[0].deadline && (
                  <Text style={{ fontSize: 11, color: muted, fontFamily: "Manrope-SemiBold", marginTop: 3 }}>
                    {Math.max(0, Math.ceil((new Date(activeGoals[0].deadline).getTime() - Date.now()) / 86400000))}d left
                  </Text>
                )}
              </View>

              {/* Progress track */}
              {(() => {
                const goal = activeGoals[0] as any;
                const isWeightGoal = goal.type === "weight_loss" || goal.type === "weight_gain";
                const isStrengthGoal = goal.type === "strength";
                const startG   = goal.startValue;
                const targetG  = goal.targetValue;
                const currentG = (isWeightGoal || (!goal.type && latestWeight)) && latestWeight
                  ? latestWeight.weightGrams
                  : null;

                // Fallback: no start/target stored — just show current weight
                if (!startG || !targetG) {
                  if (!currentG) return null;
                  return (
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ fontFamily: "Manrope", fontSize: 8, color: muted, letterSpacing: 0.6, marginBottom: 4 }}>
                        CURRENT WEIGHT
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                        <Text style={{ ...(DOT as any), fontSize: 24, color: text, lineHeight: 28 }}>
                          {gramsToLbs(currentG)}
                        </Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted }}>lbs</Text>
                      </View>
                      <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted, marginTop: 4 }}>
                        Set a target in Goals →
                      </Text>
                    </View>
                  );
                }

                const fmt = (g: number) => String(gramsToLbs(g));
                const unit = isStrengthGoal ? "lbs" : "lbs";
                const range = targetG - startG;
                const pct = currentG != null && range !== 0
                  ? Math.max(0, Math.min(1, (currentG - startG) / range))
                  : 0;
                const pctPx = `${(pct * 100).toFixed(1)}%` as any;

                return (
                  <View style={{ marginTop: 14 }}>
                    {/* Track bar */}
                    <View style={{ height: 3, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
                      {/* Filled */}
                      <View style={{
                        position: "absolute", left: 0, top: 0, bottom: 0,
                        width: pct > 0 ? pctPx : 0,
                        backgroundColor: text, borderRadius: 2,
                      }} />
                      {/* Dot at current */}
                      {currentG != null && (
                        <View style={{
                          position: "absolute", left: pctPx,
                          top: -4, width: 11, height: 11, borderRadius: 6,
                          backgroundColor: text,
                          transform: [{ translateX: -5.5 }],
                        }} />
                      )}
                    </View>

                    {/* Start / Now / Target labels */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                      <View>
                        <Text style={{ fontFamily: "Manrope", fontSize: 8, color: muted, letterSpacing: 0.5 }}>START</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted }}>
                          {fmt(startG)}
                        </Text>
                      </View>
                      {currentG != null && (
                        <View style={{ alignItems: "center" }}>
                          <Text style={{ fontFamily: "Manrope", fontSize: 8, color: muted, letterSpacing: 0.5 }}>NOW</Text>
                          <Text style={{ ...(DOT as any), fontSize: 14, color: text, lineHeight: 18 }}>
                            {fmt(currentG)}
                          </Text>
                        </View>
                      )}
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontFamily: "Manrope", fontSize: 8, color: muted, letterSpacing: 0.5 }}>GOAL</Text>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted }}>
                          {fmt(targetG)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })()}
            </View>
          ) : (
            <Pressable
              onPress={() => router.push("/(tabs)/goals")}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: card, borderRadius: 24, padding: 16,
                borderWidth: 1, borderColor: border,
                alignItems: "center", justifyContent: "center", gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Plus size={20} color={muted} />
              <Text style={{ fontSize: 12, color: muted, fontFamily: "Manrope" }}>Set a goal</Text>
            </Pressable>
          )}
        </View>

        {/* ── Friends Nearby ───────────────────────────────────────── */}
        <View style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", letterSpacing: 0.4, color: text }}>
              FRIENDS NEARBY
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text }}>See all</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 16, paddingBottom: 4 }}
          >
            {MOCK_FRIENDS.map(f => (
              <View key={f.initials} style={{ alignItems: "center", gap: 6 }}>
                <View style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: f.color,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: "#0a0a0a" }}>
                    {f.initials}
                  </Text>
                  {/* Online badge */}
                  <View style={{
                    position: "absolute", bottom: 1, right: 1,
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: "#1c1c1c",
                    borderWidth: 2, borderColor: bg,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LIME }} />
                  </View>
                </View>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: text }}>{f.name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Setup prompt (when no targets yet) ───────────────────── */}
        {!targets && (
          <View style={{
            borderRadius: 24, padding: 20, alignItems: "center",
            backgroundColor: "rgba(248,200,220,0.08)",
            borderWidth: 1, borderColor: "rgba(248,200,220,0.22)",
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: PINK }}>
              Complete your profile
            </Text>
            <Text style={{ fontSize: 12, color: muted, fontFamily: "Manrope", marginTop: 4, textAlign: "center" }}>
              Add your weight & goals to unlock personalized targets →
            </Text>
          </View>
        )}

      </ScrollView>

      {/* ── Water history expanded view ─────────────────────────── */}
      <Modal visible={waterOpen} transparent animationType="none" onRequestClose={closeWaterHistory} statusBarTranslucent>
        <Animated.View style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: BLUE,
          transform: [{ scale: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] }) }],
          borderRadius: expandAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [999, 40, 0] }),
        }}>
          <Animated.View style={{ flex: 1, opacity: contentAnim }}>
            <SafeAreaView style={{ flex: 1 }}>
              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Droplets size={20} color="rgba(0,0,0,0.55)" />
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: "#0a0a0a" }}>Water</Text>
                </View>
                <Pressable onPress={closeWaterHistory} hitSlop={12}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: "#0a0a0a", lineHeight: 20 }}>×</Text>
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

                {/* Today stat */}
                <View style={{ alignItems: "center", marginBottom: 28 }}>
                  <Text style={{ ...(DOT as any), fontSize: 72, color: "#0a0a0a", lineHeight: 76 }}>{waterCups}</Text>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "rgba(0,0,0,0.5)" }}>of {targetCups} cups today</Text>
                  {/* progress bar */}
                  <View style={{ width: "70%", height: 6, backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 3, marginTop: 12, overflow: "hidden" }}>
                    <View style={{ width: `${Math.min(waterCups / targetCups, 1) * 100}%` as any, height: "100%", backgroundColor: "#0a0a0a", borderRadius: 3 }} />
                  </View>
                </View>

                {/* Summary stats */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                  {[
                    { label: "AVG / DAY",  value: `${avgCups}` , unit: "cups" },
                    { label: "BEST DAY",   value: `${bestCups}`, unit: "cups" },
                    { label: "GOAL MET",   value: `${goalMetDays}`, unit: `of ${waterPeriod}d` },
                  ].map(s => (
                    <View key={s.label} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.1)", borderRadius: 16, padding: 12, alignItems: "center" }}>
                      <Text style={{ ...(DOT as any), fontSize: 24, color: "#0a0a0a", lineHeight: 28 }}>{s.value}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 9, color: "rgba(0,0,0,0.45)", letterSpacing: 0.5, marginTop: 2 }}>{s.unit}</Text>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 8, color: "rgba(0,0,0,0.35)", letterSpacing: 0.5, marginTop: 1 }}>{s.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Period selector */}
                <View style={{ flexDirection: "row", backgroundColor: "rgba(0,0,0,0.1)", borderRadius: 12, padding: 3, marginBottom: 20 }}>
                  {([7, 30, 90] as const).map(p => (
                    <Pressable key={p} onPress={() => setWaterPeriod(p)} style={{
                      flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center",
                      backgroundColor: waterPeriod === p ? "rgba(0,0,0,0.18)" : "transparent",
                    }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: waterPeriod === p ? "#0a0a0a" : "rgba(0,0,0,0.4)" }}>
                        {p === 7 ? "7 Days" : p === 30 ? "30 Days" : "90 Days"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Bar chart */}
                {historyWithMl.length > 0 ? (
                  <View style={{ marginBottom: 24 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "rgba(0,0,0,0.4)", letterSpacing: 0.6, marginBottom: 10 }}>DAILY INTAKE</Text>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 90 }}>
                      {historyWithMl.map((d, i) => {
                        const pct = d.cups / maxBarCups;
                        const metGoal = d.cups >= targetCups;
                        const isToday = d.date === today;
                        return (
                          <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: 90 }}>
                            <View style={{
                              width: "100%", borderRadius: 3,
                              height: Math.max(pct * 78, 3),
                              backgroundColor: isToday ? "#0a0a0a" : metGoal ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.2)",
                            }} />
                          </View>
                        );
                      })}
                    </View>
                    {/* Goal line label */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                      <View style={{ width: 12, height: 2, backgroundColor: "rgba(0,0,0,0.4)" }} />
                      <Text style={{ fontFamily: "Manrope", fontSize: 10, color: "rgba(0,0,0,0.4)" }}>Goal: {targetCups} cups</Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "rgba(0,0,0,0.4)" }}>No data for this period yet</Text>
                  </View>
                )}

                {/* Today's log */}
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "rgba(0,0,0,0.4)", letterSpacing: 0.6, marginBottom: 10 }}>TODAY'S LOG</Text>
                {water.length === 0 ? (
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "rgba(0,0,0,0.4)" }}>Nothing logged yet today.</Text>
                ) : (
                  [...water].reverse().map((e: any, i: number) => (
                    <View key={e.id ?? i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "rgba(0,0,0,0.1)" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.12)", alignItems: "center", justifyContent: "center" }}>
                          <Droplets size={14} color="rgba(0,0,0,0.5)" />
                        </View>
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: "#0a0a0a" }}>8 oz</Text>
                      </View>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "rgba(0,0,0,0.4)" }}>
                        {e.loggedAt ? new Date(e.loggedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                      </Text>
                    </View>
                  ))
                )}

              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* ── Water goal editor modal ─────────────────────────────── */}
      <Modal
        visible={waterEditOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWaterEditOpen(false)}
      >
        <Pressable
          onPress={() => setWaterEditOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 }}
        >
          <Pressable
            onPress={() => { /* swallow taps so they don't dismiss */ }}
            style={{ backgroundColor: card, borderRadius: 20, padding: 20, width: "100%", maxWidth: 340, borderWidth: 1, borderColor: border }}
          >
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text, marginBottom: 4 }}>
              Daily water goal
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginBottom: 16 }}>
              How many 8 oz cups do you want to drink each day?
            </Text>
            <TextInput
              value={waterEditCups}
              onChangeText={setWaterEditCups}
              keyboardType="number-pad"
              autoFocus
              maxLength={2}
              style={{
                backgroundColor: sec, borderRadius: 12, padding: 14,
                color: text, fontFamily: "Manrope-ExtraBold", fontSize: 28,
                textAlign: "center", marginBottom: 4,
              }}
            />
            <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, textAlign: "center", marginBottom: 16 }}>
              cups (1 cup ≈ 8 oz / 237 ml)
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setWaterEditOpen(false)}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  borderWidth: 1, borderColor: border, alignItems: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveWaterGoal}
                disabled={waterGoalSaving}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 12, borderRadius: 12,
                  backgroundColor: BLUE, alignItems: "center",
                  opacity: (pressed || waterGoalSaving) ? 0.6 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: "#0a0a0a" }}>
                  {waterGoalSaving ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
