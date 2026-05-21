import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, Plus, Trash2, Dumbbell, TrendingDown, TrendingUp, Activity } from "lucide-react";
import { formatWeight, gramsToLbs, lbsToGrams, daysUntil, pct } from "@/lib/utils";
import type { Goal, BodyMeasurement, NutritionTarget } from "@shared/schema";

const GOAL_TYPES = [
  { value: "weight_loss", label: "Lose Weight", icon: TrendingDown, color: "text-blue-400" },
  { value: "weight_gain", label: "Gain Weight", icon: TrendingUp, color: "text-green-400" },
  { value: "strength", label: "Strength Goal", icon: Dumbbell, color: "text-yellow-400" },
  { value: "body_comp", label: "Body Composition", icon: Activity, color: "text-purple-400" },
];

export default function Goals() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: "weight_loss",
    label: "",
    targetValue: "",
    unit: "lbs",
    deadline: "",
    notes: "",
  });

  const { data: goals = [] } = useQuery<Goal[]>({ queryKey: ["/api/goals"] });
  const { data: measurements = [] } = useQuery<BodyMeasurement[]>({ queryKey: ["/api/measurements"] });
  const { data: targets } = useQuery<NutritionTarget | null>({ queryKey: ["/api/targets"] });

  const latestWeight = measurements[0];

  const createGoal = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/goals", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/goals"] }); qc.invalidateQueries({ queryKey: ["/api/targets"] }); setShowForm(false); resetForm(); },
  });

  const toggleGoal = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => apiRequest("PATCH", `/api/goals/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/goals"] }),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/goals"] }); qc.invalidateQueries({ queryKey: ["/api/targets"] }); },
  });

  function resetForm() {
    setForm({ type: "weight_loss", label: "", targetValue: "", unit: "lbs", deadline: "", notes: "" });
  }

  function handleSubmit() {
    const isWeightGoal = form.type === "weight_loss" || form.type === "weight_gain";
    const targetValue = isWeightGoal ? lbsToGrams(parseFloat(form.targetValue)) : parseFloat(form.targetValue) * 453.592; // lbs to grams for lifts too

    createGoal.mutate({
      type: form.type,
      label: form.label || getDefaultLabel(form.type, form.targetValue),
      targetValue,
      unit: form.unit,
      deadline: form.deadline || null,
      startValue: latestWeight?.weightGrams,
      startDate: new Date().toISOString().slice(0, 10),
      notes: form.notes || null,
    });
  }

  const activeGoals = goals.filter(g => g.isActive);
  const inactiveGoals = goals.filter(g => !g.isActive);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm text-muted-foreground">Set targets and track your progress</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Goal
        </Button>
      </div>

      {/* Nutrition targets summary */}
      {targets && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Daily Targets (Auto-calculated)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <TargetStat label="Calories" value={Math.round(targets.calories)} unit="kcal" />
              <TargetStat label="Protein" value={Math.round(targets.proteinG)} unit="g" />
              <TargetStat label="Carbs" value={Math.round(targets.carbsG)} unit="g" />
              <TargetStat label="Fat" value={Math.round(targets.fatG)} unit="g" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">Targets update automatically when you log a new weight or change your goals.</p>
          </CardContent>
        </Card>
      )}

      {/* Active goals */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Goals</h2>
        {activeGoals.length === 0 ? (
          <Card className="border-dashed border-muted-foreground/30">
            <CardContent className="py-10 text-center text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No active goals. Add one to get started!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeGoals.map(goal => (
              <GoalCard key={goal.id} goal={goal} latestWeight={latestWeight} onToggle={id => toggleGoal.mutate({ id, isActive: false })} onDelete={id => deleteGoal.mutate(id)} />
            ))}
          </div>
        )}
      </div>

      {/* Completed goals */}
      {inactiveGoals.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Completed / Paused</h2>
          <div className="space-y-2">
            {inactiveGoals.map(goal => (
              <GoalCard key={goal.id} goal={goal} latestWeight={latestWeight} onToggle={id => toggleGoal.mutate({ id, isActive: true })} onDelete={id => deleteGoal.mutate(id)} compact />
            ))}
          </div>
        </div>
      )}

      {/* New goal dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Goal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Goal type picker */}
            <div>
              <Label>Goal Type</Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {GOAL_TYPES.map(gt => (
                  <button key={gt.value}
                    onClick={() => { setForm(f => ({ ...f, type: gt.value, unit: gt.value === "strength" ? "lbs" : "lbs" })); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm transition-all ${form.type === gt.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                    <gt.icon className={`w-4 h-4 ${gt.color}`} />
                    {gt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Label <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input className="mt-1" placeholder={getDefaultLabel(form.type, form.targetValue)} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target {form.type === "strength" ? "Weight (lbs)" : "Weight (lbs)"}</Label>
                <Input type="number" className="mt-1" placeholder={form.type === "strength" ? "225" : "175"} value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} />
              </div>
              <div>
                <Label>Target Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="date" className="mt-1" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} min={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>

            {latestWeight && (form.type === "weight_loss" || form.type === "weight_gain") && (
              <div className="bg-accent/40 rounded-lg p-3 text-sm">
                <div className="text-muted-foreground">Current weight: <span className="text-foreground font-medium">{formatWeight(latestWeight.weightGrams)}</span></div>
                {form.targetValue && form.deadline && (
                  <div className="text-muted-foreground mt-1">
                    {(() => {
                      const days = daysUntil(form.deadline);
                      const diff = Math.abs(gramsToLbs(latestWeight.weightGrams) - parseFloat(form.targetValue));
                      const rate = days > 0 ? (diff / days * 7).toFixed(1) : "?";
                      return `Rate needed: ~${rate} lbs/week`;
                    })()}
                  </div>
                )}
              </div>
            )}

            <Button className="w-full" onClick={handleSubmit} disabled={!form.targetValue || createGoal.isPending}>
              Create Goal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GoalCard({ goal, latestWeight, onToggle, onDelete, compact = false }: {
  goal: Goal; latestWeight?: BodyMeasurement;
  onToggle: (id: number) => void; onDelete: (id: number) => void; compact?: boolean;
}) {
  const gtDef = GOAL_TYPES.find(t => t.value === goal.type);
  const isWeightGoal = goal.type === "weight_loss" || goal.type === "weight_gain";
  const daysLeft = goal.deadline ? daysUntil(goal.deadline) : null;

  let progressPct = 0;
  if (isWeightGoal && latestWeight && goal.startValue) {
    const total = Math.abs(goal.targetValue - goal.startValue);
    const done = Math.abs(latestWeight.weightGrams - goal.startValue);
    progressPct = total > 0 ? Math.min(Math.round((done / total) * 100), 100) : 0;
  }

  return (
    <Card className={`${goal.isActive ? "border-border" : "opacity-60"}`}>
      <CardContent className={compact ? "py-3 px-4" : "p-5"}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {gtDef && <gtDef.icon className={`w-5 h-5 flex-shrink-0 ${gtDef.color}`} />}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{goal.label}</div>
              {!compact && (
                <div className="text-sm text-muted-foreground">
                  Target: {isWeightGoal ? formatWeight(goal.targetValue) : `${gramsToLbs(goal.targetValue).toFixed(1)} lbs`}
                  {goal.startValue && isWeightGoal && ` (from ${formatWeight(goal.startValue)})`}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {daysLeft !== null && (
              <Badge variant={daysLeft < 14 ? "destructive" : "secondary"} className="text-xs">
                {daysLeft > 0 ? `${daysLeft}d left` : "Due"}
              </Badge>
            )}
            <button onClick={() => onToggle(goal.id)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:border-foreground/30 transition-colors">
              {goal.isActive ? "Pause" : "Resume"}
            </button>
            <button onClick={() => onDelete(goal.id)} className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!compact && isWeightGoal && latestWeight && (
          <div className="mt-3 space-y-1">
            <Progress value={progressPct} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Start: {goal.startValue ? formatWeight(goal.startValue) : "—"}</span>
              <span>{progressPct}% complete</span>
              <span>Goal: {formatWeight(goal.targetValue)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TargetStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{unit}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function getDefaultLabel(type: string, targetValue: string) {
  switch (type) {
    case "weight_loss": return targetValue ? `Lose weight to ${targetValue} lbs` : "Weight Loss Goal";
    case "weight_gain": return targetValue ? `Gain weight to ${targetValue} lbs` : "Weight Gain Goal";
    case "strength": return targetValue ? `Lift ${targetValue} lbs` : "Strength Goal";
    default: return "Body Composition Goal";
  }
}
