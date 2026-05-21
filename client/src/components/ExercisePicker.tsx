import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import { MuscleMap } from "@/components/MuscleMap";
import type { Exercise } from "@shared/schema";

const MUSCLE_FILTERS = [
  { label: "All", value: "" },
  { label: "Chest", value: "chest" },
  { label: "Back", value: "back" },
  { label: "Shoulders", value: "shoulders" },
  { label: "Biceps", value: "biceps" },
  { label: "Triceps", value: "triceps" },
  { label: "Legs", value: "quads" },
  { label: "Core", value: "abs" },
];

interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
}

export function ExercisePicker({ open, onClose, onSelect }: ExercisePickerProps) {
  const [search, setSearch] = useState("");
  const [muscleFilter, setMuscleFilter] = useState("");
  const [hovered, setHovered] = useState<Exercise | null>(null);

  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises", search, muscleFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (muscleFilter) params.set("muscle", muscleFilter);
      return apiRequest("GET", `/api/exercises${params.toString() ? "?" + params.toString() : ""}`);
    },
    enabled: open,
  });

  function handleSelect(ex: Exercise) {
    onSelect(ex);
    setSearch("");
    setMuscleFilter("");
    setHovered(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Exercise</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Muscle group pills */}
          <div className="flex gap-1.5 flex-wrap">
            {MUSCLE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setMuscleFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  muscleFilter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            {/* Exercise list */}
            <ScrollArea className="h-80 flex-1">
              <div className="space-y-0.5 pr-2">
                {exercises.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">No exercises found</div>
                ) : (
                  exercises.map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() => handleSelect(ex)}
                      onMouseEnter={() => setHovered(ex)}
                      onMouseLeave={() => setHovered(null)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-accent transition-colors"
                    >
                      <div className="text-sm font-medium leading-tight">{ex.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full capitalize">
                          {ex.primaryMuscle}
                        </span>
                        {ex.equipment && (
                          <span className="text-[10px] text-muted-foreground capitalize">{ex.equipment}</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Muscle map preview */}
            {hovered && (
              <div className="w-20 flex-shrink-0 flex flex-col items-center justify-start pt-2 gap-1">
                <MuscleMap
                  primary={[hovered.primaryMuscle]}
                  secondary={(hovered.secondaryMuscles as string[]) ?? []}
                  size={72}
                  view="auto"
                />
                <span className="text-[10px] text-muted-foreground text-center capitalize leading-tight">
                  {hovered.primaryMuscle}
                </span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
