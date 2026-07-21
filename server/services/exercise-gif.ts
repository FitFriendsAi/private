/**
 * Exercise GIF lookup, tried in order:
 *
 * 1. omercotkd/exercises-gifs (https://github.com/omercotkd/exercises-gifs) —
 *    1,323 unwatermarked GIFs on jsDelivr's public CDN, no API key, no rate limit.
 *    We fetch its exercises.csv once and match locally by name + equipment.
 *
 * 2. WorkoutX API (https://workoutxapp.com) — real animated GIFs via name search,
 *    but watermarked and metered. Requires WORKOUTX_API_KEY. Results are cached
 *    by the caller (storage.updateExerciseGifUrl) so each exercise is only ever
 *    looked up once against WorkoutX's quota.
 *
 * 3. free-exercise-db (https://github.com/yuhonas/free-exercise-db) — final
 *    fallback when neither of the above has a confident match. No API key
 *    required; images are hosted on GitHub's CDN. We fetch its exercises.json
 *    once on first use and keep it in memory.
 */

// ── Shared matching helpers ───────────────────────────────────────────────────

/** Normalise a name for fuzzy matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fraction of the query's significant words (len > 2) found in a candidate name.
 * Coverage-of-query rather than a symmetric ratio, so a candidate with extra
 * descriptive words ("dumbbell SEATED shoulder press", "lever KNEELING leg curl")
 * doesn't get penalised for being more specific than the query.
 */
function overlap(query: string, candidate: string): number {
  const queryWords = query.split(" ").filter(w => w.length > 2);
  const candidateWords = new Set(candidate.split(" ").filter(w => w.length > 2));
  if (queryWords.length === 0) return 0;
  const common = queryWords.filter(w => candidateWords.has(w)).length;
  return common / queryWords.length;
}

/**
 * Minimum overlap score to accept a match, stricter for short queries.
 * A 2-word query like "Face Pull" sharing just "pull" with an unrelated
 * "Cable Twisting Pull" scores 0.5 under a flat threshold — too permissive
 * when there's so little signal to begin with. Short queries require every
 * significant word to match; longer ones tolerate some variant-name drift.
 */
function overlapThreshold(query: string): number {
  const wordCount = query.split(" ").filter(w => w.length > 2).length;
  return wordCount <= 2 ? 1.0 : 0.6;
}

/**
 * Pick the best-matching candidate for a query out of a list, or null if nothing
 * clears overlapThreshold(query). Shared by all three GIF sources below.
 * `query` need not be pre-normalised — normalisation happens internally, same as
 * for each candidate's name.
 *
 * Ranks by overlap score first, then — since multiple variants of an exercise
 * commonly all achieve full coverage ("Hammer Curl" matches plain "Dumbbell
 * Hammer Curl" AND "Dumbbell Alternate Hammer Preacher Curl" equally under pure
 * coverage) — prefers whichever candidate name has fewer significant words,
 * i.e. the more generic/canonical variant over a more specific one.
 */
function pickBestMatch<T>(
  query: string,
  candidates: T[],
  getName: (c: T) => string,
  isEligible: (c: T) => boolean = () => true,
): T | null {
  const needle = norm(query);
  const threshold = overlapThreshold(needle);
  let best: T | null = null;
  let bestScore = 0;
  let bestWordCount = Infinity;

  for (const c of candidates) {
    if (!isEligible(c)) continue;
    const candidateName = norm(getName(c));
    const score = overlap(needle, candidateName);
    if (score < threshold) continue;
    const wordCount = candidateName.split(" ").filter(w => w.length > 2).length;
    if (score > bestScore || (score === bestScore && wordCount < bestWordCount)) {
      best = c; bestScore = score; bestWordCount = wordCount;
    }
  }

  return best;
}

/** Quote-aware CSV row split — same approach as the Hevy CSV importer in routes.ts. */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(current); current = ""; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// Equipment words to strip from a query before searching a remote source — searching
// the bare movement name ("Bench Press" instead of "Barbell Bench Press (Smith Machine)")
// returns a far larger, more reliable candidate pool; equipment is matched afterward
// via each source's own equipment field.
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
// each remote source's own equipment field is matched by substring per bucket.
type EquipBucket = "barbell" | "dumbbell" | "cable" | "machine" | "smith" | "bodyweight" | null;

function bucketFromEnum(equipment: string | null | undefined): EquipBucket {
  switch (equipment) {
    case "barbell":       return "barbell";
    case "dumbbell":      return "dumbbell";
    case "cable":         return "cable";
    case "machine":       return "machine";
    case "smith_machine": return "smith";
    case "bodyweight":
    case "none":          return "bodyweight";
    default:              return null; // "other" or any unmapped value
  }
}

/**
 * Equipment keyword scan over the exercise name itself (base name or parenthetical
 * suffix, e.g. "Bench Press (Smith Machine)", "Bodyweight Squat") — used when the
 * DB's equipment enum is "other"/unmapped, which is true for ~30% of the catalog.
 * Order matters: check "smith"/"machine" before the single-word checks so
 * "Smith Machine" doesn't get misread as plain "machine".
 */
function bucketFromName(exerciseName: string): EquipBucket {
  const lower = exerciseName.toLowerCase();
  if (/\bsmith\b/.test(lower))                            return "smith";
  if (/\bmachine\b/.test(lower))                          return "machine";
  if (/\bbarbell\b/.test(lower))                          return "barbell";
  if (/\bdumbbell\b/.test(lower))                         return "dumbbell";
  if (/\bcable\b/.test(lower))                            return "cable";
  if (/\bbody\s*weight\b/.test(lower) || /\bbodyweight\b/.test(lower)) return "bodyweight";
  return null;
}

/** DB equipment enum first; falls back to scanning the exercise name when unmapped. */
function resolveEquipmentBucket(exerciseName: string, equipment: string | null | undefined): EquipBucket {
  return bucketFromEnum(equipment) ?? bucketFromName(exerciseName);
}

// ── Source 1: omercotkd/exercises-gifs (unwatermarked, no key, no limit) ──────

const EXGIFS_CSV_URL =
  "https://cdn.jsdelivr.net/gh/omercotkd/exercises-gifs@main/exercises.csv";
const EXGIFS_ASSET_BASE =
  "https://cdn.jsdelivr.net/gh/omercotkd/exercises-gifs@main/assets";

interface ExGifsExercise {
  id: string;         // e.g. "0025" — matches assets/0025.gif
  name: string;        // e.g. "barbell bench press"
  equipment: string;   // e.g. "barbell", "leverage machine", "body weight"
}

let cachedExGifs: ExGifsExercise[] | null = null;

async function loadExGifsCsv(): Promise<ExGifsExercise[]> {
  if (cachedExGifs) return cachedExGifs;
  try {
    const res = await fetch(EXGIFS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    const header = parseCSVRow(lines[0]);
    const idxEquipment = header.indexOf("equipment");
    const idxId = header.indexOf("id");
    const idxName = header.indexOf("name");
    cachedExGifs = lines.slice(1).map(line => {
      const cols = parseCSVRow(line);
      return {
        id: cols[idxId] ?? "",
        name: cols[idxName] ?? "",
        equipment: cols[idxEquipment] ?? "",
      };
    }).filter(e => e.id && e.name);
    console.log(`[exercise-gif] Loaded ${cachedExGifs.length} exercises from exercises-gifs repo`);
  } catch (err) {
    console.warn("[exercise-gif] Could not load exercises-gifs CSV:", err);
    cachedExGifs = [];
  }
  return cachedExGifs;
}

// This dataset's equipment field is a clean, pre-normalised category (unlike
// WorkoutX's free-text), so bucket matching is a simple exact/substring check.
const EXGIFS_EQUIPMENT_SUBSTRINGS: Record<Exclude<EquipBucket, null>, string[]> = {
  barbell:    ["barbell"],             // covers "barbell", "ez barbell", "olympic barbell"
  dumbbell:   ["dumbbell"],
  cable:      ["cable"],
  machine:    ["leverage machine"],
  smith:      ["smith machine"],
  bodyweight: ["body weight"],
};

function exGifsEquipmentMatches(bucket: EquipBucket, datasetEquipment: string): boolean {
  if (bucket === null) return true;
  const e = datasetEquipment.toLowerCase();
  return EXGIFS_EQUIPMENT_SUBSTRINGS[bucket].some(sub => e.includes(sub));
}

/**
 * Look up an unwatermarked GIF from the omercotkd/exercises-gifs mirror.
 * Word-overlap on the equipment-stripped name, gated by requiring the equipment
 * bucket to match. No confident match returns null so the caller tries WorkoutX next.
 */
async function fetchFromExercisesGifsRepo(exerciseName: string, equipment?: string | null): Promise<string | null> {
  const list = await loadExGifsCsv();
  if (list.length === 0) return null;

  const query = buildSearchQuery(exerciseName);
  const bucket = resolveEquipmentBucket(exerciseName, equipment);

  const best = pickBestMatch(
    query, list,
    e => stripEquipmentWords(e.name),
    e => exGifsEquipmentMatches(bucket, e.equipment),
  );

  return best ? `${EXGIFS_ASSET_BASE}/${best.id}.gif` : null;
}

// ── Source 2: WorkoutX API (watermarked, metered, requires key) ───────────────

const WORKOUTX_BASE = "https://api.workoutxapp.com";

interface WorkoutXExercise {
  id: string;
  name: string;
  equipment?: string;
  gifUrl?: string;
}

const WORKOUTX_EQUIPMENT_SUBSTRINGS: Record<Exclude<EquipBucket, null>, string[]> = {
  barbell:    ["barbell"],       // covers "Barbell", "Olympic Barbell"
  dumbbell:   ["dumbbell"],
  cable:      ["cable"],
  machine:    ["machine", "leverage"], // covers "Machine", "Leverage Machine" — but NOT "Smith Machine", see below
  smith:      ["smith"],
  bodyweight: ["body weight", "bodyweight"],
};

function equipmentMatches(bucket: EquipBucket, workoutXEquipment: string | undefined): boolean {
  if (bucket === null) return true; // unknown our-side enum — don't filter
  const e = (workoutXEquipment ?? "").toLowerCase();
  // "Smith Machine" contains the substring "machine", so the machine bucket must
  // explicitly exclude it — otherwise a Smith-only exercise satisfies a generic
  // machine filter and vice versa never happens (smith's own check is unaffected).
  if (bucket === "machine" && e.includes("smith")) return false;
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
  const bucket = resolveEquipmentBucket(exerciseName, equipment);

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

    const best = pickBestMatch(
      query, results,
      e => stripEquipmentWords(e.name),
      e => equipmentMatches(bucket, e.equipment),
    );

    return best?.gifUrl ?? null;
  } catch (err) {
    console.warn("[exercise-gif] WorkoutX lookup failed:", err);
    return null;
  }
}

// ── Source 3: free-exercise-db (final fallback, 2-frame JPGs not true GIFs) ───

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

  // 2. Best word-overlap match, threshold scaled by query length (see overlapThreshold)
  const bestMatch = pickBestMatch(needle, list, e => e.name, e => e.images.length > 0);
  return bestMatch ? `${IMAGE_BASE}/${bestMatch.id}` : null;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Resolve a GIF/image URL for an exercise: exercises-gifs repo first (unwatermarked,
 * unmetered), then WorkoutX, then free-exercise-db as a last resort.
 * Pass `equipment` (our schema's exercises.equipment enum value) whenever available —
 * it's the difference between a correctly-matched GIF and a wrong-equipment one.
 */
export async function fetchExerciseGif(exerciseName: string, equipment?: string | null): Promise<string | null> {
  const fromExGifs = await fetchFromExercisesGifsRepo(exerciseName, equipment);
  if (fromExGifs) return fromExGifs;

  const fromWorkoutX = await fetchFromWorkoutX(exerciseName, equipment);
  if (fromWorkoutX) return fromWorkoutX;

  return fetchFromFreeExerciseDb(exerciseName);
}
