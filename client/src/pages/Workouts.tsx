import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Check, X, Clock, Dumbbell, Sparkles, Play, Zap, Upload, PlayCircle } from "lucide-react";
import { todayStr, gramsToLbs, lbsToGrams } from "@/lib/utils";
import { CircleRing } from "@/components/CircleRing";
import { ExercisePicker } from "@/components/ExercisePicker";
import { AIRoutineDialog } from "@/components/AIRoutineDialog";
import type { Workout, Exercise, WorkoutTemplate } from "@shared/schema";
import { useTheme } from "@/hooks/use-theme";

interface ActiveSet { exerciseId: number; sets: { reps: string; weight: string; done: boolean }[] }

function formatDate(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Workouts() {
  const qc = useQueryClient();
  const { paletteId, palettes } = useTheme();
  const isWhitePalette = (palettes.find(p => p.id === paletteId) ?? palettes[0]).accent === "#ffffff";
  const sessionsCardBg   = isWhitePalette ? "#ffffff" : "var(--lime)";
  const sessionsCardText = isWhitePalette ? "#0a0a0a" : "#0a0a0a";
  const [activeWorkoutId, setActiveWorkoutId] = useState<number | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [showNewRoutineDialog, setShowNewRoutineDialog] = useState(false);
  const [newRoutineName, setNewRoutineName] = useState("");
  const [workoutName, setWorkoutName] = useState("New Workout");
  const [liveSets, setLiveSets] = useState<ActiveSet[]>([]);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const { data: workouts = [] } = useQuery<Workout[]>({ queryKey: ["/api/workouts"] });
  const { data: exercises = [] } = useQuery<Exercise[]>({ queryKey: ["/api/exercises"] });
  const { data: templates = [], refetch: refetchTemplates } = useQuery<(WorkoutTemplate & { exercises: any[] })[]>({
    queryKey: ["/api/templates"],
  });

  const createWorkout = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/workouts", data),
    onSuccess: (w) => { setActiveWorkoutId(w.id); setStartTime(new Date()); },
  });

  const createTemplate = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/templates", { name }),
    onSuccess: () => { refetchTemplates(); setShowNewRoutineDialog(false); setNewRoutineName(""); },
  });

  const finishWorkout = useMutation({
    mutationFn: async () => {
      if (!activeWorkoutId || !startTime) return;
      const duration = Math.round((Date.now() - startTime.getTime()) / 60000);
      await apiRequest("PATCH", `/api/workouts/${activeWorkoutId}`, { completedAt: new Date().toISOString(), durationMinutes: duration });
      for (const ex of liveSets) {
        for (let i = 0; i < ex.sets.length; i++) {
          const s = ex.sets[i];
          if (!s.done) continue;
          await apiRequest("POST", `/api/workouts/${activeWorkoutId}/sets`, {
            exerciseId: ex.exerciseId,
            setNumber: i + 1,
            reps: parseInt(s.reps) || 0,
            weightGrams: lbsToGrams(parseFloat(s.weight) || 0),
            isWarmup: false,
          });
        }
      }
    },
    onSuccess: () => { setActiveWorkoutId(null); setLiveSets([]); qc.invalidateQueries({ queryKey: ["/api/workouts"] }); },
  });

  const importCSV = useMutation({
    mutationFn: (csv: string) => apiRequest("POST", "/api/workouts/import-csv", { csv }),
    onSuccess: (result) => {
      setImportResult(result);
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
    },
  });

  function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csv = ev.target?.result as string;
      if (csv) importCSV.mutate(csv);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function startFromTemplate(t: WorkoutTemplate & { exercises: any[] }) {
    setWorkoutName(t.name);
    setLiveSets(t.exercises.map((te: any) => ({
      exerciseId: te.exerciseId,
      sets: Array.from({ length: te.targetSets || 3 }, () => ({
        reps: te.targetReps?.split("-")[0] || "8",
        weight: gramsToLbs(te.targetWeightGrams ?? 0).toString(),
        done: false,
      })),
    })));
    createWorkout.mutate({ name: t.name, date: todayStr(), templateId: t.id });
  }

  function startEmptyWorkout() {
    setWorkoutName("New Workout");
    setLiveSets([]);
    createWorkout.mutate({ name: "New Workout", date: todayStr() });
  }

  function addExercise(exercise: Exercise) {
    setLiveSets(prev => [...prev, { exerciseId: exercise.id, sets: [{ reps: "8", weight: "45", done: false }] }]);
    setShowExercisePicker(false);
  }

  function addSet(exIdx: number) {
    setLiveSets(prev => prev.map((ex, i) =>
      i === exIdx ? { ...ex, sets: [...ex.sets, { ...ex.sets[ex.sets.length - 1], done: false }] } : ex
    ));
  }

  function removeExercise(exIdx: number) {
    setLiveSets(prev => prev.filter((_, i) => i !== exIdx));
  }

  function toggleSet(exIdx: number, setIdx: number) {
    setLiveSets(prev => prev.map((ex, i) =>
      i === exIdx ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, done: !s.done } : s) } : ex
    ));
  }

  function updateSet(exIdx: number, setIdx: number, field: "reps" | "weight", value: string) {
    setLiveSets(prev => prev.map((ex, i) =>
      i === exIdx ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, [field]: value } : s) } : ex
    ));
  }

  async function handleAISave(routine: { name: string; exercises: { name: string; sets: number; reps: string; muscle: string }[] }) {
    // Create template
    const tmpl = await apiRequest("POST", "/api/templates", { name: routine.name });
    // Add exercises by matching names
    for (let i = 0; i < routine.exercises.length; i++) {
      const re = routine.exercises[i];
      // Find closest exercise by name (case-insensitive)
      const match = exercises.find(e => e.name.toLowerCase() === re.name.toLowerCase()) ||
        exercises.find(e => e.name.toLowerCase().includes(re.name.toLowerCase().split(" ")[0]));
      if (match) {
        await apiRequest("POST", `/api/templates/${tmpl.id}/exercises`, {
          exerciseId: match.id,
          orderIndex: i,
          targetSets: re.sets,
          targetReps: re.reps,
        });
      }
    }
    qc.invalidateQueries({ queryKey: ["/api/templates"] });
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentWorkouts = workouts.filter(w => new Date(w.date + "T00:00:00") >= sevenDaysAgo);

  return (
    <div className="px-4 pt-6 pb-28 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Train</h1>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
            <Zap className="w-3.5 h-3.5" style={{ color: "var(--lime)" }} />
            <span>{recentWorkouts.length} sessions last 7 days</span>
          </div>
        </div>
        {activeWorkoutId && (
          <Button
            size="sm"
            onClick={() => finishWorkout.mutate()}
            disabled={finishWorkout.isPending}
            style={{ background: "var(--lime)", color: "#0a0a0a", borderRadius: 20, fontWeight: 700, border: "none" }}
          >
            <Check className="w-4 h-4 mr-1" /> Finish
          </Button>
        )}
      </div>

      {/* ── Stats row: Volume + Time ── */}
      {!activeWorkoutId && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Volume — dark card, pink number */}
          <div style={{ background: "hsl(var(--card))", borderRadius: 24, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}>VOLUME · 7D</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
              <span className="dot" style={{ fontSize: 28, color: "var(--pink)", lineHeight: 1 }}>
                {Math.round(workouts.slice(0, 7).reduce((a, w) => a, 0) / 1000 * 10) / 10 || "--"}
              </span>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontWeight: 700 }}>K LBS</span>
            </div>
          </div>
          {/* Sessions — lime or white depending on theme */}
          <div style={{ background: sessionsCardBg, borderRadius: 24, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: sessionsCardText, opacity: 0.65 }}>SESSIONS · 7D</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
              <span className="dot" style={{ fontSize: 28, color: sessionsCardText, lineHeight: 1 }}>{recentWorkouts.length}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: sessionsCardText, opacity: 0.6 }}>SESSIONS</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, color: sessionsCardText, opacity: 0.55, marginTop: 6 }}>
              {Math.round(recentWorkouts.reduce((a, w) => a + (w.durationMinutes ?? 0), 0) / 60 * 10) / 10}h total
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* Active workout logger                                                    */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeWorkoutId && (
        <div className="bg-card rounded-3xl p-4 space-y-4 border border-primary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-semibold">{workoutName}</span>
            </div>
            {startTime && <Timer startTime={startTime} />}
          </div>

          {liveSets.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Add exercises to get started
            </div>
          ) : (
            liveSets.map((ex, exIdx) => {
              const exercise = exercises.find(e => e.id === ex.exerciseId);
              return (
                <div key={exIdx} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CircleRing number={exIdx + 1} size={36} strokeWidth={3} />
                      <div>
                        <div className="font-medium text-sm">{exercise?.name ?? "Exercise"}</div>
                        {exercise?.primaryMuscle && (
                          <div className="text-xs text-muted-foreground capitalize">{exercise.primaryMuscle}</div>
                        )}
                      </div>
                    </div>
                    <button onClick={() => removeExercise(exIdx)} className="text-muted-foreground hover:text-destructive p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <ExerciseGif exerciseId={ex.exerciseId} />

                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 text-xs text-muted-foreground px-1">
                      <span>#</span><span>Weight (lbs)</span><span>Reps</span><span></span>
                    </div>
                    {ex.sets.map((set, setIdx) => (
                      <div key={setIdx}
                        className={`grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 items-center px-1 py-1 rounded-xl transition-colors ${set.done ? "bg-primary/10" : ""}`}>
                        <span className="text-xs text-muted-foreground text-center">{setIdx + 1}</span>
                        <Input
                          type="number"
                          value={set.weight}
                          onChange={e => updateSet(exIdx, setIdx, "weight", e.target.value)}
                          className="h-8 text-sm"
                        />
                        <Input
                          type="number"
                          value={set.reps}
                          onChange={e => updateSet(exIdx, setIdx, "reps", e.target.value)}
                          className="h-8 text-sm"
                        />
                        <button
                          onClick={() => toggleSet(exIdx, setIdx)}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center border-2 transition-colors ${
                            set.done ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                          }`}
                        >
                          {set.done && <Check className="w-3 h-3" />}
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => addSet(exIdx)}
                    className="text-xs text-muted-foreground flex items-center gap-1 pl-1 hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add set
                  </button>
                </div>
              );
            })
          )}

          <button
            onClick={() => setShowExercisePicker(true)}
            className="w-full py-2.5 rounded-2xl border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Exercise
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* Section A — My Routines                                                  */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {!activeWorkoutId && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">My Routines</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-1.5 text-xs h-7 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => setShowAIDialog(true)}
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Generate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-1 text-xs h-7"
                onClick={() => setShowNewRoutineDialog(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                New Routine
              </Button>
            </div>
          </div>

          {templates.length === 0 ? (
            <div className="bg-card rounded-3xl p-8 text-center">
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <div className="font-semibold text-sm">No routines yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                Create a routine or let AI generate one for you
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((t, idx) => {
                const muscles = [...new Set(
                  t.exercises.map((te: any) => te.exercise?.primaryMuscle).filter(Boolean)
                )];
                return (
                  <div
                    key={t.id}
                    className="bg-card rounded-3xl p-4 flex items-center gap-4"
                  >
                    <CircleRing
                      number={idx + 1}
                      size={56}
                      strokeWidth={4}
                      progress={(idx + 1) / Math.max(templates.length, 1)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-base leading-tight">{t.name}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {t.exercises.length} exercises
                        {muscles.length > 0 && (
                          <span className="capitalize"> · {muscles.slice(0, 2).join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => startFromTemplate(t)}
                      disabled={createWorkout.isPending}
                      style={{ background: "var(--pink)", color: "#0a0a0a", border: "none", borderRadius: 18, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                      className="active:scale-95 transition-all disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Start
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Hidden CSV input */}
      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVFile} />

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* Section B — History                                                       */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {(workouts.length > 0 || !activeWorkoutId) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">History</h2>
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importCSV.isPending}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {importCSV.isPending ? "Importing…" : "Import CSV"}
            </button>
          </div>

          {importResult && (
            <div className="rounded-2xl px-4 py-3 text-sm flex items-center justify-between"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <span>Imported <strong>{importResult.imported}</strong> sessions{importResult.skipped > 0 ? `, ${importResult.skipped} already existed` : ""}</span>
              <button onClick={() => setImportResult(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {workouts.length === 0 ? (
            <div className="bg-card rounded-3xl p-8 text-center">
              <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <div className="font-semibold text-sm">No sessions yet</div>
              <div className="text-xs text-muted-foreground mt-1">Hit the + button to start your first workout, or import a Hevy CSV above</div>
            </div>
          ) : (
            <div className="space-y-2">
              {workouts.slice(0, 10).map((w) => (
                <div key={w.id} className="bg-card rounded-3xl p-4 flex items-center gap-4">
                  <CircleRing
                    number={w.durationMinutes ? `${w.durationMinutes}m` : undefined}
                    size={52}
                    strokeWidth={4}
                    progress={Math.min((w.durationMinutes ?? 0) / 90, 1)}
                    color="hsl(var(--chart-2))"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{w.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span>{formatDate(w.date)}</span>
                      {w.durationMinutes && (
                        <>
                          <span>·</span>
                          <Clock className="w-3 h-3" />
                          <span>{w.durationMinutes}m</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* FAB                                                                       */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {!activeWorkoutId && (
        <button
          onClick={startEmptyWorkout}
          disabled={createWorkout.isPending}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full flex items-center justify-center active:scale-95 transition-all z-50 disabled:opacity-60"
          style={{ background: "var(--pink)", color: "#0a0a0a", border: "none", boxShadow: "0 8px 32px rgba(248,200,220,0.35)" }}
          aria-label="Quick-start empty workout"
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* Dialogs                                                                   */}
      {/* ──────────────────────────────────────────────────────────────────────── */}

      {/* New routine dialog */}
      <Dialog open={showNewRoutineDialog} onOpenChange={setShowNewRoutineDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Routine</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Routine name (e.g. Push Day)"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newRoutineName.trim()) createTemplate.mutate(newRoutineName.trim()); }}
            />
            <Button
              className="w-full"
              disabled={!newRoutineName.trim() || createTemplate.isPending}
              onClick={() => createTemplate.mutate(newRoutineName.trim())}
            >
              Create Routine
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI routine dialog */}
      <AIRoutineDialog
        open={showAIDialog}
        onClose={() => setShowAIDialog(false)}
        onSave={handleAISave}
      />

      {/* Exercise picker (during active workout) */}
      <ExercisePicker
        open={showExercisePicker}
        onClose={() => setShowExercisePicker(false)}
        onSelect={addExercise}
      />
    </div>
  );
}

/* ── ExerciseGif ─────────────────────────────────────────────────────────── */
/**
 * Shows a 2-frame animation (start/end position) sourced from
 * https://github.com/yuhonas/free-exercise-db — no API key required.
 * The server matches the exercise name and returns a base image URL;
 * we append /0.jpg and /1.jpg and alternate between them.
 */
function ExerciseGif({ exerciseId }: { exerciseId: number }) {
  const [open, setOpen]   = useState(false);
  const [frame, setFrame] = useState(0);

  const { data, isFetching } = useQuery<{ gifUrl: string | null }>({
    queryKey: [`/api/exercises/${exerciseId}/gif`],
    queryFn: () => apiRequest("GET", `/api/exercises/${exerciseId}/gif`),
    enabled: open,
    staleTime: Infinity,
  });

  // Animate between frame 0 and frame 1 at ~1.5 fps
  useEffect(() => {
    if (!open || !data?.gifUrl) return;
    const id = setInterval(() => setFrame(f => 1 - f), 650);
    return () => clearInterval(id);
  }, [open, data?.gifUrl]);

  const frameUrl = data?.gifUrl ? `${data.gifUrl}/${frame}.jpg` : null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 11, fontWeight: 700,
          color: open ? "var(--pink)" : "hsl(var(--muted-foreground))",
          background: "none", border: "none", cursor: "pointer", padding: 0,
          letterSpacing: "0.04em",
        }}
      >
        <PlayCircle style={{ width: 13, height: 13 }} />
        {open ? "HIDE FORM" : "SHOW FORM"}
      </button>

      {open && (
        <div style={{
          marginTop: 8, borderRadius: 16, overflow: "hidden",
          background: "hsl(var(--secondary))",
          minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}>
          {isFetching ? (
            <div style={{ padding: 24, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
              Loading…
            </div>
          ) : frameUrl ? (
            <>
              {/* Preload both frames so the swap is instant */}
              <link rel="prefetch" href={`${data!.gifUrl}/0.jpg`} />
              <link rel="prefetch" href={`${data!.gifUrl}/1.jpg`} />
              <img
                key={frame}
                src={frameUrl}
                alt="Exercise demonstration"
                style={{
                  width: "100%", maxHeight: 220,
                  objectFit: "contain", display: "block",
                }}
              />
            </>
          ) : (
            <div style={{ padding: 24, color: "hsl(var(--muted-foreground))", fontSize: 12, textAlign: "center" }}>
              No demo available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Timer({ startTime }: { startTime: Date }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Clock className="w-3.5 h-3.5" />
      <span className="font-mono">{m}:{s.toString().padStart(2, "0")}</span>
    </div>
  );
}
