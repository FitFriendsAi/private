/**
 * Badge award detection. Recomputed from scratch each time it's called
 * (after finishing a workout, after a CSV import) rather than maintained as
 * running counters — the underlying data (sets, workouts) is the source of
 * truth, and hobby-scale history sizes make a full recompute cheap enough
 * that there's no need to track incremental state.
 */
import { storage } from "../storage.js";
import { estimate1RMKg, streakFromDates } from "./scoring.js";
import {
  BADGE_CATALOG, LIFT_THRESHOLDS, LIFT_MATCHERS, STREAK_THRESHOLDS,
  VOLUME_THRESHOLDS, WORKOUT_COUNT_THRESHOLDS, type BadgeDef,
} from "../../shared/badges.js";

const LBS_PER_GRAM = 1 / 453.592;
const KG_TO_LBS = 2.20462;

function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/** Recompute all badge conditions for a user and award any newly-earned ones. */
export async function checkAndAwardBadges(userId: number): Promise<BadgeDef[]> {
  const alreadyEarned = await storage.getUserBadgeIds(userId);
  const toAward: string[] = [];

  const [allSets, allWorkouts] = await Promise.all([
    storage.getAllSetsWithExerciseNames(userId),
    storage.getWorkouts(userId, 5000),
  ]);

  // ── Strength: best-ever estimated 1RM per lift category ──
  for (const [lift, matcher] of Object.entries(LIFT_MATCHERS)) {
    let bestKg = 0;
    for (const s of allSets) {
      if (s.weightGrams <= 0 || s.reps <= 0) continue;
      if (!matcher(s.exerciseName)) continue;
      const e1 = estimate1RMKg(s.weightGrams / 1000, s.reps);
      if (e1 > bestKg) bestKg = e1;
    }
    const bestLbs = bestKg * KG_TO_LBS;
    for (const threshold of LIFT_THRESHOLDS[lift]) {
      const id = `${lift}_${threshold}`;
      if (!alreadyEarned.has(id) && bestLbs >= threshold) toAward.push(id);
    }
  }

  // ── Streak: consecutive days with a logged workout ──
  const activeDates = new Set(allWorkouts.map(w => toDateStr(w.date)));
  const streak = streakFromDates(activeDates);
  for (const threshold of STREAK_THRESHOLDS) {
    const id = `streak_${threshold}`;
    if (!alreadyEarned.has(id) && streak >= threshold) toAward.push(id);
  }

  // ── Total lifetime volume, lbs ──
  const totalVolumeLbs = allSets.reduce((sum, s) => sum + s.weightGrams * LBS_PER_GRAM * s.reps, 0);
  for (const threshold of VOLUME_THRESHOLDS) {
    const id = `volume_${threshold}`;
    if (!alreadyEarned.has(id) && totalVolumeLbs >= threshold) toAward.push(id);
  }

  // ── Total workouts logged ──
  for (const threshold of WORKOUT_COUNT_THRESHOLDS) {
    const id = `workouts_${threshold}`;
    if (!alreadyEarned.has(id) && allWorkouts.length >= threshold) toAward.push(id);
  }

  if (toAward.length > 0) {
    await storage.awardBadges(userId, toAward);
  }

  const byId = new Map(BADGE_CATALOG.map(b => [b.id, b]));
  return toAward.map(id => byId.get(id)).filter((b): b is BadgeDef => !!b);
}
