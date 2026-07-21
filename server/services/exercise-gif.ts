/**
 * Exercise GIF lookup.
 *
 * Primary source: WorkoutX API (https://workoutxapp.com) — returns one real,
 * pre-rendered animated GIF per exercise via name search. Requires
 * WORKOUTX_API_KEY; results are cached by the caller (storage.updateExerciseGifUrl)
 * so each exercise is only ever looked up once against WorkoutX's metered quota.
 *
 * Fallback: free-exercise-db dataset (https://github.com/yuhonas/free-exercise-db),
 * used when WORKOUTX_API_KEY is unset or the WorkoutX lookup fails/has no match.
 * No API key required; images are hosted on GitHub's CDN. We fetch the full
 * exercises.json once on first use and keep it in memory.
 */

const WORKOUTX_BASE = "https://api.workoutxapp.com";

const EXERCISES_JSON_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGE_BASE =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

interface FreeExercise {
  id: string;        // e.g. "Barbell_Bench_Press_-_Medium_Grip"
  name: string;      // e.g. "Barbell Bench Press - Medium Grip"
  primaryMuscles: string[];
  images: string[];  // relative paths like "Barbell_Bench_Press_-_Medium_Grip/0.jpg"
}

let cachedExercises: FreeExercise[] | null = null;

async function loadExercises(): Promise<FreeExercise[]> {
  if (cachedExercises) return cachedExercises;
  try {
    const res = await fetch(EXERCISES_JSON_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedExercises = await res.json() as FreeExercise[];
    console.log(`[exercise-gif] Loaded ${cachedExercises.length} exercises from free-exercise-db`);
  } catch (err) {
    console.warn("[exercise-gif] Could not load free-exercise-db:", err);
    cachedExercises = [];
  }
  return cachedExercises;
}

/** Normalise a name for fuzzy matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Word-overlap score between two normalised strings (0–1) */
function overlap(a: string, b: string): number {
  const wa = new Set(a.split(" ").filter(w => w.length > 2));
  const wb = new Set(b.split(" ").filter(w => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  wa.forEach(w => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size);
}

interface WorkoutXExercise {
  id: string;
  name: string;
  equipment?: string;
  gifUrl?: string;
}

// Equipment words to strip from a query before searching WorkoutX — searching the
// bare movement name ("Bench Press" instead of "Barbell Bench Press (Smith Machine)")
// returns a far larger, more reliable candidate pool; equipment is matched afterward
// via the `equipment` field WorkoutX returns for each result.
const EQUIPMENT_WORDS = [
  "barbell", "dumbbell", "cable", "machine", "smith machine", "smith",
  "ez bar", "ez-bar", "bodyweight", "band", "kettlebell",
];

function stripEquipmentWords(s: string): string {
  let out = s;
  for (const w of EQUIPMENT_WORDS) {
    out = out.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Build a search query from our exercise name: drop parenthetical suffix + equipment words. */
function buildSearchQuery(exerciseName: string): string {
  const noParens = exerciseName.replace(/\s*\([^)]*\)/g, " ").trim();
  return stripEquipmentWords(noParens) || noParens;
}

// Canonical equipment buckets. Our schema's `equipment` enum maps 1:1 into these;
// WorkoutX's free-text `equipment` field is matched by substring per bucket.
type EquipBucket = "barbell" | "dumbbell" | "cable" | "machine" | "smith" | "bodyweight" | null;

function ourEquipmentBucket(equipment: string | null | undefined): EquipBucket {
  switch (equipment) {
    case "barbell":       return "barbell";
    case "dumbbell":      return "dumbbell";
    case "cable":         return "cable";
    case "machine":       return "machine";
    case "smith_machine": return "smith";
    case "bodyweight":
    case "none":          return "bodyweight";
    default:              return null; // unknown enum value — skip filtering
  }
}

const WORKOUTX_EQUIPMENT_SUBSTRINGS: Record<Exclude<EquipBucket, null>, string[]> = {
  barbell:    ["barbell"],       // covers "Barbell", "Olympic Barbell"
  dumbbell:   ["dumbbell"],
  cable:      ["cable"],
  machine:    ["machine", "leverage"], // covers "Machine", "Leverage Machine"
  smith:      ["smith"],
  bodyweight: ["body weight", "bodyweight"],
};

function equipmentMatches(bucket: EquipBucket, workoutXEquipment: string | undefined): boolean {
  if (bucket === null) return true; // unknown our-side enum — don't filter
  const e = (workoutXEquipment ?? "").toLowerCase();
  return WORKOUTX_EQUIPMENT_SUBSTRINGS[bucket].some(sub => e.includes(sub));
}

/**
 * Look up a real animated GIF from WorkoutX by exercise name + equipment category.
 * Returns null (never throws) on missing key, network error, rate limit, or no
 * confident match — callers should treat this as "try the fallback source" rather
 * than a hard failure.
 *
 * WorkoutX's own search ranking is not reliable for our purposes (it does not sort
 * by relevance to a specific equipment variant — e.g. searching "Hammer Curl" ranks
 * "Cable Hammer Curl" above "Dumbbell Hammer Curl"), so results are re-scored here:
 * word-overlap against the base movement name, gated by requiring the equipment
 * bucket to match our own exercise's equipment when known. A candidate is only
 * accepted if it clears both bars — an ambiguous/no-match result falls through to
 * the free-exercise-db fallback rather than returning a wrong-equipment GIF.
 */
async function fetchFromWorkoutX(exerciseName: string, equipment?: string | null): Promise<string | null> {
  const apiKey = process.env.WORKOUTX_API_KEY;
  if (!apiKey) return null;

  const query = buildSearchQuery(exerciseName);
  const bucket = ourEquipmentBucket(equipment);

  try {
    const res = await fetch(
      `${WORKOUTX_BASE}/v1/exercises/name/${encodeURIComponent(query)}`,
      { headers: { "X-WorkoutX-Key": apiKey } }
    );
    if (!res.ok) {
      if (res.status === 429) console.warn("[exercise-gif] WorkoutX rate limit hit");
      else if (res.status !== 404) console.warn(`[exercise-gif] WorkoutX HTTP ${res.status}`);
      return null;
    }
    const body = await res.json() as { data?: WorkoutXExercise[] } | WorkoutXExercise[];
    const results: WorkoutXExercise[] = Array.isArray(body) ? body : (body.data ?? []);
    if (results.length === 0) return null;

    const needle = norm(query);
    let best: WorkoutXExercise | null = null;
    let bestScore = 0;
    for (const e of results) {
      if (!equipmentMatches(bucket, e.equipment)) continue;
      const score = overlap(needle, norm(stripEquipmentWords(e.name)));
      if (score > bestScore) { bestScore = score; best = e; }
    }

    if (best && bestScore >= 0.5) return best.gifUrl ?? null;
    return null;
  } catch (err) {
    console.warn("[exercise-gif] WorkoutX lookup failed:", err);
    return null;
  }
}

/**
 * Fallback: find an image base URL for the given exercise name from free-exercise-db.
 * Returns a URL like:
 *   https://raw.githubusercontent.com/.../exercises/Barbell_Bench_Press_-_Medium_Grip
 * The caller appends /0.jpg and /1.jpg for the two frames.
 */
async function fetchFromFreeExerciseDb(exerciseName: string): Promise<string | null> {
  const list = await loadExercises();
  if (list.length === 0) return null;

  const needle = norm(exerciseName);

  // 1. Exact normalised match
  const exact = list.find(e => norm(e.name) === needle);
  if (exact && exact.images.length > 0) {
    return `${IMAGE_BASE}/${exact.id}`;
  }

  // 2. Best word-overlap match (threshold ≥ 0.5)
  let bestScore = 0;
  let bestMatch: FreeExercise | null = null;
  for (const e of list) {
    const score = overlap(needle, norm(e.name));
    if (score > bestScore) { bestScore = score; bestMatch = e; }
  }

  if (bestMatch && bestScore >= 0.5 && bestMatch.images.length > 0) {
    return `${IMAGE_BASE}/${bestMatch.id}`;
  }

  return null;
}

/**
 * Resolve a GIF/image URL for an exercise: WorkoutX first, free-exercise-db fallback.
 * Pass `equipment` (our schema's exercises.equipment enum value) whenever available —
 * it's the difference between a correctly-matched GIF and a wrong-equipment one.
 */
export async function fetchExerciseGif(exerciseName: string, equipment?: string | null): Promise<string | null> {
  const fromWorkoutX = await fetchFromWorkoutX(exerciseName, equipment);
  if (fromWorkoutX) return fromWorkoutX;

  return fetchFromFreeExerciseDb(exerciseName);
}
