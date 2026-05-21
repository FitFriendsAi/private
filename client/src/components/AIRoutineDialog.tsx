import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sparkles, Loader2, Check, Save } from "lucide-react";

const EQUIPMENT_OPTIONS = [
  "Barbell",
  "Dumbbell",
  "Cable Machine",
  "Smith Machine",
  "Bodyweight",
  "Resistance Bands",
];

interface AIGeneratedExercise {
  name: string;
  sets: number;
  reps: string;
  muscle: string;
}

interface AIGeneratedRoutine {
  name: string;
  exercises: AIGeneratedExercise[];
}

interface AIRoutineDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (routine: AIGeneratedRoutine) => void;
}

export function AIRoutineDialog({ open, onClose, onSave }: AIRoutineDialogProps) {
  const [goal, setGoal] = useState("Build Muscle");
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [equipment, setEquipment] = useState<string[]>(["Barbell", "Dumbbell"]);
  const [notes, setNotes] = useState("");
  const [generated, setGenerated] = useState<AIGeneratedRoutine | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/routines/generate-ai", {
        goal,
        daysPerWeek,
        equipment,
        notes: notes || undefined,
      }),
    onSuccess: (data: AIGeneratedRoutine) => setGenerated(data),
  });

  function toggleEquipment(item: string) {
    setEquipment((prev) =>
      prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item]
    );
  }

  function handleSave() {
    if (generated) {
      onSave(generated);
      setGenerated(null);
      onClose();
    }
  }

  function handleClose() {
    setGenerated(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Generate Routine
          </DialogTitle>
        </DialogHeader>

        {!generated ? (
          <div className="space-y-4">
            {/* Goal */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Goal</label>
              <Select value={goal} onValueChange={setGoal}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Build Muscle">Build Muscle</SelectItem>
                  <SelectItem value="Lose Fat">Lose Fat</SelectItem>
                  <SelectItem value="Get Stronger">Get Stronger</SelectItem>
                  <SelectItem value="General Fitness">General Fitness</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Days per week */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Days per week
              </label>
              <Input
                type="number"
                min={1}
                max={6}
                value={daysPerWeek}
                onChange={(e) => setDaysPerWeek(Math.min(6, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-24"
              />
            </div>

            {/* Equipment */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Available equipment
              </label>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map((item) => {
                  const selected = equipment.includes(item);
                  return (
                    <button
                      key={item}
                      onClick={() => toggleEquipment(item)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Additional notes <span className="normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. focus on upper body, avoid squats..."
                rows={2}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <Button
              className="w-full gap-2"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Routine
                </>
              )}
            </Button>

            {generate.isError && (
              <p className="text-xs text-destructive text-center">
                Failed to generate. Please try again.
              </p>
            )}
          </div>
        ) : (
          /* Generated routine preview */
          <div className="space-y-4">
            <div className="bg-primary/10 rounded-2xl p-3">
              <div className="font-bold text-base">{generated.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {generated.exercises.length} exercises
              </div>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {generated.exercises.map((ex, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-secondary/50"
                >
                  <div>
                    <div className="text-sm font-medium">{ex.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{ex.muscle}</div>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <div>{ex.sets} sets</div>
                    <div>{ex.reps} reps</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setGenerated(null)}>
                Regenerate
              </Button>
              <Button className="flex-1 gap-1.5" onClick={handleSave}>
                <Save className="w-4 h-4" />
                Save Routine
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
