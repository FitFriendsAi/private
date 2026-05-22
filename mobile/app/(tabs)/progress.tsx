import { useState, useMemo } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs, todayStr } from "@/lib/utils";
import Svg, { Circle, Polyline, Rect, Line } from "react-native-svg";
import { Scale, Dumbbell, ChevronDown, X } from "lucide-react-native";

const today = todayStr();

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

// Generate a zero-value scaffold so the x-axis always renders even with no data
const DAY_ABBR   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function emptyScaffold(period: Period): { label: string; value: number }[] {
  const now = new Date();
  const addDay = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  if (period === "1W") {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDay(now, i - 6);
      return { label: DAY_ABBR[d.getDay()], value: 0 };
    });
  }
  if (period === "1M") {
    return Array.from({ length: 30 }, (_, i) => {
      const d = addDay(now, i - 29);
      return { label: String(d.getDate()), value: 0 };
    });
  }
  if (period === "3M") {
    return Array.from({ length: 13 }, (_, i) => {
      const d = addDay(now, (i - 12) * 7);
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: 0 };
    });
  }
  if (period === "1Y") {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { label: MONTH_ABBR[d.getMonth()], value: 0 };
    });
  }
  // "All"
  return MONTH_ABBR.map(label => ({ label, value: 0 }));
}

// ── Single-colour donut ring (calories card) ──────────────────────
function Donut({
  pct, size, strokeWidth, trackColor, fillColor,
}: {
  pct: number; size: number; strokeWidth: number;
  trackColor: string; fillColor: string;
}) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 1) * circ;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r}
        stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      {pct > 0 && (
        <Circle cx={size / 2} cy={size / 2} r={r}
          stroke={fillColor} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </Svg>
  );
}

// ── Multi-segment macro donut (fat/carbs/protein arcs) ────────────
function MacroDonut({
  fat, carbs, protein, size, strokeWidth,
}: {
  fat: number; carbs: number; protein: number;
  size: number; strokeWidth: number;
}) {
  const total = fat + carbs + protein;
  const r     = (size - strokeWidth) / 2;
  const circ  = 2 * Math.PI * r;
  const cx    = size / 2;
  const cy    = size / 2;

  if (total <= 0) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} fill="none" />
      </Svg>
    );
  }

  // Build segments: fat → carbs → protein, starting from top
  const segs = [
    { color: PURPLE, val: fat },
    { color: BLUE,   val: carbs },
    { color: LIME,   val: protein },
  ];
  let angle = -90;
  const rendered = segs.map((seg, i) => {
    if (seg.val <= 0) return null;
    const arcLen = (seg.val / total) * circ;
    const startAngle = angle;
    angle += (seg.val / total) * 360;
    return (
      <Circle key={i}
        cx={cx} cy={cy} r={r}
        stroke={seg.color} strokeWidth={strokeWidth} fill="none"
        strokeDasharray={`${arcLen} ${circ - arcLen}`}
        transform={`rotate(${startAngle} ${cx} ${cy})`}
      />
    );
  });

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r}
        stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} fill="none" />
      {rendered}
    </Svg>
  );
}

// ── Stacked macro bar chart ───────────────────────────────────────
function StackedBars({
  data, w, h = 80,
}: {
  data: { label: string; fat: number; carbs: number; protein: number }[];
  w: number; h?: number;
}) {
  if (w <= 0 || data.length === 0) return null;
  const n      = data.length;
  const gap    = n > 20 ? 1 : n > 10 ? 2 : 4;
  const barW   = Math.max(1, (w - gap * (n - 1)) / n);
  const labelH = 14;
  const chartH = h - labelH;
  const hasAny = data.some(d => d.fat + d.carbs + d.protein > 0);
  const maxV   = hasAny
    ? Math.max(...data.map(d => d.fat + d.carbs + d.protein), 1)
    : 1;

  const showLabel = (i: number) => {
    if (n <= 7)  return true;
    if (n <= 15) return i === 0 || i === n - 1 || i % 3 === 0;
    if (n <= 31) return i === 0 || i === n - 1 || i % 7 === 0;
    return i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
  };

  return (
    <Svg width={w} height={h}>
      <Line x1={0} y1={chartH} x2={w} y2={chartH} stroke="#333333" strokeWidth={1} />
      {data.map((d, i) => {
        const total = d.fat + d.carbs + d.protein;
        if (total <= 0) return null;
        const totalH = (total / maxV) * chartH;
        const x = i * (barW + gap);
        const fatH  = (d.fat     / total) * totalH;
        const crbH  = (d.carbs   / total) * totalH;
        const prtH  = (d.protein / total) * totalH;
        let y = chartH;
        const rects = [];
        if (fatH  > 0) { y -= fatH;  rects.push(<Rect key="f" x={x} y={y} width={barW} height={fatH}  fill={PURPLE} />); }
        if (crbH  > 0) { y -= crbH;  rects.push(<Rect key="c" x={x} y={y} width={barW} height={crbH}  fill={BLUE}   />); }
        if (prtH  > 0) { y -= prtH;  rects.push(<Rect key="p" x={x} y={y} width={barW} height={prtH}  rx={2} fill={LIME} />); }
        return <Svg key={i}>{rects}</Svg>;
      })}
      {data.map((d, i) => {
        if (!showLabel(i)) return null;
        const x = i * (barW + gap) + barW / 2;
        return (
          <SvgText key={`l${i}`} x={x} y={h} fontSize={8} fontWeight="600"
            fill={i === n - 1 && hasAny ? "#ffffff" : "#555555"} textAnchor="middle">
            {d.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ── Period bar chart — optional y-axis + goal line ───────────────
function PeriodBars({
  data, maxVal, barColor, w, h = 72, showAxis = false, goalLine,
}: {
  data: { label: string; value: number }[];
  maxVal: number;
  barColor: string;
  w: number;
  h?: number;
  showAxis?: boolean;
  goalLine?: number;
}) {
  if (w <= 0 || data.length === 0) return null;
  const yAxisW = showAxis ? 34 : 0;
  const chartW = w - yAxisW;
  const n      = data.length;
  const gap    = n > 20 ? 1 : n > 10 ? 2 : 4;
  const barW   = Math.max(1, (chartW - gap * (n - 1)) / n);
  const hasAny = data.some(d => d.value > 0);
  const maxV   = Math.max(maxVal, hasAny ? Math.max(...data.map(d => d.value)) : 0, 1);
  const labelH = 14;
  const chartH = h - labelH;

  // Y-axis ticks
  const ticks: number[] = showAxis ? (() => {
    const step = Math.ceil(maxV / 4 / 50) * 50 || 50;
    return [0, step, step * 2, step * 3, step * 4].filter(t => t <= maxV + step);
  })() : [];

  // Show labels only for a manageable subset
  const showLabel = (i: number) => {
    if (n <= 7)  return true;
    if (n <= 15) return i === 0 || i === n - 1 || i % 3 === 0;
    if (n <= 31) return i === 0 || i === n - 1 || i % 7 === 0;
    return i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
  };

  const bars = hasAny ? data.map((d, i) => {
    if (d.value <= 0) return null;
    const bh = Math.max(2, (d.value / maxV) * chartH);
    const x  = yAxisW + i * (barW + gap);
    return (
      <Rect key={`b${i}`}
        x={x} y={chartH - bh} width={barW} height={bh} rx={2}
        fill={barColor}
      />
    );
  }) : null;

  const labels = data.map((d, i) => {
    if (!showLabel(i)) return null;
    const x      = yAxisW + i * (barW + gap) + barW / 2;
    const isLast = i === n - 1;
    return (
      <SvgText key={`l${i}`} x={x} y={h}
        fontSize={8} fontWeight="600"
        fill={isLast && hasAny ? "#ffffff" : "#555555"}
        textAnchor="middle"
      >
        {d.label}
      </SvgText>
    );
  });

  // Goal line y-position
  const goalY = goalLine != null ? chartH - (goalLine / maxV) * chartH : null;

  return (
    <Svg width={w} height={h}>
      {/* Y-axis gridlines + labels */}
      {ticks.map((t, i) => {
        const y = chartH - (t / maxV) * chartH;
        return (
          <Svg key={`t${i}`}>
            <Line x1={yAxisW} y1={y} x2={w} y2={y} stroke="#1e1e1e" strokeWidth={1} />
            <SvgText x={yAxisW - 4} y={y + 4} fontSize={8} fontWeight="600"
              fill="#444444" textAnchor="end">{t}</SvgText>
          </Svg>
        );
      })}
      {/* Baseline */}
      <Line x1={yAxisW} y1={chartH} x2={w} y2={chartH} stroke="#333333" strokeWidth={1} />
      {bars}
      {labels}
      {/* Goal line */}
      {goalY != null && goalY > 0 && (
        <Svg>
          <Line x1={yAxisW} y1={goalY} x2={w} y2={goalY}
            stroke={LIME} strokeWidth={1.5} strokeDasharray="4,3" />
          <SvgText x={yAxisW - 4} y={goalY + 4} fontSize={8} fontWeight="600"
            fill={LIME} textAnchor="end">goal</SvgText>
        </Svg>
      )}
    </Svg>
  );
}

// tiny SVG Text (react-native-svg)
function SvgText({ x, y, fontSize, fontWeight, fill, textAnchor, children }: any) {
  const { Text: T } = require("react-native-svg");
  return (
    <T x={x} y={y} fontSize={fontSize} fontWeight={fontWeight}
      fill={fill} textAnchor={textAnchor}>
      {children}
    </T>
  );
}

// ── Weight sparkline ──────────────────────────────────────────────
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

// ── Strength line chart ───────────────────────────────────────────
function StrengthLine({
  data, dates, isBodyweight, color, w, h = 130,
}: {
  data: number[];
  dates: string[];
  isBodyweight: boolean;
  color: string;
  w: number;
  h?: number;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (data.length < 1 || w <= 0) return null;

  const padTop = 30; // room for PR label + callout label above chart
  const padBot = 16; // room for date label below chart
  const padL   = 8;
  const padR   = 8;
  const chartW = w - padL - padR;
  const chartH = h - padTop - padBot;

  const maxVal = Math.max(...data);
  const minVal = Math.min(...data);
  const range  = maxVal - minVal || 1;
  const suffix = isBodyweight ? "reps" : "lbs";

  const xOf = (i: number) =>
    data.length === 1
      ? padL + chartW / 2
      : padL + (i / (data.length - 1)) * chartW;

  const yOf = (v: number) =>
    padTop + ((maxVal - v) / range) * chartH;

  const lastIdx   = data.length - 1;
  const activeIdx = selectedIdx ?? lastIdx;
  const activeVal = data[activeIdx];
  const activeX   = xOf(activeIdx);
  const activeY   = yOf(activeVal);
  const activeDate = dates[activeIdx]?.slice(5) ?? ""; // MM-DD

  // PR line is always at padTop (maxVal maps there)
  const prY = padTop;

  // Callout label lives in the top padding zone (above the PR line at y=padTop),
  // so it can NEVER overlap the polyline regardless of chart shape.
  // It tracks the active point horizontally so you can see which point it refers to.
  const tipX = Math.min(Math.max(activeX, padL + 28), padL + chartW - 28);
  const tipY = 13; // fixed — always in padTop zone, above the chart area

  // Single-point case
  if (data.length === 1) {
    const midY = padTop + chartH / 2;
    return (
      <Svg width={w} height={h}>
        {/* PR line */}
        <Line x1={padL} y1={prY} x2={padL + chartW} y2={prY}
          stroke={color} strokeWidth={1} strokeDasharray="3 4" opacity={0.3} />
        <SvgText x={padL + chartW} y={prY - 4}
          fontSize={9} fontWeight="700" fill={color} textAnchor="end" opacity={0.5}>
          {`PR · ${maxVal} ${suffix}`}
        </SvgText>
        {/* Flat dashed connector */}
        <Line x1={padL} y1={midY} x2={padL + chartW} y2={midY}
          stroke={color} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.35} />
        {/* Dot */}
        <Circle cx={xOf(0)} cy={midY} r={4} fill={color} />
        {/* Current label — fixed in padTop zone, never overlaps chart */}
        <SvgText x={padL + chartW / 2} y={13}
          fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
          {`${data[0]} ${suffix}`}
        </SvgText>
      </Svg>
    );
  }

  const pts = data.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");

  return (
    <Svg width={w} height={h}>
      {/* ── PR dashed horizontal line + label anchored to left ── */}
      <Line x1={padL} y1={prY} x2={padL + chartW} y2={prY}
        stroke={color} strokeWidth={1} strokeDasharray="3 4" opacity={0.3} />
      <SvgText x={padL} y={prY - 4}
        fontSize={9} fontWeight="700" fill={color} textAnchor="start" opacity={0.5}>
        {`PR · ${maxVal} ${suffix}`}
      </SvgText>

      {/* ── Main polyline ── */}
      <Polyline points={pts} fill="none" stroke={color}
        strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* ── Vertical indicator at active point ── */}
      <Line x1={activeX} y1={padTop} x2={activeX} y2={h - padBot}
        stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.2} />

      {/* ── Active dot ── */}
      <Circle cx={activeX} cy={activeY} r={5} fill={color} />

      {/* ── Value callout — fixed in padTop zone, tracks x, NEVER overlaps chart ── */}
      <SvgText x={tipX} y={tipY}
        fontSize={11} fontWeight="700" fill={color} textAnchor="middle">
        {`${activeVal} ${suffix}`}
      </SvgText>

      {/* ── Date label at bottom — only shown when user taps a point ── */}
      {selectedIdx !== null && (
        <SvgText x={Math.min(Math.max(activeX, padL + 16), padL + chartW - 16)} y={h - 2}
          fontSize={9} fontWeight="600" fill={color} textAnchor="middle" opacity={0.8}>
          {activeDate}
        </SvgText>
      )}

      {/* ── Tap zones (midpoint-split so every pixel is covered) ── */}
      {data.map((_, i) => {
        const cx      = xOf(i);
        const prevMid = i === 0       ? 0 : (xOf(i - 1) + cx) / 2;
        const nextMid = i === lastIdx ? w : (cx + xOf(i + 1)) / 2;
        return (
          <Rect
            key={i}
            x={prevMid} y={0}
            width={nextMid - prevMid} height={h}
            fill="transparent"
            onPress={() => setSelectedIdx(prev => prev === i ? null : i)}
          />
        );
      })}
    </Svg>
  );
}

// ── Section header ────────────────────────────────────────────────
function SectionLabel({ icon: Icon, label, right }: { icon: any; label: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon size={13} color="#666666" />
        <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: "#666666", letterSpacing: 0.8 }}>
          {label}
        </Text>
      </View>
      {right}
    </View>
  );
}

// ── Main ─────────────────────────────────────────────────────────
export default function ProgressScreen() {
  const { palette } = useTheme();
  const { card, cardBorder: border, text, muted, bg } = palette;

  const [period, setPeriod]                 = useState<Period>("1M");
  const [selectedEx, setSelectedEx]         = useState<any>(null);
  const [showExPicker, setShowExPicker]     = useState(false);
  const [calChartW, setCalChartW]           = useState(0);
  const [macroChartW, setMacroChartW]       = useState(0);
  const [weightChartW, setWeightChartW]     = useState(0);
  const [strengthChartW, setStrengthChartW] = useState(0);

  // ── Queries ──
  const { data: targets }           = useQuery<any>({ queryKey: ["/api/targets"], queryFn: () => apiRequest("GET", "/api/targets") });
  const { data: measurements = [] } = useQuery<any[]>({ queryKey: ["/api/measurements"], queryFn: () => apiRequest("GET", "/api/measurements") });
  const { data: exercises = [] }    = useQuery<any[]>({ queryKey: ["/api/exercises"], queryFn: () => apiRequest("GET", "/api/exercises") });
  const { data: loggedIds = [] }    = useQuery<number[]>({ queryKey: ["/api/exercises/logged-ids"], queryFn: () => apiRequest("GET", "/api/exercises/logged-ids") });
  const { data: exHistory = [] }    = useQuery<any[]>({
    queryKey: ["/api/exercises/history", selectedEx?.id],
    queryFn:  () => apiRequest("GET", `/api/exercises/${selectedEx!.id}/history`),
    enabled:  selectedEx != null,
  });

  // Today's food log — powers the donut ring (always current)
  const { data: todayFood = [] } = useQuery<any[]>({
    queryKey: ["/api/food-log", today],
    queryFn:  () => apiRequest("GET", `/api/food-log?date=${today}`),
    staleTime: 30_000,
  });

  // Period summary — powers the bar charts (refetches when period changes)
  const { data: summary = [] } = useQuery<any[]>({
    queryKey: ["/api/food-log/summary", period],
    queryFn:  () => apiRequest("GET", `/api/food-log/summary?period=${period}`),
    staleTime: 60_000,
  });

  // ── Derived ──
  const calGoal     = targets?.calories ?? 2200;
  const proteinGoal = targets?.proteinG ?? 150;
  const carbsGoal   = targets?.carbsG   ?? 220;
  const fatGoal     = targets?.fatG     ?? 70;

  // Today's totals for the donut
  const todayTotals = useMemo(() =>
    todayFood.reduce(
      (a: any, e: any) => ({
        cal:     a.cal     + (e.caloriesActual ?? 0),
        protein: a.protein + (e.proteinActual  ?? 0),
        carbs:   a.carbs   + (e.carbsActual    ?? 0),
        fat:     a.fat     + (e.fatActual      ?? 0),
      }),
      { cal: 0, protein: 0, carbs: 0, fat: 0 },
    ),
  [todayFood]);

  const calPct    = calGoal > 0 ? todayTotals.cal / calGoal : 0;
  const remaining = Math.max(0, calGoal - todayTotals.cal);

  // Period-average calories (for the calories donut on the Progress page)
  const avgCal    = summary.length > 0
    ? Math.round(summary.reduce((s: number, d: any) => s + (d.calories ?? 0), 0) / summary.length)
    : 0;
  const avgCalPct = calGoal > 0 ? avgCal / calGoal : 0;

  // Period-average macro adherence (from summary)
  const { avgPrtPct, avgCrbPct, avgFatPct, avgFatG, avgCrbG, avgPrtG } = useMemo(() => {
    if (summary.length === 0) return { avgPrtPct: 0, avgCrbPct: 0, avgFatPct: 0, avgFatG: 0, avgCrbG: 0, avgPrtG: 0 };
    const n = summary.length;
    const avg = (key: string) => summary.reduce((s: number, d: any) => s + (d[key] ?? 0), 0) / n;
    const avgFatG = avg("fat");
    const avgCrbG = avg("carbs");
    const avgPrtG = avg("protein");
    return {
      avgFatG, avgCrbG, avgPrtG,
      avgPrtPct: proteinGoal > 0 ? Math.round(avgPrtG / proteinGoal * 100) : 0,
      avgCrbPct: carbsGoal   > 0 ? Math.round(avgCrbG / carbsGoal   * 100) : 0,
      avgFatPct: fatGoal     > 0 ? Math.round(avgFatG / fatGoal     * 100) : 0,
    };
  }, [summary, proteinGoal, carbsGoal, fatGoal]);

  // Calorie bar data for chart
  // Fall back to an empty scaffold so the x-axis always renders even with no data
  const calBarData  = useMemo(() =>
    summary.length > 0
      ? summary.map((d: any) => ({ label: d.label, value: d.calories }))
      : emptyScaffold(period),
  [summary, period]);

  // Stacked macro bar data
  const macroBarData = useMemo(() =>
    summary.length > 0
      ? summary.map((d: any) => ({ label: d.label, fat: d.fat ?? 0, carbs: d.carbs ?? 0, protein: d.protein ?? 0 }))
      : emptyScaffold(period).map(d => ({ label: d.label, fat: 0, carbs: 0, protein: 0 })),
  [summary, period]);

  // Filtered measurements for weight chart
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays(period));
  const filteredMeasurements = measurements.filter((m: any) =>
    period === "All" || new Date(m.date + "T00:00:00") >= cutoff
  );
  const weightData = [...filteredMeasurements].reverse().map((m: any) => gramsToLbs(m.weightGrams));
  const latestLbs  = measurements[0] ? gramsToLbs(measurements[0].weightGrams) : null;
  const weightChange = weightData.length >= 2 ? weightData[weightData.length - 1] - weightData[0] : 0;
  const weeksElapsed = filteredMeasurements.length >= 2
    ? Math.max((new Date(filteredMeasurements[0].date).getTime() - new Date(filteredMeasurements[filteredMeasurements.length - 1].date).getTime()) / (7 * 24 * 3600 * 1000), 1)
    : periodDays(period) / 7;
  const perWeek = weightData.length >= 2 ? weightChange / weeksElapsed : 0;

  // Strength history filtered to selected period
  const strengthCutoff = useMemo(() => {
    if (period === "All") return "";
    const d = new Date();
    d.setDate(d.getDate() - periodDays(period));
    return d.toISOString().slice(0, 10);
  }, [period]);

  const filteredHistory = useMemo(() =>
    period === "All" ? exHistory : exHistory.filter((s: any) => s.date >= strengthCutoff),
  [exHistory, strengthCutoff, period]);

  // Exercise picker — exercises with logged data sorted to top
  const loggedIdSet = useMemo(() => new Set(loggedIds), [loggedIds]);
  const recentExercises = useMemo(() => {
    const all = exercises.slice(0, 60);
    return [...all].sort((a, b) => {
      const aHas = loggedIdSet.has(a.id) ? 0 : 1;
      const bHas = loggedIdSet.has(b.id) ? 0 : 1;
      return aHas - bHas;
    });
  }, [exercises, loggedIdSet]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22, paddingTop: 4 }}>
          <Text style={{ fontSize: 28, fontFamily: "Manrope-ExtraBold", color: text, letterSpacing: -0.5 }}>
            Progress
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {PERIODS.map(p => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={({ pressed }) => ({
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
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
        </View>

        {/* ── NUTRITION ── */}
        <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.8, marginBottom: 10 }}>
          NUTRITION
        </Text>

        {/* Calories card */}
        <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border, marginBottom: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: "Manrope-Bold", color: text, marginBottom: 14 }}>Calories</Text>

          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            {/* Left: donut — avg calories for the selected period */}
            <View style={{ alignItems: "center", width: 80 }}>
              <View style={{ width: 80, height: 80, alignItems: "center", justifyContent: "center" }}>
                <Donut pct={avgCalPct} size={80} strokeWidth={7}
                  trackColor="rgba(255,255,255,0.08)" fillColor={avgCalPct > 1 ? "#ef4444" : LIME} />
                <View style={{ position: "absolute", alignItems: "center" }}>
                  <Text style={{ ...(DOT as any), fontSize: 18, color: text, lineHeight: 20 }}>
                    {avgCal.toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: "Manrope-Bold", color: avgCalPct > 1 ? "#ef4444" : LIME, letterSpacing: 0.5 }}>
                    {avgCalPct > 1 ? "Over" : "Under"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Right: bar chart with y-axis + goal line */}
            <View
              style={{ flex: 1 }}
              onLayout={e => setCalChartW(Math.floor(e.nativeEvent.layout.width))}
            >
              <PeriodBars
                data={calBarData}
                maxVal={calGoal}
                barColor={LIME}
                w={calChartW}
                h={110}
                showAxis
                goalLine={calGoal}
              />
            </View>
          </View>

          {/* Bottom row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: border }}>
            <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: text }}>
              <Text style={{ ...(DOT as any), fontSize: 14 }}>{avgCal.toLocaleString()}</Text>
              {" "}avg kcal / day
            </Text>
            <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>
              target {calGoal.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Macronutrients card */}
        <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border, marginBottom: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: "Manrope-Bold", color: text, marginBottom: 14 }}>Macronutrients</Text>

          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            {/* Left: multi-colour macro donut + legend */}
            <View style={{ width: 100, alignItems: "flex-start" }}>
              <View style={{ width: 90, height: 90, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <MacroDonut fat={avgFatG} carbs={avgCrbG} protein={avgPrtG} size={90} strokeWidth={8} />
              </View>
              {[
                { label: "Fat",     pct: avgFatPct, color: PURPLE },
                { label: "Carbs",   pct: avgCrbPct, color: BLUE   },
                { label: "Protein", pct: avgPrtPct, color: LIME   },
              ].map(m => (
                <View key={m.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: m.color }} />
                    <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>{m.label}</Text>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: text }}>{m.pct}%</Text>
                </View>
              ))}
            </View>

            {/* Right: stacked bar chart */}
            <View style={{ flex: 1 }} onLayout={e => setMacroChartW(Math.floor(e.nativeEvent.layout.width))}>
              <StackedBars data={macroBarData} w={macroChartW} h={80} />
            </View>
          </View>

          {/* AVG row */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: border }}>
            <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: muted }}>AVG</Text>
            {[
              { pct: avgFatPct,  color: PURPLE },
              { pct: avgCrbPct,  color: BLUE   },
              { pct: avgPrtPct,  color: LIME   },
            ].map((m, i) => (
              <View key={i} style={{ backgroundColor: `${m.color}22`, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: m.color }}>{m.pct}%</Text>
              </View>
            ))}
            <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>of target</Text>
          </View>
        </View>

        {/* ── BODY WEIGHT ── */}
        <SectionLabel icon={Scale} label="BODY WEIGHT" />
        <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border, marginBottom: 22 }}>
          {weightData.length >= 1 ? (
            <>
              {/* 3 equal stat boxes */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Current",  value: latestLbs ?? 0, unit: "lbs",    color: text },
                  { label: "Change",   value: weightChange,   unit: "lbs",    color: weightChange < 0 ? LIME : weightChange > 0 ? "#ff6b6b" : text,
                    prefix: weightChange > 0 ? "+" : weightChange < 0 ? "–" : "–" },
                  { label: "Per Week", value: Math.abs(perWeek), unit: "lbs/wk", color: perWeek < 0 ? LIME : perWeek > 0 ? "#ff6b6b" : text,
                    prefix: perWeek > 0 ? "+" : perWeek < 0 ? "–" : "" },
                ].map(s => (
                  <View key={s.label} style={{ flex: 1, backgroundColor: bg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: border }}>
                    <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</Text>
                    <Text style={{ ...(DOT as any), fontSize: 24, color: s.color, lineHeight: 28 }}>
                      {s.prefix ?? ""}{typeof s.value === "number" ? (Number.isInteger(s.value) ? s.value : Math.abs(s.value).toFixed(1)) : s.value}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted, marginTop: 2 }}>{s.unit}</Text>
                  </View>
                ))}
              </View>

              {/* Weight trend chart or prompt */}
              {weightData.length >= 2 ? (
                <>
                  <View onLayout={e => setWeightChartW(Math.floor(e.nativeEvent.layout.width))}>
                    <WeightLine data={weightData} color={LIME} w={weightChartW} h={100} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>
                      {filteredMeasurements[filteredMeasurements.length - 1]?.date ?? ""}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>
                      {filteredMeasurements[0]?.date ?? ""}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
                  <Scale size={28} color={muted} strokeWidth={1.5} />
                  <Text style={{ fontSize: 13, fontFamily: "Manrope-SemiBold", color: muted, textAlign: "center" }}>
                    Log 2+ weight entries to see your trend
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>Settings → Log Weight</Text>
                </View>
              )}
            </>
          ) : (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
              <Scale size={32} color={muted} strokeWidth={1.5} />
              <Text style={{ fontSize: 14, fontFamily: "Manrope-SemiBold", color: muted, textAlign: "center" }}>
                Log 2+ weight entries to see your trend
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted }}>Settings → Log Weight</Text>
            </View>
          )}
        </View>

        {/* ── STRENGTH ── */}
        <SectionLabel
          icon={Dumbbell}
          label="STRENGTH"
          right={
            <Pressable
              onPress={() => setShowExPicker(true)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text }}>
                {selectedEx?.name ?? "Pick exercise"}
              </Text>
              <ChevronDown size={14} color={text} />
            </Pressable>
          }
        />
        <View style={{ backgroundColor: card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: border }}>
          {selectedEx == null ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
              <Dumbbell size={32} color={muted} strokeWidth={1.5} />
              <Text style={{ fontSize: 14, fontFamily: "Manrope-SemiBold", color: muted, textAlign: "center" }}>
                Select an exercise above to view progress
              </Text>
            </View>
          ) : filteredHistory.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
              <Dumbbell size={32} color={muted} strokeWidth={1.5} />
              <Text style={{ fontSize: 14, fontFamily: "Manrope-SemiBold", color: muted, textAlign: "center" }}>
                No sessions in this period{"\n"}for {selectedEx.name}
              </Text>
            </View>
          ) : (() => {
            // Bodyweight exercises have weight=0 — show reps instead of lbs
            const isBodyweight = filteredHistory.every((s: any) => s.maxWeightGrams === 0);
            const last  = filteredHistory[filteredHistory.length - 1];
            const first = filteredHistory[0];

            // Chart values: lbs for weighted, total reps for bodyweight
            const chartData = isBodyweight
              ? filteredHistory.map((s: any) => s.totalReps)
              : filteredHistory.map((s: any) => gramsToLbs(s.maxWeightGrams));

            // ALL-TIME PR comes from the unfiltered history so it's always correct
            const allTimePR = isBodyweight ? 0 : Math.max(...exHistory.map((s: any) => s.maxWeightGrams));
            const change = isBodyweight
              ? last.totalReps - first.totalReps
              : Math.round((gramsToLbs(last.maxWeightGrams) - gramsToLbs(first.maxWeightGrams)) * 10) / 10;

            return (
              <>
                {/* Stats row */}
                <View style={{ flexDirection: "row", gap: 24, marginBottom: 14 }}>
                  {isBodyweight ? (
                    <View>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.6 }}>LAST SESSION</Text>
                      <Text style={{ ...(DOT as any), fontSize: 28, color: text, marginTop: 2 }}>{last.totalReps}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>reps</Text>
                    </View>
                  ) : (
                    <>
                      <View>
                        <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.6 }}>CURRENT MAX</Text>
                        <Text style={{ ...(DOT as any), fontSize: 28, color: text, marginTop: 2 }}>{gramsToLbs(last.maxWeightGrams)}</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>lbs</Text>
                      </View>
                      <View>
                        <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.6 }}>ALL-TIME PR</Text>
                        <Text style={{ ...(DOT as any), fontSize: 28, color: LIME, marginTop: 2 }}>{gramsToLbs(allTimePR)}</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>lbs</Text>
                      </View>
                    </>
                  )}
                  {filteredHistory.length >= 2 && (
                    <View>
                      <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, letterSpacing: 0.6 }}>CHANGE</Text>
                      <Text style={{ ...(DOT as any), fontSize: 28, color: change >= 0 ? LIME : "#ff6b6b", marginTop: 2 }}>
                        {change >= 0 ? "+" : ""}{isBodyweight ? change : change.toFixed(1)}
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>{isBodyweight ? "reps" : "lbs"}</Text>
                    </View>
                  )}
                </View>

                {/* Chart */}
                <View onLayout={e => setStrengthChartW(Math.floor(e.nativeEvent.layout.width))}>
                  <StrengthLine
                    data={chartData}
                    dates={filteredHistory.map((s: any) => s.date)}
                    isBodyweight={isBodyweight}
                    color={LIME}
                    w={strengthChartW}
                    h={130}
                  />
                </View>

                {/* Date labels + session count */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>{first.date}</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>
                    {filteredHistory.length} session{filteredHistory.length !== 1 ? "s" : ""}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope", color: muted }}>{last.date}</Text>
                </View>
              </>
            );
          })()}
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
                WITH DATA
              </Text>
            )}
            {recentExercises.map((ex: any, i: number) => {
              const hasData = loggedIdSet.has(ex.id);
              // Insert "ALL EXERCISES" divider when transitioning from data → no-data
              const prevHasData = i > 0 ? loggedIdSet.has(recentExercises[i - 1].id) : true;
              const showDivider = !hasData && prevHasData && loggedIds.length > 0;
              return (
                <View key={ex.id}>
                  {showDivider && (
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.8, marginBottom: 8, marginTop: 8 }}>
                      ALL EXERCISES
                    </Text>
                  )}
                  <Pressable
                    onPress={() => { setSelectedEx(ex); setShowExPicker(false); }}
                    style={({ pressed }) => ({
                      backgroundColor: card, borderRadius: 14, padding: 14,
                      borderWidth: 1,
                      borderColor: hasData ? LIME : border,
                      marginBottom: 8,
                      opacity: pressed ? 0.7 : 1,
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
                      {hasData && (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LIME, marginLeft: 10 }} />
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
            {recentExercises.length === 0 && (
              <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, textAlign: "center", paddingVertical: 40 }}>
                No exercises found
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
