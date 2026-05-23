import { useState } from "react";
import {
  ScrollView, View, Text, Pressable, Modal, TextInput,
  Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs, lbsToGrams } from "@/lib/utils";
import {
  Target, TrendingDown, TrendingUp, Dumbbell, Activity,
  Plus, X, ChevronRight, CheckCircle2, Trash2,
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

  const latestWeightGrams: number | null = measurements[0]?.weightGrams ?? null;
  const activeGoals  = (goals as any[]).filter((g: any) =>  g.isActive);
  const pastGoals    = (goals as any[]).filter((g: any) => !g.isActive);

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

        {/* ── Daily Targets card ── */}
        {targets && (
          <View style={{
            backgroundColor: card, borderRadius: 20, padding: 18,
            borderWidth: 1, borderColor: border, marginBottom: 20,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Target size={16} color={LIME} />
              <Text style={{ fontSize: 14, fontFamily: "Manrope-Bold", color: text }}>
                Daily Targets (Auto-calculated)
              </Text>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {[
                { label: "Calories", value: Math.round(targets.calories),           unit: "kcal", color: text   },
                { label: "Protein",  value: Math.round(targets.proteinG ?? 0),      unit: "g",    color: LIME   },
                { label: "Carbs",    value: Math.round(targets.carbsG   ?? 0),      unit: "g",    color: BLUE   },
                { label: "Fat",      value: Math.round(targets.fatG     ?? 0),      unit: "g",    color: PURPLE },
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
                </View>
              ))}
            </View>

            <Text style={{ fontSize: 11, fontFamily: "Manrope", color: muted, marginTop: 14, lineHeight: 16 }}>
              Targets update automatically when you log a new weight or change your goals.
            </Text>
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
    </SafeAreaView>
  );
}
