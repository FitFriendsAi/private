/**
 * Workout History Detail screen — editable
 * Route: /workout-detail/:workoutId
 *
 * • Resolves exercise names via /api/exercises (falls back to set data)
 * • Weight and reps are inline-editable TextInputs; auto-save on blur
 * • Volume column recomputes live from local edits
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Image, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs, lbsToGrams } from "@/lib/utils";
import { ArrowLeft, Clock, Dumbbell, Scale, BarChart2, Check, Camera, ImagePlus, Trash2 } from "lucide-react-native";

const LIME = "#c8e84c";

// ── Duration ring ──────────────────────────────────────────────────
function DurationRing({ minutes, size = 72 }: { minutes: number; size?: number }) {
  const sw = 5, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  const dash = Math.min(minutes / 90, 1) * circ;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size/2} cy={size/2} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
        {minutes > 0 && (
          <Circle cx={size/2} cy={size/2} r={r}
            stroke={LIME} strokeWidth={sw} fill="none"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`}
          />
        )}
      </Svg>
      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 14, color: "#ffffff" }}>
        {minutes > 0 ? `${minutes}m` : "—"}
      </Text>
    </View>
  );
}

// ── Stat chip ──────────────────────────────────────────────────────
function StatChip({ icon: Icon, value, label, iconColor }: {
  icon: any; value: string; label: string; iconColor: string;
}) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <View style={{
        width: 34, height: 34, borderRadius: 10,
        backgroundColor: `${iconColor}18`,
        alignItems: "center", justifyContent: "center", marginBottom: 5,
      }}>
        <Icon size={16} color={iconColor} />
      </View>
      <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: "#f4f4f4" }}>{value}</Text>
      <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#888888", marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function formatDate(d: string): string {
  const dt  = new Date(d + "T12:00:00");
  const now = new Date();
  const diff = Math.round((now.getTime() - dt.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Column layout constants (header + data rows share these widths) ──
const COL_SET    = 28;   // px
const COL_WEIGHT = 112;  // px  — fits "135 lbs" comfortably
const COL_REPS   = 56;   // px  — centred
const COL_IND    = 22;   // px  — save indicator
// VOLUME takes remaining flex: 1

// ── Inline-editable cell ─────────────────────────────────────────────
function EditCell({
  value, onChangeText, onBlur, keyboardType, suffix, align = "left", color, muted,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  keyboardType: "decimal-pad" | "number-pad";
  suffix?: string;
  align?: "left" | "center";
  color: string;
  muted: string;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
      }}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur(); }}
        keyboardType={keyboardType}
        selectTextOnFocus
        style={{
          fontFamily: "Manrope-SemiBold", fontSize: 14, color,
          textAlign: align,
          borderBottomWidth: focused ? 1 : 0,
          borderBottomColor: focused ? LIME : "transparent",
          paddingBottom: focused ? 2 : 0,
          // tight fixed width — fits up to 4-digit weights; reps stay compact
          width: suffix ? 50 : 32,
        }}
      />
      {/* Suffix always occupies the same space so "lbs" never drifts */}
      {suffix ? (
        <Text style={{
          fontFamily: "Manrope", fontSize: 12,
          color: value ? muted : "transparent",
          marginLeft: 2,
        }}>
          {suffix}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Types ──────────────────────────────────────────────────────────
type SetEdit = { weight: string; reps: string; saving: boolean; saved: boolean };

// ── Screen ─────────────────────────────────────────────────────────
export default function WorkoutDetailScreen() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const router        = useRouter();
  const { palette }   = useTheme();
  const { card, border, text, muted, bg } = palette;
  const qc            = useQueryClient();

  // ── Queries ──
  const { data: workout, isLoading } = useQuery<any>({
    queryKey: ["/api/workouts", workoutId, "detail"],
    queryFn: () => apiRequest("GET", `/api/workouts/${workoutId}`),
    enabled: !!workoutId,
  });

  // Fetch exercises to resolve names by ID
  const { data: allExercises = [] } = useQuery<any[]>({
    queryKey: ["/api/exercises"],
    queryFn: () => apiRequest("GET", "/api/exercises?limit=500"),
    staleTime: 5 * 60_000,
  });

  // Build exerciseId → {name, primaryMuscle} lookup
  const exLookup = useCallback(
    (id: number): { name: string; muscle: string } => {
      const found = allExercises.find((e: any) => e.id === id);
      if (found) return { name: found.name, muscle: found.primaryMuscle ?? "" };
      return { name: `Exercise #${id}`, muscle: "" };
    },
    [allExercises]
  );

  // ── Workout photo (stored locally per workout) ──
  const photoKey = `workout_photo_${workoutId}`;
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(photoKey).then(uri => { if (uri) setPhotoUri(uri); });
  }, [photoKey]);

  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to add a workout photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await AsyncStorage.setItem(photoKey, uri);
    }
  }, [photoKey]);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to take a workout photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await AsyncStorage.setItem(photoKey, uri);
    }
  }, [photoKey]);

  const removePhoto = useCallback(() => {
    Alert.alert("Remove photo?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        setPhotoUri(null);
        await AsyncStorage.removeItem(photoKey);
      }},
    ]);
  }, [photoKey]);

  const showPhotoOptions = useCallback(() => {
    if (photoUri) {
      Alert.alert("Workout Photo", "What would you like to do?", [
        { text: "Replace from Library", onPress: pickPhoto },
        { text: "Replace with Camera",  onPress: takePhoto },
        { text: "Remove Photo", style: "destructive", onPress: removePhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      Alert.alert("Add Workout Photo", "", [
        { text: "Choose from Library", onPress: pickPhoto },
        { text: "Take Photo",          onPress: takePhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, [photoUri, pickPhoto, takePhoto, removePhoto]);

  // ── Local editable state keyed by set ID ──
  const [edits, setEdits] = useState<Record<number, SetEdit>>({});

  useEffect(() => {
    if (!workout?.sets) return;
    const init: Record<number, SetEdit> = {};
    for (const s of workout.sets) {
      init[s.id] = {
        weight: gramsToLbs(s.weightGrams ?? 0) > 0 ? String(gramsToLbs(s.weightGrams)) : "",
        reps:   s.reps ? String(s.reps) : "",
        saving: false,
        saved:  false,
      };
    }
    setEdits(init);
  }, [workout]);

  // ── Auto-save a set on blur ──
  const saveSet = useCallback(async (setId: number) => {
    const e = edits[setId];
    if (!e) return;

    const newWeightGrams = lbsToGrams(parseFloat(e.weight) || 0);
    const newReps        = parseInt(e.reps) || 0;

    // Find original values
    const orig = workout?.sets?.find((s: any) => s.id === setId);
    if (orig &&
      orig.weightGrams === newWeightGrams &&
      orig.reps        === newReps) return; // no change

    setEdits(prev => ({ ...prev, [setId]: { ...prev[setId], saving: true, saved: false } }));
    try {
      await apiRequest("PATCH", `/api/workouts/sets/${setId}`, {
        weightGrams: newWeightGrams,
        reps:        newReps,
      });
      setEdits(prev => ({ ...prev, [setId]: { ...prev[setId], saving: false, saved: true } }));
      qc.invalidateQueries({ queryKey: ["/api/workouts", workoutId, "detail"] });
      // Clear "saved" checkmark after 1.5s
      setTimeout(() => {
        setEdits(prev => ({ ...prev, [setId]: { ...prev[setId], saved: false } }));
      }, 1500);
    } catch {
      setEdits(prev => ({ ...prev, [setId]: { ...prev[setId], saving: false } }));
    }
  }, [edits, workout, workoutId, qc]);

  // ── Loading / error ──
  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: bg, alignItems: "center", justifyContent: "center" }} edges={["top"]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (!workout) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
        <Pressable onPress={() => router.back()} style={{ padding: 16 }}>
          <ArrowLeft size={22} color={text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: muted }}>Workout not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Group sets by exercise (insertion order) ──
  const rawSets: any[] = workout.sets ?? [];
  const exOrder: number[] = [];
  const exGroups: Map<number, { name: string; muscle: string; sets: any[] }> = new Map();

  for (const s of rawSets) {
    const id = s.exerciseId;
    if (!exGroups.has(id)) {
      exOrder.push(id);
      const info = exLookup(id);
      // Prefer name from the set data itself if available
      const name = s.exerciseName ?? s.exercise?.name ?? info.name;
      const muscle = s.exercise?.primaryMuscle ?? info.muscle;
      exGroups.set(id, { name, muscle, sets: [] });
    }
    exGroups.get(id)!.sets.push(s);
  }
  const exercises = exOrder.map(id => ({ id, ...exGroups.get(id)! }));

  // ── Aggregate stats (using edits for live computation) ──
  const totalSets = rawSets.length;

  function liveWeight(s: any): number {
    const e = edits[s.id];
    return e ? (parseFloat(e.weight) || 0) : gramsToLbs(s.weightGrams ?? 0);
  }
  function liveReps(s: any): number {
    const e = edits[s.id];
    return e ? (parseInt(e.reps) || 0) : (s.reps ?? 0);
  }

  const totalVolLbs = rawSets.reduce((sum, s) => sum + liveWeight(s) * liveReps(s), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      {/* ── Header ── */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: border,
      }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color={text} />
        </Pressable>
        <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: text, flex: 1 }} numberOfLines={1}>
          {workout.name}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Summary card ── */}
          <View style={{
            backgroundColor: card, borderRadius: 20,
            borderWidth: 1, borderColor: border, padding: 18, marginBottom: 16,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <DurationRing minutes={workout.durationMinutes ?? 0} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 18, color: text }} numberOfLines={1}>
                  {workout.name}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Clock size={12} color={muted} />
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>
                    {formatDate(workout.date)}
                    {workout.durationMinutes ? `  ·  ${workout.durationMinutes}m` : ""}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{
              flexDirection: "row", justifyContent: "space-around",
              paddingTop: 14, borderTopWidth: 1, borderTopColor: border,
            }}>
              <StatChip icon={Dumbbell} value={String(exercises.length)} label="exercises" iconColor="#9bd1ff" />
              <View style={{ width: 1, backgroundColor: border }} />
              <StatChip icon={BarChart2} value={String(totalSets)} label="sets" iconColor={LIME} />
              <View style={{ width: 1, backgroundColor: border }} />
              <StatChip
                icon={Scale}
                value={totalVolLbs > 1000
                  ? `${(totalVolLbs / 1000).toFixed(1)}k`
                  : String(Math.round(totalVolLbs))}
                label="lbs volume"
                iconColor="#d3a8ff"
              />
            </View>
          </View>

          {/* ── Workout photo zone ── */}
          <Pressable
            onPress={showPhotoOptions}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 14 })}
          >
            {photoUri ? (
              /* ── Has photo — show full-width image with overlay controls ── */
              <View style={{ borderRadius: 18, overflow: "hidden" }}>
                <Image
                  source={{ uri: photoUri }}
                  style={{ width: "100%", aspectRatio: 16 / 9 }}
                  resizeMode="cover"
                />
                {/* Dark gradient overlay at bottom */}
                <View style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  flexDirection: "row", alignItems: "center", justifyContent: "flex-end",
                  padding: 10, gap: 8,
                  backgroundColor: "rgba(0,0,0,0.45)",
                }}>
                  <Pressable
                    onPress={showPhotoOptions}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", gap: 5,
                      backgroundColor: "rgba(255,255,255,0.15)",
                      borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Camera size={13} color="#ffffff" />
                    <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: "#ffffff" }}>
                      Change
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={removePhoto}
                    style={({ pressed }) => ({
                      backgroundColor: "rgba(239,68,68,0.25)",
                      borderRadius: 10, padding: 5,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Trash2 size={13} color="#ff8888" />
                  </Pressable>
                </View>
              </View>
            ) : (
              /* ── No photo — subtle dashed placeholder ── */
              <View style={{
                borderWidth: 1.5,
                borderStyle: "dashed",
                borderColor: "rgba(255,255,255,0.12)",
                borderRadius: 18,
                paddingVertical: 22,
                alignItems: "center",
                gap: 8,
                backgroundColor: "rgba(255,255,255,0.02)",
              }}>
                <View style={{
                  width: 42, height: 42, borderRadius: 21,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <ImagePlus size={20} color="rgba(255,255,255,0.3)" />
                </View>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "rgba(255,255,255,0.3)" }}>
                  Add workout photo
                </Text>
                <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
                  Tap to upload from library or camera
                </Text>
              </View>
            )}
          </Pressable>

          {/* ── Tap-to-edit hint ── */}
          <Text style={{
            fontFamily: "Manrope", fontSize: 11, color: muted,
            textAlign: "center", marginBottom: 12,
          }}>
            Tap any weight or rep to edit
          </Text>

          {/* ── Exercise cards ── */}
          {exercises.length === 0 ? (
            <View style={{
              backgroundColor: card, borderRadius: 20,
              borderWidth: 1, borderColor: border, padding: 40, alignItems: "center",
            }}>
              <Dumbbell size={32} color={muted} strokeWidth={1.5} />
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, marginTop: 12 }}>
                No sets recorded
              </Text>
            </View>
          ) : (
            exercises.map((ae) => {
              const sortedSets = [...ae.sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
              const exVolLbs   = sortedSets.reduce((s, set) => s + liveWeight(set) * liveReps(set), 0);
              const maxLbs     = sortedSets.reduce((mx, set) => Math.max(mx, liveWeight(set)), 0);

              return (
                <View key={ae.id} style={{
                  backgroundColor: card, borderRadius: 18,
                  borderWidth: 1, borderColor: border, padding: 14, marginBottom: 10,
                }}>
                  {/* Exercise name + stats */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>
                      {ae.name}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                      {ae.muscle ? (
                        <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted, textTransform: "capitalize" }}>
                          {ae.muscle}
                        </Text>
                      ) : null}
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: LIME }}>
                        {Math.round(exVolLbs).toLocaleString()} lbs total
                      </Text>
                      {maxLbs > 0 && (
                        <Text style={{ fontFamily: "Manrope", fontSize: 11, color: muted }}>
                          max {maxLbs} lbs
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Column headers */}
                  <View style={{
                    flexDirection: "row", alignItems: "center",
                    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: border, marginBottom: 2,
                  }}>
                    <Text style={{ width: COL_SET, fontFamily: "Manrope-Bold", fontSize: 10, color: muted, textAlign: "center", letterSpacing: 0.3 }}>SET</Text>
                    <Text style={{ width: COL_WEIGHT, fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.3 }}>WEIGHT</Text>
                    <Text style={{ width: COL_REPS, fontFamily: "Manrope-Bold", fontSize: 10, color: muted, textAlign: "center", letterSpacing: 0.3 }}>REPS</Text>
                    <Text style={{ flex: 1, fontFamily: "Manrope-Bold", fontSize: 10, color: muted, textAlign: "right", letterSpacing: 0.3 }}>VOLUME</Text>
                    <View style={{ width: COL_IND }} />
                  </View>

                  {/* Set rows */}
                  {sortedSets.map((s: any, si: number) => {
                    const e      = edits[s.id];
                    const wLbs   = e ? (parseFloat(e.weight) || 0) : gramsToLbs(s.weightGrams ?? 0);
                    const reps   = e ? (parseInt(e.reps) || 0) : (s.reps ?? 0);
                    const vol    = wLbs * reps;

                    return (
                      <View key={s.id ?? si} style={{
                        flexDirection: "row", alignItems: "center",
                        paddingVertical: 7,
                        borderBottomWidth: si < sortedSets.length - 1 ? 1 : 0,
                        borderBottomColor: "rgba(255,255,255,0.04)",
                      }}>
                        {/* Set # */}
                        <Text style={{
                          width: COL_SET, fontFamily: "Manrope-Bold",
                          fontSize: 13, color: muted, textAlign: "center",
                        }}>
                          {s.setNumber ?? si + 1}
                        </Text>

                        {/* Weight — editable, fixed width */}
                        <View style={{ width: COL_WEIGHT }}>
                          {e ? (
                            <EditCell
                              value={e.weight}
                              onChangeText={v => setEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], weight: v } }))}
                              onBlur={() => saveSet(s.id)}
                              keyboardType="decimal-pad"
                              suffix="lbs"
                              align="left"
                              color={text}
                              muted={muted}
                            />
                          ) : (
                            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted }}>—</Text>
                          )}
                        </View>

                        {/* Reps — editable, fixed width, centred */}
                        <View style={{ width: COL_REPS, alignItems: "center" }}>
                          {e ? (
                            <EditCell
                              value={e.reps}
                              onChangeText={v => setEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], reps: v } }))}
                              onBlur={() => saveSet(s.id)}
                              keyboardType="number-pad"
                              align="center"
                              color={text}
                              muted={muted}
                            />
                          ) : (
                            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 14, color: muted, textAlign: "center" }}>—</Text>
                          )}
                        </View>

                        {/* Volume (live) */}
                        <Text style={{
                          flex: 1, fontFamily: "Manrope", fontSize: 12,
                          color: muted, textAlign: "right",
                        }}>
                          {vol > 0 ? `${Math.round(vol)} lbs` : "—"}
                        </Text>

                        {/* Save indicator */}
                        <View style={{ width: COL_IND, alignItems: "center" }}>
                          {e?.saving ? (
                            <ActivityIndicator size="small" color={muted} style={{ transform: [{ scale: 0.6 }] }} />
                          ) : e?.saved ? (
                            <Check size={13} color="#22c55e" />
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
