/**
 * Badge catalog — static definitions only. Which badges a user has actually
 * earned lives in the userBadges table (shared/schema.ts); this file is the
 * single source of truth for what badges exist and what unlocks them, shared
 * between the award-detection logic (server/services/badges.ts) and the
 * trophy-case UI (mobile/app/badges.tsx) so both read from the same list.
 */

export type BadgeCategory = "strength" | "streak" | "volume" | "consistency";
export type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

export interface BadgeDef {
  id: string;
  category: BadgeCategory;
  label: string;
  description: string;
  emoji: string;
  tier: BadgeTier;
}

const TIER_BY_INDEX: BadgeTier[] = ["bronze", "silver", "gold", "platinum", "diamond", "diamond", "diamond"];
const tierFor = (i: number) => TIER_BY_INDEX[i] ?? "diamond";

// ── Strength lifts ──────────────────────────────────────────────────────────
// Threshold is the lift's best-ever *estimated* 1-rep max (Epley), in lbs.
// Keyword matchers decide which logged exercises count toward each lift —
// kept broad (any bench press variant counts toward "Bench Press") except
// where a specific equipment word would badly skew the numbers, like
// dumbbell overhead press being per-hand rather than total load.
export const LIFT_THRESHOLDS: Record<string, number[]> = {
  bench:    [135, 185, 225, 275, 315, 405],
  squat:    [135, 185, 225, 275, 315, 405, 495],
  deadlift: [135, 225, 315, 405, 495, 585],
  ohp:      [95, 135, 185, 225],
};

export const LIFT_LABELS: Record<string, string> = {
  bench: "Bench Press", squat: "Squat", deadlift: "Deadlift", ohp: "Overhead Press",
};

const LIFT_EMOJI: Record<string, string> = {
  bench: "🏋️", squat: "🦵", deadlift: "💀", ohp: "🙌",
};

export const LIFT_MATCHERS: Record<string, (exerciseName: string) => boolean> = {
  bench:    (n) => n.toLowerCase().includes("bench press"),
  squat:    (n) => n.toLowerCase().includes("squat"),
  deadlift: (n) => n.toLowerCase().includes("deadlift"),
  ohp:      (n) => {
    const lower = n.toLowerCase();
    return (lower.includes("overhead press") || lower.includes("military press")) && !lower.includes("dumbbell");
  },
};

// ── Streak (consecutive days trained) ───────────────────────────────────────
export const STREAK_THRESHOLDS = [7, 30, 100, 365];

// ── Total lifetime volume (sum of weight × reps across every set, lbs) ──────
export const VOLUME_THRESHOLDS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

// ── Total workouts ever logged ───────────────────────────────────────────────
export const WORKOUT_COUNT_THRESHOLDS = [1, 10, 50, 100, 250, 500];

function strengthBadges(): BadgeDef[] {
  const out: BadgeDef[] = [];
  for (const [lift, thresholds] of Object.entries(LIFT_THRESHOLDS)) {
    thresholds.forEach((t, i) => {
      out.push({
        id: `${lift}_${t}`,
        category: "strength",
        label: `${t} lb ${LIFT_LABELS[lift]}`,
        description: `Hit an estimated ${t} lb 1-rep max on ${LIFT_LABELS[lift]}`,
        emoji: LIFT_EMOJI[lift],
        tier: tierFor(i),
      });
    });
  }
  return out;
}

function streakBadges(): BadgeDef[] {
  return STREAK_THRESHOLDS.map((days, i) => ({
    id: `streak_${days}`,
    category: "streak",
    label: days === 365 ? "1 Year Streak" : `${days}-Day Streak`,
    description: `Train ${days} days in a row`,
    emoji: "🔥",
    tier: tierFor(i),
  }));
}

function volumeBadges(): BadgeDef[] {
  return VOLUME_THRESHOLDS.map((lbs, i) => ({
    id: `volume_${lbs}`,
    category: "volume",
    label: `${(lbs / 1000).toLocaleString()}K lbs Lifted`,
    description: `Lift a cumulative total of ${lbs.toLocaleString()} lbs across all workouts`,
    emoji: "📈",
    tier: tierFor(i),
  }));
}

function consistencyBadges(): BadgeDef[] {
  return WORKOUT_COUNT_THRESHOLDS.map((n, i) => ({
    id: `workouts_${n}`,
    category: "consistency",
    label: n === 1 ? "First Workout" : `${n} Workouts Logged`,
    description: n === 1 ? "Log your first workout" : `Log ${n} total workouts`,
    emoji: "✅",
    tier: tierFor(i),
  }));
}

export const BADGE_CATALOG: BadgeDef[] = [
  ...strengthBadges(),
  ...streakBadges(),
  ...volumeBadges(),
  ...consistencyBadges(),
];

export const BADGE_BY_ID: Record<string, BadgeDef> = Object.fromEntries(
  BADGE_CATALOG.map(b => [b.id, b])
);

export const TIER_COLOR: Record<BadgeTier, string> = {
  bronze:   "#cd7f32",
  silver:   "#c0c0c0",
  gold:     "#ffd700",
  platinum: "#9bd1ff",
  diamond:  "#c8e84c",
};
