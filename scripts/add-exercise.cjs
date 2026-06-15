// One-time script: insert a single global exercise into the exercises table
// (skips if an exercise with the same name already exists).
// Run: node scripts/add-exercise.cjs
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const EXERCISE = {
  name: "Back Extension",
  primaryMuscle: "Back",
  secondaryMuscles: ["Glutes", "Hamstrings"],
  category: "isolation",
  equipment: "bodyweight",
};

(async () => {
  const existing = await pool.query("select id from exercises where lower(name) = lower($1)", [EXERCISE.name]);
  if (existing.rows.length > 0) {
    console.log(`Already exists (id=${existing.rows[0].id}), skipping.`);
    await pool.end();
    return;
  }
  const result = await pool.query(
    `insert into exercises (name, primary_muscle, secondary_muscles, category, equipment, is_custom, user_id)
     values ($1, $2, $3, $4, $5, false, null) returning id`,
    [EXERCISE.name, EXERCISE.primaryMuscle, JSON.stringify(EXERCISE.secondaryMuscles), EXERCISE.category, EXERCISE.equipment]
  );
  console.log(`Inserted "${EXERCISE.name}" with id=${result.rows[0].id}`);
  await pool.end();
})();
