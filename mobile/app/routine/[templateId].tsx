/**
 * Routine Detail + Edit Screen
 * Route: /routine/:templateId
 *
 * View mode  — exercise list with sets/reps/weight, rest timer, Start Workout CTA
 * Edit mode  — inline set/rep/weight editing, reorder (↑↓), replace, delete, add exercise
 */

import { useState, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, TextInput,
  Alert, ActivityIndicator, Modal, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { todayStr, gramsToLbs, lbsToGrams } from "@/lib/utils";
import {
  ArrowLeft, Play, Pencil, Check, Trash2, ArrowUp, ArrowDown,
  RefreshCw, Plus, Timer, Search, ChevronRight, Dumbbell,
} from "lucide-react-native";

const LIME   = "#c8e84c";
const BLUE   = "#9bd1ff";
const DOT: object = { fontFamily: "Doto" };

// ── Muscle / category helpers ─────────────────────────────────────────────────
const MUSCLE_LABELS: Record<string, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders",
  biceps: "Biceps", triceps: "Triceps", forearms: "Forearms",
  abs: "Core", glutes: "Glutes", quads: "Quads",
  hamstrings: "Hamstrings", calves: "Calves",
  traps: "Traps", lats: "Lats", cardio: "Cardio", full_body: "Full Body",
};
const muscleLabel = (m: string) =>
  MUSCLE_LABELS[m] ?? (m ? m[0].toUpperCase() + m.slice(1) : "");

function categoryColor(cat: string) {
  if (cat === "compound") return LIME;
  if (cat === "cardio")   return BLUE;
  return "rgba(255,255,255,0.35)";
}

// ── Rest picker presets ───────────────────────────────────────────────────────
const REST_PRESETS = [30, 45, 60, 90, 120, 180, 240];

// ── Types ─────────────────────────────────────────────────────────────────────
interface TemplateEx {
  id: number; templateId: number; exerciseId: number; orderIndex: number;
  targetSets: number; targetReps: string; targetWeightGrams: number | null;
  exerciseName: string; primaryMuscle: string; category: string;
}

// ── Weight formatting helpers ─────────────────────────────────────────────────
function gToLbsStr(g: number | null): string {
  if (!g) return "";
  return gramsToLbs(g);
}
function lbsStrToG(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : lbsToGrams(n);
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function RoutineDetailScreen() {
  const { templateId }  = useLocalSearchParams<{ templateId: string }>();
  const router          = useRouter();
  const qc              = useQueryClient();
  const { palette }     = useTheme();
  const { card, cardBorder: border, text, muted, bg } = palette;
  const today = todayStr();

  // ── Mode & UI state ──────────────────────────────────────────────────────────
  const [editMode,          setEditMode]          = useState(false);
  const [restSeconds,       setRestSeconds]       = useState(90);
  const [showRestPicker,    setShowRestPicker]     = useState(false);
  const [showExPicker,      setShowExPicker]       = useState(false);
  const [replacingEx,       setReplacingEx]        = useState<TemplateEx | null>(null);
  const [exSearch,          setExSearch]           = useState("");
  const [starting,          setStarting]           = useState(false);

  // Local editable copy of exercises (source of truth in edit mode)
  const [localEx, setLocalEx] = useState<TemplateEx[]>([]);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: template, isLoading } = useQuery<any>({
    queryKey: ["/api/templates", templateId],
    queryFn:  () => apiRequest("GET", `/api/templates/${templateId}`),
    enabled:  !!templateId,
  });

  const { data: allExercises = [] } = useQuery<any[]>({
    queryKey: ["/api/exercises"],
    queryFn:  () => apiRequest("GET", "/api/exercises"),
    enabled:  showExPicker,
  });

  // Sync server data → local state (only when NOT in edit mode)
  useEffect(() => {
    if (template?.exercises && !editMode) {
      setLocalEx(template.exercises);
    }
  }, [template, editMode]);

  // ── Invalidation helper ──────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["/api/templates", templateId] });
    qc.invalidateQueries({ queryKey: ["/api/templates"] });
  }, [qc, templateId]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const patchEx = useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiRequest("PATCH", `/api/template-exercises/${id}`, data),
  });

  const deleteEx = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/template-exercises/${id}`),
  });

  const addEx = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", `/api/templates/${templateId}/exercises`, data),
    onSuccess: invalidate,
  });

  // ── Edit mode helpers ────────────────────────────────────────────────────────
  const updateField = (id: number, field: string, rawValue: string) => {
    // Update local state immediately
    setLocalEx(prev => prev.map(ex => {
      if (ex.id !== id) return ex;
      if (field === "targetSets")          return { ...ex, targetSets: parseInt(rawValue) || 1 };
      if (field === "targetReps")          return { ...ex, targetReps: rawValue };
      if (field === "targetWeightGrams")   return { ...ex, targetWeightGrams: lbsStrToG(rawValue) };
      return ex;
    }));
  };

  const saveField = (id: number, field: string, rawValue: string) => {
    // Persist to server on blur
    let payload: any = {};
    if (field === "targetSets")         payload = { targetSets: Math.max(1, parseInt(rawValue) || 1) };
    else if (field === "targetReps")    payload = { targetReps: rawValue || "—" };
    else if (field === "targetWeightGrams") payload = { targetWeightGrams: lbsStrToG(rawValue) };
    patchEx.mutate({ id, ...payload });
  };

  const reorder = (idx: number, dir: "up" | "down") => {
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= localEx.length) return;
    const next = [...localEx];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    next.forEach((ex, i) => { ex.orderIndex = i; });
    setLocalEx(next);
    patchEx.mutate({ id: next[idx].id,  orderIndex: next[idx].orderIndex });
    patchEx.mutate({ id: next[swap].id, orderIndex: next[swap].orderIndex });
  };

  const handleDelete = (ex: TemplateEx) => {
    Alert.alert("Remove Exercise", `Remove "${ex.exerciseName}" from this routine?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: () => {
          setLocalEx(prev => prev.filter(e => e.id !== ex.id));
          deleteEx.mutate(ex.id);
        },
      },
    ]);
  };

  const handleReplace = (ex: TemplateEx) => {
    setReplacingEx(ex);
    setExSearch("");
    setShowExPicker(true);
  };

  const handleAddExercise = () => {
    setReplacingEx(null);
    setExSearch("");
    setShowExPicker(true);
  };

  const pickExercise = (exercise: any) => {
    setShowExPicker(false);

    if (replacingEx) {
      // Replace: optimistic update, then DELETE + POST on server
      setLocalEx(prev => prev.map(ex => ex.id === replacingEx.id ? {
        ...ex,
        exerciseId:    exercise.id,
        exerciseName:  exercise.name,
        primaryMuscle: exercise.primaryMuscle,
        category:      exercise.category,
      } : ex));
      deleteEx.mutate(replacingEx.id, {
        onSuccess: () => addEx.mutate({
          exerciseId:        exercise.id,
          orderIndex:        replacingEx.orderIndex,
          targetSets:        replacingEx.targetSets,
          targetReps:        replacingEx.targetReps,
          targetWeightGrams: replacingEx.targetWeightGrams,
        }),
      });
      setReplacingEx(null);
    } else {
      // Add new exercise
      const nextOrder = localEx.length;
      const tempId = Date.now();
      setLocalEx(prev => [...prev, {
        id: tempId, templateId: Number(templateId),
        exerciseId: exercise.id, orderIndex: nextOrder,
        targetSets: 3, targetReps: "8-12", targetWeightGrams: null,
        exerciseName: exercise.name,
        primaryMuscle: exercise.primaryMuscle,
        category: exercise.category,
      }]);
      addEx.mutate({
        exerciseId: exercise.id, orderIndex: nextOrder,
        targetSets: 3, targetReps: "8-12",
      });
    }
  };

  const exitEditMode = () => {
    setEditMode(false);
    invalidate(); // re-fetch so real IDs replace temp IDs
  };

  // ── Start workout ────────────────────────────────────────────────────────────
  const startWorkout = async () => {
    if (!template) return;
    setStarting(true);
    try {
      const workout = await apiRequest<any>("POST", "/api/workouts", {
        date: today, name: template.name, templateId: template.id,
      });
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
      router.replace({
        pathname: "/workout/[workoutId]",
        params: {
          workoutId:    String(workout.id),
          templateId:   String(template.id),
          restSeconds:  String(restSeconds),
        },
      });
    } catch {
      Alert.alert("Error", "Could not start workout.");
      setStarting(false);
    }
  };

  // ── Filtered exercises for picker ────────────────────────────────────────────
  const filteredEx = exSearch.trim()
    ? allExercises.filter((e: any) =>
        e.name.toLowerCase().includes(exSearch.toLowerCase()) ||
        (e.primaryMuscle ?? "").toLowerCase().includes(exSearch.toLowerCase()))
    : allExercises;

  // ── Render helpers ───────────────────────────────────────────────────────────
  const fg = `rgba(0,0,0,`;  // card backgrounds are themed; text is always themed

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>

      {/* ── Header ── */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12,
      }}>
        <Pressable
          onPress={() => editMode ? exitEditMode() : router.back()}
          hitSlop={12}
          style={({ pressed }) => ({
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: card, borderWidth: 1, borderColor: border,
            alignItems: "center", justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ArrowLeft size={20} color={text} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text }} numberOfLines={1}>
            {isLoading ? "Loading…" : (template?.name ?? "Routine")}
          </Text>
          {!isLoading && (
            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 1 }}>
              {localEx.length} exercise{localEx.length !== 1 ? "s" : ""}
            </Text>
          )}
        </View>

        {/* Edit / Done toggle */}
        {!isLoading && (
          <Pressable
            onPress={() => editMode ? exitEditMode() : setEditMode(true)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: editMode ? LIME : card,
              borderWidth: 1, borderColor: editMode ? LIME : border,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {editMode
              ? <Check size={14} color="#0a0a0a" />
              : <Pencil size={14} color={text} />
            }
            <Text style={{
              fontFamily: "Manrope-Bold", fontSize: 13,
              color: editMode ? "#0a0a0a" : text,
            }}>
              {editMode ? "Done" : "Edit"}
            </Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={LIME} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={80}
        >
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: editMode ? 40 : 110 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* ── Rest Timer row ── */}
            <Pressable
              onPress={() => setShowRestPicker(true)}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                backgroundColor: card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
                borderWidth: 1, borderColor: border, marginBottom: 16,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Timer size={16} color={LIME} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>
                  Rest between sets
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ ...(DOT as any), fontSize: 18, color: LIME, lineHeight: 20 }}>
                  {restSeconds}s
                </Text>
                <ChevronRight size={14} color={muted} />
              </View>
            </Pressable>

            {/* ── Exercise list ── */}
            {localEx.length === 0 && !editMode && (
              <View style={{
                backgroundColor: card, borderRadius: 18, padding: 32,
                alignItems: "center", borderWidth: 1, borderColor: border,
              }}>
                <Dumbbell size={28} color={muted} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted, marginTop: 10 }}>
                  No exercises yet
                </Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 4 }}>
                  Tap Edit to add exercises
                </Text>
              </View>
            )}

            {localEx.map((ex, idx) => (
              <View
                key={ex.id}
                style={{
                  backgroundColor: card, borderRadius: 18, marginBottom: 10,
                  borderWidth: 1, borderColor: border, overflow: "hidden",
                }}
              >
                {/* ── Card header row ── */}
                <View style={{
                  flexDirection: "row", alignItems: "center",
                  paddingHorizontal: 14, paddingTop: 14,
                  paddingBottom: editMode ? 8 : 14, gap: 12,
                }}>
                  {/* Index badge */}
                  <View style={{
                    width: 34, height: 34, borderRadius: 17,
                    backgroundColor: "rgba(200,232,76,0.12)",
                    borderWidth: 1, borderColor: "rgba(200,232,76,0.2)",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Text style={{ ...(DOT as any), fontSize: 14, color: LIME, lineHeight: 16 }}>
                      {idx + 1}
                    </Text>
                  </View>

                  {/* Name + muscle */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>
                      {ex.exerciseName}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                      {ex.primaryMuscle ? (
                        <Text style={{
                          fontFamily: "Manrope-SemiBold", fontSize: 11,
                          color: categoryColor(ex.category),
                        }}>
                          {muscleLabel(ex.primaryMuscle)}
                        </Text>
                      ) : null}
                      {ex.category === "compound" && (
                        <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted }}>
                          · Compound
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Edit mode: reorder + actions */}
                  {editMode && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Pressable
                        onPress={() => reorder(idx, "up")}
                        disabled={idx === 0}
                        style={({ pressed }) => ({
                          width: 30, height: 30, borderRadius: 15,
                          backgroundColor: "rgba(255,255,255,0.06)",
                          alignItems: "center", justifyContent: "center",
                          opacity: (pressed || idx === 0) ? 0.3 : 1,
                        })}
                      >
                        <ArrowUp size={14} color={text} />
                      </Pressable>
                      <Pressable
                        onPress={() => reorder(idx, "down")}
                        disabled={idx === localEx.length - 1}
                        style={({ pressed }) => ({
                          width: 30, height: 30, borderRadius: 15,
                          backgroundColor: "rgba(255,255,255,0.06)",
                          alignItems: "center", justifyContent: "center",
                          opacity: (pressed || idx === localEx.length - 1) ? 0.3 : 1,
                        })}
                      >
                        <ArrowDown size={14} color={text} />
                      </Pressable>
                    </View>
                  )}
                </View>

                {/* ── VIEW MODE: sets table ── */}
                {!editMode && (
                  <View style={{
                    marginHorizontal: 14, marginBottom: 14,
                    backgroundColor: "rgba(255,255,255,0.04)",
                    borderRadius: 12, overflow: "hidden",
                  }}>
                    {/* Column headers */}
                    <View style={{
                      flexDirection: "row", paddingHorizontal: 12, paddingVertical: 7,
                      borderBottomWidth: 1, borderBottomColor: border,
                    }}>
                      <Text style={{ width: 40, fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.5 }}>SET</Text>
                      <Text style={{ flex: 1,  fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.5, textAlign: "center" }}>REPS</Text>
                      <Text style={{ flex: 1,  fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.5, textAlign: "center" }}>WEIGHT</Text>
                    </View>
                    {/* One row per target set */}
                    {Array.from({ length: ex.targetSets }).map((_, si) => (
                      <View key={si} style={{
                        flexDirection: "row", alignItems: "center",
                        paddingHorizontal: 12, paddingVertical: 9,
                        borderTopWidth: si === 0 ? 0 : 1, borderTopColor: border,
                      }}>
                        <View style={{
                          width: 40, height: 24, borderRadius: 6,
                          backgroundColor: "rgba(200,232,76,0.1)",
                          alignItems: "center", justifyContent: "center",
                        }}>
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: LIME }}>
                            {si + 1}
                          </Text>
                        </View>
                        <Text style={{
                          flex: 1, fontFamily: "Manrope-SemiBold", fontSize: 14,
                          color: text, textAlign: "center",
                        }}>
                          {ex.targetReps ?? "—"}
                        </Text>
                        <Text style={{
                          flex: 1, fontFamily: "Manrope-SemiBold", fontSize: 14,
                          color: ex.targetWeightGrams ? text : muted, textAlign: "center",
                        }}>
                          {ex.targetWeightGrams ? `${gToLbsStr(ex.targetWeightGrams)} lbs` : "BW"}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* ── EDIT MODE: inline inputs + actions ── */}
                {editMode && (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                    {/* Sets / Reps / Weight inputs */}
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                      {[
                        { label: "SETS", field: "targetSets",        value: String(ex.targetSets), keyType: "numeric" as const, width: 72 },
                        { label: "REPS", field: "targetReps",        value: ex.targetReps ?? "",   keyType: "default" as const, width: undefined },
                        { label: "LBS",  field: "targetWeightGrams", value: gToLbsStr(ex.targetWeightGrams), keyType: "decimal-pad" as const, width: undefined },
                      ].map(({ label, field, value, keyType, width }) => (
                        <View key={field} style={{ flex: width ? undefined : 1, width }}>
                          <Text style={{
                            fontFamily: "Manrope-Bold", fontSize: 9, color: muted,
                            letterSpacing: 0.6, marginBottom: 5,
                          }}>
                            {label}
                          </Text>
                          <TextInput
                            value={value}
                            onChangeText={v => updateField(ex.id, field, v)}
                            onBlur={e => saveField(ex.id, field, e.nativeEvent.text)}
                            keyboardType={keyType}
                            selectTextOnFocus
                            style={{
                              backgroundColor: "rgba(255,255,255,0.07)",
                              borderRadius: 10, padding: 10,
                              color: text, fontFamily: "Manrope-Bold", fontSize: 15,
                              textAlign: "center",
                              borderWidth: 1, borderColor: border,
                            }}
                          />
                        </View>
                      ))}
                    </View>

                    {/* Replace / Remove row */}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => handleReplace(ex)}
                        style={({ pressed }) => ({
                          flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                          gap: 6, paddingVertical: 9, borderRadius: 10,
                          borderWidth: 1, borderColor: border,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <RefreshCw size={13} color={muted} />
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: muted }}>
                          Replace
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDelete(ex)}
                        style={({ pressed }) => ({
                          width: 42, alignItems: "center", justifyContent: "center",
                          paddingVertical: 9, borderRadius: 10,
                          backgroundColor: "rgba(239,68,68,0.12)",
                          borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Trash2 size={15} color="#ef4444" />
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}

            {/* ── Add Exercise (edit mode) ── */}
            {editMode && (
              <Pressable
                onPress={handleAddExercise}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: 16, borderRadius: 18, marginBottom: 8,
                  borderWidth: 1.5, borderColor: LIME, borderStyle: "dashed",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Plus size={16} color={LIME} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: LIME }}>
                  Add Exercise
                </Text>
              </Pressable>
            )}

          </ScrollView>

          {/* ── Start Workout CTA (view mode only) ── */}
          {!editMode && (
            <View style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              paddingHorizontal: 16, paddingBottom: 28, paddingTop: 12,
              backgroundColor: bg,
            }}>
              <Pressable
                onPress={startWorkout}
                disabled={starting}
                style={({ pressed }) => ({
                  backgroundColor: LIME, borderRadius: 18, paddingVertical: 18,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
                  opacity: (pressed || starting) ? 0.7 : 1,
                })}
              >
                {starting
                  ? <ActivityIndicator color="#0a0a0a" />
                  : (
                    <>
                      <Play size={18} color="#0a0a0a" fill="#0a0a0a" />
                      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: "#0a0a0a" }}>
                        Start Workout
                      </Text>
                    </>
                  )
                }
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* ── Rest Timer Picker Modal ── */}
      <Modal
        visible={showRestPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRestPicker(false)}
      >
        <Pressable
          onPress={() => setShowRestPicker(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
        >
          <Pressable onPress={() => {}} style={{
            backgroundColor: card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 24, paddingBottom: 40,
            borderWidth: 1, borderColor: border,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <Timer size={18} color={LIME} />
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text }}>
                Rest Between Sets
              </Text>
            </View>

            {/* Preset buttons */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
              {REST_PRESETS.map(s => (
                <Pressable
                  key={s}
                  onPress={() => { setRestSeconds(s); setShowRestPicker(false); }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14,
                    backgroundColor: restSeconds === s ? LIME : "rgba(255,255,255,0.07)",
                    borderWidth: 1, borderColor: restSeconds === s ? LIME : border,
                    opacity: pressed ? 0.7 : 1,
                    minWidth: 72, alignItems: "center",
                  })}
                >
                  <Text style={{
                    fontFamily: "Manrope-ExtraBold", fontSize: 14,
                    color: restSeconds === s ? "#0a0a0a" : text,
                  }}>
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Custom input */}
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.6, marginBottom: 8 }}>
              CUSTOM (seconds)
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                value={String(restSeconds)}
                onChangeText={v => setRestSeconds(Math.max(10, parseInt(v) || 60))}
                keyboardType="number-pad"
                selectTextOnFocus
                style={{
                  flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 12,
                  padding: 14, color: text, fontFamily: "Manrope-Bold", fontSize: 18,
                  textAlign: "center", borderWidth: 1, borderColor: border,
                }}
              />
              <Pressable
                onPress={() => setShowRestPicker(false)}
                style={({ pressed }) => ({
                  flex: 1, backgroundColor: LIME, borderRadius: 12,
                  alignItems: "center", justifyContent: "center",
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: "#0a0a0a" }}>
                  Set
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Exercise Picker Modal ── */}
      <Modal
        visible={showExPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowExPicker(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
          {/* Header */}
          <View style={{
            flexDirection: "row", alignItems: "center",
            paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12,
          }}>
            <Pressable
              onPress={() => { setShowExPicker(false); setReplacingEx(null); }}
              style={({ pressed }) => ({
                width: 36, height: 36, borderRadius: 18, alignItems: "center",
                justifyContent: "center", backgroundColor: card,
                borderWidth: 1, borderColor: border, opacity: pressed ? 0.6 : 1,
              })}
            >
              <ArrowLeft size={18} color={text} />
            </Pressable>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: text }}>
              {replacingEx ? "Replace Exercise" : "Add Exercise"}
            </Text>
          </View>

          {/* Search */}
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            marginHorizontal: 16, marginBottom: 12,
            backgroundColor: card, borderRadius: 14, paddingHorizontal: 12,
            borderWidth: 1, borderColor: border,
          }}>
            <Search size={16} color={muted} />
            <TextInput
              value={exSearch}
              onChangeText={setExSearch}
              placeholder="Search exercises…"
              placeholderTextColor={muted}
              autoFocus
              style={{
                flex: 1, paddingVertical: 12,
                color: text, fontFamily: "Manrope", fontSize: 14,
              }}
            />
          </View>

          {/* List */}
          <FlatList
            data={filteredEx}
            keyExtractor={(item: any) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }: { item: any }) => (
              <Pressable
                onPress={() => pickExercise(item)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: "rgba(200,232,76,0.1)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Dumbbell size={16} color={LIME} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>
                    {item.name}
                  </Text>
                  {item.primaryMuscle && (
                    <Text style={{
                      fontFamily: "Manrope", fontSize: 11, marginTop: 1,
                      color: categoryColor(item.category),
                    }}>
                      {muscleLabel(item.primaryMuscle)}
                      {item.category === "compound" ? " · Compound" : ""}
                    </Text>
                  )}
                </View>
                <ChevronRight size={16} color={muted} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingVertical: 48 }}>
                <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>
                  {allExercises.length === 0 ? "Loading…" : "No exercises found"}
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}
