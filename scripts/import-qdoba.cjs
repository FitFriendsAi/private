// One-time script: import scripts/qdoba.csv (Qdoba nutrition brochure data)
//   into the food_items table, skipping items that already exist (by name+brand).
// Run: node scripts/import-qdoba.cjs
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const CSV_PATH = path.join(__dirname, process.argv[2] || "qdoba.csv");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; continue; }
        inQuote = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === ",") { row.push(current); current = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(current); rows.push(row); row = []; current = ""; continue; }
    current += ch;
  }
  if (current.length > 0 || row.length > 0) { row.push(current); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

function num(v) {
  if (v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// calories, protein_g, carbs_g, fat_g are NOT NULL with default 0 in schema
function numOrZero(v) {
  const n = num(v);
  return n === null ? 0 : n;
}

async function main() {
  const allRows = parseCSV(fs.readFileSync(CSV_PATH, "utf-8"));
  const header = allRows[0];
  const rows = allRows.slice(1);

  console.log(`Loaded ${rows.length} rows from ${CSV_PATH}`);

  const existing = await pool.query(
    `SELECT lower(name) AS name, lower(brand) AS brand FROM food_items WHERE brand IS NOT NULL`
  );
  const existingKeys = new Set(existing.rows.map(r => `${r.name}|||${r.brand}`));
  console.log(`Found ${existingKeys.size} existing branded food_items for dedup`);

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const COLS = [
    "name", "brand", "serving_size_g", "serving_unit", "calories", "protein_g", "carbs_g", "fat_g",
    "fiber_g", "sodium_mg", "sugar_g", "saturated_fat_g", "trans_fat_g", "cholesterol_mg", "potassium_mg", "source",
  ];

  const toInsert = [];
  let skippedDupe = 0;
  for (const row of rows) {
    const name = row[idx.name];
    const brand = row[idx.brand];
    const key = `${name.toLowerCase()}|||${brand.toLowerCase()}`;
    if (existingKeys.has(key)) { skippedDupe++; continue; }
    existingKeys.add(key);
    toInsert.push([
      name, brand,
      num(row[idx.servingSizeG]), row[idx.servingUnit],
      numOrZero(row[idx.calories]), numOrZero(row[idx.proteinG]), numOrZero(row[idx.carbsG]), numOrZero(row[idx.fatG]),
      num(row[idx.fiberG]), num(row[idx.sodiumMg]), num(row[idx.sugarG]),
      num(row[idx.saturatedFatG]), num(row[idx.transFatG]), num(row[idx.cholesterolMg]), num(row[idx.potassiumMg]),
      row[idx.source],
    ]);
  }

  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const valuesSql = batch.map((_, r) =>
      `(${COLS.map((__, c) => `$${r * COLS.length + c + 1}`).join(",")})`
    ).join(",");
    const params = batch.flat();
    await pool.query(
      `INSERT INTO food_items (${COLS.join(",")}) VALUES ${valuesSql}`,
      params
    );
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }

  console.log(`Inserted ${inserted} rows, skipped ${skippedDupe} duplicates`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
