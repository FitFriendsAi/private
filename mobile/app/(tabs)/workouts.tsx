import { useState, useMemo } from "react";
import {
  View, Text, ScrollView, Pressable, Modal, TextInput,
  Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { todayStr } from "@/lib/utils";
import { Zap, Plus, X, Clock, Upload } from "lucide-react-native";

const LIME = "#c8e84c";
const DOT: object = { fontFamily: "Doto" };
const today = todayStr();

// ── Arc circle for routine cards ──────────────────────────────────
function RoutineRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const sw = 3;
  const r  = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 1) * circ;
  return (
    <Svg width={size} height={size} style={{ position: "absolute" }}>
      <Circle cx={size / 2} cy={size / 2} r={r}
        stroke="rgba(255,255,255,0.1)" strokeWidth={sw} fill="none" />
      {pct > 0 && (
        <Circle cx={size / 2} cy={size / 2} r={r}
          stroke="#ffffff" strokeWidth={sw} fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </Svg>
  );
}

// ── Duration donut for history rows ──────────────────────────────
function DurationDonut({ minutes, size = 52 }: { minutes: number; size?: number }) {
  const sw  = 3.5;
  const r   = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(minutes / 90, 1);
  const dash = pct * circ;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
        {pct > 0 && (
          <Circle cx={size / 2} cy={size / 2} r={r}
            stroke={LIME} strokeWidth={sw} fill="none"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#ffffff" }}>
        {minutes > 0 ? `${minutes}m` : "—"}
      </Text>
    </View>
  );
}

function EmptyRing({ size = 52 }: { size?: number }) {
  const sw = 3;
  const r  = (size - sw) / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
      </Svg>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d   = new Date(dateStr + "T12:00:00");
  const now = new Date();
  const diff = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Main ──────────────────────────────────────────────────────────
export default function WorkoutsScreen() {
  const { palette }          = useTheme();
  const { card, border, text, muted, accent, accentText, bg } = palette;
  const router               = useRouter();
  const qc                   = useQueryClient();

  const [showNewRoutine, setShowNewRoutine] = useState(false);
  const [routineName,    setRoutineName]    = useState("");
  const [starting,       setStarting]       = useState<number | null>(null);

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/templates"],
    queryFn:  () => apiRequest("GET", "/api/templates"),
  });

  const { data: workouts = [] } = useQuery<any[]>({
    queryKey: ["/api/workouts"],
    queryFn:  () => apiRequest("GET", "/api/workouts?limit=30"),
  });

  // ── Stats ──
  const sevenDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const recentWorkouts  = useMemo(() =>
    workouts.filter((w: any) => w.date >= sevenDaysAgo && w.completedAt),
  [workouts, sevenDaysAgo]);

  const sessionCount7d  = recentWorkouts.length;
  const totalMinutes7d  = recentWorkouts.reduce((s: number, w: any) => s + (w.durationMinutes ?? 0), 0);
  const totalHours7d    = totalMinutes7d > 0
    ? `${Math.round((totalMinutes7d / 60) * 10) / 10}h total` : "";

  // ── Create routine ──
  const createTemplate = useMutation({
    mutationFn: () => apiRequest<any>("POST", "/api/templates", { name: routineName.trim() }),
    onSuccess:  () => {
      setShowNewRoutine(false);
      setRoutineName("");
      qc.invalidateQueries({ queryKey: ["/api/templates"] });
    },
    onError: () => Alert.alert("Error", "Could not create routine."),
  });

  // ── Start a routine ──
  const startRoutine = async (template: any) => {
    setStarting(template.id);
    try {
      const workout = await apiRequest<any>("POST", "/api/workouts", {
        date: today,
        name: template.name,
        templateId: template.id,
      });
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
      router.push({
        pathname: "/workout/[workoutId]",
        params: { workoutId: String(workout.id), templateId: String(template.id) },
      });
    } catch {
      Alert.alert("Error", "Could not start workout.");
    } finally {
      setStarting(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 32, color: text }}>Train</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <Zap size={13} color={LIME} fill={LIME} />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
              {sessionCount7d} session{sessionCount7d !== 1 ? "s" : ""} last 7 days
            </Text>
          </View>
        </View>

        {/* ── Stats row ── */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 14, marginBottom: 22 }}>
          {/* Volume card */}
          <View style={{
            flex: 1, backgroundColor: card, borderRadius: 18,
            padding: 16, borderWidth: 1, borderColor: border,
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.8 }}>
              VOLUME · 7D
            </Text>
            <Text style={{ ...(DOT as any), fontSize: 30, color: text, marginTop: 6, lineHeight: 34 }}>—</Text>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.5, marginTop: 2 }}>
              K LBS
            </Text>
          </View>
          {/* Sessions card (white) */}
          <View style={{
            flex: 1, backgroundColor: "#ffffff", borderRadius: 18, padding: 16,
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#666666", letterSpacing: 0.8 }}>
              SESSIONS · 7D
            </Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <Text style={{ ...(DOT as any), fontSize: 32, color: "#0a0a0a", lineHeight: 36 }}>
                {sessionCount7d}
              </Text>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#0a0a0a", letterSpacing: 0.5 }}>
                SESSIONS
              </Text>
            </View>
            {totalHours7d ? (
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#666666", marginTop: 2 }}>
                {totalHours7d}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── MY ROUTINES ── */}
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{
            flexDirection: "row", alignItems: "center",
            justifyContent: "space-between", marginBottom: 12,
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8 }}>
              MY ROUTINES
            </Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Pressable
                onPress={() => Alert.alert("AI Generate", "Coming soon!")}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 5,
                  borderWidth: 1, borderColor: border, borderRadius: 18,
                  paddingHorizontal: 12, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 11 }}>✦</Text>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: text }}>AI Generate</Text>
              </Pressable>
              <Pressable
                onPress={() => { setRoutineName(""); setShowNewRoutine(true); }}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Plus size={13} color={muted} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>New Routine</Text>
              </Pressable>
            </View>
          </View>

          {templates.length === 0 ? (
            <View style={{
              backgroundColor: card, borderRadius: 18, padding: 28,
              alignItems: "center", borderWidth: 1, borderColor: border, marginBottom: 20,
            }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>No routines yet</Text>
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 4 }}>
                Create one to get started
              </Text>
            </View>
          ) : (
            templates.map((t: any, i: number) => {
              const pct     = templates.length > 1 ? (i + 1) / templates.length : 1;
              const exCount = t.exercises?.length ?? t.exerciseCount ?? 0;
              const busy    = starting === t.id;
              return (
                <View key={t.id} style={{
                  backgroundColor: card, borderRadius: 18, padding: 14,
                  borderWidth: 1, borderColor: border, marginBottom: 10,
                  flexDirection: "row", alignItems: "center", gap: 14,
                }}>
                  {/* Arc circle */}
                  <View style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
                    <RoutineRing pct={pct} />
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 17, color: text }}>{i + 1}</Text>
                  </View>
                  {/* Info */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>{t.name}</Text>
                    {exCount > 0 && (
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 1 }}>
                        {exCount} exercise{exCount !== 1 ? "s" : ""}
                      </Text>
                    )}
                  </View>
                  {/* Start */}
                  <Pressable
                    onPress={() => startRoutine(t)}
                    disabled={busy}
                    style={({ pressed }) => ({
                      backgroundColor: "#ffffff", borderRadius: 20,
                      paddingHorizontal: 16, paddingVertical: 9,
                      flexDirection: "row", alignItems: "center", gap: 6,
                      opacity: pressed || busy ? 0.7 : 1, minWidth: 72, justifyContent: "center",
                    })}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color="#0a0a0a" />
                      : <>
                          <Text style={{ fontSize: 10, color: "#0a0a0a" }}>▶</Text>
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#0a0a0a" }}>Start</Text>
                        </>
                    }
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        {/* ── HISTORY ── */}
        <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
          <View style={{
            flexDirection: "row", alignItems: "center",
            justifyContent: "space-between", marginBottom: 12,
          }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8 }}>
              HISTORY
            </Text>
            <Pressable
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 5, opacity: pressed ? 0.7 : 1,
              })}
            >
              <Upload size={12} color={muted} />
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>Import CSV</Text>
            </Pressable>
          </View>

          {workouts.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>No workouts logged yet</Text>
            </View>
          ) : (
            workouts.map((w: any) => (
              <Pressable
                key={w.id}
                onPress={() => router.push({
                  pathname: "/workout-detail/[workoutId]",
                  params: { workoutId: String(w.id) },
                })}
                style={({ pressed }) => ({
                  backgroundColor: card, borderRadius: 18, padding: 14,
                  marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 14,
                  borderWidth: 1, borderColor: border, opacity: pressed ? 0.75 : 1,
                })}
              >
                {w.durationMinutes
                  ? <DurationDonut minutes={w.durationMinutes} />
                  : <EmptyRing />
                }
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>
                    {w.name.toUpperCase()}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                      {formatDate(w.date)}
                    </Text>
                    {w.durationMinutes ? (
                      <>
                        <Text style={{ color: muted }}>·</Text>
                        <Clock size={11} color={muted} />
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                          {w.durationMinutes}m
                        </Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </View>

      </ScrollView>

      {/* ── New Routine Modal ── */}
      <Modal visible={showNewRoutine} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg, padding: 24 }}>
          <View style={{
            flexDirection: "row", justifyContent: "space-between",
            alignItems: "center", marginBottom: 28,
          }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text }}>New Routine</Text>
            <Pressable onPress={() => setShowNewRoutine(false)}><X size={22} color={text} /></Pressable>
          </View>
          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 8 }}>
            ROUTINE NAME
          </Text>
          <TextInput
            value={routineName}
            onChangeText={setRoutineName}
            placeholder="e.g. Push Day, Leg Day…"
            placeholderTextColor={muted}
            autoFocus
            style={{
              backgroundColor: card, borderRadius: 14, padding: 14, color: text,
              fontFamily: "Manrope-Bold", fontSize: 16,
              borderWidth: 1, borderColor: border, marginBottom: 28,
            }}
          />
          <Pressable
            onPress={() => { if (routineName.trim()) createTemplate.mutate(); }}
            disabled={createTemplate.isPending || !routineName.trim()}
            style={({ pressed }) => ({
              backgroundColor: accent, borderRadius: 16, paddingVertical: 16, alignItems: "center",
              opacity: pressed || createTemplate.isPending || !routineName.trim() ? 0.6 : 1,
            })}
          >
            {createTemplate.isPending
              ? <ActivityIndicator color={accentText} />
              : <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: accentText }}>
                  Create Routine
                </Text>
            }
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
