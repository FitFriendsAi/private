import { useState, useMemo, useRef, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, Modal, TextInput, Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { estimateRoutineMinutes, formatDuration } from "@shared/training";
import { Platform } from "react-native";
import {
  Zap, Plus, X, Clock, Upload, ChevronRight, Trash2,
  MoreHorizontal, Pencil, Sparkles, Moon, Dumbbell, Share2, Users, Check,
  Calculator, Trophy,
} from "lucide-react-native";
import { PlateCalculator } from "@/components/PlateCalculator";

const LIME   = "#c8e84c";
const PURPLE = "#a78bfa";
const DOT: object = { fontFamily: "Doto" };

// ── Arc circle for routine cards ─────────────────────────────────────────────
function RoutineRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const sw = 3, r = (size - sw) / 2, circ = 2 * Math.PI * r, dash = Math.min(pct, 1) * circ;
  return (
    <Svg width={size} height={size} style={{ position: "absolute" }}>
      <Circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={sw} fill="none" />
      {pct > 0 && (
        <Circle cx={size/2} cy={size/2} r={r} stroke="#ffffff" strokeWidth={sw} fill="none"
          strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
      )}
    </Svg>
  );
}

// ── Duration donut for history rows ─────────────────────────────────────────
function DurationDonut({ minutes, size = 52 }: { minutes: number; size?: number }) {
  const sw = 3.5, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  const pct = Math.min(minutes / 90, 1), dash = pct * circ;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
        {pct > 0 && (
          <Circle cx={size/2} cy={size/2} r={r} stroke={LIME} strokeWidth={sw} fill="none"
            strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${size/2} ${size/2})`} />
        )}
      </Svg>
      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#ffffff" }}>
        {minutes > 0 ? `${minutes}m` : "—"}
      </Text>
    </View>
  );
}

function EmptyRing({ size = 52 }: { size?: number }) {
  const sw = 3, r = (size - sw) / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
      </Svg>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00"), now = new Date();
  const diff = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
export default function WorkoutsScreen() {
  const { palette }   = useTheme();
  const { card, cardBorder: border, text, muted, accent, accentText, bg } = palette;
  const router        = useRouter();
  const qc            = useQueryClient();

  // ── Modal state ──
  const [showNewRoutine,  setShowNewRoutine]  = useState(false);
  const [routineName,     setRoutineName]     = useState("");
  const [showPlateCalc,   setShowPlateCalc]   = useState(false);

  // Rename
  const [showRename,      setShowRename]      = useState(false);
  const [renameId,        setRenameId]        = useState<number | null>(null);
  const [renameName,      setRenameName]      = useState("");

  // Template action menu
  const [menuTemplateId,  setMenuTemplateId]  = useState<number | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);

  // Workout history delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // CSV import
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const handleCSVFile = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const csv = await file.text();
      const result = await apiRequest<{ imported: number; skipped: number; total: number }>(
        "POST", "/api/workouts/import-csv", { csv }, 120_000
      );
      setImportResult({ imported: result.imported, skipped: result.skipped });
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
    } catch (err: any) {
      setImportError(err?.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  }, [qc]);

  const handleImportCSV = useCallback(() => {
    if (Platform.OS === "web" && csvInputRef.current) {
      csvInputRef.current.value = "";
      csvInputRef.current.click();
    }
  }, []);

  // Share routine
  const [shareTemplateId, setShareTemplateId] = useState<number | null>(null);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);

  const { data: friends = [] } = useQuery<any[]>({
    queryKey: ["/api/friends"],
    queryFn: () => apiRequest("GET", "/api/friends"),
  });

  const shareRoutine = useMutation({
    mutationFn: ({ templateId, friendUserId }: { templateId: number; friendUserId: number }) =>
      apiRequest("POST", `/api/templates/${templateId}/share`, { friendUserId }, 15_000),
    onSuccess: (data: any) => {
      setShareTemplateId(null);
      const friendName = friends.find((f: any) => f.id === data.sharedTo)?.name ?? "friend";
      setShareSuccess(`Routine "${data.name}" shared with ${friendName}!`);
      setTimeout(() => setShareSuccess(null), 4000);
    },
    onError: (e: any) => {
      if (Platform.OS === "web") { alert(e?.message ?? "Could not share routine"); }
      else { Alert.alert("Share failed", e?.message ?? "Could not share routine"); }
    },
  });

  // AI Generate
  const [showAiModal,     setShowAiModal]     = useState(false);
  const [aiGoal,          setAiGoal]          = useState("Build Muscle");
  const [aiEquipment,     setAiEquipment]     = useState<"full_gym"|"dumbbells_cables"|"dumbbells_only"|"bodyweight">("full_gym");
  const [aiNotes,         setAiNotes]         = useState("");
  const [coachFeedback,   setCoachFeedback]   = useState<string[]>([]);
  const [pendingNavId,    setPendingNavId]     = useState<number | null>(null);

  // ── Data ──
  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/templates"],
    queryFn:  () => apiRequest("GET", "/api/templates"),
  });

  const { data: workouts = [] } = useQuery<any[]>({
    queryKey: ["/api/workouts"],
    queryFn:  () => apiRequest("GET", "/api/workouts?limit=30"),
  });

  const { data: activeRoutine } = useQuery<any | null>({
    queryKey: ["/api/routine/active"],
    queryFn:  () => apiRequest("GET", "/api/routine/active"),
  });

  const sevenDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10);
  }, []);
  const recentWorkouts  = useMemo(() => workouts.filter((w: any) => w.date >= sevenDaysAgo && w.completedAt), [workouts, sevenDaysAgo]);
  const sessionCount7d  = recentWorkouts.length;
  const totalMinutes7d  = recentWorkouts.reduce((s: number, w: any) => s + (w.durationMinutes ?? 0), 0);
  const totalHours7d    = totalMinutes7d > 0 ? `${Math.round((totalMinutes7d / 60) * 10) / 10}h total` : "";

  // ── Mutations ──
  const createTemplate = useMutation({
    mutationFn: () => apiRequest<any>("POST", "/api/templates", { name: routineName.trim() }),
    onSuccess:  () => { setShowNewRoutine(false); setRoutineName(""); qc.invalidateQueries({ queryKey: ["/api/templates"] }); },
    onError:    () => Alert.alert("Error", "Could not create routine."),
  });

  const renameTemplate = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/templates/${renameId}`, { name: renameName.trim() }),
    onSuccess:  () => { setShowRename(false); setRenameId(null); qc.invalidateQueries({ queryKey: ["/api/templates"] }); },
    onError:    () => Alert.alert("Error", "Could not rename routine."),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/templates/${id}`),
    onSuccess:  () => { setConfirmDeleteTemplateId(null); qc.invalidateQueries({ queryKey: ["/api/templates"] }); },
    onError:    () => { setConfirmDeleteTemplateId(null); Alert.alert("Error", "Could not delete routine."); },
  });

  const deleteWorkout = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/workouts/${id}`),
    onSuccess:  () => { setConfirmDeleteId(null); qc.invalidateQueries({ queryKey: ["/api/workouts"] }); },
    onError:    () => { setConfirmDeleteId(null); Alert.alert("Error", "Could not delete workout."); },
  });

  const aiGenerate = useMutation({
    mutationFn: () => apiRequest<any>("POST", "/api/routines/generate-ai", {
      goal: aiGoal, equipment: aiEquipment, notes: aiNotes.trim() || undefined,
    }),
    onSuccess: (data: any) => {
      setShowAiModal(false);
      setAiNotes("");
      qc.invalidateQueries({ queryKey: ["/api/templates"] });
      if (data?.coachFeedback?.length > 0) {
        // Show feedback card first, then let user tap to open the routine
        setCoachFeedback(data.coachFeedback);
        setPendingNavId(data.templateId ?? null);
      } else if (data?.templateId) {
        router.push({ pathname: "/routine/[templateId]", params: { templateId: String(data.templateId) } });
      }
    },
    onError: (err: any) => {
      Alert.alert("Generation Failed", err?.message ?? "Could not generate routine. Please try again.");
    },
  });

  const openRoutine = (template: any) =>
    router.push({ pathname: "/routine/[templateId]", params: { templateId: String(template.id) } });

  const openRename = (t: any) => {
    setMenuTemplateId(null);
    setRenameId(t.id);
    setRenameName(t.name);
    setShowRename(true);
  };

  const openDeleteTemplate = (id: number) => {
    setMenuTemplateId(null);
    setConfirmDeleteTemplateId(id);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 32, color: text }}>Train</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <Zap size={13} color={LIME} fill={LIME} />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: muted }}>
              {sessionCount7d} session{sessionCount7d !== 1 ? "s" : ""} last 7 days
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 14, marginBottom: 22 }}>
          <View style={{ flex: 1, backgroundColor: card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: border }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 0.8 }}>VOLUME · 7D</Text>
            <Text style={{ ...(DOT as any), fontSize: 30, color: text, marginTop: 6, lineHeight: 34 }}>—</Text>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.5, marginTop: 2 }}>K LBS</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "#ffffff", borderRadius: 18, padding: 16 }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: "#666666", letterSpacing: 0.8 }}>SESSIONS · 7D</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <Text style={{ ...(DOT as any), fontSize: 32, color: "#0a0a0a", lineHeight: 36 }}>{sessionCount7d}</Text>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: "#0a0a0a", letterSpacing: 0.5 }}>SESSIONS</Text>
            </View>
            {totalHours7d ? <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#666666", marginTop: 2 }}>{totalHours7d}</Text> : null}
          </View>
        </View>

        {/* Tools */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 22 }}>
          <Pressable
            onPress={() => setShowPlateCalc(true)}
            style={({ pressed }) => ({
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
              backgroundColor: card, borderRadius: 14, paddingVertical: 12,
              borderWidth: 1, borderColor: border, opacity: pressed ? 0.7 : 1,
            })}
          >
            <Calculator size={15} color={LIME} />
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Plate Calculator</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/badges")}
            style={({ pressed }) => ({
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
              backgroundColor: card, borderRadius: 14, paddingVertical: 12,
              borderWidth: 1, borderColor: border, opacity: pressed ? 0.7 : 1,
            })}
          >
            <Trophy size={15} color="#f8c86a" />
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>Trophy Case</Text>
          </Pressable>
        </View>

        {/* NEXT UP (active AI routine) */}
        {activeRoutine?.currentDay && (() => {
          const day = activeRoutine.currentDay;
          const isRest = day.type === "rest" || day.type === "active_recovery";
          const Inner = (
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 14,
              backgroundColor: isRest ? card : LIME, borderRadius: 18, padding: 16,
              borderWidth: isRest ? 1 : 0, borderColor: border,
            }}>
              <View style={{
                width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
                backgroundColor: isRest ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.1)",
              }}>
                {isRest ? <Moon size={20} color={muted} /> : <Dumbbell size={20} color="#1a1a1a" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, letterSpacing: 0.8, color: isRest ? muted : "#1a1a1a99" }}>
                  NEXT UP · {day.dayLabel?.toUpperCase()}
                </Text>
                <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: isRest ? text : "#1a1a1a", marginTop: 2 }}>
                  {isRest ? "Rest Day" : day.focus}
                </Text>
                {isRest && (
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 2 }}>
                    Recover up — this rolls to the next day automatically.
                  </Text>
                )}
              </View>
              {!isRest && <ChevronRight size={18} color="#1a1a1a" />}
            </View>
          );
          return (
            <View style={{ paddingHorizontal: 16, marginBottom: 22 }}>
              {isRest || day.templateId == null ? Inner : (
                <Pressable
                  onPress={() => router.push({ pathname: "/routine/[templateId]", params: { templateId: String(day.templateId) } })}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  {Inner}
                </Pressable>
              )}
            </View>
          );
        })()}

        {/* Share success banner */}
        {shareSuccess && (
          <View style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: LIME + "22", borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: LIME + "44" }}>
            <Check size={16} color={LIME} />
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: LIME, flex: 1 }}>{shareSuccess}</Text>
          </View>
        )}

        {/* MY ROUTINES */}
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8 }}>MY ROUTINES</Text>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              {/* AI Generate */}
              <Pressable
                onPress={() => setShowAiModal(true)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 5,
                  borderWidth: 1, borderColor: PURPLE, borderRadius: 18,
                  paddingHorizontal: 12, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                  backgroundColor: "#1a1a2e",
                })}
              >
                <Sparkles size={11} color={PURPLE} />
                <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: PURPLE }}>AI Generate</Text>
              </Pressable>
              {/* New Routine */}
              <Pressable
                onPress={() => { setRoutineName(""); setShowNewRoutine(true); }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
              >
                <Plus size={13} color={muted} />
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>New</Text>
              </Pressable>
            </View>
          </View>

          {/* ── Coach Feedback card (shows after AI generation) ── */}
          {coachFeedback.length > 0 && (
            <View style={{
              backgroundColor: "#1a1a2e", borderRadius: 18, padding: 16, marginBottom: 12,
              borderWidth: 1.5, borderColor: PURPLE,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Sparkles size={14} color={PURPLE} />
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: PURPLE }}>Coach Observations</Text>
                </View>
                <Pressable onPress={() => setCoachFeedback([])} hitSlop={8}>
                  <X size={16} color="#555" />
                </Pressable>
              </View>
              {coachFeedback.map((fb, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: i < coachFeedback.length - 1 ? 8 : 0 }}>
                  <Text style={{ fontSize: 13, color: PURPLE, marginTop: 1 }}>•</Text>
                  <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "#d4c4ff", flex: 1, lineHeight: 19 }}>{fb}</Text>
                </View>
              ))}
              {pendingNavId !== null && (
                <Pressable
                  onPress={() => {
                    const id = pendingNavId;
                    setPendingNavId(null);
                    setCoachFeedback([]);
                    router.push({ pathname: "/routine/[templateId]", params: { templateId: String(id) } });
                  }}
                  style={({ pressed }) => ({
                    marginTop: 14, backgroundColor: PURPLE, borderRadius: 12,
                    paddingVertical: 10, alignItems: "center",
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 13, color: "#fff" }}>
                    View New Routine →
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {templates.length === 0 ? (
            <View style={{ backgroundColor: card, borderRadius: 18, padding: 28, alignItems: "center", borderWidth: 1, borderColor: border, marginBottom: 20 }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: muted }}>No routines yet</Text>
              <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 4 }}>
                Tap AI Generate or New to get started
              </Text>
            </View>
          ) : (
            templates.map((t: any, i: number) => {
              const isConfirmingDelete = confirmDeleteTemplateId === t.id;
              const pct     = templates.length > 1 ? (i + 1) / templates.length : 1;
              const exCount = t.exercises?.length ?? t.exerciseCount ?? 0;
              const estMinutes = t.exercises ? estimateRoutineMinutes(t.exercises) : 0;
              if (isConfirmingDelete) {
                return (
                  <View key={t.id} style={{
                    backgroundColor: "#fee2e2", borderRadius: 18, marginBottom: 10,
                    flexDirection: "row", alignItems: "center",
                    borderWidth: 1, borderColor: "#fca5a5", overflow: "hidden",
                  }}>
                    <View style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 14 }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#dc2626" }}>Delete "{t.name}"?</Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#ef4444", marginTop: 2 }}>This cannot be undone.</Text>
                    </View>
                    <Pressable onPress={() => setConfirmDeleteTemplateId(null)}
                      style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 18, opacity: pressed ? 0.6 : 1 })}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#6b7280" }}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteTemplate.mutate(t.id)}
                      disabled={deleteTemplate.isPending}
                      style={({ pressed }) => ({
                        backgroundColor: "#dc2626", paddingHorizontal: 16, paddingVertical: 18,
                        opacity: pressed || deleteTemplate.isPending ? 0.7 : 1,
                      })}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>
                        {deleteTemplate.isPending ? "…" : "Delete"}
                      </Text>
                    </Pressable>
                  </View>
                );
              }
              return (
                <View key={t.id} style={{
                  backgroundColor: card, borderRadius: 18, marginBottom: 10,
                  flexDirection: "row", alignItems: "center",
                  borderWidth: 1, borderColor: border, overflow: "hidden",
                }}>
                  {/* Main tappable area */}
                  <Pressable
                    onPress={() => openRoutine(t)}
                    style={({ pressed }) => ({
                      flex: 1, flexDirection: "row", alignItems: "center", gap: 14, padding: 14,
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <View style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
                      <RoutineRing pct={pct} />
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 17, color: text }}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Manrope-Bold", fontSize: 15, color: text }}>{t.name}</Text>
                      {exCount > 0 && (
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted, marginTop: 1 }}>
                          {exCount} exercise{exCount !== 1 ? "s" : ""}
                          {estMinutes > 0 ? ` · ~${formatDuration(estMinutes)}` : ""}
                        </Text>
                      )}
                    </View>
                    <ChevronRight size={18} color={muted} />
                  </Pressable>
                  {/* ⋯ Menu button */}
                  <Pressable
                    onPress={() => setMenuTemplateId(t.id)}
                    hitSlop={8}
                    style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 18, opacity: pressed ? 0.5 : 1 })}
                  >
                    <MoreHorizontal size={18} color={muted} />
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        {/* HISTORY */}
        <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, letterSpacing: 0.8 }}>HISTORY</Text>
            <Pressable
              onPress={handleImportCSV}
              disabled={importing}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: pressed || importing ? 0.5 : 1 })}
            >
              {importing
                ? <ActivityIndicator size="small" color={muted} style={{ transform: [{ scale: 0.7 }] }} />
                : <Upload size={12} color={muted} />}
              <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted }}>
                {importing ? "Importing…" : "Import CSV"}
              </Text>
            </Pressable>
          </View>

          {importResult && (
            <View style={{ backgroundColor: LIME + "22", borderRadius: 12, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: LIME + "44" }}>
              <Check size={14} color={LIME} />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: LIME, flex: 1 }}>
                Imported {importResult.imported} workout{importResult.imported !== 1 ? "s" : ""}{importResult.skipped > 0 ? `, ${importResult.skipped} already existed` : ""}
              </Text>
              <Pressable onPress={() => setImportResult(null)}><X size={14} color={LIME} /></Pressable>
            </View>
          )}
          {importError && (
            <View style={{ backgroundColor: "#ef444422", borderRadius: 12, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#ef444444" }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#ef4444", flex: 1 }}>{importError}</Text>
              <Pressable onPress={() => setImportError(null)}><X size={14} color="#ef4444" /></Pressable>
            </View>
          )}

          {workouts.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontFamily: "Manrope", fontSize: 13, color: muted }}>No workouts logged yet</Text>
            </View>
          ) : (
            workouts.map((w: any) => {
              const isConfirming = confirmDeleteId === w.id;
              const isDeleting   = deleteWorkout.isPending && confirmDeleteId === w.id;
              return (
                <View key={w.id} style={{
                  backgroundColor: isConfirming ? "#fee2e2" : card,
                  borderRadius: 18, marginBottom: 8,
                  flexDirection: "row", alignItems: "center",
                  borderWidth: 1, borderColor: isConfirming ? "#fca5a5" : border,
                  overflow: "hidden",
                }}>
                  {isConfirming ? (
                    <>
                      <View style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 14 }}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#dc2626" }}>Delete "{w.name}"?</Text>
                        <Text style={{ fontFamily: "Manrope", fontSize: 12, color: "#ef4444", marginTop: 2 }}>This cannot be undone.</Text>
                      </View>
                      <Pressable onPress={() => setConfirmDeleteId(null)}
                        style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 18, opacity: pressed ? 0.6 : 1 })}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#6b7280" }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={() => deleteWorkout.mutate(w.id)} disabled={isDeleting}
                        style={({ pressed }) => ({
                          backgroundColor: "#dc2626", paddingHorizontal: 16, paddingVertical: 18,
                          opacity: pressed || isDeleting ? 0.7 : 1,
                        })}>
                        <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: "#fff" }}>{isDeleting ? "…" : "Delete"}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => router.push({ pathname: "/workout-detail/[workoutId]", params: { workoutId: String(w.id) } })}
                        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, opacity: pressed ? 0.75 : 1 })}
                      >
                        {w.durationMinutes ? <DurationDonut minutes={w.durationMinutes} /> : <EmptyRing />}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: text }}>{w.name.toUpperCase()}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                            <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>{formatDate(w.date)}</Text>
                            {w.durationMinutes ? (
                              <>
                                <Text style={{ color: muted }}>·</Text>
                                <Clock size={11} color={muted} />
                                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>{w.durationMinutes}m</Text>
                              </>
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                      <Pressable onPress={() => setConfirmDeleteId(w.id)} hitSlop={8}
                        style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 18, opacity: pressed ? 0.5 : 1 })}>
                        <Trash2 size={16} color={muted} />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* ── New Routine Modal ── */}
      <Modal visible={showNewRoutine} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg, padding: 24 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text }}>New Routine</Text>
            <Pressable onPress={() => setShowNewRoutine(false)}><X size={22} color={text} /></Pressable>
          </View>
          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 8 }}>ROUTINE NAME</Text>
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
              : <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: accentText }}>Create Routine</Text>
            }
          </Pressable>
        </View>
      </Modal>

      {/* ── Rename Routine Modal ── */}
      <Modal visible={showRename} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: bg, padding: 24 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 22, color: text }}>Rename Routine</Text>
            <Pressable onPress={() => setShowRename(false)}><X size={22} color={text} /></Pressable>
          </View>
          <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: muted, marginBottom: 8 }}>ROUTINE NAME</Text>
          <TextInput
            value={renameName}
            onChangeText={setRenameName}
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
            onPress={() => { if (renameName.trim()) renameTemplate.mutate(); }}
            disabled={renameTemplate.isPending || !renameName.trim()}
            style={({ pressed }) => ({
              backgroundColor: accent, borderRadius: 16, paddingVertical: 16, alignItems: "center",
              opacity: pressed || renameTemplate.isPending || !renameName.trim() ? 0.6 : 1,
            })}
          >
            {renameTemplate.isPending
              ? <ActivityIndicator color={accentText} />
              : <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 15, color: accentText }}>Save Name</Text>
            }
          </Pressable>
        </View>
      </Modal>

      {/* ── Routine Action Sheet (⋯ menu) ── */}
      <Modal visible={menuTemplateId !== null} transparent animationType="fade" onRequestClose={() => setMenuTemplateId(null)}>
        <Pressable onPress={() => setMenuTemplateId(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
        <View style={{
          backgroundColor: "#141414", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderWidth: 1, borderColor: "#2a2a2a", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40,
        }}>
          {/* Drag indicator */}
          <View style={{ width: 36, height: 4, backgroundColor: "#333", borderRadius: 2, alignSelf: "center", marginBottom: 18 }} />

          {/* Rename */}
          <Pressable
            onPress={() => {
              const t = templates.find((t: any) => t.id === menuTemplateId);
              if (t) openRename(t);
            }}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 14,
              paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1e1e1e",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Pencil size={20} color={text} />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 16, color: text }}>Rename Routine</Text>
          </Pressable>

          {/* Share */}
          <Pressable
            onPress={() => {
              setShareTemplateId(menuTemplateId);
              setMenuTemplateId(null);
            }}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 14,
              paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1e1e1e",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Share2 size={20} color={text} />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 16, color: text }}>Share with Friend</Text>
          </Pressable>

          {/* Delete */}
          <Pressable
            onPress={() => {
              if (menuTemplateId !== null) openDeleteTemplate(menuTemplateId);
            }}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 14,
              paddingVertical: 16,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Trash2 size={20} color="#ef4444" />
            <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 16, color: "#ef4444" }}>Delete Routine</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Share Friend Picker Modal ── */}
      <Modal visible={shareTemplateId !== null} transparent animationType="fade" onRequestClose={() => setShareTemplateId(null)}>
        <Pressable onPress={() => setShareTemplateId(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
        <View style={{
          backgroundColor: "#141414", borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderWidth: 1, borderColor: "#2a2a2a", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40,
        }}>
          <View style={{ width: 36, height: 4, backgroundColor: "#333", borderRadius: 2, alignSelf: "center", marginBottom: 18 }} />
          <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 18, color: "#f4f4f4", marginBottom: 16 }}>Share Routine</Text>
          {friends.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
              <Users size={28} color="#555" />
              <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "#888" }}>No friends to share with yet</Text>
            </View>
          ) : (
            friends.map((f: any) => (
              <Pressable
                key={f.id}
                onPress={() => {
                  if (shareTemplateId && f.id) shareRoutine.mutate({ templateId: shareTemplateId, friendUserId: f.id });
                }}
                disabled={shareRoutine.isPending}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1e1e1e",
                  opacity: pressed || shareRoutine.isPending ? 0.6 : 1,
                })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: (f.color ?? LIME) + "22", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 14, color: f.color ?? LIME }}>
                    {(f.initials ?? f.name?.[0] ?? "?").toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 15, color: "#f4f4f4" }}>{f.name ?? "Friend"}</Text>
                </View>
                {shareRoutine.isPending ? (
                  <ActivityIndicator size="small" color={LIME} />
                ) : (
                  <Share2 size={16} color={LIME} />
                )}
              </Pressable>
            ))
          )}
        </View>
      </Modal>

      {/* Importing overlay */}
      {importing && (
        <View style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.7)", zIndex: 100,
          alignItems: "center", justifyContent: "center",
        }}>
          <View style={{ backgroundColor: "#1a1a1a", borderRadius: 20, padding: 32, alignItems: "center", gap: 16 }}>
            <ActivityIndicator size="large" color={LIME} />
            <Text style={{ fontFamily: "Manrope-Bold", fontSize: 16, color: "#ffffff" }}>Importing workouts…</Text>
            <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "#888" }}>This may take a minute for large files</Text>
          </View>
        </View>
      )}

      {/* Hidden CSV file input (web only) */}
      {Platform.OS === "web" && (
        <input
          ref={csvInputRef as any}
          type="file"
          accept=".csv"
          style={{ display: "none" } as any}
          onChange={(e: any) => {
            const file = e.target?.files?.[0];
            if (file) handleCSVFile(file);
          }}
        />
      )}

      {/* ── AI Generate Modal ── */}
      <Modal visible={showAiModal} transparent animationType="slide" onRequestClose={() => setShowAiModal(false)}>
        <Pressable onPress={() => !aiGenerate.isPending && setShowAiModal(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)" }} />
        <View style={{
          backgroundColor: "#141414", borderTopLeftRadius: 28, borderTopRightRadius: 28,
          borderWidth: 1, borderColor: "#2a2a2a",
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 44,
        }}>
          {/* Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Sparkles size={18} color={PURPLE} />
              <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 20, color: "#f4f4f4" }}>AI Routine Generator</Text>
            </View>
            {!aiGenerate.isPending && (
              <Pressable onPress={() => setShowAiModal(false)} hitSlop={8}>
                <X size={22} color="#666" />
              </Pressable>
            )}
          </View>
          <Text style={{ fontFamily: "Manrope", fontSize: 13, color: "#888", marginBottom: 20 }}>
            Describe your goal and available equipment — Claude will build a personalized routine and save it automatically.
          </Text>

          {/* Goal */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 10 }}>
            TRAINING GOAL
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {["Build Muscle", "Lose Fat", "Full Body", "Strength", "Upper Body", "Lower Body", "Cardio"].map(goal => {
              const sel = aiGoal === goal;
              return (
                <Pressable key={goal} onPress={() => setAiGoal(goal)}
                  style={({ pressed }) => ({
                    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
                    backgroundColor: sel ? "#1a1a2e" : "#1e1e1e",
                    borderWidth: 1.5, borderColor: sel ? PURPLE : "#2a2a2a",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: sel ? PURPLE : "#f4f4f4" }}>{goal}</Text>
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
              { key: "full_gym",         label: "Full Gym",             sub: "Barbells, cables, machines" },
              { key: "dumbbells_cables", label: "Dumbbells + Cables",   sub: "No barbell"                },
              { key: "dumbbells_only",   label: "Dumbbells Only",       sub: "Home gym"                  },
              { key: "bodyweight",       label: "Bodyweight Only",      sub: "No weights"                },
            ] as const).map(opt => {
              const sel = aiEquipment === opt.key;
              return (
                <Pressable key={opt.key} onPress={() => setAiEquipment(opt.key)}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 12,
                    borderRadius: 14, padding: 13,
                    backgroundColor: sel ? "#1a1a2e" : "#1e1e1e",
                    borderWidth: 1.5, borderColor: sel ? PURPLE : "#2a2a2a",
                    opacity: pressed ? 0.8 : 1,
                  })}>
                  <View style={{
                    width: 18, height: 18, borderRadius: 9,
                    borderWidth: 2, borderColor: sel ? PURPLE : "#555",
                    backgroundColor: sel ? PURPLE : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {sel && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#141414" }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: sel ? PURPLE : "#f4f4f4" }}>{opt.label}</Text>
                    <Text style={{ fontFamily: "Manrope", fontSize: 11, color: "#666", marginTop: 1 }}>{opt.sub}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Optional notes */}
          <Text style={{ fontFamily: "Manrope-Bold", fontSize: 12, color: "#aaa", letterSpacing: 0.6, marginBottom: 8 }}>
            NOTES <Text style={{ fontFamily: "Manrope", color: "#555" }}>(optional)</Text>
          </Text>
          <TextInput
            value={aiNotes}
            onChangeText={setAiNotes}
            placeholder="e.g. focus on hypertrophy, no leg press, keep it under 45 min…"
            placeholderTextColor="#444"
            multiline
            editable={!aiGenerate.isPending}
            style={{
              backgroundColor: "#1e1e1e", borderRadius: 14, padding: 13,
              fontFamily: "Manrope", fontSize: 13, color: "#f4f4f4",
              borderWidth: 1, borderColor: "#2a2a2a",
              minHeight: 52, textAlignVertical: "top", marginBottom: 20,
            }}
          />

          {/* Generate button */}
          <Pressable
            onPress={() => aiGenerate.mutate()}
            disabled={aiGenerate.isPending}
            style={({ pressed }) => ({
              backgroundColor: PURPLE, borderRadius: 16, paddingVertical: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: pressed || aiGenerate.isPending ? 0.7 : 1,
            })}
          >
            {aiGenerate.isPending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Sparkles size={18} color="#fff" />}
            <Text style={{ fontFamily: "Manrope-ExtraBold", fontSize: 16, color: "#fff" }}>
              {aiGenerate.isPending ? "Generating routine…" : "Generate Routine"}
            </Text>
          </Pressable>
        </View>
      </Modal>

      <PlateCalculator visible={showPlateCalc} onClose={() => setShowPlateCalc(false)} />

    </SafeAreaView>
  );
}
