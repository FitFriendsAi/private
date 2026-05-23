/**
 * Routine Detail Screen
 * Route: /routine/:templateId
 *
 * Shows the exercises in a saved routine and lets the user
 * start a workout session or edit the routine.
 */

import { useState } from "react";
import {
  View, Text, ScrollView, Pressable, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { todayStr, gramsToLbs } from "@/lib/utils";
import { ArrowLeft, Dumbbell, Play, ChevronRight } from "lucide-react-native";

const LIME = "#c8e84c";
const DOT: object = { fontFamily: "Doto" };

/** Muscle group → short display label */
function muscleLabel(m: string): string {
  const map: Record<string, string> = {
    chest: "Chest", back: "Back", shoulders: "Shoulders",
    biceps: "Biceps", triceps: "Triceps", forearms: "Forearms",
    abs: "Core", glutes: "Glutes", quads: "Quads",
    hamstrings: "Hamstrings", calves: "Calves",
    traps: "Traps", lats: "Lats",
    cardio: "Cardio", full_body: "Full Body",
  };
  return map[m] ?? m?.charAt(0).toUpperCase() + (m?.slice(1) ?? "");
}

/** Category → accent colour */
function categoryColor(cat: string): string {
  if (cat === "compound") return LIME;
  if (cat === "cardio")   return "#9bd1ff";
  return "rgba(255,255,255,0.4)";
}

export default function RoutineDetailScreen() {
  const { templateId }      = useLocalSearchParams<{ templateId: string }>();
  const router              = useRouter();
  const qc                  = useQueryClient();
  const { palette }         = useTheme();
  const { card, cardBorder: border, text, muted, bg } = palette;
  const today               = todayStr();
  const [starting, setStarting] = useState(false);

  // Fetch template with exercise details
  const { data: template, isLoading } = useQuery<any>({
    queryKey:  ["/api/templates", templateId],
    queryFn:   () => apiRequest("GET", `/api/templates/${templateId}`),
    enabled:   !!templateId,
  });

  // ── Start workout ─────────────────────────────────────────────────
  const startWorkout = async () => {
    if (!template) return;
    setStarting(true);
    try {
      const workout = await apiRequest<any>("POST", "/api/workouts", {
        date: today,
        name: template.name,
        templateId: template.id,
      });
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
      router.replace({
        pathname: "/workout/[workoutId]",
        params: { workoutId: String(workout.id), templateId: String(template.id) },
      });
    } catch {
      Alert.alert("Error", "Could not start workout.");
      setStarting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>

      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16,
        gap: 12,
      }}>
        <Pressable
          onPress={() => router.back()}
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
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 24, color: text }} numberOfLines={1}>
            {isLoading ? "Loading…" : (template?.name ?? "Routine")}
          </Text>
          {!isLoading && template && (
            <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted, marginTop: 1 }}>
              {template.exercises?.length ?? 0} exercise{(template.exercises?.length ?? 0) !== 1 ? "s" : ""}
            </Text>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={LIME} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >

          {/* Exercise list */}
          {(!template?.exercises || template.exercises.length === 0) ? (
            <View style={{
              backgroundColor: card, borderRadius: 18, padding: 32,
              alignItems: "center", borderWidth: 1, borderColor: border, marginTop: 8,
            }}>
              <Dumbbell size={28} color={muted} style={{ marginBottom: 10 }} />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>No exercises yet</Text>
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 4, textAlign: "center" }}>
                Start the workout to add exercises on the fly
              </Text>
            </View>
          ) : (
            template.exercises.map((ex: any, i: number) => (
              <View
                key={ex.id}
                style={{
                  backgroundColor: card, borderRadius: 16,
                  padding: 14, borderWidth: 1, borderColor: border,
                  flexDirection: "row", alignItems: "center", gap: 14,
                  marginBottom: 8,
                }}
              >
                {/* Index badge */}
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: "rgba(200,232,76,0.12)",
                  alignItems: "center", justifyContent: "center",
                  borderWidth: 1, borderColor: "rgba(200,232,76,0.2)",
                }}>
                  <Text style={{ ...(DOT as any), fontSize: 15, color: LIME, lineHeight: 18 }}>{i + 1}</Text>
                </View>

                {/* Exercise info */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>
                    {ex.exerciseName}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                    {/* Sets × Reps */}
                    {ex.targetSets > 0 && ex.targetReps > 0 && (
                      <View style={{
                        backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 6,
                        paddingHorizontal: 7, paddingVertical: 2,
                      }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: text }}>
                          {ex.targetSets} × {ex.targetReps}
                        </Text>
                      </View>
                    )}
                    {/* Target weight */}
                    {ex.targetWeightGrams > 0 && (
                      <View style={{
                        backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 6,
                        paddingHorizontal: 7, paddingVertical: 2,
                      }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted }}>
                          @ {gramsToLbs(ex.targetWeightGrams)} lbs
                        </Text>
                      </View>
                    )}
                    {/* Muscle tag */}
                    {ex.primaryMuscle && (
                      <Text style={{
                        fontFamily: "Manrope", fontSize: 11,
                        color: categoryColor(ex.category),
                      }}>
                        {muscleLabel(ex.primaryMuscle)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}

        </ScrollView>
      )}

      {/* Start Workout CTA — fixed at bottom */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12,
        backgroundColor: bg,
      }}>
        <Pressable
          onPress={startWorkout}
          disabled={starting || isLoading}
          style={({ pressed }) => ({
            backgroundColor: LIME, borderRadius: 18,
            paddingVertical: 18, flexDirection: "row",
            alignItems: "center", justifyContent: "center", gap: 10,
            opacity: pressed || starting || isLoading ? 0.7 : 1,
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
    </SafeAreaView>
  );
}
