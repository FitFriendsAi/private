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
  male:    StrengthLevels;  // BW multipliers
  female:  StrengthLevels;
  /**
   * When true, the thresholds represent weight per arm (one dumbbell / one side).
   * Users who log combined weight (both arms summed) should have their logged
   * value halved before comparing, or equivalently see the thresholds doubled.
   * Show a "per arm / combined" toggle on the UI for these exercises.
   */
  perArm?: boolean;
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

  // ── Dumbbell (per-arm weight — perArm: true) ─────────────────────────────────
  "dumbbell bench press":     { male: [0.2,  0.3,  0.45, 0.65, 0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.65], perArm: true },
  "dumbbell incline press":   { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.08, 0.15, 0.25, 0.4,  0.55], perArm: true },
  "incline dumbbell press":   { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.08, 0.15, 0.25, 0.4,  0.55], perArm: true },
  "dumbbell row":             { male: [0.2,  0.35, 0.5,  0.7,  0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.6 ], perArm: true },
  "one arm dumbbell row":     { male: [0.2,  0.35, 0.5,  0.7,  0.9 ], female: [0.1,  0.18, 0.3,  0.45, 0.6 ], perArm: true },
  "dumbbell shoulder press":  { male: [0.15, 0.22, 0.35, 0.5,  0.7 ], female: [0.08, 0.15, 0.22, 0.35, 0.5 ], perArm: true },
  "arnold press":             { male: [0.12, 0.2,  0.3,  0.45, 0.65], female: [0.07, 0.12, 0.2,  0.3,  0.45], perArm: true },
  "hammer curl":              { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], perArm: true },
  "dumbbell curl":            { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], perArm: true },
  "bicep curl":               { male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], perArm: true },
  "lateral raise":            { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], perArm: true },
  "dumbbell lateral raise":   { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], perArm: true },
  "front raise":              { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], perArm: true },
  "dumbbell fly":             { male: [0.1,  0.15, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.18, 0.25, 0.35], perArm: true },
  "chest fly":                { male: [0.1,  0.15, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.18, 0.25, 0.35], perArm: true },
  "dumbbell tricep extension":{ male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], perArm: true },
  "overhead tricep extension":{ male: [0.1,  0.17, 0.25, 0.35, 0.5 ], female: [0.05, 0.1,  0.17, 0.25, 0.35], perArm: true },
  "rear delt fly":            { male: [0.05, 0.08, 0.12, 0.18, 0.25], female: [0.03, 0.05, 0.08, 0.12, 0.18], perArm: true },
  "dumbbell lunges":          { male: [0.15, 0.25, 0.4,  0.55, 0.75], female: [0.1,  0.18, 0.3,  0.45, 0.65], perArm: true },
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

function stripParens(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function stripEquipment(name: string): string {
  let n = name;
  for (const suffix of EQUIPMENT_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, "g"), " ");
  }
  return n.replace(/\s+/g, " ").trim();
}

/** Return the set of words in a string, for word-overlap scoring. */
function wordSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

/**
 * Look up strength standards for an exercise by name.
 *
 * Lookup order (stops at first hit):
 *   1. Exact match on parens-stripped name (equipment words kept) — e.g. "incline dumbbell press"
 *   2. Exact match on original lowercase — catches keys that already have equipment words
 *   3. Best word-overlap match on parens-stripped name (equipment kept) — most words in common wins
 *   4. Exact match after also stripping equipment words — fallback for equipment-agnostic keys
 *   5. Best word-overlap match after stripping equipment words
 *
 * Keeping equipment words in phases 1–3 ensures "Incline Dumbbell Bench Press" preferentially
 * matches dumbbell-specific keys rather than the barbell "Incline Bench Press" standard.
 */
export function getStrengthStandard(exerciseName: string): ExerciseStandard | null {
  const withEquip   = stripParens(exerciseName);          // parens stripped, equipment kept
  const withoutEquip = stripEquipment(withEquip);         // equipment words also stripped

  // 1. Exact match — equipment words present
  if (STANDARDS[withEquip]) return STANDARDS[withEquip];

  // 2. Exact match — original lowercase (handles keys already in db-name form)
  const lower = exerciseName.toLowerCase().trim();
  if (STANDARDS[lower]) return STANDARDS[lower];

  // 3. Best word-overlap match — equipment words present (favours dumbbell/cable keys)
  const withEquipWords = wordSet(withEquip);
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const key of Object.keys(STANDARDS)) {
    const keyWords = wordSet(key);
    let overlap = 0;
    for (const w of keyWords) { if (withEquipWords.has(w)) overlap++; }
    // Score = overlap / key word count — prefer keys whose words are all present in the name
    const score = overlap / keyWords.size;
    if (score > bestScore && overlap >= Math.min(keyWords.size, 2)) {
      bestScore = score;
      bestKey   = key;
    }
  }
  // Only accept if ≥60% of key words matched (avoids spurious single-word hits)
  if (bestKey && bestScore >= 0.6) return STANDARDS[bestKey];

  // 4. Exact match after stripping equipment words
  if (STANDARDS[withoutEquip]) return STANDARDS[withoutEquip];

  // 5. Word-overlap match on equipment-stripped name
  const withoutEquipWords = wordSet(withoutEquip);
  bestKey = null; bestScore = 0;
  for (const key of Object.keys(STANDARDS)) {
    const keyWords = wordSet(stripEquipment(key));
    let overlap = 0;
    for (const w of keyWords) { if (withoutEquipWords.has(w)) overlap++; }
    const score = keyWords.size > 0 ? overlap / keyWords.size : 0;
    if (score > bestScore && overlap >= Math.min(keyWords.size, 2)) {
      bestScore = score;
      bestKey   = key;
    }
  }
  if (bestKey && bestScore >= 0.6) return STANDARDS[bestKey];

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
