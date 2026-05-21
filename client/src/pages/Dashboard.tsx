import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { CircleRing } from "@/components/CircleRing";
import {
  Droplets, Pill, Plus, Check, ChevronRight,
  Dumbbell, Flame, Heart, Zap, TrendingDown, TrendingUp as TrendUp,
} from "lucide-react";
import { todayStr, mlToOz, gramsToLbs } from "@/lib/utils";
import { Link } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { useHeartRate } from "@/hooks/use-heart-rate";
import type { HRReading } from "@/hooks/use-heart-rate";
import type {
  Goal, NutritionTarget, FoodLogEntry, WaterLogEntry,
  SupplementLogEntry, BodyMeasurement, Workout,
} from "@shared/schema";

const today = todayStr();

// Mock friends for "Friends Nearby"
const MOCK_FRIENDS = [
  { initials: "MR", name: "Maya",   color: "#f8c8dc" },
  { initials: "JK", name: "Jordan", color: "#c8e84c" },
  { initials: "SQ", name: "Sam",    color: "#9bd1ff" },
  { initials: "LP", name: "Leo",    color: "#ffb88c" },
  { initials: "AV", name: "Ana",    color: "#d3a8ff" },
];

// Mock step bar data (Mon–Sun, last 7 days)
const STEP_BARS = [7800, 6400, 9100, 4300, 11200, 8420, 5100];
const TODAY_STEPS = 8420;
const STEP_GOAL = 10000;

/* ── Heart Rate SVG chart (live or idle placeholder) ────────── */
function HRChart({ readings, w = 300, h = 52 }: { readings: HRReading[]; w?: number; h?: number }) {
  const pad = 4;

  if (readings.length < 2) {
    // Flat placeholder line when no data yet
    const y = pad + (h - pad * 2) * 0.6;
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        <line x1={pad} y1={y} x2={w - pad} y2={y}
          stroke="var(--pink)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
      </svg>
    );
  }

  const bpms = readings.map(r => r.bpm);
  const lo   = Math.min(...bpms) - 5;
  const hi   = Math.max(...bpms) + 5;
  const range = hi - lo || 1;

  const coords = readings.map((r, i) => {
    const x = pad + (i / (readings.length - 1)) * (w - pad * 2);
    const y = pad + ((hi - r.bpm) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  const areaClose = `${w - pad},${h - pad} ${pad},${h - pad}`;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--pink)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--pink)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${coords.join(" ")} ${areaClose}`} fill="url(#hrGrad)" />
      <polyline points={coords.join(" ")} fill="none"
        stroke="var(--pink)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── Body weight sparkline ──────────────────────────────────── */
function WeightSparkline({ measurements }: { measurements: BodyMeasurement[] }) {
  const pts = [...measurements].reverse().slice(-12);
  if (pts.length < 2) return null;

  const values = pts.map(m => gramsToLbs(m.weightGrams));
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const W = 120, H = 48, pad = 4;

  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = pad + ((max - v) / (max - min)) * (H - pad * 2);
    return `${x},${y}`;
  });

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Last point dot */}
      {(() => {
        const last = coords[coords.length - 1].split(",");
        return <circle cx={last[0]} cy={last[1]} r="3.5" fill="#0a0a0a" opacity="0.7" />;
      })()}
    </svg>
  );
}

/* ── Steps bar chart ────────────────────────────────────────── */
function StepsBars() {
  const max = Math.max(...STEP_BARS);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }}>
      {STEP_BARS.map((s, i) => {
        const isToday = i === STEP_BARS.length - 2; // Saturday = today in mock
        const h = Math.max(4, Math.round((s / max) * 36));
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{
              width: "100%", height: h, borderRadius: "3px 3px 2px 2px",
              background: isToday ? "var(--lime)" : `var(--lime)`,
              opacity: isToday ? 1 : 0.45 + (s / max) * 0.55,
            }} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: targets } = useQuery<NutritionTarget | null>({ queryKey: ["/api/targets"] });
  const { data: foodLog = [] } = useQuery<FoodLogEntry[]>({
    queryKey: ["/api/food-log", today],
    queryFn: () => apiRequest("GET", `/api/food-log?date=${today}`),
  });
  const { data: water = [] } = useQuery<WaterLogEntry[]>({
    queryKey: ["/api/water", today],
    queryFn: () => apiRequest("GET", `/api/water?date=${today}`),
  });
  const { data: supplements = [] } = useQuery<SupplementLogEntry[]>({
    queryKey: ["/api/supplements", today],
    queryFn: () => apiRequest("GET", `/api/supplements?date=${today}`),
  });
  const { data: goals = [] } = useQuery<Goal[]>({ queryKey: ["/api/goals"] });
  const { data: measurements = [] } = useQuery<BodyMeasurement[]>({ queryKey: ["/api/measurements"] });
  const { data: recentWorkouts = [] } = useQuery<Workout[]>({ queryKey: ["/api/workouts"] });

  const addWater = useMutation({
    mutationFn: (amountMl: number) => apiRequest("POST", "/api/water", { date: today, amountMl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/water", today] }),
  });
  const addSupplement = useMutation({
    mutationFn: (amountG: number) =>
      apiRequest("POST", "/api/supplements", { date: today, supplement: "creatine", amountG }),
    onMutate: async (amountG) => {
      // Optimistic update — immediately reflect the addition in the UI
      await qc.cancelQueries({ queryKey: ["/api/supplements", today] });
      const prev = qc.getQueryData<any[]>(["/api/supplements", today]) ?? [];
      qc.setQueryData(["/api/supplements", today], [
        ...prev,
        { id: -Date.now(), userId: -1, date: today, supplement: "creatine", amountG, loggedAt: new Date().toISOString() },
      ]);
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      // Roll back optimistic update
      if (ctx?.prev) qc.setQueryData(["/api/supplements", today], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/supplements", today] });
    },
  });

  const totals = foodLog.reduce((acc, e) => ({
    calories: acc.calories + e.caloriesActual,
    protein:  acc.protein  + e.proteinActual,
    carbs:    acc.carbs    + e.carbsActual,
    fat:      acc.fat      + e.fatActual,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const totalWaterOz  = mlToOz(water.reduce((a, e) => a + e.amountMl, 0));
  const targetWaterOz = mlToOz(targets?.waterMl ?? 2500);
  const waterCups     = Math.round(totalWaterOz / 8);
  const targetCups    = Math.max(Math.round(targetWaterOz / 8), 8);
  const creatineGrams = supplements
    .filter(s => s.supplement === "creatine")
    .reduce((sum, s) => sum + (s.amountG ?? 0), 0);
  const creatineDone  = creatineGrams >= 5; // at or past recommended dose
  const latestWeight  = measurements[0];
  const prevWeight    = measurements.find((_, i, arr) => {
    // find measurement ~7 days ago
    const daysAgo = (Date.now() - new Date(arr[i].date + "T00:00:00").getTime()) / 86400000;
    return daysAgo >= 6;
  });
  const weeklyChange  = latestWeight && prevWeight
    ? gramsToLbs(latestWeight.weightGrams) - gramsToLbs(prevWeight.weightGrams)
    : null;
  const activeGoals   = goals.filter(g => g.isActive);

  // 5-week workout calendar
  const workoutDates = new Set(recentWorkouts.map(w => w.date));
  const calDays: { date: string; hasWorkout: boolean; isToday: boolean }[] = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    calDays.push({ date: ds, hasWorkout: workoutDates.has(ds), isToday: ds === today });
  }

  // Streak
  let streak = 0;
  for (let i = 0; i <= 60; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (workoutDates.has(d.toISOString().slice(0, 10))) streak++;
    else if (i > 0) break;
  }

  const calTarget = targets?.calories ?? 2200;
  const calPct    = Math.min(totals.calories / calTarget, 1);
  const greeting  = getGreeting();
  const firstName = user?.name?.split(" ")[0] ?? "";

  const hr = useHeartRate();

  // Workout calendar dot colour — use dark ink on the white card so dots are
  // always visible regardless of which palette the user has chosen.
  const { paletteId, palettes } = useTheme();
  const currentPalette  = palettes.find(p => p.id === paletteId) ?? palettes[0];
  const isWhitePalette  = currentPalette.accent === "#ffffff";
  const dotAccent       = isWhitePalette ? "#1a1a1a"          : currentPalette.accent;
  const dotFaded        = isWhitePalette ? "rgba(0,0,0,0.22)" : `${currentPalette.accent}70`;

  return (
    <div style={{ padding: "0 16px 100px" }}>

      {/* ── Header ─────────────────────────────── */}
      <div style={{ padding: "12px 4px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {greeting}
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", margin: "2px 0 0", lineHeight: 1.1 }}>{firstName}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {latestWeight && (
            <div style={{ background: "#ffffff", borderRadius: 20, padding: "10px 16px", textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "0.08em" }}>BODY WEIGHT</div>
              <div className="dot" style={{ fontSize: 26, color: "#0a0a0a", lineHeight: 1.1 }}>
                {gramsToLbs(latestWeight.weightGrams)}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#888", marginLeft: 4, fontFamily: "'Manrope', sans-serif" }}>lbs</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Streak + Calories ──────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Streak — dark + lime */}
        <div style={{ background: "hsl(var(--card))", borderRadius: 24, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 700, letterSpacing: "0.08em" }}>STREAK</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                <span className="dot" style={{ fontSize: 36, color: "var(--lime)", lineHeight: 1 }}>{streak}</span>
                <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>DAYS</span>
              </div>
            </div>
            <Flame className="w-5 h-5 mt-0.5" style={{ color: "var(--lime)" }} />
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {Array.from({ length: 7 }).map((_, i) => {
              const d = new Date(); d.setDate(d.getDate() - (6 - i));
              const on = workoutDates.has(d.toISOString().slice(0, 10));
              return (
                <div key={i} style={{
                  flex: 1, aspectRatio: "1", maxWidth: 10, borderRadius: "50%",
                  background: on ? "var(--lime)" : "hsl(var(--secondary))",
                }} />
              );
            })}
          </div>
        </div>

        {/* Calories — PINK card */}
        <Link href="/food">
          <a style={{
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            height: "100%", boxSizing: "border-box",
            background: "var(--pink)", borderRadius: 24, padding: 16,
            color: "#0a0a0a", textDecoration: "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", opacity: 0.65 }}>CALORIES</div>
              <CircleRing size={44} strokeWidth={5} progress={calPct} color="#0a0a0a" />
            </div>
            <div>
              <div className="dot" style={{ fontSize: 36, color: "#0a0a0a", lineHeight: 1 }}>
                {Math.round(totals.calories).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.55, marginTop: 4 }}>/ {Math.round(calTarget)} kcal</div>
            </div>
          </a>
        </Link>
      </div>

      {/* ── Macro bars ─────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
        {([
          { label: "PROTEIN", val: Math.round(totals.protein), target: Math.round(targets?.proteinG ?? 0), color: "var(--lime)" },
          { label: "CARBS",   val: Math.round(totals.carbs),   target: Math.round(targets?.carbsG  ?? 0), color: "var(--blue-water)" },
          { label: "FAT",     val: Math.round(totals.fat),     target: Math.round(targets?.fatG    ?? 0), color: "hsl(var(--chart-4))" },
        ] as const).map(m => (
          <Link key={m.label} href="/food">
            <a style={{ display: "block", background: "hsl(var(--card))", borderRadius: 20, padding: "12px 14px", textDecoration: "none" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 4 }}>
                <span className="dot" style={{ fontSize: 20, color: m.color }}>{m.val}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>/{m.target}g</span>
              </div>
              <div style={{ height: 4, background: "hsl(var(--secondary))", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(m.target > 0 ? (m.val / m.target) * 100 : 0, 100)}%`,
                  height: "100%", background: m.color, borderRadius: 2,
                }} />
              </div>
            </a>
          </Link>
        ))}
      </div>

      {/* ── Heart Rate ─────────────────────────── */}
      <div style={{ background: "hsl(var(--card))", borderRadius: 24, padding: 18, marginBottom: 10 }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Heart style={{ width: 15, height: 15, color: "var(--pink)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>Heart rate</span>
          </div>

          {hr.connected ? (
            /* LIVE pill + disconnect */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.4)",
                borderRadius: 20, padding: "2px 10px",
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 700, color: "#22c55e",
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                LIVE
              </div>
              <button
                onClick={hr.disconnect}
                style={{
                  fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))",
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                }}
              >
                Disconnect
              </button>
            </div>
          ) : hr.reconnecting ? (
            /* Reconnecting pill */
            <div style={{
              background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)",
              borderRadius: 20, padding: "2px 10px",
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, fontWeight: 700, color: "#f59e0b",
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%", background: "#f59e0b",
                animation: "pulse 1.2s ease-in-out infinite",
              }} />
              Reconnecting…
            </div>
          ) : (
            /* Connect button */
            <button
              onClick={hr.connect}
              disabled={hr.connecting || !hr.supported}
              style={{
                background: "var(--pink)", color: "#0a0a0a",
                border: "none", borderRadius: 14, padding: "5px 14px",
                fontSize: 12, fontWeight: 700, cursor: hr.supported ? "pointer" : "not-allowed",
                opacity: hr.connecting ? 0.7 : 1,
              }}
            >
              {hr.connecting ? "Connecting…" : !hr.supported ? "Not supported" : "Connect"}
            </button>
          )}
        </div>

        {/* Error message */}
        {hr.error && (
          <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8, fontWeight: 600 }}>
            {hr.error}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "flex", gap: 28, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}>
              {hr.connected ? "CURRENT" : "AVG"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
              <span className="dot" style={{ fontSize: 32, color: "hsl(var(--foreground))", lineHeight: 1 }}>
                {hr.connected
                  ? (hr.heartRate ?? "—")
                  : (hr.avg ?? "—")}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>BPM</span>
            </div>
          </div>
          {(hr.min !== null && hr.max !== null) ? (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}>RANGE</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 2 }}>
                <span className="dot" style={{ fontSize: 32, color: "hsl(var(--foreground))", lineHeight: 1 }}>
                  {hr.min}–{hr.max}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>BPM</span>
              </div>
            </div>
          ) : !hr.connected && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.4 }}>
                Tap Connect to pair your<br />Bluetooth HR monitor
              </span>
            </div>
          )}
        </div>

        {/* Live chart */}
        <HRChart readings={hr.readings} />

        {/* Time axis — shows elapsed time when live, clock times when idle */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {hr.readings.length >= 2 ? (() => {
            const first = hr.readings[0].ts;
            const last  = hr.readings[hr.readings.length - 1].ts;
            const step  = (last - first) / 5;
            return Array.from({ length: 6 }, (_, i) => {
              const t = new Date(first + i * step);
              return (
                <span key={i} style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>
                  {t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              );
            });
          })() : (
            ["", "", "", "", "", ""].map((_, i) => (
              <span key={i} style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>
                {["12PM","14PM","16PM","18PM","20PM","22PM"][i]}
              </span>
            ))
          )}
        </div>
      </div>

      {/* ── Water + Steps side-by-side ──────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Water — compact */}
        <div style={{ background: "hsl(var(--card))", borderRadius: 24, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))" }}>WATER</span>
            <button
              onClick={() => addWater.mutate(240)}
              style={{
                width: 22, height: 22, borderRadius: "50%",
                background: "var(--blue-water)", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Droplets style={{ width: 11, height: 11, color: "#0a0a0a" }} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
            <span className="dot" style={{ fontSize: 40, color: "var(--blue-water)", lineHeight: 1 }}>{waterCups}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--muted-foreground))" }}>/ {targetCups} cups</span>
          </div>

          {/* Segment bar */}
          <div style={{ display: "flex", gap: 3 }}>
            {Array.from({ length: targetCups }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 5, borderRadius: 2,
                background: i < waterCups ? "var(--blue-water)" : "hsl(var(--secondary))",
              }} />
            ))}
          </div>
        </div>

        {/* Steps */}
        <div style={{ background: "hsl(var(--card))", borderRadius: 24, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "hsl(var(--muted-foreground))" }}>STEPS</span>
            <Zap style={{ width: 14, height: 14, color: "var(--lime)" }} />
          </div>

          <div style={{ marginBottom: 2 }}>
            <span className="dot" style={{ fontSize: 28, color: "hsl(var(--foreground))", lineHeight: 1 }}>
              {TODAY_STEPS.toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
            / {STEP_GOAL.toLocaleString()} goal
          </div>

          <StepsBars />
        </div>
      </div>

      {/* ── Workout calendar — WHITE ────────────── */}
      <Link href="/workouts">
        <a style={{ display: "block", background: "#ffffff", borderRadius: 24, padding: 18, marginBottom: 10, textDecoration: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#0a0a0a" }}>Workouts</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#888" }}>
              {recentWorkouts.length} sessions <ChevronRight style={{ width: 12, height: 12 }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 9, color: "#aaa", fontWeight: 700 }}>{d}</div>
            ))}
            {calDays.map((d, i) => (
              <div key={i} style={{
                margin: "0 auto", width: 14, height: 14, borderRadius: "50%",
                background: d.hasWorkout || d.isToday ? dotAccent : "#e8e8e8",
                outline: d.isToday ? `2px solid ${dotAccent}` : "none",
                outlineOffset: 2,
              }} />
            ))}
          </div>
          {recentWorkouts[0] && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dumbbell style={{ width: 16, height: 16, color: "var(--pink)" }} />
                <span style={{ fontWeight: 600, color: "#0a0a0a" }}>{recentWorkouts[0].name}</span>
              </div>
              <span style={{ fontSize: 11, color: "#aaa" }}>{relativeDate(recentWorkouts[0].date)}</span>
            </div>
          )}
        </a>
      </Link>

      {/* ── Body Weight — WHITE ─────────────────── */}
      {latestWeight && (
        <div style={{ background: "#ffffff", borderRadius: 24, padding: 18, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", marginBottom: 8 }}>BODY WEIGHT</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="dot" style={{ fontSize: 42, color: "#0a0a0a", lineHeight: 1 }}>
                  {gramsToLbs(latestWeight.weightGrams)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#888" }}>lbs</span>
              </div>
              {weeklyChange !== null && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 4, marginTop: 4,
                  fontSize: 12, fontWeight: 700,
                  color: weeklyChange < 0 ? "#22c55e" : weeklyChange > 0 ? "#ef4444" : "#888",
                }}>
                  {weeklyChange < 0
                    ? <TrendingDown style={{ width: 14, height: 14 }} />
                    : weeklyChange > 0
                    ? <TrendUp style={{ width: 14, height: 14 }} />
                    : null}
                  {weeklyChange === 0
                    ? "No change this week"
                    : `${weeklyChange > 0 ? "+" : ""}${weeklyChange.toFixed(1)} lbs this week`}
                </div>
              )}
            </div>
            <WeightSparkline measurements={measurements} />
          </div>
        </div>
      )}

      {/* ── Creatine + Goal ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => addSupplement.mutate(2.5)}
          disabled={addSupplement.isPending}
          style={{
            background: creatineDone ? "var(--lime)" : "hsl(var(--card))",
            borderRadius: 24, padding: 16,
            display: "flex", flexDirection: "column", gap: 8,
            border: "none", textAlign: "left", cursor: "pointer",
            transition: "background .2s", width: "100%",
          }}
        >
          {/* Icon row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 11,
              background: creatineDone ? "rgba(0,0,0,0.12)" : "hsl(var(--secondary))",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Pill style={{ width: 18, height: 18, color: creatineDone ? "#0a0a0a" : "hsl(var(--muted-foreground))" }} />
            </div>
            {/* gram counter badge */}
            {creatineGrams > 0 && (
              <span className="dot" style={{
                fontSize: 20, lineHeight: 1,
                color: creatineDone ? "#0a0a0a" : "var(--pink)",
              }}>
                {creatineGrams % 1 === 0 ? creatineGrams : creatineGrams.toFixed(1)}g
              </span>
            )}
          </div>

          {/* Label */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: creatineDone ? "#0a0a0a" : "hsl(var(--foreground))" }}>
              Creatine
            </div>
            <div style={{ fontSize: 11, marginTop: 2, color: creatineDone ? "rgba(0,0,0,0.55)" : "hsl(var(--muted-foreground))" }}>
              {creatineGrams === 0 ? "tap to add 2.5g" : creatineDone ? "dose reached ✓" : "tap for more"}
            </div>
          </div>

          {/* Progress dots — 2 dots = 5g (full dose) */}
          <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
            {Array.from({ length: 4 }).map((_, i) => {
              const filled = creatineGrams >= (i + 1) * 2.5;
              return (
                <div key={i} style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: filled
                    ? (creatineDone ? "rgba(0,0,0,0.3)" : "var(--pink)")
                    : (creatineDone ? "rgba(0,0,0,0.15)" : "hsl(var(--secondary))"),
                  transition: "background .2s",
                }} />
              );
            })}
          </div>
        </button>

        {activeGoals[0] ? (
          <Link href="/goals">
            <a style={{ display: "block", background: "hsl(var(--card))", borderRadius: 24, padding: 16, textDecoration: "none" }}>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>ACTIVE GOAL</div>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {activeGoals[0].label}
              </div>
              {activeGoals[0].deadline && (
                <div style={{ fontSize: 11, color: "var(--pink)", fontWeight: 700, marginTop: 8 }}>
                  {Math.max(0, Math.ceil((new Date(activeGoals[0].deadline).getTime() - Date.now()) / 86400000))}d left
                </div>
              )}
            </a>
          </Link>
        ) : (
          <Link href="/goals">
            <a style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "hsl(var(--card))", borderRadius: 24, padding: 16, gap: 8, textDecoration: "none",
            }}>
              <Plus className="w-5 h-5" style={{ color: "hsl(var(--muted-foreground))" }} />
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Set a goal</div>
            </a>
          </Link>
        )}
      </div>

      {/* ── Friends Nearby ────────────────────── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>FRIENDS NEARBY</span>
          <Link href="/friends">
            <a style={{ fontSize: 12, fontWeight: 700, color: "var(--pink)", textDecoration: "none" }}>See all</a>
          </Link>
        </div>
        <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 4 }}>
          {MOCK_FRIENDS.map(f => {
            const isDark = f.color === "#c8e84c" || f.color === "#ffb88c";
            return (
              <Link key={f.initials} href="/friends">
                <a style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textDecoration: "none", flexShrink: 0 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: "50%",
                    background: f.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 16,
                    color: isDark ? "#0a0a0a" : "#0a0a0a",
                    position: "relative",
                  }}>
                    {f.initials}
                    {/* Online badge */}
                    <div style={{
                      position: "absolute", bottom: 1, right: 1,
                      width: 14, height: 14, borderRadius: "50%",
                      background: "#1c1c1c", border: "2px solid hsl(var(--background))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--lime)" }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--foreground))" }}>{f.name}</span>
                </a>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Setup prompt ─────────────────────── */}
      {!targets && (
        <Link href="/settings">
          <a style={{
            display: "block", borderRadius: 24, padding: 20, textAlign: "center", marginTop: 10,
            background: "rgba(248,200,220,0.08)", border: "1px solid rgba(248,200,220,0.22)",
            backdropFilter: "blur(12px)", textDecoration: "none",
          }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "var(--pink)", margin: 0 }}>Complete your profile</p>
            <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>
              Add your weight &amp; goals to unlock personalized targets →
            </p>
          </a>
        </Link>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function relativeDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
