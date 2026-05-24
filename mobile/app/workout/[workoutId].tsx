/**
 * Active workout session screen
 * Route: /workout/:workoutId?templateId=:templateId
 *
 * Features:
 *  - Elapsed timer
 *  - Exercises pre-loaded from template (if templateId provided)
 *  - Previous performance snippet per exercise
 *  - Set entry (weight + reps) with mark-complete checkbox
 *  - Rest timer overlay (auto-starts after completing a set)
 *  - Add / remove sets and exercises
 *  - Finish → saves sets, patches workout with duration
 */

import { useState, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, TextInput, Modal,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useHealth } from "@/hooks/use-health";
import { gramsToLbs, lbsToGrams } from "@/lib/utils";
import { ArrowLeft, Check, Plus, X, Search, Timer, ChevronDown, Maximize2 } from "lucide-react-native";
import Svg, { Circle, Line, G } from "react-native-svg";

// ── Rest timer ring constants ──────────────────────────────────────
const SVG_SIZE  = 210;
const CX        = SVG_SIZE / 2;
const CY        = SVG_SIZE / 2;
const RING_R    = 82;
const RING_CIRC = 2 * Math.PI * RING_R;   // ≈ 515
const LIME      = "#C8E84C";
// Pre-compute static tick-mark endpoints (60 ticks, like a clock face)
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const ang      = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const isLong   = i % 5 === 0;
  const outerR   = 99;
  const innerR   = isLong ? 93 : 96;
  return {
    x1: CX + Math.cos(ang) * innerR,
    y1: CY + Math.sin(ang) * innerR,
    x2: CX + Math.cos(ang) * outerR,
    y2: CY + Math.sin(ang) * outerR,
    isLong,
  };
});

// ── Types ─────────────────────────────────────────────────────────
interface Exercise { id: number; name: string; primaryMuscle: string; category: string; }
interface PrevPerf  { date: string; sets: { reps: number; weightGrams: number }[]; }
type SetEntry       = { reps: string; weight: string; done: boolean; };
interface ActiveEx  { exercise: Exercise; sets: SetEntry[]; }

// ── Helpers ───────────────────────────────────────────────────────
function fmtElapsed(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtRest(secs: number): string {
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

// ── Screen ────────────────────────────────────────────────────────
export default function WorkoutSessionScreen() {
  const params = useLocalSearchParams<{ workoutId: string; templateId?: string }>();
  const workoutId  = params.workoutId;
  const templateId = params.templateId;
  const router = useRouter();
  const { palette } = useTheme();
  const { card, cardBorder: border, text, muted, accent, accentText, bg } = palette;
  const qc = useQueryClient();
  const health = useHealth();

  const [exercises,    setExercises]    = useState<ActiveEx[]>([]);
  const [elapsed,      setElapsed]      = useState(0);
  const [restSecs,     setRestSecs]     = useState<number | null>(null);
  const [restDefault,  setRestDefault]  = useState(90);
  const [showAddEx,    setShowAddEx]    = useState(false);
  const [exSearch,     setExSearch]     = useState("");
  const [saving,       setSaving]       = useState(false);
  const [prevPerf,     setPrevPerf]     = useState<Record<number, PrevPerf>>({});
  const [confirm,      setConfirm]      = useState<{ title: string; body: string; onOk: () => void } | null>(null);
  const [restMinimized, setRestMinimized] = useState(false);

  // ── Workout meta ──
  const { data: workout } = useQuery<any>({
    queryKey: ["/api/workouts", workoutId],
    queryFn: () => apiRequest("GET", `/api/workouts/${workoutId}`),
    enabled: !!workoutId,
  });

  // ── Template exercises ──
  const { data: template } = useQuery<any>({
    queryKey: ["/api/templates", templateId],
    queryFn: () => apiRequest("GET", `/api/templates/${templateId}`),
    enabled: !!templateId,
  });

  // ── Exercise search ──
  const { data: searchResults = [] } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises", exSearch],
    queryFn: () => apiRequest("GET", `/api/exercises?search=${encodeURIComponent(exSearch)}&limit=50`),
    enabled: showAddEx,
  });

  // Populate exercises from template on load
  useEffect(() => {
    if (!template?.exercises?.length || exercises.length > 0) return;
    const initial: ActiveEx[] = template.exercises
      .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      .map((te: any) => ({
        exercise: {
          id:            te.exerciseId,
          name:          te.exerciseName ?? te.name ?? "Exercise",
          primaryMuscle: te.primaryMuscle ?? "",
          category:      te.category ?? "",
        },
        sets: Array.from(
          { length: te.targetSets ?? 3 },
          () => ({ reps: te.targetReps ? String(te.targetReps) : "", weight: "", done: false })
        ),
      }));
    setExercises(initial);

    // Fetch previous performance for each exercise
    initial.forEach(async (ae) => {
      try {
        const hist = await apiRequest<any>(
          "GET", `/api/exercises/${ae.exercise.id}/history?limit=1`
        );
        if (hist?.date) {
          setPrevPerf(prev => ({ ...prev, [ae.exercise.id]: hist }));
        }
      } catch {
        // No previous data — that's fine
      }
    });
  }, [template]);

  // ── Elapsed timer ──
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Rest countdown ──
  useEffect(() => {
    if (restSecs === null || restSecs <= 0) {
      if (restSecs === 0) setRestSecs(null);
      return;
    }
    const id = setTimeout(() => setRestSecs(s => s !== null ? s - 1 : null), 1000);
    return () => clearTimeout(id);
  }, [restSecs]);

  // ── Set actions ──
  const toggleDone = (ei: number, si: number) => {
    setExercises(prev => {
      const copy = prev.map((ae, i) =>
        i !== ei ? ae : {
          ...ae,
          sets: ae.sets.map((s, j) =>
            j !== si ? s : { ...s, done: !s.done }
          ),
        }
      );
      const wasNotDone = !prev[ei].sets[si].done;
      if (wasNotDone) { setRestSecs(restDefault); setRestMinimized(false); }
      return copy;
    });
  };

  const updateSet = (ei: number, si: number, field: "reps" | "weight", val: string) => {
    setExercises(prev =>
      prev.map((ae, i) =>
        i !== ei ? ae : {
          ...ae,
          sets: ae.sets.map((s, j) =>
            j !== si ? s : { ...s, [field]: val }
          ),
        }
      )
    );
  };

  const addSet = (ei: number) => {
    setExercises(prev =>
      prev.map((ae, i) => {
        if (i !== ei) return ae;
        const last = ae.sets[ae.sets.length - 1];
        return {
          ...ae,
          sets: [...ae.sets, { reps: last?.reps ?? "", weight: last?.weight ?? "", done: false }],
        };
      })
    );
  };

  const removeSet = (ei: number, si: number) => {
    setExercises(prev =>
      prev.map((ae, i) => {
        if (i !== ei || ae.sets.length <= 1) return ae;
        return { ...ae, sets: ae.sets.filter((_, j) => j !== si) };
      })
    );
  };

  const removeExercise = (ei: number) => {
    setExercises(prev => prev.filter((_, i) => i !== ei));
  };

  const addExercise = (ex: Exercise) => {
    setExercises(prev => [
      ...prev,
      { exercise: ex, sets: [
        { reps: "", weight: "", done: false },
        { reps: "", weight: "", done: false },
        { reps: "", weight: "", done: false },
      ]},
    ]);
    // Fetch previous performance for new exercise
    apiRequest<any>("GET", `/api/exercises/${ex.id}/history?limit=1`)
      .then(hist => { if (hist?.date) setPrevPerf(p => ({ ...p, [ex.id]: hist })); })
      .catch(() => {});
    setShowAddEx(false);
    setExSearch("");
  };

  // ── Finish ──
  const finishWorkout = useCallback(async () => {
    setSaving(true);
    try {
      for (const { exercise, sets } of exercises) {
        for (let i = 0; i < sets.length; i++) {
          const s = sets[i];
          if (!s.reps && !s.weight) continue;
          await apiRequest("POST", "/api/workouts/sets", {
            workoutId:   Number(workoutId),
            exerciseId:  exercise.id,
            setNumber:   i + 1,
            reps:        parseInt(s.reps) || 0,
            weightGrams: lbsToGrams(parseFloat(s.weight) || 0),
            isWarmup:    false,
          });
        }
      }
      const completedAt = new Date().toISOString();
      const durationMinutes = Math.round(elapsed / 60);
      await apiRequest("PATCH", `/api/workouts/${workoutId}`, {
        completedAt,
        durationMinutes,
      });
      // Write workout to Apple Health silently
      if (health.authorized && durationMinutes > 0) {
        const startDate = new Date(Date.now() - elapsed * 1000).toISOString();
        health.writeWorkout({ startDate, durationMinutes });
      }
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
      router.replace("/(tabs)/workouts");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save workout.");
    } finally {
      setSaving(false);
    }
  }, [exercises, elapsed, workoutId, qc, router]);

  const confirmFinish = () => {
    const doneSets = exercises.reduce((s, ae) => s + ae.sets.filter(x => x.done).length, 0);
    setConfirm({
      title: "Finish Workout?",
      body: `${fmtElapsed(elapsed)} · ${exercises.length} exercise${exercises.length !== 1 ? "s" : ""} · ${doneSets} sets completed`,
      onOk: finishWorkout,
    });
  };

  // ── Render ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      {/* ── Top bar ── */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: border,
      }}>
        <Pressable
          onPress={() => setConfirm({
            title: "Leave Workout?",
            body: "Unsaved sets will be lost.",
            onOk: () => router.replace("/(tabs)/workouts"),
          })}
          style={{ marginRight: 12 }}
        >
          <ArrowLeft size={22} color={text} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: text }} numberOfLines={1}>
            {workout?.name ?? "Workout"}
          </Text>
          <Text style={{ fontFamily: "Doto", fontSize: 13, color: muted, letterSpacing: 1 }}>
            {fmtElapsed(elapsed)}
          </Text>
        </View>

        <Pressable
          onPress={confirmFinish}
          disabled={saving}
          style={({ pressed }) => ({
            backgroundColor: "#C8E84C", borderRadius: 14,
            paddingHorizontal: 14, paddingVertical: 8,
            flexDirection: "row", alignItems: "center", gap: 5,
            opacity: pressed || saving ? 0.7 : 1,
          })}
        >
          {saving
            ? <ActivityIndicator size="small" color="#0a0a0a" />
            : <Check size={15} color="#0a0a0a" />
          }
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#0a0a0a" }}>Finish</Text>
        </Pressable>
      </View>

      {/* ── Exercise list ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: restSecs !== null && !restMinimized ? 380 : 48 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {exercises.map((ae, ei) => {
            const prev      = prevPerf[ae.exercise.id];
            const doneCount = ae.sets.filter(s => s.done).length;
            return (
              <View key={ei} style={{
                backgroundColor: card, borderRadius: 18, padding: 14,
                borderWidth: 1, borderColor: border, marginBottom: 12,
              }}>
                {/* Exercise header */}
                <View style={{
                  flexDirection: "row", alignItems: "flex-start",
                  justifyContent: "space-between", marginBottom: 10,
                }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>
                      {ae.exercise.name}
                    </Text>
                    {ae.exercise.primaryMuscle ? (
                      <Text style={{
                        fontFamily: "Manrope", fontSize: 11,
                        color: muted, textTransform: "capitalize", marginTop: 1,
                      }}>
                        {ae.exercise.primaryMuscle}
                      </Text>
                    ) : null}

                    {/* Previous performance */}
                    {prev ? (
                      <View style={{
                        marginTop: 6, backgroundColor: "rgba(255,255,255,0.04)",
                        borderRadius: 8, padding: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
                      }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.6 }}>
                          PREV  ·  {new Date(prev.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </Text>
                        <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#aaaaaa", marginTop: 2 }}>
                          {prev.sets.slice(0, 4).map(s =>
                            `${gramsToLbs(s.weightGrams)} × ${s.reps}`
                          ).join(" · ")}
                          {prev.sets.length > 4 ? " …" : ""}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable onPress={() => removeExercise(ei)} style={{ padding: 4 }}>
                    <X size={16} color={muted} />
                  </Pressable>
                </View>

                {/* Column headers */}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  <Text style={{ width: 24, fontFamily: "Manrope-Bold", fontSize: 9, color: muted, textAlign: "center", letterSpacing: 0.5 }}>
                    SET
                  </Text>
                  <Text style={{ flex: 1, fontFamily: "Manrope-Bold", fontSize: 9, color: muted, textAlign: "center", letterSpacing: 0.5 }}>
                    LBS
                  </Text>
                  <Text style={{ flex: 1, fontFamily: "Manrope-Bold", fontSize: 9, color: muted, textAlign: "center", letterSpacing: 0.5 }}>
                    REPS
                  </Text>
                  <View style={{ width: 32 }} />
                </View>

                {/* Set rows */}
                {ae.sets.map((s, si) => {
                  const pSet = prev?.sets[si];
                  return (
                    <View key={si} style={{
                      flexDirection: "row", gap: 8, marginBottom: 7, alignItems: "center",
                    }}>
                      {/* Set number */}
                      <Text style={{
                        width: 24, fontFamily: "Manrope-Bold", fontSize: 13,
                        color: s.done ? "#C8E84C" : muted, textAlign: "center",
                      }}>
                        {si + 1}
                      </Text>

                      {/* Weight */}
                      <TextInput
                        value={s.weight}
                        onChangeText={v => updateSet(ei, si, "weight", v)}
                        keyboardType="decimal-pad"
                        placeholder={pSet ? String(gramsToLbs(pSet.weightGrams)) : "0"}
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        style={{
                          flex: 1, backgroundColor: s.done ? "rgba(200,232,76,0.07)" : "#111111",
                          borderRadius: 10, paddingVertical: 10, paddingHorizontal: 4,
                          textAlign: "center", fontFamily: "Manrope-Bold", fontSize: 14, color: text,
                          borderWidth: 1, borderColor: s.done ? "rgba(200,232,76,0.3)" : border,
                        }}
                      />

                      {/* Reps */}
                      <TextInput
                        value={s.reps}
                        onChangeText={v => updateSet(ei, si, "reps", v)}
                        keyboardType="number-pad"
                        placeholder={pSet ? String(pSet.reps) : "0"}
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        style={{
                          flex: 1, backgroundColor: s.done ? "rgba(200,232,76,0.07)" : "#111111",
                          borderRadius: 10, paddingVertical: 10, paddingHorizontal: 4,
                          textAlign: "center", fontFamily: "Manrope-Bold", fontSize: 14, color: text,
                          borderWidth: 1, borderColor: s.done ? "rgba(200,232,76,0.3)" : border,
                        }}
                      />

                      {/* Done button (long-press to remove) */}
                      <Pressable
                        onPress={() => toggleDone(ei, si)}
                        onLongPress={() => {
                          if (ae.sets.length > 1) removeSet(ei, si);
                        }}
                        style={({ pressed }) => ({
                          width: 32, height: 32, borderRadius: 16,
                          backgroundColor: s.done ? "#C8E84C" : "#1c1c1c",
                          borderWidth: 1.5,
                          borderColor: s.done ? "#C8E84C" : border,
                          alignItems: "center", justifyContent: "center",
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        {s.done ? <Check size={15} color="#0a0a0a" /> : null}
                      </Pressable>
                    </View>
                  );
                })}

                {/* Footer row */}
                <View style={{
                  flexDirection: "row", alignItems: "center",
                  justifyContent: "space-between", marginTop: 4,
                }}>
                  <Pressable
                    onPress={() => addSet(ei)}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Plus size={13} color={muted} />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>
                      Add Set
                    </Text>
                  </Pressable>
                  <Text style={{
                    fontFamily: "Manrope-SemiBold", fontSize: 11,
                    color: doneCount > 0 ? "#C8E84C" : muted,
                  }}>
                    {doneCount}/{ae.sets.length} done
                  </Text>
                </View>
              </View>
            );
          })}

          {/* Add Exercise */}
          <Pressable
            onPress={() => setShowAddEx(true)}
            style={({ pressed }) => ({
              borderWidth: 1.5, borderStyle: "dashed", borderColor: "#333333",
              borderRadius: 18, padding: 16, alignItems: "center",
              flexDirection: "row", justifyContent: "center", gap: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Plus size={18} color={muted} />
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>Add Exercise</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Rest Timer — minimized floating pill ── */}
      {restSecs !== null && restMinimized && (
        <Pressable
          onPress={() => setRestMinimized(false)}
          style={({ pressed }) => ({
            position: "absolute", bottom: 24, right: 20,
            width: 76, height: 76, borderRadius: 38,
            backgroundColor: "#111111",
            borderWidth: 2.5, borderColor: restSecs <= 10 ? "#ef4444" : LIME,
            alignItems: "center", justifyContent: "center",
            opacity: pressed ? 0.8 : 1,
            // simple glow via shadow (iOS/Android) — web ignores this gracefully
            shadowColor: restSecs <= 10 ? "#ef4444" : LIME,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 12,
          })}
        >
          <Text style={{
            fontFamily: "Doto", fontSize: 13, letterSpacing: 0.5,
            color: restSecs <= 10 ? "#ef4444" : LIME,
          }}>
            {fmtRest(restSecs)}
          </Text>
          <Maximize2 size={10} color={muted} style={{ marginTop: 3 }} />
        </Pressable>
      )}

      {/* ── Rest Timer — full ring overlay ── */}
      {restSecs !== null && !restMinimized && (() => {
        const progress    = restDefault > 0 ? Math.max(0, Math.min(1, restSecs / restDefault)) : 0;
        const dashOffset  = RING_CIRC * (1 - progress);
        const urgent      = restSecs <= 10;
        const ringColor   = urgent ? "#ef4444" : LIME;

        return (
          <View style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            backgroundColor: "#0f0f0f",
            borderTopLeftRadius: 26, borderTopRightRadius: 26,
            borderTopWidth: 1, borderColor: "#222222",
            paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 34 : 20,
            paddingHorizontal: 20, alignItems: "center",
          }}>
            {/* Header row: drag handle + minimize */}
            <View style={{ width: "100%", flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <View style={{ flex: 1 }} />
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#2d2d2d" }} />
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Pressable onPress={() => setRestMinimized(true)} style={{ padding: 4 }}>
                  <ChevronDown size={18} color={muted} />
                </Pressable>
              </View>
            </View>

            {/* Label */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
              <Timer size={12} color={muted} />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 1.2 }}>
                REST TIME
              </Text>
            </View>

            {/* ── SVG Ring ── */}
            <View style={{ width: SVG_SIZE, height: SVG_SIZE, alignItems: "center", justifyContent: "center" }}>
              <Svg width={SVG_SIZE} height={SVG_SIZE}>
                {/* Tick marks */}
                {TICKS.map((t, i) => (
                  <Line
                    key={i}
                    x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                    stroke={t.isLong ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)"}
                    strokeWidth={t.isLong ? 2 : 1}
                    strokeLinecap="round"
                  />
                ))}

                {/* Background track */}
                <Circle
                  cx={CX} cy={CY} r={RING_R}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={3}
                />

                {/* Glow layers (outer → inner) */}
                <G rotation="-90" origin={`${CX},${CY}`}>
                  {/* outer haze */}
                  <Circle cx={CX} cy={CY} r={RING_R} fill="none"
                    stroke={ringColor + "18"} strokeWidth={22}
                    strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                  {/* mid bloom */}
                  <Circle cx={CX} cy={CY} r={RING_R} fill="none"
                    stroke={ringColor + "45"} strokeWidth={10}
                    strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                  {/* inner glow */}
                  <Circle cx={CX} cy={CY} r={RING_R} fill="none"
                    stroke={ringColor + "aa"} strokeWidth={4}
                    strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                  {/* core */}
                  <Circle cx={CX} cy={CY} r={RING_R} fill="none"
                    stroke={ringColor} strokeWidth={2}
                    strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                </G>
              </Svg>

              {/* Time overlay — centered on top of SVG */}
              <View style={{
                position: "absolute", alignItems: "center", justifyContent: "center",
              }}>
                <Text style={{
                  fontFamily: "Doto", fontSize: 52, lineHeight: 56,
                  color: urgent ? "#ef4444" : "#ffffff",
                  letterSpacing: 2,
                }}>
                  {fmtRest(restSecs)}
                </Text>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: muted, letterSpacing: 0.5, marginTop: 2 }}>
                  {Math.round(progress * 100)}%
                </Text>
              </View>
            </View>

            {/* Controls */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              {[
                { label: "−15s", onPress: () => setRestSecs(s => Math.max(0, (s ?? 0) - 15)) },
                { label: "Skip",  onPress: () => setRestSecs(null), primary: true },
                { label: "+15s", onPress: () => setRestSecs(s => (s ?? 0) + 15) },
              ].map((btn: any) => (
                <Pressable
                  key={btn.label}
                  onPress={btn.onPress}
                  style={({ pressed }) => ({
                    backgroundColor: btn.primary ? "#1e1e1e" : "#161616",
                    borderRadius: 14, paddingHorizontal: btn.primary ? 28 : 18, paddingVertical: 10,
                    borderWidth: 1, borderColor: btn.primary ? "#333333" : "#242424",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    fontFamily: "Manrope-Bold", fontSize: 14,
                    color: btn.primary ? "#ffffff" : "#888888",
                  }}>
                    {btn.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Duration presets */}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              {[60, 90, 120, 180].map(d => (
                <Pressable
                  key={d}
                  onPress={() => { setRestDefault(d); setRestSecs(d); }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12,
                    backgroundColor: restDefault === d ? "rgba(132,204,22,0.12)" : "transparent",
                    borderWidth: 1,
                    borderColor: restDefault === d ? LIME + "44" : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    fontFamily: "Manrope-SemiBold", fontSize: 12,
                    color: restDefault === d ? LIME : muted,
                  }}>
                    {d / 60 < 1 ? `${d}s` : `${d / 60}m`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })()}

      {/* ── Confirm Dialog ── */}
      <Modal visible={!!confirm} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center", alignItems: "center", padding: 32,
        }}>
          <View style={{
            backgroundColor: "#1a1a1a", borderRadius: 20,
            padding: 24, width: "100%", maxWidth: 360,
            borderWidth: 1, borderColor: "#2a2a2a",
          }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: "#ffffff", marginBottom: 8 }}>
              {confirm?.title}
            </Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 14, color: "#999999", marginBottom: 24, lineHeight: 20 }}>
              {confirm?.body}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setConfirm(null)}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: "#262626", borderWidth: 1, borderColor: "#333333",
                  alignItems: "center", opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#cccccc" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { const fn = confirm?.onOk; setConfirm(null); fn?.(); }}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: "#ef4444", alignItems: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: "#ffffff" }}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Exercise Picker Modal ── */}
      <Modal visible={showAddEx} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg }}>
          <View style={{
            padding: 16, flexDirection: "row", justifyContent: "space-between",
            alignItems: "center", borderBottomWidth: 1, borderBottomColor: border,
          }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>Add Exercise</Text>
            <Pressable onPress={() => { setShowAddEx(false); setExSearch(""); }}>
              <X size={22} color={text} />
            </Pressable>
          </View>
          <View style={{ padding: 16 }}>
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: "#111111", borderRadius: 12,
              paddingHorizontal: 12, borderWidth: 1, borderColor: border,
            }}>
              <Search size={15} color={muted} />
              <TextInput
                value={exSearch}
                onChangeText={setExSearch}
                placeholder="Search exercises…"
                placeholderTextColor={muted}
                autoFocus
                style={{
                  flex: 1, paddingVertical: 12, color: text,
                  fontFamily: "Manrope", fontSize: 14,
                }}
              />
            </View>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {searchResults.map((ex) => (
              <Pressable
                key={ex.id}
                onPress={() => addExercise(ex)}
                style={({ pressed }) => ({
                  backgroundColor: card, borderRadius: 14, padding: 14,
                  borderWidth: 1, borderColor: border, marginBottom: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: text }}>
                  {ex.name}
                </Text>
                <Text style={{
                  fontFamily: "Manrope", fontSize: 11, color: muted,
                  textTransform: "capitalize", marginTop: 2,
                }}>
                  {ex.primaryMuscle}{ex.primaryMuscle && ex.category ? " · " : ""}{ex.category}
                </Text>
              </Pressable>
            ))}
            {showAddEx && searchResults.length === 0 && (
              <Text style={{
                fontFamily: "Manrope", fontSize: 13, color: muted,
                textAlign: "center", paddingVertical: 40,
              }}>
                {exSearch ? "No exercises found" : "Type to search exercises"}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
