/**
 * Strength standards expressed as bodyweight multipliers for 1-rep-max estimates.
 * Values represent [beginner, novice, intermediate, advanced, elite] thresholds.
 * Source: aggregated from widely published strength training literature and
 * published federation standards (ExRx, NSCA, powerlifting federation percentile data).
 *
 * Key normalization: lowercase, strip parenthetical equipment suffixes, trim whitespace.
 * Dumbbell exercises: per-dumbbell weight (one side), not combined total.
 */

export type StrengthLevels = [number, number, number, number, number];

export interface ExerciseStandard {
  male:   StrengthLevels;  // BW multipliers
  female: StrengthLevels;
  note?:  string;          // e.g. "per dumbbell"
}

export const LEVEL_NAMES   = ["Untrained", "Beginner", "Novice", "Intermediate", "Advanced", "Elite"] as const;
export type  LevelName     = (typeof LEVEL_NAMES)[number];

// Lookup map — keys are normalized exercise names
const STANDARDS: Record<string, ExerciseStandard> = {
  // ── Barbell compound ─────────────────────────────────────────────────────────
  "bench press":              { male: [0.5,  0.75, 1.25, 1.5,  2.0], female: [0.25, 0.5,  0.75, 1.0,  1.5 ] },
  "incline bench press":      { male: [0.4,  0.65, 1.0,  1.3,  1.75], female: [0.2,  0.4,  0.65, 0.85, 1.2 ] },
  "close grip bench press":   { male: [0.4,  0.65, 1.0,  1.3,  1.7], female: [0.2,  0.35, 0.6,  0.8,  1.1 ] },
  "squat":                    { male: [0.75, 1.25, 1.5,  2.0,  2.5], female: [0.5,  0.75, 1.0,  1.5,  2.0 ] },
  "back squat":               { male: [0.75, 1.25, 1.5,  2.0,  2.5], female: [0.5,  0.75, 1.0,  1.5,  2.0 ] },
  "front squat":              { male: [0.5,  0.85, 1.25, 1.7,  2.1], female: [0.3,  0.5,  0.85, 1.25, 1.6 ] },
  "deadlift":                 { male: [1.0,  1.5,  2.0,  2.5,  3.0], female: [0.5,  1.0,  1.5,  2.0,  2.5 ] },
  "sumo deadlift":            { male: [1.0,  1.5,  2.0,  2.5,  3.0], female: [0.5,  1.0,  1.5,  2.0,  2.5 ] },
  "romanian deadlift":        { male: [0.75, 1.0,  1.5,  2.0,  2.5], female: [0.4,  0.65, 1.0,  1.5,  2.0 ] },
  "rdl":                      { male: [0.75, 1.0,  1.5,  2.0,  2.5], female: [0.4,  0.65, 1.0,  1.5,  2.0 ] },
  "overhead press":           { male: [0.35, 0.55, 0.8,  1.0,  1.25], female: [0.2,  0.35, 0.5,  0.65, 0.85] },
  "ohp":                      { male: [0.35, 0.55, 0.8,  1.0,  1.25], female: [0.2,  0.35, 0.5,  0.65, 0.85] },
  "military press":           { male: [0.35, 0.55, 0.8,  1.0,  1.25], female: [0.2,  0.35, 0.5,  0.65, 0.85] },
  "barbell row":              { male: [0.5,  0.75, 1.0,  1.25, 1.75], female: [0.25, 0.4,  0.65, 0.85, 1.25] },
  "bent over row":            { male: [0.5,  0.75, 1.0,  1.25, 1.75], female: [0.25, 0.4,  0.65, 0.85, 1.25] },
  "pendlay row":              { male: [0.5,  0.75, 1.0,  1.25, 1.75], female: [0.25, 0.4,  0.65, 0.85, 1.25] },
  "hip thrust":               { male: [0.75, 1.25, 1.75, 2.5,  3.0 ], female: [0.5,  0.9,  1.4,  2.0,  2.75] },
  "preacher curl":            { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "ez bar curl":              { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "barbell curl":             { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "skull crusher":            { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "lying tricep extension":   { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "good morning":             { male: [0.5,  0.75, 1.0,  1.4,  1.75], female: [0.3,  0.5,  0.75, 1.1,  1.5 ] },
  "power clean":              { male: [0.5,  0.75, 1.0,  1.4,  1.75], female: [0.3,  0.5,  0.75, 1.0,  1.25] },

  // ── Dumbbell (per-dumbbell weight) ───────────────────────────────────────────
  "dumbbell bench press":     { male: [0.2,  0.3,  0.45, 0.65, 0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.65], note: "per dumbbell" },
  "dumbbell incline press":   { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.08, 0.15, 0.25, 0.4,  0.55], note: "per dumbbell" },
  "incline dumbbell press":   { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.08, 0.15, 0.25, 0.4,  0.55], note: "per dumbbell" },
  "dumbbell row":             { male: [0.2,  0.35, 0.5,  0.7,  0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.6 ], note: "per dumbbell" },
  "one arm dumbbell row":     { male: [0.2,  0.35, 0.5,  0.7,  0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.6 ], note: "per dumbbell" },
  "dumbbell shoulder press":  { male: [0.15, 0.22, 0.35, 0.5,  0.7 ], female: [0.08, 0.15, 0.22, 0.35, 0.5 ], note: "per dumbbell" },
  "arnold press":             { male: [0.12, 0.2,  0.3,  0.45, 0.65], female: [0.07, 0.12, 0.2,  0.3,  0.45], note: "per dumbbell" },
  "hammer curl":              { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], note: "per dumbbell" },
  "dumbbell curl":            { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], note: "per dumbbell" },
  "bicep curl":               { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], note: "per dumbbell" },
  "lateral raise":            { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], note: "per dumbbell" },
  "dumbbell lateral raise":   { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], note: "per dumbbell" },
  "front raise":              { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], note: "per dumbbell" },
  "dumbbell fly":             { male: [0.1,  0.15, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.18, 0.25, 0.35], note: "per dumbbell" },
  "chest fly":                { male: [0.1,  0.15, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.18, 0.25, 0.35], note: "per dumbbell" },
  "dumbbell tricep extension":{ male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], note: "per dumbbell" },
  "overhead tricep extension":{ male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35] },
  "rear delt fly":            { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], note: "per dumbbell" },
  "dumbbell lunges":          { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.1,  0.18, 0.3,  0.45, 0.65], note: "per dumbbell" },
  "goblet squat":             { male: [0.2,  0.35, 0.5,  0.7,  0.9 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },

  // ── Cable ─────────────────────────────────────────────────────────────────────
  "lat pulldown":             { male: [0.5,  0.75, 1.0,  1.25, 1.5 ], female: [0.25, 0.4,  0.65, 0.85, 1.15] },
  "seated cable row":         { male: [0.5,  0.75, 1.0,  1.25, 1.65], female: [0.25, 0.4,  0.65, 0.85, 1.15] },
  "cable row":                { male: [0.5,  0.75, 1.0,  1.25, 1.65], female: [0.25, 0.4,  0.65, 0.85, 1.15] },
  "tricep pushdown":          { male: [0.2,  0.3,  0.45, 0.6,  0.8 ], female: [0.1,  0.18, 0.28, 0.4,  0.55] },
  "cable tricep pushdown":    { male: [0.2,  0.3,  0.45, 0.6,  0.8 ], female: [0.1,  0.18, 0.28, 0.4,  0.55] },
  "cable crossover":          { male: [0.2,  0.3,  0.45, 0.6,  0.75], female: [0.1,  0.15, 0.25, 0.35, 0.5 ] },
  "cable fly":                { male: [0.2,  0.3,  0.45, 0.6,  0.75], female: [0.1,  0.15, 0.25, 0.35, 0.5 ] },
  "face pull":                { male: [0.2,  0.3,  0.45, 0.6,  0.8 ], female: [0.1,  0.18, 0.28, 0.4,  0.55] },
  "cable curl":               { male: [0.2,  0.3,  0.45, 0.6,  0.8 ], female: [0.1,  0.18, 0.28, 0.4,  0.55] },
  "cable bicep curl":         { male: [0.2,  0.3,  0.45, 0.6,  0.8 ], female: [0.1,  0.18, 0.28, 0.4,  0.55] },
  "cable pull through":       { male: [0.5,  0.75, 1.0,  1.4,  1.75], female: [0.3,  0.5,  0.75, 1.1,  1.5 ] },

  // ── Machine ───────────────────────────────────────────────────────────────────
  "leg press":                { male: [1.5,  2.0,  3.0,  4.0,  5.5 ], female: [1.0,  1.5,  2.25, 3.0,  4.0 ] },
  "leg curl":                 { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.2,  0.32, 0.5,  0.65, 0.85] },
  "hamstring curl":           { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.2,  0.32, 0.5,  0.65, 0.85] },
  "lying leg curl":           { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.2,  0.32, 0.5,  0.65, 0.85] },
  "seated leg curl":          { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.2,  0.32, 0.5,  0.65, 0.85] },
  "leg extension":            { male: [0.4,  0.6,  0.85, 1.1,  1.5 ], female: [0.25, 0.4,  0.6,  0.8,  1.1 ] },
  "chest press":              { male: [0.4,  0.6,  0.9,  1.25, 1.65], female: [0.2,  0.35, 0.55, 0.75, 1.0 ] },
  "machine chest press":      { male: [0.4,  0.6,  0.9,  1.25, 1.65], female: [0.2,  0.35, 0.55, 0.75, 1.0 ] },
  "pec deck":                 { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "butterfly":                { male: [0.3,  0.45, 0.65, 0.85, 1.1 ], female: [0.15, 0.25, 0.4,  0.55, 0.75] },
  "reverse pec deck":         { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.1,  0.15, 0.25, 0.35, 0.5 ] },
  "reverse fly":              { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.1,  0.15, 0.25, 0.35, 0.5 ] },
  "shoulder press":           { male: [0.35, 0.55, 0.8,  1.0,  1.25], female: [0.2,  0.35, 0.5,  0.65, 0.85] },
  "machine shoulder press":   { male: [0.35, 0.55, 0.8,  1.0,  1.25], female: [0.2,  0.35, 0.5,  0.65, 0.85] },
  "machine row":              { male: [0.5,  0.75, 1.0,  1.25, 1.65], female: [0.25, 0.4,  0.65, 0.85, 1.15] },
  "calf raise":               { male: [0.75, 1.25, 1.75, 2.5,  3.25], female: [0.5,  0.9,  1.4,  2.0,  2.75] },
  "seated calf raise":        { male: [0.5,  0.85, 1.25, 1.75, 2.5 ], female: [0.35, 0.6,  0.95, 1.35, 1.9 ] },
  "hack squat":               { male: [0.75, 1.25, 1.75, 2.25, 3.0 ], female: [0.5,  0.85, 1.25, 1.75, 2.5 ] },
  "smith machine squat":      { male: [0.75, 1.25, 1.5,  2.0,  2.5 ], female: [0.5,  0.75, 1.0,  1.5,  2.0 ] },
  "tricep dip":               { male: [0.2,  0.35, 0.55, 0.75, 1.0 ], female: [0.1,  0.2,  0.35, 0.5,  0.7 ] },
};

// Suffixes stripped before lookup
const EQUIPMENT_SUFFIXES = [
  "barbell", "dumbbell", "cable", "machine", "smith machine", "smith",
  "ez bar", "ez-bar", "band", "kettlebell", "resistance band", "bodyweight",
  "high to low", "low to high", "high", "low", "neutral grip", "wide grip",
  "close grip", "underhand", "overhand", "supinated", "pronated",
];

function normalizeExerciseName(name: string): string {
  let n = name.toLowerCase().trim();
  // Remove parenthetical suffixes: "Hammer Curl (Dumbbell)" → "hammer curl"
  n = n.replace(/\s*\([^)]*\)/g, "").trim();
  // Remove leading/trailing equipment words
  for (const suffix of EQUIPMENT_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, "g"), "").replace(/\s+/g, " ").trim();
  }
  return n;
}

/**
 * Look up strength standards for an exercise by name.
 * Returns null if no standard is available for that exercise.
 */
export function getStrengthStandard(exerciseName: string): ExerciseStandard | null {
  const normalized = normalizeExerciseName(exerciseName);

  // Direct match first
  if (STANDARDS[normalized]) return STANDARDS[normalized];

  // Fallback: try without stripping (original lowercased)
  const lower = exerciseName.toLowerCase().trim();
  if (STANDARDS[lower]) return STANDARDS[lower];

  // Partial match: find any key that the normalized name contains
  for (const key of Object.keys(STANDARDS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return STANDARDS[key];
    }
  }

  return null;
}

/**
 * Given a 1RM in grams and the bodyweight multiplier thresholds,
 * return the level index (0=Untrained, 1=Beginner, …, 5=Elite).
 */
export function getLevelIndex(e1rmGrams: number, bodyweightGrams: number, multipliers: StrengthLevels): number {
  const bw = bodyweightGrams;
  for (let i = multipliers.length - 1; i >= 0; i--) {
    if (e1rmGrams >= multipliers[i] * bw) return i + 1;
  }
  return 0;
}

/**
 * Compute absolute threshold weights in grams for a given bodyweight.
 */
export function computeThresholds(multipliers: StrengthLevels, bodyweightGrams: number): StrengthLevels {
  return multipliers.map(m => Math.round(m * bodyweightGrams)) as StrengthLevels;
}
