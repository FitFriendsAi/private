import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell
} from "recharts";
import { Scale, Dumbbell, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { gramsToLbs } from "@/lib/utils";
import type { BodyMeasurement, Goal, Exercise, NutritionTarget } from "@shared/schema";

const RANGE_OPTIONS = [
  { label: "1W", key: "1w" },
  { label: "1M", key: "1m" },
  { label: "3M", key: "3m" },
  { label: "1Y", key: "1y" },
  { label: "All", key: "all" },
];

const DAY_LABELS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
const MACRO_COLORS = {
  fat: "#c084fc",       // purple
  carbs: "#9bd1ff",     // blue-water
  protein: "#c8e84c",   // lime
};

function daysForRange(key: string): number {
  if (key === "1w") return 7;
  if (key === "1m") return 30;
  if (key === "3m") return 90;
  if (key === "1y") {
    const now = new Date();
    return Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  }
  return 730;
}

function shortDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cutoffDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function xInterval(days: number) {
  if (days <= 7) return 0;
  if (days <= 30) return 6;
  if (days <= 90) return 13;
  return 29;
}

// Current week Mon–Sun dates
function getWeekDates(): string[] {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// SVG semi-circle gauge (horseshoe, opens at bottom)
function SemiGauge({ value, max, color, size = 110 }: { value: number; max: number; color: string; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.37;
  const sw = size * 0.09;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const pt = (deg: number) => ({ x: cx + r * Math.cos(toRad(deg)), y: cy + r * Math.sin(toRad(deg)) });

  const START = 135; // SW corner (SVG clockwise from E)
  const SWEEP = 270;
  const start = pt(START);
  const end = pt(45); // SE corner

  const pct = Math.min(Math.max(value / Math.max(max, 1), 0), 0.9999);
  const progDeg = START + pct * SWEEP;
  const prog = pt(progDeg);
  const largeArc = pct * SWEEP > 180 ? 1 : 0;

  return (
    <svg width={size} height={size * 0.82} viewBox={`0 ${size * 0.1} ${size} ${size * 0.82}`} overflow="visible">
      <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`}
        fill="none" stroke="hsl(var(--secondary))" strokeWidth={sw} strokeLinecap="round" />
      {pct > 0 && (
        <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${prog.x} ${prog.y}`}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      )}
    </svg>
  );
}

function EmptyState({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="h-32 flex items-center justify-center text-muted-foreground text-sm text-center">
      <div>
        <div className="w-7 h-7 mx-auto mb-2 opacity-25">{icon}</div>
        <p>{text}</p>
        {sub && <p className="text-xs mt-1">{sub}</p>}
      </div>
    </div>
  );
}

const chartStyle = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", fontSize: "11px" },
};

export default function Progress() {
  const [range, setRange] = useState("1m");
  const [strengthExerciseId, setStrengthExerciseId] = useState<string>("");
  const days = daysForRange(range);

  const { data: measurements = [] } = useQuery<BodyMeasurement[]>({ queryKey: ["/api/measurements"] });
  const { data: goals = [] } = useQuery<Goal[]>({ queryKey: ["/api/goals"] });
  const { data: exercises = [] } = useQuery<Exercise[]>({ queryKey: ["/api/exercises"] });
  const { data: targets } = useQuery<NutritionTarget | null>({ queryKey: ["/api/targets"] });

  const { data: nutritionHistory = [] } = useQuery<{ date: string; calories: number; protein: number; carbs: number; fat: number }[]>({
    queryKey: ["/api/food-log/history", days],
    queryFn: () => apiRequest("GET", `/api/food-log/history?days=${days}`),
  });

  // Always fetch the current week for the weekly cards
  const { data: weekHistory = [] } = useQuery<{ date: string; calories: number; protein: number; carbs: number; fat: number }[]>({
    queryKey: ["/api/food-log/history", 7],
    queryFn: () => apiRequest("GET", `/api/food-log/history?days=7`),
  });

  const { data: strengthHistory = [] } = useQuery({
    queryKey: ["/api/exercises", strengthExerciseId, "history"],
    queryFn: () => strengthExerciseId
      ? apiRequest<{ date: string; maxWeightGrams: number; totalVolume: number }[]>("GET", `/api/exercises/${strengthExerciseId}/history`)
      : [],
    enabled: !!strengthExerciseId,
  });

  // Week data aligned to Mon–Sun
  const weekDates = getWeekDates();
  const weekMap = Object.fromEntries(weekHistory.map(d => [d.date, d]));
  const weekData = weekDates.map(date => ({
    date,
    label: DAY_LABELS[new Date(date + "T00:00:00").getDay()],
    calories: weekMap[date]?.calories ?? 0,
    protein: weekMap[date]?.protein ?? 0,
    carbs: weekMap[date]?.carbs ?? 0,
    fat: weekMap[date]?.fat ?? 0,
    isToday: date === new Date().toISOString().slice(0, 10),
  }));

  const todayData = weekMap[new Date().toISOString().slice(0, 10)];
  const todayCals = todayData?.calories ?? 0;
  const calTarget = targets?.calories ?? 0;
  const calDiff = calTarget > 0 ? calTarget - todayCals : 0;
  const isUnder = calDiff >= 0;

  // Avg macros for current range
  const nutDaysWithData = nutritionHistory.filter(d => d.calories > 0);
  const avgCals = nutDaysWithData.length > 0 ? Math.round(nutDaysWithData.reduce((s, d) => s + d.calories, 0) / nutDaysWithData.length) : 0;
  const avgFat = nutDaysWithData.length > 0 ? Math.round(nutDaysWithData.reduce((s, d) => s + d.fat, 0) / nutDaysWithData.length) : 0;
  const avgCarbs = nutDaysWithData.length > 0 ? Math.round(nutDaysWithData.reduce((s, d) => s + d.carbs, 0) / nutDaysWithData.length) : 0;
  const avgProtein = nutDaysWithData.length > 0 ? Math.round(nutDaysWithData.reduce((s, d) => s + d.protein, 0) / nutDaysWithData.length) : 0;

  // Donut data from today (or avg if no today data)
  const donutCals = todayCals || avgCals;
  const donutFatKcal = (todayData?.fat ?? avgFat) * 9;
  const donutCarbKcal = (todayData?.carbs ?? avgCarbs) * 4;
  const donutProtKcal = (todayData?.protein ?? avgProtein) * 4;
  const donutTotal = donutFatKcal + donutCarbKcal + donutProtKcal || 1;
  const donutData = [
    { name: "Fat", value: donutFatKcal, color: MACRO_COLORS.fat },
    { name: "Carbs", value: donutCarbKcal, color: MACRO_COLORS.carbs },
    { name: "Protein", value: donutProtKcal, color: MACRO_COLORS.protein },
  ];
  const fatPct = Math.round(donutFatKcal / donutTotal * 100);
  const carbPct = Math.round(donutCarbKcal / donutTotal * 100);
  const protPct = Math.round(donutProtKcal / donutTotal * 100);

  // Avg % of target for macro avg chips
  const avgFatPct = targets?.fatG ? Math.round(avgFat / targets.fatG * 100) : 0;
  const avgCarbPct = targets?.carbsG ? Math.round(avgCarbs / targets.carbsG * 100) : 0;
  const avgProtPct = targets?.proteinG ? Math.round(avgProtein / targets.proteinG * 100) : 0;

  const nutData = nutritionHistory.map(d => ({ ...d, label: shortDate(d.date) }));
  const barSize = days <= 7 ? 18 : days <= 30 ? 7 : days <= 90 ? 4 : 2;
  const interval = xInterval(days);

  // Weight / strength
  const weightGoal = goals.find(g => (g.type === "weight_loss" || g.type === "weight_gain") && g.isActive);
  const weightData = [...measurements].reverse()
    .filter(m => m.date >= cutoffDate(days))
    .map(m => ({ date: m.date, weight: gramsToLbs(m.weightGrams), label: shortDate(m.date) }));
  const strengthData = [...strengthHistory].reverse()
    .filter(h => h.date >= cutoffDate(days))
    .map(h => ({ date: h.date, weight: gramsToLbs(h.maxWeightGrams), label: shortDate(h.date) }));
  const weightStats = weightData.length > 1 ? (() => {
    const first = weightData[0]; const last = weightData[weightData.length - 1];
    const change = last.weight - first.weight;
    const d = Math.max(1, Math.ceil((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000));
    return { current: last.weight, change: change.toFixed(1), ratePerWeek: ((change / d) * 7).toFixed(2) };
  })() : (measurements.length > 0 ? { current: gramsToLbs(measurements[0].weightGrams), change: "0", ratePerWeek: "0" } : null);
  const goalWeightLbs = weightGoal ? gramsToLbs(weightGoal.targetValue) : undefined;
  const compoundExercises = exercises.filter(e => e.category === "compound").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-4 pt-6 pb-8 space-y-6">
      {/* Header + range selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Progress</h1>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${range === r.key ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:bg-accent"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Nutrition ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nutrition</h2>

        {/* Calories card */}
        <div className="bg-card rounded-3xl p-4">
          <div className="text-sm font-bold mb-3">Calories</div>
          <div className="flex items-start gap-3">
            {/* Gauge + number */}
            <div className="flex flex-col items-center" style={{ minWidth: 110 }}>
              <div className="relative">
                <SemiGauge value={todayCals} max={calTarget || 2000} color={isUnder ? "var(--lime)" : "#ef4444"} size={110} />
                <div className="absolute inset-0 flex flex-col items-center justify-center mt-2">
                  <span className="text-xl font-bold leading-none dot" style={{ color: isUnder ? "var(--lime)" : "#ef4444" }}>
                    {todayCals.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{isUnder ? "Under" : "Over"}</span>
                </div>
              </div>
              <div className="text-center mt-1">
                <span className="text-sm font-bold">{todayCals}</span>
                <span className="text-xs text-muted-foreground ml-1">cals</span>
              </div>
            </div>

            {/* 7-day bar chart */}
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={weekData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={14}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip {...chartStyle} formatter={(v: number) => [`${v} kcal`, "Calories"]} />
                  <Bar dataKey="calories" radius={[4, 4, 2, 2]}
                    fill="hsl(var(--secondary))"
                    label={false}
                  >
                    {weekData.map((entry, i) => (
                      <Cell key={i} fill={entry.isToday ? (isUnder ? "#c8e84c" : "#ef4444") : "hsl(var(--secondary))"} />
                    ))}
                  </Bar>
                  {calTarget > 0 && <ReferenceLine y={calTarget} stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.3} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span><span className="text-foreground font-semibold">{Math.abs(calDiff)}</span> kcal {isUnder ? "remaining today" : "over today"}</span>
            {calTarget > 0 && <span>target {calTarget.toLocaleString()}</span>}
          </div>
        </div>

        {/* Macronutrients card */}
        <div className="bg-card rounded-3xl p-4">
          <div className="text-sm font-bold mb-3">Macronutrients</div>
          <div className="flex items-start gap-3">
            {/* Donut + legend */}
            <div style={{ minWidth: 110 }}>
              <PieChart width={110} height={90}>
                {donutCals > 0 ? (
                  <Pie data={donutData} cx={55} cy={45} innerRadius={28} outerRadius={42} paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                ) : (
                  <Pie data={[{ value: 1 }]} cx={55} cy={45} innerRadius={28} outerRadius={42} dataKey="value" strokeWidth={0}>
                    <Cell fill="hsl(var(--secondary))" />
                  </Pie>
                )}
              </PieChart>
              <div className="space-y-1 mt-1">
                {[
                  { label: "Fat", pct: fatPct, color: MACRO_COLORS.fat },
                  { label: "Carbs", pct: carbPct, color: MACRO_COLORS.carbs },
                  { label: "Protein", pct: protPct, color: MACRO_COLORS.protein },
                ].map(m => (
                  <div key={m.label} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.color }} />
                      <span className="text-muted-foreground">{m.label}</span>
                    </div>
                    <span className="font-semibold">{m.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 7-day stacked bar */}
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={weekData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={14}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip {...chartStyle} />
                  <Bar dataKey="fat" stackId="a" fill={MACRO_COLORS.fat} name="Fat (g)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="carbs" stackId="a" fill={MACRO_COLORS.carbs} name="Carbs (g)" />
                  <Bar dataKey="protein" stackId="a" fill={MACRO_COLORS.protein} name="Protein (g)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* AVG chips */}
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-2 text-xs">
            <span className="text-muted-foreground font-medium">AVG</span>
            {[
              { label: `${avgFatPct}%`, color: MACRO_COLORS.fat, bg: "rgba(217,119,6,0.2)" },
              { label: `${avgCarbPct}%`, color: MACRO_COLORS.carbs, bg: "rgba(59,130,246,0.2)" },
              { label: `${avgProtPct}%`, color: MACRO_COLORS.protein, bg: "rgba(139,92,246,0.2)" },
            ].map((chip, i) => (
              <span key={i} className="px-2 py-0.5 rounded-lg font-semibold" style={{ background: chip.bg, color: chip.color }}>
                {chip.label}
              </span>
            ))}
            <span className="text-muted-foreground text-[10px] ml-1">of target</span>
          </div>
        </div>

        {/* Longer-range calorie trend */}
        {nutDaysWithData.length > 0 && (
          <div className="bg-card rounded-3xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">Calorie Trend</div>
              <span className="text-xs text-muted-foreground">avg {avgCals} kcal/day</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={nutData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barSize={barSize}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={interval} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip {...chartStyle} formatter={(v: number) => [`${v} kcal`, "Calories"]} />
                <Bar dataKey="calories" fill="var(--pink)" radius={[3, 3, 0, 0]} />
                {calTarget > 0 && <ReferenceLine y={calTarget} stroke="hsl(var(--foreground))" strokeDasharray="4 4" strokeOpacity={0.35} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Body Weight ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Scale className="w-3.5 h-3.5" /> Body Weight
        </h2>
        {weightStats && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Current", value: `${weightStats.current}`, unit: "lbs" },
              { label: "Change", value: `${Math.abs(parseFloat(weightStats.change))}`, unit: "lbs", icon: parseFloat(weightStats.change) < 0 ? <TrendingDown className="w-3 h-3" /> : parseFloat(weightStats.change) > 0 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />, color: parseFloat(weightStats.change) < 0 ? "text-green-400" : parseFloat(weightStats.change) > 0 ? "text-red-400" : "" },
              { label: "Per Week", value: `${Math.abs(parseFloat(weightStats.ratePerWeek))}`, unit: "lbs/wk" },
            ].map((s, i) => (
              <div key={i} className="bg-card rounded-2xl p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
                <div className={`text-lg font-bold flex items-center justify-center gap-0.5 ${s.color ?? ""}`}>
                  {s.icon}{s.value}
                </div>
                <div className="text-xs text-muted-foreground">{s.unit}</div>
              </div>
            ))}
          </div>
        )}
        <div className="bg-card rounded-3xl p-4">
          {weightData.length < 2 ? (
            <EmptyState icon={<Scale className="w-7 h-7" />} text="Log 2+ weight entries to see your trend" sub="Settings → Log Weight" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weightData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={interval} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                <Tooltip {...chartStyle} formatter={(v: number) => [`${v} lbs`, "Weight"]} />
                <Line type="monotone" dataKey="weight" stroke="var(--pink)" strokeWidth={2.5} dot={false} />
                {goalWeightLbs && <ReferenceLine y={goalWeightLbs} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" label={{ value: `Goal: ${goalWeightLbs}`, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ── Strength ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Dumbbell className="w-3.5 h-3.5" /> Strength
          </h2>
          <Select value={strengthExerciseId} onValueChange={setStrengthExerciseId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Pick exercise" /></SelectTrigger>
            <SelectContent>
              {compoundExercises.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-3xl p-4">
          {!strengthExerciseId ? (
            <EmptyState icon={<Dumbbell className="w-7 h-7" />} text="Select an exercise above to view progress" />
          ) : strengthData.length < 2 ? (
            <EmptyState icon={<Dumbbell className="w-7 h-7" />} text="Keep logging workouts to see your trend" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={strengthData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={interval} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip {...chartStyle} formatter={(v: number) => [`${v} lbs`, "Max Weight"]} />
                <Line type="monotone" dataKey="weight" stroke="var(--lime)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--lime)" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}
