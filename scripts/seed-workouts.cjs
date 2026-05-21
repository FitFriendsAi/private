// One-time script: import workout_data.csv for user ID 2
// Run: node scripts/seed-workouts.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const CSV_PATH = path.join(process.env.USERPROFILE || process.env.HOME, "Downloads", "workout_data.csv");
const USER_ID = 2;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseCSVRow(line) {
  const result = [];
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

function parseHevyDate(s) {
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const m = s.match(/(\d+)\s+(\w+)\s+(\d{4}),\s+(\d+):(\d+)/);
  if (!m) return { date: new Date().toISOString().slice(0, 10), iso: new Date().toISOString() };
  const [, day, mon, year, hour, min] = m;
  const d = new Date(parseInt(year), months[mon], parseInt(day), parseInt(hour), parseInt(min));
  return { date: d.toISOString().slice(0, 10), iso: d.toISOString() };
}

// Exercise → muscle mapping based on CSV exercise names
const MUSCLE_MAP = {
  "wide pull up": "back", "pull up": "back", "chin up": "back", "lat pulldown": "back",
  "seated cable row": "back", "bent over row": "back", "t-bar row": "back",
  "face pull": "back", "cable row": "back", "single arm dumbbell row": "back",
  "shoulder press (dumbbell)": "shoulders", "overhead press": "shoulders",
  "lateral raise": "shoulders", "front raise": "shoulders", "arnold press": "shoulders",
  "reverse fly": "shoulders", "upright row": "shoulders",
  "bench press (barbell)": "chest", "bench press (dumbbell)": "chest",
  "incline bench press": "chest", "incline dumbbell press": "chest",
  "cable fly": "chest", "chest fly": "chest", "push up": "chest", "dips": "chest",
  "bicep curl": "biceps", "hammer curl": "biceps", "preacher curl": "biceps",
  "cable curl": "biceps", "concentration curl": "biceps",
  "tricep pushdown": "triceps", "skull crusher": "triceps", "tricep dip": "triceps",
  "overhead tricep extension": "triceps", "close grip bench press": "triceps",
  "squat (barbell)": "quads", "squat": "quads", "leg press": "quads",
  "hack squat": "quads", "leg extension": "quads", "bulgarian split squat": "quads",
  "lunge": "quads", "front squat": "quads",
  "romanian deadlift": "hamstrings", "rdl": "hamstrings", "leg curl": "hamstrings",
  "deadlift": "hamstrings", "stiff leg deadlift": "hamstrings",
  "hip thrust": "glutes", "glute bridge": "glutes", "cable kickback": "glutes",
  "calf raise": "calves", "seated calf raise": "calves",
  "plank": "core", "crunch": "core", "cable crunch": "core", "ab wheel": "core",
};

function getMuscle(name) {
  const lower = name.toLowerCase();
  for (const [key, muscle] of Object.entries(MUSCLE_MAP)) {
    if (lower.includes(key)) return muscle;
  }
  return "other";
}

async function main() {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = csv.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = lines.slice(1);

  // Group by session
  const sessions = new Map();
  for (const line of rows) {
    const cols = parseCSVRow(line);
    const [title, startTime, endTime] = cols;
    const key = `${title}|||${startTime}`;
    if (!sessions.has(key)) sessions.set(key, { title, startTime, endTime, rows: [] });
    sessions.get(key).rows.push(cols);
  }

  // Load existing exercises
  const { rows: existingEx } = await pool.query("SELECT id, name FROM exercises WHERE user_id = $1 OR user_id IS NULL", [USER_ID]);
  const exerciseByName = new Map(existingEx.map(e => [e.name.toLowerCase(), e.id]));

  // Load existing workouts to deduplicate
  const { rows: existingW } = await pool.query("SELECT name, date FROM workouts WHERE user_id = $1", [USER_ID]);
  const existingKeys = new Set(existingW.map(w => `${w.name}|||${w.date}`));

  let imported = 0;
  let skipped = 0;

  for (const [, session] of sessions) {
    const { date, iso: startIso } = parseHevyDate(session.startTime);
    const { iso: endIso } = parseHevyDate(session.endTime);
    const durationMinutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);

    if (existingKeys.has(`${session.title}|||${date}`)) { skipped++; continue; }

    // Insert workout
    const { rows: [workout] } = await pool.query(
      `INSERT INTO workouts (user_id, name, date, duration_minutes, completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [USER_ID, session.title, date, durationMinutes > 0 ? durationMinutes : null, new Date(endIso)]
    );

    // Group sets by exercise
    const exGroups = new Map();
    for (const cols of session.rows) {
      const exName = cols[4];
      const setIndex = parseInt(cols[7]) || 0;
      const setType = cols[8] || "normal";
      const weightLbs = cols[9] ? parseFloat(cols[9]) : null;
      const reps = cols[10] ? parseInt(cols[10]) : null;
      if (!exGroups.has(exName)) exGroups.set(exName, []);
      exGroups.get(exName).push({ setIndex, weightLbs, reps, setType });
    }

    for (const [exName, sets] of exGroups) {
      let exerciseId = exerciseByName.get(exName.toLowerCase());
      if (!exerciseId) {
        const muscle = getMuscle(exName);
        const { rows: [ex] } = await pool.query(
          `INSERT INTO exercises (name, primary_muscle, secondary_muscles, category, equipment, is_custom, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [exName, muscle, JSON.stringify([]), "compound", "other", true, USER_ID]
        );
        exerciseId = ex.id;
        exerciseByName.set(exName.toLowerCase(), exerciseId);
      }

      const sorted = sets.sort((a, b) => a.setIndex - b.setIndex);
      for (const set of sorted) {
        await pool.query(
          `INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps, weight_grams, is_warmup)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workout.id, exerciseId, set.setIndex + 1, set.reps ?? 0,
           set.weightLbs ? Math.round(set.weightLbs * 453.592) : 0,
           set.setType === "warmup"]
        );
      }
    }

    imported++;
    process.stdout.write(`\r  Imported ${imported}/${sessions.size}...`);
  }

  console.log(`\nDone. Imported: ${imported}, Skipped (already existed): ${skipped}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
