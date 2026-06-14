// Fitness scoring: estimated 1RM, Wilks normalization, PRs, and progress.
// Pure functions over raw set data so they're easy to reuse + test.

export interface StrengthSet {
  exerciseId: number;
  name: string;
  date: string;      // YYYY-MM-DD
  reps: number;
  weightGrams: number;
}

const GRAMS_PER_KG = 1000;

/** Epley estimated 1RM. Reps capped at 12 — beyond that Epley over-estimates. */
export function estimate1RMKg(weightKg: number, reps: number): number {
  const r = Math.min(Math.max(reps, 1), 12);
  return weightKg * (1 + r / 30);
}

// ── Wilks (original 1994 coefficients) ───────────────────────────────────────
// Normalizes a lift for bodyweight + sex so a 60kg lifter and a 100kg lifter
// compare fairly. score = liftKg × 500 / poly(bodyweightKg).
const WILKS = {
  male:   { a: -216.0475144, b: 16.2606339, c: -0.002388645, d: -0.00113732, e: 7.01863e-06, f: -1.291e-08 },
  female: { a: 594.31747775582, b: -27.23842536447, c: 0.82112226871, d: -0.00930733913, e: 4.731582e-05, f: -9.054e-08 },
};

export function wilksCoefficient(bodyweightKg: number, sex: string | null | undefined): number {
  const k = sex === "female" ? WILKS.female : WILKS.male; // default male for other/unknown
  const x = Math.min(Math.max(bodyweightKg, 40), 200);     // clamp to a sane range
  const denom = k.a + k.b * x + k.c * x ** 2 + k.d * x ** 3 + k.e * x ** 4 + k.f * x ** 5;
  return denom !== 0 ? 500 / denom : 0;
}

/** Size-/sex-normalized strength score for a single lift. */
export function wilksScore(liftKg: number, bodyweightKg: number, sex: string | null | undefined): number {
  if (liftKg <= 0 || bodyweightKg <= 0) return 0;
  return liftKg * wilksCoefficient(bodyweightKg, sex);
}

// ── Per-exercise session bests ───────────────────────────────────────────────
export interface ExerciseBests {
  name: string;
  sessions: { date: string; e1rmKg: number }[]; // one best-est-1RM per day, ascending by date
}

/** Group sets → best estimated 1RM per exercise per day, sorted by date ascending. */
export function sessionBests(sets: StrengthSet[]): Map<number, ExerciseBests> {
  const byEx = new Map<number, { name: string; byDate: Map<string, number> }>();
  for (const s of sets) {
    if (s.weightGrams <= 0 || s.reps <= 0) continue;
    const e1 = estimate1RMKg(s.weightGrams / GRAMS_PER_KG, s.reps);
    let ex = byEx.get(s.exerciseId);
    if (!ex) { ex = { name: s.name, byDate: new Map() }; byEx.set(s.exerciseId, ex); }
    const prev = ex.byDate.get(s.date) ?? 0;
    if (e1 > prev) ex.byDate.set(s.date, e1);
  }
  const out = new Map<number, ExerciseBests>();
  for (const [id, ex] of byEx) {
    const sessions = [...ex.byDate.entries()]
      .map(([date, e1rmKg]) => ({ date, e1rmKg }))
      .sort((a, b) => a.date.localeCompare(b.date));
    out.set(id, { name: ex.name, sessions });
  }
  return out;
}

/** Count PRs: each time an exercise's best est-1RM exceeds its prior best
 *  (the first session establishes the baseline and doesn't count). */
export function countPRs(bests: Map<number, ExerciseBests>): number {
  let prs = 0;
  for (const { sessions } of bests.values()) {
    let max = 0;
    for (let i = 0; i < sessions.length; i++) {
      if (i > 0 && sessions[i].e1rmKg > max + 1e-6) prs++;
      max = Math.max(max, sessions[i].e1rmKg);
    }
  }
  return prs;
}

/** Current best est-1RM (kg) per exercise across all time. */
export function currentBests(bests: Map<number, ExerciseBests>): Map<number, { name: string; e1rmKg: number }> {
  const out = new Map<number, { name: string; e1rmKg: number }>();
  for (const [id, ex] of bests) {
    const max = ex.sessions.reduce((m, s) => Math.max(m, s.e1rmKg), 0);
    if (max > 0) out.set(id, { name: ex.name, e1rmKg: max });
  }
  return out;
}

/** Average % gain in est-1RM within a window: for each exercise with ≥2 sessions
 *  on/after `sinceDate`, compare the earliest in-window best to the latest. */
export function avgProgressPct(bests: Map<number, ExerciseBests>, sinceDate: string): number {
  const gains: number[] = [];
  for (const { sessions } of bests.values()) {
    const inWin = sessions.filter(s => s.date >= sinceDate);
    if (inWin.length < 2) continue;
    const first = inWin[0].e1rmKg, last = inWin[inWin.length - 1].e1rmKg;
    if (first > 0) gains.push(((last - first) / first) * 100);
  }
  if (gains.length === 0) return 0;
  return Math.round((gains.reduce((s, g) => s + g, 0) / gains.length) * 10) / 10;
}

// ── Points ───────────────────────────────────────────────────────────────────
export const POINTS = { perWorkout: 100, perProteinDay: 50, perPR: 150, perStreakDay: 25 };

export function computePointsTotal(p: { workouts: number; proteinDays: number; prs: number; streak: number }): number {
  return p.workouts * POINTS.perWorkout
    + p.proteinDays * POINTS.perProteinDay
    + p.prs * POINTS.perPR
    + p.streak * POINTS.perStreakDay;
}

/** Current consecutive-day streak from a set of active dates (any logged activity).
 *  Today not yet logged is OK — the streak counts from yesterday. */
export function streakFromDates(activeDates: Set<string>, now = new Date()): number {
  const ds = (d: Date) => d.toISOString().slice(0, 10);
  let streak = 0;
  for (let i = 0; i <= 366; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (activeDates.has(ds(d))) streak++;
    else if (i === 0) continue; // today not logged yet — don't break
    else break;
  }
  return streak;
}
