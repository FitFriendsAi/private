// Pure training-progression helpers shared by the mobile app and server.
// No framework imports — safe to use from React Native and Node.

export interface PrevSet {
  reps: number;
  weightGrams: number;
}

const LB_TO_GRAMS = 453.59237;

/** Epley estimated 1RM in grams. Reps capped at 12 — beyond that Epley over-estimates. */
export function estimate1RM(weightGrams: number, reps: number): number {
  const r = Math.min(Math.max(reps, 1), 12);
  return weightGrams * (1 + r / 30);
}

/** Parse a target-reps string like "8-12" or "8" into [low, high]. */
function parseTargetReps(targetReps: string | null | undefined): [number, number] {
  if (!targetReps) return [8, 12];
  const match = targetReps.match(/(\d+)\s*-\s*(\d+)/);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  const single = targetReps.match(/(\d+)/);
  if (single) {
    const n = parseInt(single[1], 10);
    return [n, n];
  }
  return [8, 12];
}

export interface WeightSuggestion {
  weightGrams: number;
  note: string;
}

/**
 * Suggest next weight based on last session's sets vs. the target rep range.
 * - Hit/exceeded the top of the range on every set → bump up (+10lb for
 *   barbell/compound equipment, +5lb otherwise).
 * - Missed the bottom of the range on any set → keep the same weight, focus on reps.
 * - Otherwise (close but not quite) → keep the same weight, aim for one more rep.
 */
export function suggestNextWeight(
  prevSets: PrevSet[],
  targetReps: string | null | undefined,
  equipment: string | null | undefined,
): WeightSuggestion | null {
  if (!prevSets || prevSets.length === 0) return null;
  const [low, high] = parseTargetReps(targetReps);
  const lastWeight = prevSets[prevSets.length - 1].weightGrams;
  if (lastWeight <= 0) return null;

  const allHitHigh = prevSets.every(s => s.reps >= high);
  const anyMissedLow = prevSets.some(s => s.reps < low);

  if (allHitHigh) {
    const isCompound = equipment === "barbell";
    const bumpGrams = (isCompound ? 10 : 5) * LB_TO_GRAMS;
    return {
      weightGrams: lastWeight + bumpGrams,
      note: "You hit all reps last time — try going up.",
    };
  }

  if (anyMissedLow) {
    return {
      weightGrams: lastWeight,
      note: "Focus on hitting your reps before adding weight.",
    };
  }

  return {
    weightGrams: lastWeight,
    note: "So close — aim for one more rep.",
  };
}
