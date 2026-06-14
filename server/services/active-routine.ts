// Active routine: turns an AI Coach Plan's weekly schedule into a rotating
// sequence of days. The sequence has no calendar binding — `currentIndex`
// just points at whichever day is "next up".
import type { RoutineDay } from "../../shared/schema.js";

export interface ActiveRoutineState {
  days: RoutineDay[];
  currentIndex: number;
  lastCheckedDate: string; // YYYY-MM-DD
}

const isRestDay = (d: RoutineDay) => d.type === "rest" || d.type === "active_recovery";

function addDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consume one calendar day at a time between `lastCheckedDate` and `today`.
 * For each elapsed day, if the day currently "next up" is a rest/active-recovery
 * day, advance past it — those days don't need to be completed. If it's a
 * training day, leave it in place: it stays "next up" (and everything after it
 * shifts) until the user completes it via `completeCurrentDay`.
 */
export function rollForward(state: ActiveRoutineState, today: string): ActiveRoutineState {
  const { days } = state;
  if (days.length === 0) return { ...state, lastCheckedDate: today };
  let { currentIndex, lastCheckedDate } = state;
  while (lastCheckedDate < today) {
    lastCheckedDate = addDay(lastCheckedDate);
    if (isRestDay(days[currentIndex])) {
      currentIndex = (currentIndex + 1) % days.length;
    }
  }
  return { days, currentIndex, lastCheckedDate };
}

/** Mark the current "next up" day complete and advance to the following day. */
export function completeCurrentDay(state: ActiveRoutineState, today: string): ActiveRoutineState {
  const { days } = state;
  if (days.length === 0) return { ...state, lastCheckedDate: today };
  const currentIndex = (state.currentIndex + 1) % days.length;
  return { days, currentIndex, lastCheckedDate: today };
}

/** Build the routine's day sequence from an AI Coach Plan's `training.schedule`. */
export function buildDaysFromSchedule(schedule: any[]): RoutineDay[] {
  return (schedule ?? []).map((d: any): RoutineDay => ({
    dayLabel: d.day ?? "",
    type: d.type ?? "rest",
    focus: d.focus ?? "",
    templateId: null,
    exercises: Array.isArray(d.exercises) ? d.exercises.map((e: any) => ({
      name: e.name,
      sets: e.sets ?? 3,
      reps: e.reps ?? "8-12",
      weightNote: e.weightNote ?? undefined,
    })) : [],
  }));
}
