/**
 * Exercise image lookup using the free-exercise-db dataset:
 * https://github.com/yuhonas/free-exercise-db
 *
 * No API key required. Images are hosted on GitHub's CDN.
 * Each exercise has 2 JPEG frames (0.jpg, 1.jpg) showing start/end position.
 * The frontend animates between them to simulate a GIF.
 *
 * We fetch the full exercises.json once on first use and keep it in memory.
 */

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

/**
 * Find an image base URL for the given exercise name.
 * Returns a URL like:
 *   https://raw.githubusercontent.com/.../exercises/Barbell_Bench_Press_-_Medium_Grip
 * The caller appends /0.jpg and /1.jpg for the two frames.
 */
export async function fetchExerciseGif(exerciseName: string): Promise<string | null> {
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
