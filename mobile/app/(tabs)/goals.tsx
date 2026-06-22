import { useState } from "react";
import {
  ScrollView, View, Text, Pressable, Modal, TextInput,
  Alert, Platform, ActivityIndicator, LayoutAnimation,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs, lbsToGrams } from "@/lib/utils";
import {
  Target, TrendingDown, TrendingUp, Dumbbell, Activity,
  Plus, X, ChevronRight, CheckCircle2, Trash2,
  Sparkles, Utensils, Droplets, Calendar, Zap, ChevronDown, ChevronUp,
  Clock, RefreshCw,
} from "lucide-react-native";

// ── Accent colours ────────────────────────────────────────────────
const LIME   = "#c8e84c";
const PINK   = "#f8c8dc";
const BLUE   = "#9bd1ff";
const PURPLE = "#d3a8ff";

const DOT: object = { fontFamily: "Doto" };

// ── Goal type config ──────────────────────────────────────────────
const GOAL_TYPES = [
  { key: "weight_loss",  label: "Lose Weight",       Icon: TrendingDown, color: BLUE   },
  { key: "weight_gain",  label: "Gain Weight",        Icon: TrendingUp,   color: LIME   },
  { key: "strength",     label: "Strength Goal",      Icon: Dumbbell,     color: PINK   },
  { key: "body_comp",    label: "Body Composition",   Icon: Activity,     color: PURPLE },
] as const;

type GoalTypeKey = typeof GOAL_TYPES[number]["key"];

function goalTypeConfig(key: string) {
  return GOAL_TYPES.find(t => t.key === key) ?? GOAL_TYPES[0];
}

// ── Days remaining helper ─────────────────────────────────────────
function daysLeft(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// Each macro's share of total macro calories (protein/carbs 4, fat 9 kcal/g),
// as integer percentages summing to exactly 100 (largest-remainder).
function macroCalShares(proteinG: number, carbsG: number, fatG: number) {
  const vals  = [proteinG * 4, carbsG * 4, fatG * 9];
  const total = vals.reduce((s, v) => s + v, 0);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  const raw = vals.map(v => (v / total) * 100);
  const out = raw.map(Math.floor);
  const rem = 100 - out.reduce((s, v) => s + v, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f).slice(0, rem).forEach(o => out[o.i]++);
  return { protein: out[0], carbs: out[1], fat: out[2] };
}

// ── Progress toward goal ──────────────────────────────────────────
function goalProgress(goal: any, latestWeightGrams: number | null): number {
  if (!goal.startValue || !goal.targetValue) return 0;
  const current = goal.type === "weight_loss" || goal.type === "weight_gain"
    ? (latestWeightGrams ?? goal.startValue)
    : goal.startValue; // strength / body_comp: would need PR tracking
  const total = Math.abs(goal.targetValue - goal.startValue);
  if (total === 0) return 1;
  const done = Math.abs(current - goal.startValue);
  return Math.min(done / total, 1);
}

// ── Goal card ─────────────────────────────────────────────────────
function GoalCard({
  goal, latestWeightGrams, onDelete, palette,
}: {
  goal: any;
  latestWeightGrams: number | null;
  onDelete: (id: number) => void;
  palette: any;
}) {
  const cfg      = goalTypeConfig(goal.type);
  const progress = goalProgress(goal, latestWeightGrams);
  const days     = daysLeft(goal.deadline);
  const card     = palette.card;
  const border   = palette.cardBorder;
  const text     = palette.text;
  const muted    = palette.muted;

  return (
    <View style={{
      backgroundColor: card, borderRadius: 20, padding: 16, marginBottom: 10,
      borderWidth: 1, borderColor: border,
    }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: `${cfg.color}22`,
            alignItems: "center", justifyContent: "center",
          }}>
            <cfg.Icon size={18} color={cfg.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: text }} numberOfLines={1}>
              {goal.label}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginTop: 1 }}>
              {cfg.label}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => onDelete(goal.id)}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
        >
          <Trash2 size={15} color={muted} />
        </Pressable>
      </View>

      {/* Target value */}
      {goal.targetValue > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
          <Text style={{ fontSize: 11, color: muted, fontFamily: "Manrope-Bold", letterSpacing: 0.6 }}>TARGET</Text>
          <Text style={{ ...(DOT as any), fontSize: 16, color: cfg.color }}>
            {goal.unit === "lbs"
              ? `${gramsToLbs(goal.targetValue)} lbs`
              : `${goal.targetValue}${goal.unit}`}
          </Text>
        </View>
      )}

      {/* Progress bar */}
      {progress > 0 && (
        <View style={{ marginTop: 10 }}>
          <View style={{ height: 5, backgroundColor: "#2a2a2a", borderRadius: 3, overflow: "hidden" }}>
            <View style={{
              width: `${Math.round(progress * 100)}%`,
              height: "100%", backgroundColor: cfg.color, borderRadius: 3,
            }} />
          </View>
          <Text style={{ fontSize: 10, color: muted, fontFamily: "Manrope-SemiBold", marginTop: 4 }}>
            {Math.round(progress * 100)}% complete
          </Text>
        </View>
      )}

      {/* Deadline */}
      {days !== null && (
        <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{
            fontSize: 11, fontFamily: "Manrope-Bold",
            color: days < 7 ? "#ef4444" : days < 30 ? PINK : muted,
          }}>
            {days === 0 ? "Due today" : `${days}d remaining`}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── AI plan types ────────────────────────────────────────────────
interface AiNutrition {
  calories: number; proteinG: number; carbsG: number; fatG: number;
  reasoning: string; tips: string[];
}
interface AiHydration { dailyOz: number; reasoning: string; tips: string[]; }
interface AiScheduleDay {
  day: string;
  focus: string;
  type: string;
  exercises?: { name: string; sets: number; reps: string }[];
}
interface AiTraining {
  daysPerWeek: number; restDays: number; split: string;
  schedule: AiScheduleDay[]; reasoning: string; tips: string[];
}
interface AiGoalFeasibility {
  goalId: number;
  goalLabel: string;
  status: "on_track" | "achievable" | "tight" | "not_achievable" | "no_deadline";
  requiredRatePerWeek: string | null;
  safeMaxRate: string | null;
  currentRate: string | null;
  assessment: string;
  recommendedAdditionalDays: number | null;
  suggestedDeadline: string | null;
}
interface AiAdjustOption {
  type: "extend_deadline" | "adjust_nutrition";
  label: string;
  description: string;
  // extend_deadline fields
  goalId?: number;
  newDeadline?: string;
  // adjust_nutrition fields
  newCalories?: number;
  newProteinG?: number;
  newCarbsG?: number;
  newFatG?: number;
}
interface AiProgressAdjustment {
  needed: boolean;
  observation?: string;
  options: AiAdjustOption[];
}
interface AiPlan {
  summary: string;
  nutrition: AiNutrition;
  hydration: AiHydration;
  training: AiTraining;
  goalFeasibility: AiGoalFeasibility[];
  progressAdjustment: AiProgressAdjustment;
  priorityActions: string[];
  goalNotes: string;
}

// ── Check-in result type ─────────────────────────────────────────
interface CheckInResult {
  status: "on_track" | "behind" | "ahead";
  headline: string;
  observations: string[];
  topAction: string;
  nutritionAdjustment?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    reasoning: string;
  };
}

interface AdaptiveProposal {
  templateExerciseId: number;
  templateName: string;
  exerciseName: string;
  field: "targetWeightGrams";
  currentValue: number | null;
  proposedValue: number;
  reason: string;
}

// ── Check-in status colors ───────────────────────────────────────
function checkinStatusColor(status: CheckInResult["status"]): string {
  if (status === "on_track") return "#22c55e";
  if (status === "ahead") return "#c8e84c";
  return "#f59e0b";
}

// ── Collapsible section helper ───────────────────────────────────
function Section({
  icon, title, color, children, palette,
}: {
  icon: React.ReactNode; title: string; color: string;
  children: React.ReactNode; palette: any;
}) {
  const [open, setOpen] = useState(true);
  return (
    <View style={{
      backgroundColor: palette.card, borderRadius: 18,
      borderWidth: 1, borderColor: palette.cardBorder,
      marginBottom: 12, overflow: "hidden",
    }}>
      <Pressable
        onPress={() => setOpen(v => !v)}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 10,
          padding: 16, opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{
          width: 32, height: 32, borderRadius: 9,
          backgroundColor: `${color}22`,
          alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </View>
        <Text style={{ flex: 1, fontSize: 14, fontFamily: "Manrope-Bold", color: palette.text }}>
          {title}
        </Text>
        {open
          ? <ChevronUp size={16} color={palette.muted} />
          : <ChevronDown size={16} color={palette.muted} />}
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {children}
        </View>
      )}
    </View>
  );
}

// day-type → color
function dayTypeColor(type: string): string {
  if (type === "rest") return "#6b7280";
  if (type === "active_recovery") return "#9bd1ff";
  if (type === "cardio") return "#f8c8dc";
  return "#c8e84c"; // strength
}

// feasibility status → color + label
function feasibilityMeta(status: AiGoalFeasibility["status"]) {
  switch (status) {
    case "on_track":      return { color: "#22c55e", emoji: "✅", label: "On Track" };
    case "achievable":    return { color: "#22c55e", emoji: "✅", label: "Achievable" };
    case "tight":         return { color: "#f59e0b", emoji: "⚠️", label: "Tight" };
    case "not_achievable":return { color: "#ef4444", emoji: "🚨", label: "Needs Adjustment" };
    case "no_deadline":   return { color: "#6b7280", emoji: "📅", label: "No Deadline" };
    default:              return { color: "#6b7280", emoji: "📅", label: status };
  }
}

// ── Main component ────────────────────────────────────────────────
export default function GoalsScreen() {
  const { palette } = useTheme();
  const qc          = useQueryClient();

  const bg     = palette.bg;
  const card   = palette.card;
  const border = palette.cardBorder;
  const text   = palette.text;
  const muted  = palette.muted;

  // ── Queries ──
  const { data: goals = [] }        = useQuery<any[]>({ queryKey: ["/api/goals"],        queryFn: () => apiRequest("GET", "/api/goals") });
  const { data: targets }           = useQuery<any>({   queryKey: ["/api/targets"],       queryFn: () => apiRequest("GET", "/api/targets") });
  const { data: measurements = [] } = useQuery<any[]>({ queryKey: ["/api/measurements"], queryFn: () => apiRequest("GET", "/api/measurements") });
  const { data: storedPlan }        = useQuery<AiPlan | null>({
    queryKey: ["/api/goals/ai-plan"],
    queryFn: () => apiRequest("GET", "/api/goals/ai-plan"),
  });
  const { data: activeRoutine }     = useQuery<any | null>({
    queryKey: ["/api/routine/active"],
    queryFn: () => apiRequest("GET", "/api/routine/active"),
  });

  const latestWeightGrams: number | null = measurements[0]?.weightGrams ?? null;
  const activeGoals  = (goals as any[]).filter((g: any) =>  g.isActive);
  const pastGoals    = (goals as any[]).filter((g: any) => !g.isActive);

  // ── AI analysis state ──
  const [aiPlan, setAiPlan]           = useState<AiPlan | null>(null);
  const [aiError, setAiError]         = useState<string | null>(null);
  const [adjustChosen, setAdjustChosen] = useState<"extend_deadline" | "adjust_nutrition" | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({});
  const [checkIn, setCheckIn]           = useState<CheckInResult | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInNutritionApplied, setCheckInNutritionApplied] = useState(false);

  // ── Manual target editing ──
  const [editingTargets, setEditingTargets] = useState(false);
  const [draftCal, setDraftCal]   = useState("");
  const [draftPro, setDraftPro]   = useState("");
  const [draftCarb, setDraftCarb] = useState("");
  const [draftFat, setDraftFat]   = useState("");

  // ── Plan nutrition applied state ──
  const [planNutritionApplied, setPlanNutritionApplied] = useState(false);

  // ── Adaptive plan adjustments ──
  const [adaptProposals, setAdaptProposals] = useState<AdaptiveProposal[] | null>(null);
  const [adaptNotes, setAdaptNotes]         = useState<string[]>([]);
  const [adaptError, setAdaptError]         = useState<string | null>(null);

  // ── Pre-flight preferences ────────────────────────────────────────
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefExperience, setPrefExperience] = useState<"beginner"|"intermediate"|"advanced">("beginner");
  const [prefDuration, setPrefDuration]     = useState<30|45|60|90>(45);
  const [prefEquipment, setPrefEquipment]   = useState<"full_gym"|"dumbbells_cables"|"dumbbells_only"|"bodyweight">("full_gym");
  const [prefLimitations, setPrefLimitations] = useState("");

  // Seed prefs from stored plan on first load
  const storedPrefs = (storedPlan as any)?.preferences;
  const [prefsSynced, setPrefsSynced] = useState(false);

  // Effective plan: local state (just fetched) takes priority over stored plan
  const effectivePlan: AiPlan | null = aiPlan ?? (storedPlan ?? null);

  // Sync prefs from stored plan once
  if (storedPlan && !prefsSynced) {
    if (storedPrefs?.experience)   setPrefExperience(storedPrefs.experience);
    if (storedPrefs?.duration)     setPrefDuration(storedPrefs.duration);
    if (storedPrefs?.equipment)    setPrefEquipment(storedPrefs.equipment);
    if (storedPrefs?.limitations)  setPrefLimitations(storedPrefs.limitations);
    setPrefsSynced(true);
  }

  const currentPrefs = {
    experience:  prefExperience,
    duration:    prefDuration,
    equipment:   prefEquipment,
    limitations: prefLimitations.trim() || undefined,
  };

  const aiMutation = useMutation({
    mutationFn: (prefs: typeof currentPrefs) =>
      apiRequest("POST", "/api/goals/ai-analysis", { preferences: prefs }, 60_000),
    onSuccess: (data: AiPlan) => {
      setAiPlan(data);
      setAiError(null);
      setAdjustChosen(null);
      setExpandedDays({});
      setShowPrefs(false);
      qc.invalidateQueries({ queryKey: ["/api/goals/ai-plan"] });
    },
    onError: (e: any) => { setAiError(e?.message ?? "Failed to generate plan"); setShowPrefs(false); },
  });

  const checkinMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/goals/ai-checkin", undefined, 60_000),
    onSuccess: (data: CheckInResult) => { setCheckIn(data); setCheckInError(null); },
    onError: (e: any) => setCheckInError(e?.message ?? "Failed to generate check-in"),
  });

  const applyRoutineMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/routine/apply"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/routine/active"] });
      Alert.alert("Routine applied", "Head to the Train tab to see what's up next.");
    },
    onError: (e: any) => Alert.alert("Couldn't apply routine", e?.message ?? "Please try again."),
  });

  const stopRoutineMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/routine/active"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/routine/active"] }),
    onError: (e: any) => Alert.alert("Couldn't stop routine", e?.message ?? "Please try again."),
  });

  const adaptMutation = useMutation({
    mutationFn: () => apiRequest<{ proposals: AdaptiveProposal[]; notes: string[] }>("GET", "/api/routine/adapt-proposals"),
    onSuccess: (data: { proposals: AdaptiveProposal[]; notes: string[] }) => {
      setAdaptProposals(data.proposals);
      setAdaptNotes(data.notes);
      setAdaptError(null);
    },
    onError: (e: any) => setAdaptError(e?.message ?? "Couldn't check for plan updates"),
  });

  const approveAdaptMutation = useMutation({
    mutationFn: (p: AdaptiveProposal) =>
      apiRequest("PATCH", `/api/template-exercises/${p.templateExerciseId}`, { [p.field]: p.proposedValue }),
    onSuccess: (_data, p) => {
      setAdaptProposals(prev => prev?.filter(x => x.templateExerciseId !== p.templateExerciseId) ?? null);
      qc.invalidateQueries({ queryKey: ["/api/templates"] });
    },
    onError: (e: any) => Alert.alert("Couldn't apply update", e?.message ?? "Please try again."),
  });

  // Extend goal deadline
  const extendDeadline = useMutation({
    mutationFn: ({ goalId, newDeadline }: { goalId: number; newDeadline: string }) =>
      apiRequest("PATCH", `/api/goals/${goalId}`, { deadline: newDeadline }),
    onSuccess: () => {
      setAdjustChosen("extend_deadline");
      qc.invalidateQueries({ queryKey: ["/api/goals"] });
    },
    onError: (e: any) => setAiError(e?.message ?? "Could not update deadline"),
  });

  // Adjust nutrition targets
  const adjustNutrition = useMutation({
    mutationFn: (body: { calories: number; proteinG: number; carbsG: number; fatG: number }) =>
      apiRequest("PATCH", "/api/targets", body, 30_000),
    onSuccess: (data: any, vars: any) => {
      if (data) qc.setQueryData(["/api/targets"], data);
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      setCheckInNutritionApplied(true);
      setPlanNutritionApplied(true);
      if (vars.__source === "manual") {
        setEditingTargets(false);
      } else if (!vars.__source || vars.__source === "adjust_nutrition") {
        setAdjustChosen("adjust_nutrition");
      }
    },
    onError: (e: any) => setAiError(e?.message ?? "Could not update targets"),
  });

  function openTargetEditor() {
    setDraftCal(String(Math.round(targets?.calories ?? 2000)));
    setDraftPro(String(Math.round(targets?.proteinG ?? 150)));
    setDraftCarb(String(Math.round(targets?.carbsG ?? 200)));
    setDraftFat(String(Math.round(targets?.fatG ?? 65)));
    setEditingTargets(true);
  }

  function saveTargets() {
    const cal = parseInt(draftCal);
    const pro = parseInt(draftPro);
    const carb = parseInt(draftCarb);
    const fat = parseInt(draftFat);
    if ([cal, pro, carb, fat].some(isNaN) || cal <= 0) {
      Alert.alert("Invalid values", "Please enter valid numbers for all fields.");
      return;
    }
    adjustNutrition.mutate({ calories: cal, proteinG: pro, carbsG: carb, fatG: fat, __source: "manual" } as any);
  }

  // ── New goal modal state ──
  const [modalOpen, setModalOpen]           = useState(false);
  const [selectedType, setSelectedType]     = useState<GoalTypeKey>("weight_loss");
  const [labelText, setLabelText]           = useState("");
  const [targetValueText, setTargetValueText] = useState("");
  const [deadlineText, setDeadlineText]     = useState("");

  function openModal() {
    setSelectedType("weight_loss");
    setLabelText("");
    setTargetValueText("");
    setDeadlineText("");
    setModalOpen(true);
  }

  // ── Create goal mutation ──
  const createGoal = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/goals", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/goals"] });
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
      setModalOpen(false);
    },
    onError: (e: any) => Alert.alert("Could not save goal", e?.message ?? "Please try again"),
  });

  // ── Delete goal mutation ──
  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/goals"] });
      qc.invalidateQueries({ queryKey: ["/api/targets"] });
    },
    onError: (e: any) => Alert.alert("Could not delete goal", e?.message ?? "Please try again"),
  });

  function confirmDelete(id: number) {
    if (Platform.OS === "web") {
      if (window.confirm("Delete this goal?")) deleteGoal.mutate(id);
    } else {
      Alert.alert("Delete goal", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteGoal.mutate(id) },
      ]);
    }
  }

  function handleCreate() {
    const rawVal = parseFloat(targetValueText);
    if (!targetValueText || isNaN(rawVal) || rawVal <= 0) {
      Alert.alert("Invalid target", "Please enter a valid target value.");
      return;
    }

    // Convert lbs → grams for weight-based and strength goals (stored in grams)
    const isWeightGoal    = selectedType === "weight_loss" || selectedType === "weight_gain";
    const isStrengthGoal  = selectedType === "strength";
    const targetValue     = (isWeightGoal || isStrengthGoal) ? lbsToGrams(rawVal) : rawVal;
    const unit            = isWeightGoal ? "lbs" : selectedType === "body_comp" ? "%" : "lbs";

    const cfg          = goalTypeConfig(selectedType);
    const label        = labelText.trim() || cfg.label;

    const body: any = {
      type: selectedType,
      label,
      targetValue,
      unit,
      isActive: true,
      startValue: latestWeightGrams ?? undefined,
      startDate: new Date().toISOString().slice(0, 10),
    };

    if (deadlineText) body.deadline = deadlineText;

    createGoal.mutate(body);
  }

  // ── Render ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, paddingTop: 4 }}>
          <View>
            <Text style={{ fontSize: 28, fontFamily: "Manrope-ExtraBold", color: text, letterSpacing: -0.5 }}>
              Goals
            </Text>
            <Text style={{ fontSize: 13, fontFamily: "Manrope", color: muted, marginTop: 2 }}>
              Set targets and track your progress
            </Text>
          </View>
          <Pressable
            onPress={openModal}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: LIME, borderRadius: 22,
              paddingHorizontal: 16, paddingVertical: 10,
              opacity: pressed ? 0.8 : 1, marginTop: 4,
            })}
          >
            <Plus size={14} color="#0a0a0a" strokeWidth={2.5} />
            <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#0a0a0a" }}>New Goal</Text>
          </Pressable>
        </View>

        {/* ── AI Coach button ── */}
        <Pressable
          onPress={() => setShowPrefs(true)}
          disabled={aiMutation.isPending}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
            backgroundColor: "#1a1a2e", borderRadius: 18,
            borderWidth: 1.5, borderColor: "#7c3aed",
            paddingVertical: 16, marginBottom: 10,
            opacity: (pressed || aiMutation.isPending) ? 0.7 : 1,
          })}
        >
          {aiMutation.isPending
            ? <ActivityIndicator size="small" color="#a78bfa" />
            : effectivePlan
            ? <RefreshCw size={18} color="#a78bfa" />
            : <Sparkles size={18} color="#a78bfa" />}
          <Text style={{ fontSize: 15, fontFamily: "Manrope-Bold", color: "#a78bfa" }}>
            {aiMutation.isPending ? "Analyzing your goals…" : effectivePlan ? "Refresh Plan" : "Get AI Coach Plan"}
          </Text>
        </Pressable>

        {/* ── Quick Check-In button ── */}
        <Pressable
          onPress={() => checkinMutation.mutate()}
          disabled={checkinMutation.isPending}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            backgroundColor: "#111827", borderRadius: 16,
            borderWidth: 1, borderColor: "#374151",
            paddingVertical: 12, marginBottom: 20,
            opacity: (pressed || checkinMutation.isPending) ? 0.7 : 1,
          })}
        >
          {checkinMutation.isPending
            ? <ActivityIndicator size="small" color="#9ca3af" />
            : <Clock size={15} color="#9ca3af" />}
          <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#9ca3af" }}>
            {checkinMutation.isPending ? "Checking in…" : "Quick Check-In"}
          </Text>
        </Pressable>

        {/* ── Check-in result ── */}
        {checkInError && (
          <View style={{
            backgroundColor: "#2a0a0a", borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: "#7f1d1d", marginBottom: 16,
          }}>
            <Text style={{ fontSize: 13, fontFamily: "Manrope", color: "#fca5a5" }}>{checkInError}</Text>
          </View>
        )}
        {checkIn && (
          <View style={{
            backgroundColor: "#111827", borderRadius: 18, padding: 16,
            borderWidth: 1.5, borderColor: checkinStatusColor(checkIn.status),
            marginBottom: 20,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Clock size={14} color={checkinStatusColor(checkIn.status)} />
              <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: checkinStatusColor(checkIn.status), letterSpacing: 0.5 }}>
                QUICK CHECK-IN
              </Text>
            </View>
            <Text style={{ fontSize: 16, fontFamily: "Manrope-ExtraBold", color: "#e2e8f0", lineHeight: 22, marginBottom: 12 }}>
              {checkIn.headline}
            </Text>
            {checkIn.observations.map((obs, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                <Text style={{ fontSize: 12, color: checkinStatusColor(checkIn.status), marginTop: 1 }}>•</Text>
                <Text style={{ fontSize: 12, fontFamily: "Manrope", color: "#e2e8f0", flex: 1, lineHeight: 18 }}>{obs}</Text>
              </View>
            ))}
            <View style={{
              backgroundColor: `${checkinStatusColor(checkIn.status)}18`,
              borderRadius: 12, padding: 12, marginTop: 8,
              borderWidth: 1, borderColor: `${checkinStatusColor(checkIn.status)}44`,
            }}>
              <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: checkinStatusColor(checkIn.status), letterSpacing: 0.5, marginBottom: 4 }}>
                TOP ACTION THIS WEEK
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Manrope-SemiBold", color: "#e2e8f0", lineHeight: 18 }}>
                {checkIn.topAction}
              </Text>
            </View>

            {/* Nutrition adjustment suggestion */}
            {checkIn.nutritionAdjustment && (
              <View style={{
                backgroundColor: "#0f172a", borderRadius: 12, padding: 14, marginTop: 10,
                borderWidth: 1, borderColor: LIME + "66",
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Utensils size={13} color={LIME} />
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: LIME, letterSpacing: 0.5 }}>
                    SUGGESTED NUTRITION ADJUSTMENT
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Manrope", color: "#e2e8f0", lineHeight: 17, marginBottom: 8 }}>
                  {checkIn.nutritionAdjustment.reasoning}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted, marginBottom: 10 }}>
                  {checkIn.nutritionAdjustment.calories} kcal · {checkIn.nutritionAdjustment.proteinG}g protein · {checkIn.nutritionAdjustment.carbsG}g carbs · {checkIn.nutritionAdjustment.fatG}g fat
                </Text>
                {checkInNutritionApplied ? (
                  <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: LIME }}>✓ Applied to daily targets</Text>
                ) : (
                  <Pressable
                    onPress={() => adjustNutrition.mutate({ ...checkIn.nutritionAdjustment!, __source: "ai_checkin", __reason: checkIn.nutritionAdjustment!.reasoning } as any)}
                    disabled={adjustNutrition.isPending}
                    style={({ pressed }) => ({
                      backgroundColor: LIME + "22", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14,
                      alignItems: "center", borderWidth: 1, borderColor: LIME + "66",
                      opacity: (pressed || adjustNutrition.isPending) ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: LIME }}>
                      {adjustNutrition.isPending ? "Applying…" : "Apply Adjustment"}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── AI error ── */}
        {aiError && (
          <View style={{
            backgroundColor: "#2a0a0a", borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: "#7f1d1d", marginBottom: 16,
          }}>
            <Text style={{ fontSize: 13, fontFamily: "Manrope", color: "#fca5a5" }}>{aiError}</Text>
          </View>
        )}

        {/* ── AI Plan ── */}
        {effectivePlan && (
          <View style={{ marginBottom: 20 }}>

            {/* Summary banner */}
            <View style={{
              backgroundColor: "#1a1a2e", borderRadius: 18,
              borderWidth: 1.5, borderColor: "#7c3aed",
              padding: 16, marginBottom: 12,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Sparkles size={16} color="#a78bfa" />
                <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#a78bfa", letterSpacing: 0.5 }}>
                  AI COACH PLAN
                </Text>
              </View>
              <Text style={{ fontSize: 14, fontFamily: "Manrope", color: "#e2e8f0", lineHeight: 20 }}>
                {effectivePlan.summary}
              </Text>
              {effectivePlan.goalNotes ? (
                <Text style={{ fontSize: 12, fontFamily: "Manrope", color: "#a78bfa", marginTop: 8, lineHeight: 18, fontStyle: "italic" }}>
                  {effectivePlan.goalNotes}
                </Text>
              ) : null}
            </View>

            {/* Goal Feasibility section */}
            {effectivePlan.goalFeasibility && effectivePlan.goalFeasibility.length > 0 && (
              <Section icon={<Target size={16} color={PURPLE} />} title="Goal Feasibility" color={PURPLE} palette={palette}>
                {effectivePlan.goalFeasibility.map((f, i) => {
                  const meta = feasibilityMeta(f.status);
                  return (
                    <View key={i} style={{
                      backgroundColor: `${meta.color}11`,
                      borderRadius: 12, padding: 12, marginBottom: 8,
                      borderLeftWidth: 3, borderLeftColor: meta.color,
                    }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 13 }}>{meta.emoji}</Text>
                        <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: meta.color, flex: 1 }}>
                          {f.goalLabel}
                        </Text>
                        <View style={{
                          backgroundColor: `${meta.color}22`, borderRadius: 8,
                          paddingHorizontal: 8, paddingVertical: 3,
                        }}>
                          <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: meta.color }}>
                            {meta.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, lineHeight: 18, marginBottom: 6 }}>
                        {f.assessment}
                      </Text>
                      {(f.requiredRatePerWeek || f.currentRate) && (
                        <View style={{ flexDirection: "row", gap: 12 }}>
                          {f.requiredRatePerWeek && (
                            <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted }}>
                              Required: <Text style={{ color: text }}>{f.requiredRatePerWeek}</Text>
                            </Text>
                          )}
                          {f.currentRate && (
                            <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted }}>
                              Actual: <Text style={{ color: text }}>{f.currentRate}</Text>
                            </Text>
                          )}
                        </View>
                      )}
                      {f.suggestedDeadline && (
                        <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: "#f59e0b", marginTop: 4 }}>
                          Suggested deadline: {f.suggestedDeadline}
                          {f.recommendedAdditionalDays ? ` (+${f.recommendedAdditionalDays} days)` : ""}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </Section>
            )}

            {/* Progress Adjustment section */}
            {effectivePlan.progressAdjustment?.needed && effectivePlan.progressAdjustment.options.length > 0 && (
              <View style={{
                backgroundColor: "#1c1007", borderRadius: 18,
                borderWidth: 1.5, borderColor: "#f59e0b",
                padding: 16, marginBottom: 12,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Text style={{ fontSize: 16 }}>⚡</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: "#f59e0b" }}>
                    Adjustment Recommended
                  </Text>
                </View>
                <Text style={{ fontSize: 13, fontFamily: "Manrope", color: "#fef3c7", lineHeight: 19, marginBottom: 14 }}>
                  {effectivePlan.progressAdjustment.observation}
                </Text>

                {adjustChosen ? (
                  <View style={{
                    backgroundColor: "#052e16", borderRadius: 12, padding: 14,
                    borderWidth: 1, borderColor: "#22c55e", alignItems: "center",
                  }}>
                    <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#22c55e" }}>
                      {adjustChosen === "extend_deadline" ? "✅ Deadline updated" : "✅ Nutrition targets updated"}
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: "Manrope", color: "#86efac", marginTop: 4, textAlign: "center" }}>
                      {adjustChosen === "extend_deadline"
                        ? "Your goal deadline has been extended. Keep going!"
                        : "Your daily targets have been adjusted. Check the Nutrition section above."}
                    </Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: "#fbbf24", marginBottom: 10, letterSpacing: 0.4 }}>
                    WHAT WOULD YOU LIKE TO DO?
                  </Text>
                )}

                {!adjustChosen && effectivePlan.progressAdjustment.options.map((opt, i) => {
                  const isDeadline  = opt.type === "extend_deadline";
                  const isPending   = isDeadline ? extendDeadline.isPending : adjustNutrition.isPending;
                  const optColor    = isDeadline ? "#9bd1ff" : "#f8c8dc";
                  return (
                    <Pressable
                      key={i}
                      disabled={isPending}
                      onPress={() => {
                        if (isDeadline && opt.goalId && opt.newDeadline) {
                          extendDeadline.mutate({ goalId: opt.goalId, newDeadline: opt.newDeadline });
                        } else if (!isDeadline && opt.newCalories != null) {
                          adjustNutrition.mutate({
                            calories:  opt.newCalories!,
                            proteinG:  opt.newProteinG!,
                            carbsG:    opt.newCarbsG!,
                            fatG:      opt.newFatG!,
                          });
                        }
                      }}
                      style={({ pressed }) => ({
                        backgroundColor: `${optColor}11`,
                        borderRadius: 14, padding: 14, marginBottom: 8,
                        borderWidth: 1.5, borderColor: optColor,
                        opacity: (pressed || isPending) ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: optColor, marginBottom: 4 }}>
                        {isPending ? "Applying…" : opt.label}
                      </Text>
                      <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, lineHeight: 17 }}>
                        {opt.description}
                      </Text>
                      {!isDeadline && opt.newCalories != null && (
                        <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted, marginTop: 6 }}>
                          {opt.newCalories} kcal · {opt.newProteinG}g protein · {opt.newCarbsG}g carbs · {opt.newFatG}g fat
                        </Text>
                      )}
                      {isDeadline && opt.newDeadline && (
                        <Text style={{ fontSize: 11, fontFamily: "Manrope-SemiBold", color: muted, marginTop: 6 }}>
                          New deadline: {opt.newDeadline}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Hydration section */}
            <Section icon={<Droplets size={16} color={BLUE} />} title="Hydration" color={BLUE} palette={palette}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                <Text style={{ ...(DOT as any), fontSize: 32, color: BLUE }}>{effectivePlan.hydration.dailyOz}</Text>
                <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: muted }}>oz / day</Text>
                <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted }}>
                  ({Math.round(effectivePlan.hydration.dailyOz * 29.57)} ml)
                </Text>
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted, lineHeight: 18, marginBottom: 10 }}>
                {effectivePlan.hydration.reasoning}
              </Text>
              {effectivePlan.hydration.tips.map((tip, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: BLUE }}>•</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, flex: 1, lineHeight: 18 }}>{tip}</Text>
                </View>
              ))}
            </Section>

            {/* Training schedule section */}
            <Section icon={<Calendar size={16} color={PINK} />} title={`Training Schedule — ${effectivePlan.training.split}`} color={PINK} palette={palette}>
              <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ ...(DOT as any), fontSize: 28, color: PINK }}>{effectivePlan.training.daysPerWeek}</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted }}>training</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted }}>days/wk</Text>
                </View>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ ...(DOT as any), fontSize: 28, color: "#6b7280" }}>{effectivePlan.training.restDays}</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted }}>rest</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted }}>days/wk</Text>
                </View>
              </View>
              {/* Weekly schedule */}
              <View style={{ gap: 5, marginBottom: 12 }}>
                {effectivePlan.training.schedule.map((d, i) => {
                  const hasExercises = d.exercises && d.exercises.length > 0;
                  const isExpanded = expandedDays[i] ?? false;
                  return (
                    <View key={i}>
                      <Pressable
                        onPress={() => {
                          if (!hasExercises) return;
                          setExpandedDays(prev => ({ ...prev, [i]: !prev[i] }));
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row", alignItems: "center", gap: 10,
                          backgroundColor: `${dayTypeColor(d.type)}11`,
                          borderRadius: isExpanded ? 0 : 10,
                          borderTopLeftRadius: 10, borderTopRightRadius: 10,
                          paddingHorizontal: 12, paddingVertical: 8,
                          borderLeftWidth: 3, borderLeftColor: dayTypeColor(d.type),
                          opacity: pressed ? 0.8 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: dayTypeColor(d.type), width: 32 }}>
                          {d.day.slice(0, 3).toUpperCase()}
                        </Text>
                        <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, flex: 1, lineHeight: 16 }}>
                          {d.focus}
                        </Text>
                        {hasExercises && (
                          isExpanded
                            ? <ChevronUp size={13} color={dayTypeColor(d.type)} />
                            : <ChevronDown size={13} color={dayTypeColor(d.type)} />
                        )}
                      </Pressable>
                      {hasExercises && isExpanded && (
                        <View style={{
                          backgroundColor: `${dayTypeColor(d.type)}08`,
                          borderLeftWidth: 3, borderLeftColor: dayTypeColor(d.type),
                          borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
                          paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8,
                          gap: 4,
                        }}>
                          {d.exercises!.map((ex, j) => (
                            <View key={j} style={{ gap: 2, marginBottom: 2 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <View style={{
                                  width: 4, height: 4, borderRadius: 2,
                                  backgroundColor: dayTypeColor(d.type), opacity: 0.7,
                                }} />
                                <Text style={{ fontSize: 12, fontFamily: "Manrope-SemiBold", color: text, flex: 1 }}>
                                  {ex.name}
                                </Text>
                                <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted }}>
                                  {ex.sets}×{ex.reps}
                                </Text>
                              </View>
                              {(ex as any).weightNote ? (
                                <Text style={{ fontSize: 11, fontFamily: "Manrope", color: "#a78bfa", marginLeft: 12, lineHeight: 15 }}>
                                  💡 {(ex as any).weightNote}
                                </Text>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted, lineHeight: 18, marginBottom: 10 }}>
                {effectivePlan.training.reasoning}
              </Text>
              {effectivePlan.training.tips.map((tip, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: PINK }}>•</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, flex: 1, lineHeight: 18 }}>{tip}</Text>
                </View>
              ))}

              {/* Apply / stop following this plan as a rotating routine */}
              {activeRoutine ? (
                <Pressable
                  onPress={() => stopRoutineMutation.mutate()}
                  disabled={stopRoutineMutation.isPending}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: `${PINK}1A`, borderRadius: 12, paddingVertical: 12, marginTop: 8,
                    opacity: (pressed || stopRoutineMutation.isPending) ? 0.6 : 1,
                  })}
                >
                  <CheckCircle2 size={14} color={PINK} />
                  <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: PINK }}>
                    {stopRoutineMutation.isPending ? "Stopping…" : "Following this plan — stop"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => applyRoutineMutation.mutate()}
                  disabled={applyRoutineMutation.isPending}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: PINK, borderRadius: 12, paddingVertical: 12, marginTop: 8,
                    opacity: (pressed || applyRoutineMutation.isPending) ? 0.6 : 1,
                  })}
                >
                  {applyRoutineMutation.isPending
                    ? <ActivityIndicator size="small" color="#1a1a1a" />
                    : <Calendar size={14} color="#1a1a1a" />}
                  <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: "#1a1a1a" }}>
                    {applyRoutineMutation.isPending ? "Applying…" : "Apply this plan as my routine"}
                  </Text>
                </Pressable>
              )}
              {activeRoutine && (
                <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginTop: 6, textAlign: "center", lineHeight: 16 }}>
                  Missed days roll forward automatically — check the Train tab for what's next.
                </Text>
              )}
            </Section>

            {/* Plan Adjustments section — approval-gated weight bumps based on recent performance */}
            {activeRoutine && (
              <Section icon={<RefreshCw size={16} color={BLUE} />} title="Plan Adjustments" color={BLUE} palette={palette}>
                <Pressable
                  onPress={() => adaptMutation.mutate()}
                  disabled={adaptMutation.isPending}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: `${BLUE}1A`, borderRadius: 12, paddingVertical: 12,
                    opacity: (pressed || adaptMutation.isPending) ? 0.6 : 1,
                  })}
                >
                  {adaptMutation.isPending
                    ? <ActivityIndicator size="small" color={BLUE} />
                    : <RefreshCw size={14} color={BLUE} />}
                  <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: BLUE }}>
                    {adaptMutation.isPending ? "Checking…" : "Check for plan updates"}
                  </Text>
                </Pressable>

                {adaptError && (
                  <Text style={{ fontSize: 12, fontFamily: "Manrope", color: "#ef4444", marginTop: 10, textAlign: "center" }}>
                    {adaptError}
                  </Text>
                )}

                {adaptProposals !== null && adaptProposals.length === 0 && (
                  <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted, marginTop: 10, textAlign: "center", lineHeight: 18 }}>
                    No suggested changes right now — keep up the good work!
                  </Text>
                )}

                {adaptProposals !== null && adaptProposals.map((p) => (
                  <View key={p.templateExerciseId} style={{
                    backgroundColor: `${BLUE}11`, borderRadius: 12, padding: 12, marginTop: 10,
                  }}>
                    <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: text }}>
                      {p.exerciseName}
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginBottom: 4 }}>
                      {p.templateName}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Manrope", color: text, marginBottom: 6 }}>
                      {p.currentValue != null ? `${gramsToLbs(p.currentValue)} lbs → ` : ""}
                      <Text style={{ fontFamily: "Manrope-Bold", color: BLUE }}>{gramsToLbs(p.proposedValue)} lbs</Text>
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Manrope", color: muted, lineHeight: 17, marginBottom: 10 }}>
                      {p.reason}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => approveAdaptMutation.mutate(p)}
                        disabled={approveAdaptMutation.isPending}
                        style={({ pressed }) => ({
                          flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10,
                          backgroundColor: BLUE,
                          opacity: (pressed || approveAdaptMutation.isPending) ? 0.6 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: "#1a1a1a" }}>Approve</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setAdaptProposals(prev => prev?.filter(x => x.templateExerciseId !== p.templateExerciseId) ?? null)}
                        style={({ pressed }) => ({
                          flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10,
                          backgroundColor: `${muted}22`,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: muted }}>Dismiss</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}

                {adaptNotes.length > 0 && (
                  <View style={{ marginTop: 10, gap: 4 }}>
                    {adaptNotes.map((note, i) => (
                      <Text key={i} style={{ fontSize: 12, fontFamily: "Manrope", color: muted, lineHeight: 17 }}>
                        💡 {note}
                      </Text>
                    ))}
                  </View>
                )}
              </Section>
            )}

            {/* Priority actions section */}
            <Section icon={<Zap size={16} color={PURPLE} />} title="Priority Actions" color={PURPLE} palette={palette}>
              {effectivePlan.priorityActions.map((action, i) => (
                <View key={i} style={{
                  flexDirection: "row", gap: 12, marginBottom: 10,
                  alignItems: "flex-start",
                }}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: `${PURPLE}33`,
                    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
                  }}>
                    <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", color: PURPLE }}>{i + 1}</Text>
                  </View>
                  <Text style={{ fontSize: 13, fontFamily: "Manrope", color: text, flex: 1, lineHeight: 19 }}>
                    {action}
                  </Text>
                </View>
              ))}
            </Section>

            {/* Regenerate button */}
            <Pressable
              onPress={() => setShowPrefs(true)}
              disabled={aiMutation.isPending}
              style={({ pressed }) => ({
                alignItems: "center", paddingVertical: 12,
                opacity: (pressed || aiMutation.isPending) ? 0.5 : 1,
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: "Manrope-SemiBold", color: "#7c3aed" }}>
                Regenerate Plan
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Daily Targets card ── */}
        {targets && (
          <View style={{
            backgroundColor: card, borderRadius: 20, padding: 18,
            borderWidth: 1, borderColor: editingTargets ? LIME + "88" : border, marginBottom: 20,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Target size={16} color={LIME} />
              <Text style={{ flex: 1, fontSize: 14, fontFamily: "Manrope-Bold", color: text }}>
                Daily Targets
              </Text>
              {editingTargets ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setEditingTargets(false)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={saveTargets}
                    disabled={adjustNutrition.isPending}
                    style={({ pressed }) => ({
                      backgroundColor: LIME, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 5,
                      opacity: (pressed || adjustNutrition.isPending) ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: "#0a0a0a" }}>
                      {adjustNutrition.isPending ? "…" : "Save"}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={openTargetEditor} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ fontSize: 13, fontFamily: "Manrope-Bold", color: LIME }}>Edit</Text>
                </Pressable>
              )}
            </View>

            {editingTargets ? (
              <View style={{ gap: 12 }}>
                {[
                  { label: "Calories", unit: "kcal", value: draftCal,  set: setDraftCal,  color: text },
                  { label: "Protein",  unit: "g",    value: draftPro,  set: setDraftPro,  color: LIME },
                  { label: "Carbs",    unit: "g",    value: draftCarb, set: setDraftCarb, color: BLUE },
                  { label: "Fat",      unit: "g",    value: draftFat,  set: setDraftFat,  color: PURPLE },
                ].map(f => (
                  <View key={f.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ width: 64, fontSize: 12, fontFamily: "Manrope-Bold", color: f.color }}>{f.label}</Text>
                    <TextInput
                      value={f.value}
                      onChangeText={f.set}
                      keyboardType="numeric"
                      style={{
                        flex: 1, backgroundColor: "#1a1a1a", borderRadius: 10,
                        paddingHorizontal: 12, paddingVertical: 8,
                        fontSize: 16, fontFamily: "Manrope-Bold", color: f.color,
                        borderWidth: 1, borderColor: f.color + "44",
                      }}
                    />
                    <Text style={{ width: 32, fontSize: 11, fontFamily: "Manrope", color: muted }}>{f.unit}</Text>
                  </View>
                ))}
              </View>
            ) : (
              (() => {
                const sh = macroCalShares(targets.proteinG ?? 0, targets.carbsG ?? 0, targets.fatG ?? 0);
                return (
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    {[
                      { label: "Calories", value: Math.round(targets.calories),      unit: "kcal", color: text,   pct: null as number | null },
                      { label: "Protein",  value: Math.round(targets.proteinG ?? 0), unit: "g",    color: LIME,   pct: sh.protein },
                      { label: "Carbs",    value: Math.round(targets.carbsG   ?? 0), unit: "g",    color: BLUE,   pct: sh.carbs },
                      { label: "Fat",      value: Math.round(targets.fatG     ?? 0), unit: "g",    color: PURPLE, pct: sh.fat },
                    ].map(m => (
                      <View key={m.label} style={{ alignItems: "center" }}>
                        <Text style={{ ...(DOT as any), fontSize: 26, color: m.color, lineHeight: 30 }}>
                          {m.value}
                        </Text>
                        <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted, marginTop: 2 }}>
                          {m.unit}
                        </Text>
                        <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: muted }}>
                          {m.label}
                        </Text>
                        {m.pct != null && (
                          <Text style={{ fontSize: 10, fontFamily: "Manrope-Bold", color: m.color, marginTop: 2 }}>{m.pct}%</Text>
                        )}
                      </View>
                    ))}
                  </View>
                );
              })()
            )}

            {!editingTargets && (() => {
              const reason = checkIn?.nutritionAdjustment?.reasoning;
              const planTips = effectivePlan?.nutrition?.tips;
              const planReasoning = effectivePlan?.nutrition?.reasoning;
              if (reason) {
                return (
                  <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginTop: 14, lineHeight: 16 }}>
                    {reason}
                  </Text>
                );
              }
              if (planReasoning) {
                return (
                  <View style={{ marginTop: 14 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, lineHeight: 16, marginBottom: 6 }}>
                      {planReasoning}
                    </Text>
                    {planTips?.map((tip: string, i: number) => (
                      <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
                        <Text style={{ fontSize: 11, color: LIME }}>•</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Manrope", color: text, flex: 1, lineHeight: 16 }}>{tip}</Text>
                      </View>
                    ))}
                  </View>
                );
              }
              return (
                <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginTop: 14, lineHeight: 16 }}>
                  Auto-calculated from your goals. Tap Edit to set manually.
                </Text>
              );
            })()}
          </View>
        )}

        {/* ── Active Goals ── */}
        <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", letterSpacing: 0.8, color: muted, marginBottom: 10 }}>
          ACTIVE GOALS
        </Text>

        {activeGoals.length === 0 ? (
          <View style={{
            backgroundColor: card, borderRadius: 20, padding: 40,
            borderWidth: 1, borderColor: border,
            alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20,
          }}>
            <Target size={32} color={muted} strokeWidth={1.5} />
            <Text style={{ fontSize: 14, fontFamily: "Manrope-SemiBold", color: muted, textAlign: "center" }}>
              No active goals. Add one to get started!
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom: 10 }}>
            {activeGoals.map((g: any) => (
              <GoalCard
                key={g.id}
                goal={g}
                latestWeightGrams={latestWeightGrams}
                onDelete={confirmDelete}
                palette={palette}
              />
            ))}
          </View>
        )}

        {/* ── Past Goals ── */}
        {pastGoals.length > 0 && (
          <>
            <Text style={{ fontSize: 11, fontFamily: "Manrope-Bold", letterSpacing: 0.8, color: muted, marginBottom: 10 }}>
              COMPLETED
            </Text>
            {pastGoals.map((g: any) => (
              <View key={g.id} style={{
                backgroundColor: card, borderRadius: 16, padding: 14, marginBottom: 8,
                borderWidth: 1, borderColor: border, opacity: 0.6,
                flexDirection: "row", alignItems: "center", gap: 10,
              }}>
                <CheckCircle2 size={16} color={LIME} />
                <Text style={{ fontSize: 13, fontFamily: "Manrope-SemiBold", color: text, flex: 1 }} numberOfLines={1}>
                  {g.label}
                </Text>
              </View>
            ))}
          </>
        )}

      </ScrollView>

      {/* ── New Goal Modal ── */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable
          onPress={() => setModalOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
        >
          {/* Sheet — swallow taps so they don't dismiss */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
              paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
              borderWidth: 1, borderColor: border,
            }}
          >
            {/* Modal header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontFamily: "Manrope-ExtraBold", color: text }}>New Goal</Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <X size={20} color={muted} />
              </Pressable>
            </View>

            {/* Goal type grid */}
            <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text, marginBottom: 10 }}>
              Goal Type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {GOAL_TYPES.map(t => {
                const selected = selectedType === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setSelectedType(t.key)}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", gap: 6,
                      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
                      width: "47%",
                      backgroundColor: selected ? "#ffffff" : "transparent",
                      borderWidth: 1.5,
                      borderColor: selected ? "#ffffff" : border,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <t.Icon size={14} color={selected ? "#0a0a0a" : t.color} />
                    <Text style={{
                      fontSize: 13, fontFamily: "Manrope-Bold",
                      color: selected ? "#0a0a0a" : text,
                    }}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Label */}
            <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text, marginBottom: 8 }}>
              Label <Text style={{ color: muted, fontFamily: "Manrope" }}>(optional)</Text>
            </Text>
            <TextInput
              value={labelText}
              onChangeText={setLabelText}
              placeholder={goalTypeConfig(selectedType).label + " Goal"}
              placeholderTextColor={muted}
              style={{
                backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                color: text, fontFamily: "Manrope", fontSize: 14,
                marginBottom: 16, borderWidth: 1, borderColor: border,
              }}
            />

            {/* Target value + date */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text, marginBottom: 8 }}>
                  {selectedType === "body_comp"
                    ? "Target Body Fat (%)"
                    : selectedType === "strength"
                    ? "Target Weight (lbs)"
                    : "Target Weight (lbs)"}
                </Text>
                <TextInput
                  value={targetValueText}
                  onChangeText={setTargetValueText}
                  placeholder={selectedType === "weight_loss" ? "175" : selectedType === "weight_gain" ? "185" : "225"}
                  placeholderTextColor={muted}
                  keyboardType="decimal-pad"
                  style={{
                    backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                    color: text, fontFamily: "Manrope", fontSize: 14,
                    borderWidth: 1, borderColor: border,
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontFamily: "Manrope-Bold", color: text, marginBottom: 8 }}>
                  Target Date <Text style={{ color: muted, fontFamily: "Manrope" }}>(optional)</Text>
                </Text>
                <TextInput
                  value={deadlineText}
                  onChangeText={setDeadlineText}
                  placeholder="mm/dd/yyyy"
                  placeholderTextColor={muted}
                  keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
                  style={{
                    backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14,
                    color: text, fontFamily: "Manrope", fontSize: 14,
                    borderWidth: 1, borderColor: border,
                  }}
                />
              </View>
            </View>

            {/* Create button */}
            <Pressable
              onPress={handleCreate}
              disabled={createGoal.isPending}
              style={({ pressed }) => ({
                backgroundColor: "#2a2a2a", borderRadius: 16, paddingVertical: 16,
                alignItems: "center",
                opacity: (pressed || createGoal.isPending) ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontFamily: "Manrope-ExtraBold", color: text }}>
                {createGoal.isPending ? "Saving…" : "Create Goal"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── AI Coach Preferences Modal ── */}
      <Modal visible={showPrefs} transparent animationType="slide" onRequestClose={() => setShowPrefs(false)}>
        <Pressable onPress={() => setShowPrefs(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }} />
        <View style={{
          backgroundColor: "#141414", borderTopLeftRadius: 28, borderTopRightRadius: 28,
          borderWidth: 1, borderColor: "#2a2a2a",
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44,
        }}>
          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: "#f4f4f4" }}>Personalize Your Plan</Text>
            <Pressable onPress={() => setShowPrefs(false)} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
              <X size={22} color="#666" />
            </Pressable>
          </View>
          <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "#888", marginBottom: 20 }}>
            Tell the AI a few things so it can tailor workouts and macros specifically for you.
          </Text>

          {/* Experience level */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 10 }}>
            TRAINING EXPERIENCE
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
            {([
              { key: "beginner",     label: "Beginner",     sub: "0 – 1 yr"  },
              { key: "intermediate", label: "Intermediate", sub: "1 – 3 yrs" },
              { key: "advanced",     label: "Advanced",     sub: "3+ yrs"    },
            ] as const).map(opt => {
              const sel = prefExperience === opt.key;
              return (
                <Pressable key={opt.key} onPress={() => setPrefExperience(opt.key)}
                  style={({ pressed }) => ({
                    flex: 1, borderRadius: 14, padding: 12, alignItems: "center",
                    backgroundColor: sel ? "#1a1a2e" : "#1e1e1e",
                    borderWidth: 1.5, borderColor: sel ? "#a78bfa" : "#2a2a2a",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: sel ? "#a78bfa" : "#f4f4f4" }}>{opt.label}</Text>
                  <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#666", marginTop: 2 }}>{opt.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Workout duration */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 10 }}>
            WORKOUT DURATION
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
            {([30, 45, 60, 90] as const).map(mins => {
              const sel = prefDuration === mins;
              return (
                <Pressable key={mins} onPress={() => setPrefDuration(mins)}
                  style={({ pressed }) => ({
                    flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center",
                    backgroundColor: sel ? "#1a1a2e" : "#1e1e1e",
                    borderWidth: 1.5, borderColor: sel ? "#a78bfa" : "#2a2a2a",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: sel ? "#a78bfa" : "#f4f4f4" }}>{mins}</Text>
                  <Text style={{ fontFamily: "Manrope", fontSize: 10, color: "#666" }}>min</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Equipment */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 10 }}>
            AVAILABLE EQUIPMENT
          </Text>
          <View style={{ gap: 8, marginBottom: 18 }}>
            {([
              { key: "full_gym",        label: "Full Gym",               sub: "Barbells, cables, machines, everything" },
              { key: "dumbbells_cables", label: "Dumbbells + Cables",     sub: "No barbell, but cables available"       },
              { key: "dumbbells_only",  label: "Dumbbells Only",          sub: "Home gym or limited equipment"          },
              { key: "bodyweight",      label: "Bodyweight Only",         sub: "No weights at all"                      },
            ] as const).map(opt => {
              const sel = prefEquipment === opt.key;
              return (
                <Pressable key={opt.key} onPress={() => setPrefEquipment(opt.key)}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 12,
                    borderRadius: 14, padding: 13,
                    backgroundColor: sel ? "#1a1a2e" : "#1e1e1e",
                    borderWidth: 1.5, borderColor: sel ? "#a78bfa" : "#2a2a2a",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <View style={{
                    width: 18, height: 18, borderRadius: 9,
                    borderWidth: 2, borderColor: sel ? "#a78bfa" : "#555",
                    backgroundColor: sel ? "#a78bfa" : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {sel && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#141414" }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: sel ? "#a78bfa" : "#f4f4f4" }}>{opt.label}</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#666", marginTop: 1 }}>{opt.sub}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Injuries / limitations (optional) */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 8 }}>
            INJURIES OR LIMITATIONS <Text style={{ fontFamily: "Manrope", color: "#555" }}>(optional)</Text>
          </Text>
          <TextInput
            value={prefLimitations}
            onChangeText={setPrefLimitations}
            placeholder="e.g. bad lower back, no heavy squats, recovering from shoulder surgery…"
            placeholderTextColor="#444"
            multiline
            style={{
              backgroundColor: "#1e1e1e", borderRadius: 14, padding: 13,
              fontFamily: "Manrope", fontSize: 13, color: "#f4f4f4",
              borderWidth: 1, borderColor: "#2a2a2a",
              minHeight: 60, textAlignVertical: "top", marginBottom: 20,
            }}
          />

          {/* Generate button */}
          <Pressable
            onPress={() => aiMutation.mutate(currentPrefs)}
            disabled={aiMutation.isPending}
            style={({ pressed }) => ({
              backgroundColor: "#a78bfa", borderRadius: 16, paddingVertical: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: (pressed || aiMutation.isPending) ? 0.7 : 1,
            })}
          >
            {aiMutation.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Sparkles size={18} color="#fff" />}
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: "#fff" }}>
              {aiMutation.isPending ? "Generating your plan…" : "Generate My Plan"}
            </Text>
          </Pressable>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
