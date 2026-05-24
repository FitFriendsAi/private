// server/index.ts
import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg2 from "pg";

// server/auth.ts
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

// server/storage.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc, gte, lte, like, or, isNull, sql, inArray } from "drizzle-orm";

// shared/schema.ts
import { pgTable, serial, text, integer, real, boolean, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
var userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  heightCm: real("height_cm"),
  birthDate: date("birth_date"),
  sex: text("sex"),
  // male | female | other
  activityLevel: text("activity_level").default("moderate"),
  // sedentary|light|moderate|active|very_active
  weightUnitPref: text("weight_unit_pref").default("lbs"),
  // lbs | kg
  volumeUnitPref: text("volume_unit_pref").default("oz"),
  // oz | ml
  updatedAt: timestamp("updated_at").defaultNow()
});
var insertUserProfileSchema = createInsertSchema(userProfiles).omit({ id: true });
var goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  // weight_loss | weight_gain | strength | body_comp
  label: text("label").notNull(),
  targetValue: real("target_value").notNull(),
  // grams for weight, grams for lifts
  unit: text("unit").notNull(),
  // lbs | kg | % (body fat)
  deadline: date("deadline"),
  startValue: real("start_value"),
  startDate: date("start_date"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  exerciseId: integer("exercise_id"),
  // for strength goals
  createdAt: timestamp("created_at").defaultNow()
});
var insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true });
var bodyMeasurements = pgTable("body_measurements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  weightGrams: real("weight_grams").notNull(),
  bodyFatPercent: real("body_fat_percent"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow()
});
var insertBodyMeasurementSchema = createInsertSchema(bodyMeasurements).omit({ id: true, createdAt: true });
var foodItems = pgTable("food_items", {
  id: serial("id").primaryKey(),
  barcode: text("barcode").unique(),
  name: text("name").notNull(),
  brand: text("brand"),
  servingSizeG: real("serving_size_g").notNull(),
  servingUnit: text("serving_unit").default("g"),
  calories: real("calories").notNull(),
  proteinG: real("protein_g").notNull().default(0),
  carbsG: real("carbs_g").notNull().default(0),
  fatG: real("fat_g").notNull().default(0),
  fiberG: real("fiber_g"),
  sodiumMg: real("sodium_mg"),
  sugarG: real("sugar_g"),
  saturatedFatG: real("saturated_fat_g"),
  transFatG: real("trans_fat_g"),
  cholesterolMg: real("cholesterol_mg"),
  potassiumMg: real("potassium_mg"),
  calciumMg: real("calcium_mg"),
  ironMg: real("iron_mg"),
  vitaminDMcg: real("vitamin_d_mcg"),
  vitaminCMg: real("vitamin_c_mg"),
  source: text("source").default("custom"),
  // openfoodfacts | custom | scanned
  createdAt: timestamp("created_at").defaultNow()
});
var insertFoodItemSchema = createInsertSchema(foodItems).omit({ id: true, createdAt: true });
var foodLog = pgTable("food_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  mealType: text("meal_type").notNull(),
  // breakfast | lunch | dinner | snack
  foodItemId: integer("food_item_id").references(() => foodItems.id),
  foodName: text("food_name").notNull(),
  // denormalized for display
  servings: real("servings").notNull().default(1),
  caloriesActual: real("calories_actual").notNull(),
  proteinActual: real("protein_actual").notNull().default(0),
  carbsActual: real("carbs_actual").notNull().default(0),
  fatActual: real("fat_actual").notNull().default(0),
  fiberActual: real("fiber_actual"),
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow()
});
var insertFoodLogSchema = createInsertSchema(foodLog).omit({ id: true, loggedAt: true });
var nutritionTargets = pgTable("nutrition_targets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  effectiveDate: date("effective_date").notNull(),
  calories: real("calories").notNull(),
  proteinG: real("protein_g").notNull(),
  carbsG: real("carbs_g").notNull(),
  fatG: real("fat_g").notNull(),
  waterMl: real("water_ml").notNull().default(2500),
  updatedAt: timestamp("updated_at").defaultNow()
});
var insertNutritionTargetSchema = createInsertSchema(nutritionTargets).omit({ id: true });
var waterLog = pgTable("water_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  amountMl: real("amount_ml").notNull(),
  loggedAt: timestamp("logged_at").defaultNow()
});
var insertWaterLogSchema = createInsertSchema(waterLog).omit({ id: true, loggedAt: true });
var supplementLog = pgTable("supplement_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  supplement: text("supplement").notNull(),
  // creatine | protein | pre_workout | vitamin | other
  amountG: real("amount_g"),
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow()
});
var insertSupplementLogSchema = createInsertSchema(supplementLog).omit({ id: true, loggedAt: true });
var exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  primaryMuscle: text("primary_muscle").notNull(),
  secondaryMuscles: jsonb("secondary_muscles").$type().default([]),
  category: text("category").notNull(),
  // compound | isolation | cardio | bodyweight
  equipment: text("equipment"),
  // barbell | dumbbell | machine | cable | bodyweight | none
  isCustom: boolean("is_custom").default(false),
  userId: integer("user_id"),
  // null = global, set = user-specific
  gifUrl: text("gif_url")
  // cached from ExerciseDB API
});
var insertExerciseSchema = createInsertSchema(exercises).omit({ id: true });
var workoutTemplates = pgTable("workout_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow()
});
var insertWorkoutTemplateSchema = createInsertSchema(workoutTemplates).omit({ id: true, createdAt: true });
var templateExercises = pgTable("template_exercises", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => workoutTemplates.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  orderIndex: integer("order_index").notNull(),
  targetSets: integer("target_sets").notNull().default(3),
  targetReps: text("target_reps").default("8-12"),
  // can be range like "8-12"
  targetWeightGrams: real("target_weight_grams")
});
var insertTemplateExerciseSchema = createInsertSchema(templateExercises).omit({ id: true });
var workouts = pgTable("workouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  templateId: integer("template_id").references(() => workoutTemplates.id),
  name: text("name").notNull(),
  notes: text("notes"),
  durationMinutes: integer("duration_minutes"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow()
});
var insertWorkoutSchema = createInsertSchema(workouts).omit({ id: true, createdAt: true });
var heartRateLog = pgTable("heart_rate_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  /** Client-side epoch ms when the reading was taken */
  ts: timestamp("ts").notNull(),
  bpm: integer("bpm").notNull()
});
var insertHeartRateLogSchema = createInsertSchema(heartRateLog).omit({ id: true });
var savedMeals = pgTable("saved_meals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow()
});
var insertSavedMealSchema = createInsertSchema(savedMeals).omit({ id: true, createdAt: true });
var mealIngredients = pgTable("meal_ingredients", {
  id: serial("id").primaryKey(),
  mealId: integer("meal_id").notNull().references(() => savedMeals.id, { onDelete: "cascade" }),
  foodItemId: integer("food_item_id").references(() => foodItems.id),
  foodName: text("food_name").notNull(),
  // denormalised for display without join
  servings: real("servings").notNull().default(1),
  caloriesActual: real("calories_actual").notNull(),
  proteinActual: real("protein_actual").notNull().default(0),
  carbsActual: real("carbs_actual").notNull().default(0),
  fatActual: real("fat_actual").notNull().default(0)
});
var insertMealIngredientSchema = createInsertSchema(mealIngredients).omit({ id: true });
var workoutSets = pgTable("workout_sets", {
  id: serial("id").primaryKey(),
  workoutId: integer("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps").notNull(),
  weightGrams: real("weight_grams").notNull().default(0),
  rpe: real("rpe"),
  // rate of perceived exertion 1-10
  isWarmup: boolean("is_warmup").default(false),
  completedAt: timestamp("completed_at").defaultNow()
});
var insertWorkoutSetSchema = createInsertSchema(workoutSets).omit({ id: true });

// server/storage.ts
var pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  idleTimeoutMillis: 6e4,
  connectionTimeoutMillis: 5e3
});
var db = drizzle(pool);
var storage = {
  // ── Users ──────────────────────────────────────────────────────────────────
  async createUser(data) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },
  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  },
  async getUserById(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },
  // ── Profile ────────────────────────────────────────────────────────────────
  async getProfile(userId) {
    const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return p;
  },
  async upsertProfile(userId, data) {
    const existing = await this.getProfile(userId);
    if (existing) {
      const [p2] = await db.update(userProfiles).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(userProfiles.userId, userId)).returning();
      return p2;
    }
    const [p] = await db.insert(userProfiles).values({ userId, ...data }).returning();
    return p;
  },
  // ── Goals ──────────────────────────────────────────────────────────────────
  async getGoals(userId) {
    return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.createdAt));
  },
  async createGoal(data) {
    const [g] = await db.insert(goals).values(data).returning();
    return g;
  },
  async updateGoal(id, userId, data) {
    const [g] = await db.update(goals).set(data).where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();
    return g;
  },
  async deleteGoal(id, userId) {
    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  },
  // ── Body Measurements ──────────────────────────────────────────────────────
  async getMeasurements(userId, limit = 90) {
    return db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)).orderBy(desc(bodyMeasurements.date)).limit(limit);
  },
  async createMeasurement(data) {
    const [m] = await db.insert(bodyMeasurements).values(data).returning();
    return m;
  },
  async getLatestMeasurement(userId) {
    const [m] = await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)).orderBy(desc(bodyMeasurements.date)).limit(1);
    return m;
  },
  // ── Food Items ─────────────────────────────────────────────────────────────
  async getFoodItemById(id) {
    const [item] = await db.select().from(foodItems).where(eq(foodItems.id, id));
    return item;
  },
  async getFoodItemByBarcode(barcode) {
    const [item] = await db.select().from(foodItems).where(eq(foodItems.barcode, barcode));
    return item;
  },
  async searchFoodItems(query, foodQuery) {
    const q = foodQuery || query;
    return db.select().from(foodItems).where(or(like(foodItems.name, `%${q}%`), like(foodItems.brand, `%${q}%`))).limit(30);
  },
  async createFoodItem(data) {
    const [item] = await db.insert(foodItems).values(data).returning();
    return item;
  },
  async updateFoodItem(id, patch) {
    const [item] = await db.update(foodItems).set(patch).where(eq(foodItems.id, id)).returning();
    return item;
  },
  // ── Food Log ───────────────────────────────────────────────────────────────
  async getFoodLog(userId, date2) {
    return db.select().from(foodLog).where(and(eq(foodLog.userId, userId), eq(foodLog.date, date2))).orderBy(foodLog.loggedAt);
  },
  async createFoodLogEntry(data) {
    const [entry] = await db.insert(foodLog).values(data).returning();
    return entry;
  },
  async updateFoodLogEntry(id, userId, data) {
    const [entry] = await db.update(foodLog).set(data).where(and(eq(foodLog.id, id), eq(foodLog.userId, userId))).returning();
    return entry;
  },
  async deleteFoodLogEntry(id, userId) {
    await db.delete(foodLog).where(and(eq(foodLog.id, id), eq(foodLog.userId, userId)));
  },
  /** Aggregated food-log summary for charts.
   *  Always returns a COMPLETE scaffold of every period bucket (zeros for days with no data),
   *  so the x-axis is fully populated regardless of logging history.
   */
  async getFoodLogSummary(userId, period) {
    const today = /* @__PURE__ */ new Date();
    const ds = (d) => d.toISOString().slice(0, 10);
    const addDay = (d, n) => {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    };
    const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let buckets;
    let groupBy;
    if (period === "1W") {
      groupBy = "day";
      buckets = Array.from({ length: 7 }, (_, i) => {
        const d = addDay(today, i - 6);
        return { key: ds(d), label: DAY_ABBR[d.getDay()] };
      });
    } else if (period === "1M") {
      groupBy = "day";
      buckets = Array.from({ length: 30 }, (_, i) => {
        const d = addDay(today, i - 29);
        return { key: ds(d), label: String(d.getDate()) };
      });
    } else if (period === "3M") {
      groupBy = "week";
      const start = addDay(today, -90);
      const dow = start.getDay();
      start.setDate(start.getDate() - ((dow === 0 ? 7 : dow) - 1));
      buckets = [];
      for (let d = new Date(start); d <= today; d = addDay(d, 7)) {
        buckets.push({ key: ds(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
    } else if (period === "1Y") {
      groupBy = "month";
      buckets = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
        return {
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          label: MONTH_ABBR[d.getMonth()]
        };
      });
    } else {
      groupBy = "month";
      buckets = [];
      for (let d = new Date(2020, 0, 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.getFullYear() === today.getFullYear() ? MONTH_ABBR[d.getMonth()] : `${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
        buckets.push({ key, label });
      }
    }
    const fromDate = buckets[0].key;
    const toDate = ds(today);
    const rows = await db.select({
      date: foodLog.date,
      calories: sql`coalesce(sum(${foodLog.caloriesActual}), 0)`,
      protein: sql`coalesce(sum(${foodLog.proteinActual}), 0)`,
      carbs: sql`coalesce(sum(${foodLog.carbsActual}), 0)`,
      fat: sql`coalesce(sum(${foodLog.fatActual}), 0)`
    }).from(foodLog).where(and(
      eq(foodLog.userId, userId),
      gte(foodLog.date, fromDate),
      lte(foodLog.date, toDate)
    )).groupBy(foodLog.date).orderBy(foodLog.date);
    const normDate = (raw) => {
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return String(raw).slice(0, 10);
    };
    const dayMap = /* @__PURE__ */ new Map();
    for (const r of rows) {
      dayMap.set(normDate(r.date), {
        cal: Number(r.calories),
        prt: Number(r.protein),
        crb: Number(r.carbs),
        fat: Number(r.fat)
      });
    }
    if (groupBy === "day") {
      return buckets.map((b) => {
        const d = dayMap.get(b.key) ?? { cal: 0, prt: 0, crb: 0, fat: 0 };
        return { period: b.key, label: b.label, calories: d.cal, protein: d.prt, carbs: d.crb, fat: d.fat };
      });
    }
    const accMap = /* @__PURE__ */ new Map();
    for (const [dateStr, d] of dayMap) {
      let bucketKey;
      if (groupBy === "week") {
        const date2 = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
        const dow = date2.getDay();
        const mon = new Date(date2);
        mon.setDate(date2.getDate() - ((dow === 0 ? 7 : dow) - 1));
        bucketKey = ds(mon);
      } else {
        bucketKey = dateStr.slice(0, 7);
      }
      if (!buckets.some((b) => b.key === bucketKey)) continue;
      const cur = accMap.get(bucketKey) ?? { cal: 0, prt: 0, crb: 0, fat: 0, days: 0 };
      accMap.set(bucketKey, {
        cal: cur.cal + d.cal,
        prt: cur.prt + d.prt,
        crb: cur.crb + d.crb,
        fat: cur.fat + d.fat,
        days: cur.days + (d.cal > 0 ? 1 : 0)
        // only count days with actual data
      });
    }
    return buckets.map((b) => {
      const v = accMap.get(b.key);
      const n = v?.days ?? 0;
      return {
        period: b.key,
        label: b.label,
        calories: n > 0 ? Math.round(v.cal / n) : 0,
        protein: n > 0 ? Math.round(v.prt / n) : 0,
        carbs: n > 0 ? Math.round(v.crb / n) : 0,
        fat: n > 0 ? Math.round(v.fat / n) : 0
      };
    });
  },
  // ── Nutrition Targets ──────────────────────────────────────────────────────
  async getNutritionTarget(userId) {
    const [t] = await db.select().from(nutritionTargets).where(eq(nutritionTargets.userId, userId)).orderBy(desc(nutritionTargets.effectiveDate)).limit(1);
    return t;
  },
  async upsertNutritionTarget(userId, data) {
    const existing = await this.getNutritionTarget(userId);
    if (existing) {
      const [t2] = await db.update(nutritionTargets).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(nutritionTargets.userId, userId)).returning();
      return t2;
    }
    const [t] = await db.insert(nutritionTargets).values({ userId, ...data }).returning();
    return t;
  },
  // ── Water Log ──────────────────────────────────────────────────────────────
  async getWaterLog(userId, date2) {
    return db.select().from(waterLog).where(and(eq(waterLog.userId, userId), eq(waterLog.date, date2)));
  },
  async createWaterEntry(data) {
    const [entry] = await db.insert(waterLog).values(data).returning();
    return entry;
  },
  async deleteWaterEntry(id, userId) {
    await db.delete(waterLog).where(and(eq(waterLog.id, id), eq(waterLog.userId, userId)));
  },
  async getWaterHistory(userId, days) {
    const since = /* @__PURE__ */ new Date();
    since.setDate(since.getDate() - days + 1);
    const sinceStr = since.toISOString().slice(0, 10);
    const rows = await db.select({ date: waterLog.date, totalMl: sql`sum(${waterLog.amountMl})` }).from(waterLog).where(and(eq(waterLog.userId, userId), gte(waterLog.date, sinceStr))).groupBy(waterLog.date).orderBy(waterLog.date);
    return rows;
  },
  // ── Supplement Log ─────────────────────────────────────────────────────────
  async getSupplementLog(userId, date2) {
    return db.select().from(supplementLog).where(and(eq(supplementLog.userId, userId), eq(supplementLog.date, date2)));
  },
  async createSupplementEntry(data) {
    const [entry] = await db.insert(supplementLog).values(data).returning();
    return entry;
  },
  async deleteSupplementEntry(id, userId) {
    await db.delete(supplementLog).where(and(eq(supplementLog.id, id), eq(supplementLog.userId, userId)));
  },
  async getSupplementHistory(userId, days, supplement) {
    const since = /* @__PURE__ */ new Date();
    since.setDate(since.getDate() - days + 1);
    const sinceStr = since.toLocaleDateString("en-CA");
    return db.select({ date: supplementLog.date, totalG: sql`sum(${supplementLog.amountG})` }).from(supplementLog).where(and(eq(supplementLog.userId, userId), gte(supplementLog.date, sinceStr), eq(supplementLog.supplement, supplement))).groupBy(supplementLog.date).orderBy(supplementLog.date);
  },
  // ── Exercises ──────────────────────────────────────────────────────────────
  async getExercises(userId, muscle, search) {
    let q = db.select().from(exercises).where(or(isNull(exercises.userId), eq(exercises.userId, userId)));
    const results = await q.orderBy(exercises.name);
    return results.filter((e) => {
      if (muscle && e.primaryMuscle.toLowerCase() !== muscle.toLowerCase()) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  },
  async createExercise(data) {
    const [e] = await db.insert(exercises).values(data).returning();
    return e;
  },
  async getExerciseById(id) {
    const [e] = await db.select().from(exercises).where(eq(exercises.id, id));
    return e;
  },
  async updateExerciseGifUrl(id, gifUrl) {
    await db.update(exercises).set({ gifUrl }).where(eq(exercises.id, id));
  },
  async countExercises() {
    const result = await db.select().from(exercises).where(isNull(exercises.userId));
    return result.length;
  },
  async seedExercises(data) {
    await db.insert(exercises).values(data);
  },
  // ── Workout Templates ──────────────────────────────────────────────────────
  async getTemplates(userId) {
    return db.select().from(workoutTemplates).where(eq(workoutTemplates.userId, userId)).orderBy(workoutTemplates.name);
  },
  async createTemplate(data) {
    const [t] = await db.insert(workoutTemplates).values(data).returning();
    return t;
  },
  async updateTemplate(id, userId, data) {
    const [t] = await db.update(workoutTemplates).set(data).where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId))).returning();
    return t;
  },
  async deleteTemplate(id, userId) {
    await db.delete(workoutTemplates).where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId)));
  },
  // ── Template Exercises ─────────────────────────────────────────────────────
  async getTemplateExercises(templateId) {
    return db.select().from(templateExercises).where(eq(templateExercises.templateId, templateId)).orderBy(templateExercises.orderIndex);
  },
  /** Returns template exercises with exercise details (name, muscle, category).
   *  Uses two separate queries so exercises are never silently dropped if the
   *  exercise row is missing (avoids INNER JOIN dropping rows). */
  async getTemplateExercisesWithDetails(templateId) {
    const tes = await db.select().from(templateExercises).where(eq(templateExercises.templateId, templateId)).orderBy(templateExercises.orderIndex);
    if (tes.length === 0) return [];
    const exIds = [...new Set(tes.map((te) => te.exerciseId))];
    const exRows = await db.select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle, category: exercises.category }).from(exercises).where(inArray(exercises.id, exIds));
    const exMap = new Map(exRows.map((e) => [e.id, e]));
    return tes.map((te) => {
      const ex = exMap.get(te.exerciseId);
      return {
        id: te.id,
        templateId: te.templateId,
        exerciseId: te.exerciseId,
        orderIndex: te.orderIndex,
        targetSets: te.targetSets,
        targetReps: te.targetReps,
        targetWeightGrams: te.targetWeightGrams,
        exerciseName: ex?.name ?? `Exercise #${te.exerciseId}`,
        primaryMuscle: ex?.primaryMuscle ?? "",
        category: ex?.category ?? ""
      };
    });
  },
  async addTemplateExercise(data) {
    const [te] = await db.insert(templateExercises).values(data).returning();
    return te;
  },
  async updateTemplateExercise(id, data) {
    const [te] = await db.update(templateExercises).set(data).where(eq(templateExercises.id, id)).returning();
    return te;
  },
  async removeTemplateExercise(id) {
    await db.delete(templateExercises).where(eq(templateExercises.id, id));
  },
  // ── Workouts ───────────────────────────────────────────────────────────────
  async getWorkouts(userId, limit = 20) {
    return db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(limit);
  },
  async createWorkout(data) {
    const [w] = await db.insert(workouts).values(data).returning();
    return w;
  },
  async getWorkoutById(id, userId) {
    const [w] = await db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, userId)));
    return w;
  },
  async updateWorkout(id, userId, data) {
    const [w] = await db.update(workouts).set(data).where(and(eq(workouts.id, id), eq(workouts.userId, userId))).returning();
    return w;
  },
  async deleteWorkout(id, userId) {
    await db.delete(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, userId)));
  },
  // ── Workout Sets ───────────────────────────────────────────────────────────
  async getWorkoutSets(workoutId) {
    return db.select().from(workoutSets).where(eq(workoutSets.workoutId, workoutId)).orderBy(workoutSets.exerciseId, workoutSets.setNumber);
  },
  /** Returns max weight (grams) + total reps per workout session for one exercise. */
  async getExerciseHistory(exerciseId, userId) {
    const rows = await db.select({
      date: workouts.date,
      weightGrams: workoutSets.weightGrams,
      reps: workoutSets.reps,
      setNumber: workoutSets.setNumber
    }).from(workoutSets).innerJoin(workouts, eq(workoutSets.workoutId, workouts.id)).where(and(eq(workoutSets.exerciseId, exerciseId), eq(workouts.userId, userId))).orderBy(workouts.date, workoutSets.setNumber);
    function toDateStr(d) {
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      if (typeof d === "string") return d.slice(0, 10);
      return String(d).slice(0, 10);
    }
    const byDate = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const key = toDateStr(r.date);
      const w = r.weightGrams ?? 0;
      const rep = r.reps ?? 0;
      const e1rm = rep > 0 ? w * (1 + rep / 30) : w;
      const setVol = w * rep;
      const cur = byDate.get(key) ?? {
        maxW: 0,
        bestE1rm: 0,
        bestSetVol: 0,
        sessionVol: 0,
        totalReps: 0,
        sets: 0,
        setsData: []
      };
      byDate.set(key, {
        maxW: Math.max(cur.maxW, w),
        bestE1rm: Math.max(cur.bestE1rm, e1rm),
        bestSetVol: Math.max(cur.bestSetVol, setVol),
        sessionVol: cur.sessionVol + setVol,
        totalReps: cur.totalReps + rep,
        sets: cur.sets + 1,
        setsData: [...cur.setsData, { reps: rep, weightGrams: w }]
      });
    }
    return Array.from(byDate.entries()).map(([date2, v]) => ({
      date: date2,
      maxWeightGrams: v.maxW,
      e1rmGrams: Math.round(v.bestE1rm),
      bestSetVolume: v.bestSetVol,
      sessionVolume: v.sessionVol,
      totalReps: v.totalReps,
      sets: v.sets,
      setsData: v.setsData
    }));
  },
  /** Returns the distinct exercise IDs the user has ever logged a set for. */
  async getLoggedExerciseIds(userId) {
    const rows = await db.selectDistinct({ exerciseId: workoutSets.exerciseId }).from(workoutSets).innerJoin(workouts, eq(workoutSets.workoutId, workouts.id)).where(eq(workouts.userId, userId));
    return rows.map((r) => r.exerciseId);
  },
  async createWorkoutSet(data) {
    const [s] = await db.insert(workoutSets).values(data).returning();
    return s;
  },
  async updateWorkoutSet(id, data) {
    const [s] = await db.update(workoutSets).set(data).where(eq(workoutSets.id, id)).returning();
    return s;
  },
  async deleteWorkoutSet(id) {
    await db.delete(workoutSets).where(eq(workoutSets.id, id));
  },
  // ── Heart Rate Log ─────────────────────────────────────────────────────────
  /** Bulk-insert a batch of readings (called from client flush every 30s) */
  async bulkInsertHeartRate(entries) {
    if (entries.length === 0) return;
    await db.insert(heartRateLog).values(entries);
  },
  /** Return all readings for a given UTC date (YYYY-MM-DD) */
  async getHeartRateForDate(userId, date2) {
    const start = /* @__PURE__ */ new Date(`${date2}T00:00:00.000Z`);
    const end = /* @__PURE__ */ new Date(`${date2}T23:59:59.999Z`);
    return db.select().from(heartRateLog).where(and(
      eq(heartRateLog.userId, userId),
      gte(heartRateLog.ts, start),
      lte(heartRateLog.ts, end)
    )).orderBy(heartRateLog.ts);
  },
  /** Return one row per minute (last reading in that minute) for charting */
  async getHeartRateSummary(userId, date2) {
    const rows = await this.getHeartRateForDate(userId, date2);
    const buckets = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const bucket = Math.floor(r.ts.getTime() / 6e4);
      buckets.set(bucket, { ts: r.ts, bpm: r.bpm });
    }
    return Array.from(buckets.values()).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  },
  async getPreviousWorkoutSets(userId, exerciseId) {
    const [lastWorkout] = await db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(1);
    if (!lastWorkout) return [];
    const sessions = await db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(10);
    for (const session2 of sessions) {
      const sets = await db.select().from(workoutSets).where(and(eq(workoutSets.workoutId, session2.id), eq(workoutSets.exerciseId, exerciseId)));
      if (sets.length > 0) return sets;
    }
    return [];
  },
  // ── Saved Meals ────────────────────────────────────────────────────────────
  async getMeals(userId) {
    const meals = await db.select().from(savedMeals).where(eq(savedMeals.userId, userId)).orderBy(desc(savedMeals.createdAt));
    const result = [];
    for (const meal of meals) {
      const ingredients = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, meal.id));
      result.push({ ...meal, ingredients });
    }
    return result;
  },
  async getMeal(id, userId) {
    const [meal] = await db.select().from(savedMeals).where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
    if (!meal) return null;
    const ingredients = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, id));
    return { ...meal, ingredients };
  },
  async createMeal(data, ingredients) {
    const [meal] = await db.insert(savedMeals).values(data).returning();
    const rows = await db.insert(mealIngredients).values(ingredients.map((i) => ({ ...i, mealId: meal.id }))).returning();
    return { ...meal, ingredients: rows };
  },
  async updateMeal(id, userId, data, ingredients) {
    const [meal] = await db.update(savedMeals).set({ name: data.name, description: data.description }).where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId))).returning();
    if (!meal) return null;
    if (ingredients) {
      await db.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
      await db.insert(mealIngredients).values(ingredients.map((i) => ({ ...i, mealId: id })));
    }
    const rows = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, id));
    return { ...meal, ingredients: rows };
  },
  async deleteMeal(id, userId) {
    await db.delete(savedMeals).where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
  },
  async logMeal(mealId, userId, date2, mealType) {
    const [meal] = await db.select().from(savedMeals).where(and(eq(savedMeals.id, mealId), eq(savedMeals.userId, userId)));
    if (!meal) throw new Error("Meal not found");
    const ingredients = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, mealId));
    const entries = await db.insert(foodLog).values(ingredients.map((ing) => ({
      userId,
      date: date2,
      mealType,
      foodItemId: ing.foodItemId,
      foodName: ing.foodName,
      servings: ing.servings,
      caloriesActual: ing.caloriesActual,
      proteinActual: ing.proteinActual,
      carbsActual: ing.carbsActual,
      fatActual: ing.fatActual
    }))).returning();
    return entries;
  }
};

// server/auth.ts
var scryptAsync = promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString("hex")}.${salt}`;
}
async function verifyPassword(password, hash) {
  const [hashed, salt] = hash.split(".");
  const buf = await scryptAsync(password, salt, 64);
  return timingSafeEqual(buf, Buffer.from(hashed, "hex"));
}
passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await storage.getUserByEmail(email);
      if (!user) return done(null, false, { message: "Invalid email or password" });
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) return done(null, false, { message: "Invalid email or password" });
      return done(null, user);
    } catch (err) {
      console.error("Auth DB error:", err.message);
      return done(null, false, { message: "Server error \u2014 please try again" });
    }
  })
);
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await storage.getUserById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// server/routes.ts
import Anthropic2 from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";

// server/services/food-lookup.ts
function fetchWithTimeout(url, options = {}, timeoutMs = 7e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
async function lookupBarcode(barcode) {
  try {
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      { headers: { "User-Agent": "FitCore/1.0 (fitness tracker)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments || {};
    const perServing = p.serving_size ? true : false;
    const servingG = parseServingSize(p.serving_size) || 100;
    const scale = perServing ? 1 : servingG / 100;
    const calories = extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale) ?? (extractNutrient(n, "energy", "energy_serving", scale) ?? 0) / 4.184;
    return {
      name: p.product_name || p.product_name_en || "Unknown Product",
      brand: p.brands,
      barcode,
      servingSizeG: servingG,
      servingUnit: p.serving_size || "100g",
      calories: Math.round(calories),
      proteinG: extractNutrient(n, "proteins", "proteins_serving", scale) ?? 0,
      carbsG: extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
      fatG: extractNutrient(n, "fat", "fat_serving", scale) ?? 0,
      fiberG: extractNutrient(n, "fiber", "fiber_serving", scale),
      sodiumMg: extractOFFSodium(n, scale),
      sugarG: extractNutrient(n, "sugars", "sugars_serving", scale),
      saturatedFatG: extractNutrient(n, "saturated-fat", "saturated-fat_serving", scale),
      transFatG: extractNutrient(n, "trans-fat", "trans-fat_serving", scale),
      cholesterolMg: extractOFFCholesterol(n, scale),
      potassiumMg: extractOFFMineral(n, "potassium", scale),
      calciumMg: extractOFFMineral(n, "calcium", scale),
      ironMg: extractOFFMineral(n, "iron", scale),
      vitaminDMcg: extractOFFVitamin(n, "vitamin-d", scale),
      vitaminCMg: extractOFFVitamin(n, "vitamin-c", scale)
    };
  } catch {
    return null;
  }
}
function extractNutrient(n, per100Key, servingKey, scale) {
  if (n[servingKey] !== void 0) return Math.round(n[servingKey] * 10) / 10;
  if (n[per100Key] !== void 0) return Math.round(n[per100Key] * scale * 10) / 10;
  return void 0;
}
function extractOFFSodium(n, scale) {
  const v = extractNutrient(n, "sodium", "sodium_serving", scale);
  return v !== void 0 ? v * 1e3 : void 0;
}
function extractOFFCholesterol(n, scale) {
  const v = extractNutrient(n, "cholesterol", "cholesterol_serving", scale);
  return v !== void 0 ? v * 1e3 : void 0;
}
function extractOFFMineral(n, key, scale) {
  const v = extractNutrient(n, key, `${key}_serving`, scale);
  return v !== void 0 ? v * 1e3 : void 0;
}
function extractOFFVitamin(n, key, scale) {
  const v = extractNutrient(n, key, `${key}_serving`, scale);
  return v !== void 0 ? Math.round(v * 1e3 * 10) / 10 : void 0;
}
function parseServingSize(serving) {
  if (!serving) return null;
  const match = serving.match(/(\d+\.?\d*)\s*g/i);
  if (match) return parseFloat(match[1]);
  const mlMatch = serving.match(/(\d+\.?\d*)\s*ml/i);
  if (mlMatch) return parseFloat(mlMatch[1]);
  const ozMatch = serving.match(/(\d+\.?\d*)\s*oz/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.35;
  return null;
}
var _fsToken = null;
var _fsTokenExpiry = 0;
async function getFatSecretToken() {
  const FS_CLIENT_ID = process.env.FATSECRET_CLIENT_ID?.trim();
  const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET?.trim();
  console.log(`[FatSecret] credentials check: id=${FS_CLIENT_ID ? "SET(" + FS_CLIENT_ID.slice(0, 6) + "...)" : "MISSING"} secret=${FS_CLIENT_SECRET ? "SET" : "MISSING"}`);
  if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) {
    console.warn("[FatSecret] credentials missing \u2014 set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET");
    return null;
  }
  if (_fsToken && Date.now() < _fsTokenExpiry) return _fsToken;
  try {
    const creds = Buffer.from(`${FS_CLIENT_ID}:${FS_CLIENT_SECRET}`).toString("base64");
    const res = await fetchWithTimeout("https://oauth.fatsecret.com/connect/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials&scope=basic"
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[FatSecret] token fetch failed: HTTP ${res.status} \u2014 ${body}`);
      return null;
    }
    const data = await res.json();
    if (!data.access_token) {
      console.error("[FatSecret] token response missing access_token:", JSON.stringify(data));
      return null;
    }
    _fsToken = data.access_token;
    _fsTokenExpiry = Date.now() + (data.expires_in - 120) * 1e3;
    console.log(`[FatSecret] token acquired, expires in ${data.expires_in}s`);
    return _fsToken;
  } catch (err) {
    console.error("[FatSecret] token fetch threw:", err?.message ?? err);
    return null;
  }
}
async function searchFatSecret(query, limit = 25) {
  const token = await getFatSecretToken();
  if (!token) return [];
  try {
    const url = `https://platform.fatsecret.com/rest/server.api?method=foods.search&search_expression=${encodeURIComponent(query)}&format=json&max_results=${limit}&page_number=0`;
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
    });
    if (!res.ok) {
      console.error(`[FatSecret] search failed: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const raw = data.foods?.food;
    if (!raw) return [];
    const foods = Array.isArray(raw) ? raw : [raw];
    return foods.filter((f) => f.food_description).map((f) => {
      const desc2 = f.food_description;
      const calories = parseFloat(desc2.match(/Calories:\s*([\d.]+)/i)?.[1] ?? "0");
      const fat = parseFloat(desc2.match(/Fat:\s*([\d.]+)/i)?.[1] ?? "0");
      const carbs = parseFloat(desc2.match(/Carbs:\s*([\d.]+)/i)?.[1] ?? "0");
      const protein = parseFloat(desc2.match(/Protein:\s*([\d.]+)/i)?.[1] ?? "0");
      const servingG = parseFloat(desc2.match(/\(([\d.]+)g\)/i)?.[1] ?? "100");
      const servingLabel = desc2.match(/^Per (.+?) -/i)?.[1] ?? "1 serving";
      return {
        name: f.food_name,
        brand: f.brand_name || void 0,
        servingSizeG: servingG || 100,
        servingUnit: servingLabel,
        calories: Math.round(calories),
        proteinG: Math.round(protein * 10) / 10,
        carbsG: Math.round(carbs * 10) / 10,
        fatG: Math.round(fat * 10) / 10
      };
    });
  } catch {
    return [];
  }
}
async function searchCalorieNinjas(query, limit = 20) {
  const CN_KEY = process.env.CALORIENINJA_API_KEY?.trim();
  if (!CN_KEY) return [];
  try {
    const res = await fetchWithTimeout(
      `https://api.calorieninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`,
      { headers: { "X-Api-Key": CN_KEY, "Accept": "application/json" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data.items || []).slice(0, limit);
    return items.filter((item) => item.calories != null).map((item) => ({
      name: toTitleCaseCN(item.name),
      servingSizeG: item.serving_size_g || 100,
      servingUnit: `${item.serving_size_g || 100}g`,
      calories: Math.round(item.calories || 0),
      proteinG: Math.round((item.protein_g || 0) * 10) / 10,
      carbsG: Math.round((item.carbohydrates_total_g || 0) * 10) / 10,
      fatG: Math.round((item.fat_total_g || 0) * 10) / 10,
      fiberG: item.fiber_g != null ? Math.round(item.fiber_g * 10) / 10 : void 0,
      sodiumMg: item.sodium_mg != null ? Math.round(item.sodium_mg) : void 0,
      sugarG: item.sugar_g != null ? Math.round(item.sugar_g * 10) / 10 : void 0
    }));
  } catch {
    return [];
  }
}
function toTitleCaseCN(str) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
async function searchBrandOFF(brandQuery, limit = 25) {
  try {
    const slug = brandQuery.toLowerCase().replace(/[''']/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/brand/${slug}/1.json?page_size=${limit}&fields=product_name,brands,serving_size,nutriments,code`,
      { headers: { "User-Agent": "FitCore/1.0" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const products = data.products || [];
    return products.filter((p) => p.product_name && p.nutriments?.["energy-kcal_100g"]).map((p) => {
      const n = p.nutriments || {};
      const servingG = parseServingSize(p.serving_size) || 100;
      const scale = p.serving_size ? 1 : servingG / 100;
      return {
        name: p.product_name,
        brand: p.brands,
        barcode: p.code,
        servingSizeG: servingG,
        servingUnit: p.serving_size || "100g",
        calories: Math.round(extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale) ?? 0),
        proteinG: extractNutrient(n, "proteins", "proteins_serving", scale) ?? 0,
        carbsG: extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
        fatG: extractNutrient(n, "fat", "fat_serving", scale) ?? 0,
        fiberG: extractNutrient(n, "fiber", "fiber_serving", scale),
        sodiumMg: extractOFFSodium(n, scale),
        sugarG: extractNutrient(n, "sugars", "sugars_serving", scale),
        saturatedFatG: extractNutrient(n, "saturated-fat", "saturated-fat_serving", scale),
        transFatG: extractNutrient(n, "trans-fat", "trans-fat_serving", scale),
        cholesterolMg: extractOFFCholesterol(n, scale),
        potassiumMg: extractOFFMineral(n, "potassium", scale),
        calciumMg: extractOFFMineral(n, "calcium", scale),
        ironMg: extractOFFMineral(n, "iron", scale),
        vitaminDMcg: extractOFFVitamin(n, "vitamin-d", scale),
        vitaminCMg: extractOFFVitamin(n, "vitamin-c", scale)
      };
    });
  } catch {
    return [];
  }
}
function getUsdaKey() {
  return process.env.USDA_API_KEY?.trim() || "DEMO_KEY";
}
function apostropheVariant(q) {
  if (q.includes("'") || q.includes("\u2019")) return null;
  const variant = q.replace(/([a-zA-Z]+)s\b/g, "$1's");
  return variant !== q ? variant : null;
}
async function fetchUSDA(query, limit, brandedOnly = false) {
  try {
    const dataType = brandedOnly ? "Branded" : "Branded,Survey%20(FNDDS)";
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=${limit}&api_key=${getUsdaKey()}&dataType=${dataType}`;
    const res = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.foods || [];
  } catch {
    return [];
  }
}
async function searchUSDA(query, limit = 20, brandedOnly = false) {
  try {
    const variant = apostropheVariant(query);
    const [foods1, foods2] = await Promise.all([
      fetchUSDA(query, limit, brandedOnly),
      variant ? fetchUSDA(variant, Math.ceil(limit / 2), brandedOnly) : Promise.resolve([])
    ]);
    const seenIds = /* @__PURE__ */ new Set();
    const foods = [];
    for (const f of [...foods1, ...foods2]) {
      if (!seenIds.has(f.fdcId)) {
        seenIds.add(f.fdcId);
        foods.push(f);
      }
    }
    return foods.filter((f) => {
      const hasCalories = f.foodNutrients?.some(
        (n) => n.nutrientId === 1008 || n.nutrientName === "Energy"
      );
      return f.description && hasCalories;
    }).map((f) => {
      const nMap = {};
      for (const n of f.foodNutrients || []) {
        nMap[n.nutrientId] = n.value ?? 0;
      }
      const servingSizeG = f.servingSize && f.servingSizeUnit?.toLowerCase() === "g" ? f.servingSize : f.servingSize && f.servingSizeUnit?.toLowerCase() === "oz" ? f.servingSize * 28.35 : 100;
      const scale = servingSizeG / 100;
      return {
        name: toTitleCase(f.description),
        brand: f.brandOwner || f.brandName,
        servingSizeG,
        servingUnit: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || "g"}` : "100g",
        calories: Math.round((nMap[1008] || 0) * scale),
        proteinG: Math.round((nMap[1003] || 0) * scale * 10) / 10,
        carbsG: Math.round((nMap[1005] || 0) * scale * 10) / 10,
        fatG: Math.round((nMap[1004] || 0) * scale * 10) / 10,
        fiberG: nMap[1079] != null ? Math.round(nMap[1079] * scale * 10) / 10 : void 0,
        sodiumMg: nMap[1093] != null ? Math.round(nMap[1093] * scale) : void 0,
        sugarG: nMap[2e3] != null ? Math.round(nMap[2e3] * scale * 10) / 10 : void 0,
        // USDA nutrient IDs: 1258=Sat fat, 1257=Trans fat, 1253=Cholesterol(mg),
        // 1092=Potassium(mg), 1087=Calcium(mg), 1089=Iron(mg),
        // 1114=Vit D(µg), 1162=Vit C(mg)
        saturatedFatG: nMap[1258] != null ? Math.round(nMap[1258] * scale * 10) / 10 : void 0,
        transFatG: nMap[1257] != null ? Math.round(nMap[1257] * scale * 10) / 10 : void 0,
        cholesterolMg: nMap[1253] != null ? Math.round(nMap[1253] * scale) : void 0,
        potassiumMg: nMap[1092] != null ? Math.round(nMap[1092] * scale) : void 0,
        calciumMg: nMap[1087] != null ? Math.round(nMap[1087] * scale) : void 0,
        ironMg: nMap[1089] != null ? Math.round(nMap[1089] * scale * 100) / 100 : void 0,
        vitaminDMcg: nMap[1114] != null ? Math.round(nMap[1114] * scale * 10) / 10 : void 0,
        vitaminCMg: nMap[1162] != null ? Math.round(nMap[1162] * scale * 10) / 10 : void 0
      };
    });
  } catch {
    return [];
  }
}
function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
async function searchOFF(query, limit = 20) {
  try {
    const res = await fetchWithTimeout(
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=${limit}&fields=product_name,brands,serving_size,nutriments,code`,
      { headers: { "User-Agent": "FitCore/1.0 (fitness tracker)" } },
      8e3
    );
    if (!res.ok) return [];
    const data = await res.json();
    const products = data.hits || [];
    return mapOFFProducts(products);
  } catch {
    return [];
  }
}
function mapOFFProducts(products) {
  return products.filter((p) => p.product_name && (p.nutriments?.["energy-kcal_100g"] || p.nutriments?.["energy-kcal_serving"])).map((p) => {
    const n = p.nutriments || {};
    const servingG = parseServingSize(p.serving_size) || 100;
    const hasServing = !!p.serving_size;
    const scale = hasServing ? 1 : servingG / 100;
    const cals = extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale);
    if (!cals || cals <= 0) return null;
    return {
      name: p.product_name,
      brand: p.brands || void 0,
      barcode: p.code || void 0,
      servingSizeG: servingG,
      servingUnit: p.serving_size || "100g",
      calories: Math.round(cals),
      proteinG: extractNutrient(n, "proteins", "proteins_serving", scale) ?? 0,
      carbsG: extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
      fatG: extractNutrient(n, "fat", "fat_serving", scale) ?? 0,
      fiberG: extractNutrient(n, "fiber", "fiber_serving", scale),
      sodiumMg: extractOFFSodium(n, scale),
      sugarG: extractNutrient(n, "sugars", "sugars_serving", scale),
      saturatedFatG: extractNutrient(n, "saturated-fat", "saturated-fat_serving", scale),
      transFatG: extractNutrient(n, "trans-fat", "trans-fat_serving", scale),
      cholesterolMg: extractOFFCholesterol(n, scale),
      potassiumMg: extractOFFMineral(n, "potassium", scale),
      calciumMg: extractOFFMineral(n, "calcium", scale),
      ironMg: extractOFFMineral(n, "iron", scale),
      vitaminDMcg: extractOFFVitamin(n, "vitamin-d", scale),
      vitaminCMg: extractOFFVitamin(n, "vitamin-c", scale)
    };
  }).filter((x) => x !== null);
}
var ENRICHABLE_FIELDS = [
  "fiberG",
  "sodiumMg",
  "sugarG",
  "saturatedFatG",
  "transFatG",
  "cholesterolMg",
  "potassiumMg",
  "calciumMg",
  "ironMg",
  "vitaminDMcg",
  "vitaminCMg"
];
async function enrichMissingNutrition(item) {
  const missing = ENRICHABLE_FIELDS.filter((f) => item[f] == null);
  if (missing.length === 0) return {};
  let donor = null;
  if (item.barcode) {
    donor = await lookupBarcode(item.barcode);
  }
  if (!donor) {
    const query = [item.name, item.brand].filter(Boolean).join(" ");
    const hits = await searchOFF(query, 15);
    if (hits.length) {
      const toWords = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
      const itemWords = /* @__PURE__ */ new Set([
        ...toWords(item.name),
        ...toWords(item.brand ?? "")
      ]);
      let bestScore = 0;
      for (const h of hits) {
        const hWords = /* @__PURE__ */ new Set([
          ...toWords(h.name),
          ...toWords(h.brand ?? "")
        ]);
        let common = 0;
        for (const w of itemWords) if (hWords.has(w)) common++;
        const score = itemWords.size ? common / Math.max(itemWords.size, hWords.size) : 0;
        if (score > bestScore) {
          bestScore = score;
          donor = h;
        }
      }
      if (bestScore < 0.5) donor = null;
    }
  }
  if (!donor) return {};
  let scaledDonor = donor;
  if (item.servingSizeG && donor.servingSizeG && Math.abs(donor.servingSizeG - item.servingSizeG) / item.servingSizeG > 0.15) {
    const ratio = item.servingSizeG / donor.servingSizeG;
    const rescale = (v) => v != null ? Math.round(v * ratio * 10) / 10 : void 0;
    scaledDonor = {
      ...donor,
      fiberG: rescale(donor.fiberG),
      sodiumMg: donor.sodiumMg != null ? Math.round(donor.sodiumMg * ratio) : void 0,
      sugarG: rescale(donor.sugarG),
      saturatedFatG: rescale(donor.saturatedFatG),
      transFatG: rescale(donor.transFatG),
      cholesterolMg: donor.cholesterolMg != null ? Math.round(donor.cholesterolMg * ratio) : void 0,
      potassiumMg: donor.potassiumMg != null ? Math.round(donor.potassiumMg * ratio) : void 0,
      calciumMg: donor.calciumMg != null ? Math.round(donor.calciumMg * ratio) : void 0,
      ironMg: rescale(donor.ironMg),
      vitaminDMcg: rescale(donor.vitaminDMcg),
      vitaminCMg: rescale(donor.vitaminCMg)
    };
  }
  const patch = {};
  for (const f of missing) {
    const val = scaledDonor[f];
    if (val != null) patch[f] = val;
  }
  return patch;
}

// server/services/vision.ts
import Anthropic from "@anthropic-ai/sdk";
var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
var LABEL_PROMPT = `You are a nutrition label reader. Extract the nutrition information from this image of a food product's nutrition facts label.

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "name": "product name if visible, otherwise 'Scanned Food'",
  "brand": "brand name if visible, otherwise null",
  "servingSizeG": <serving size in grams as a number>,
  "servingUnit": "<serving description, e.g. '1 cup (240g)'>",
  "calories": <number>,
  "proteinG": <grams of protein as number>,
  "carbsG": <grams of total carbohydrates as number>,
  "fatG": <grams of total fat as number>,
  "fiberG": <grams of dietary fiber as number or null if not present>,
  "sodiumMg": <milligrams of sodium as number or null if not present>,
  "sugarG": <grams of total sugars as number or null if not present>
}

If a value is not visible or unclear, use null for optional fields or 0 for required fields.
Convert all units to the specified units (g, mg, kcal).`;
async function parseNutritionLabel(imageBase64, mediaType) {
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64
              }
            },
            { type: "text", text: LABEL_PROMPT }
          ]
        }
      ]
    });
    const text2 = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text2.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      name: parsed.name || "Scanned Food",
      brand: parsed.brand || void 0,
      servingSizeG: parsed.servingSizeG || 100,
      servingUnit: parsed.servingUnit || "serving",
      calories: Math.round(parsed.calories || 0),
      proteinG: parsed.proteinG || 0,
      carbsG: parsed.carbsG || 0,
      fatG: parsed.fatG || 0,
      fiberG: parsed.fiberG ?? void 0,
      sodiumMg: parsed.sodiumMg ?? void 0,
      sugarG: parsed.sugarG ?? void 0
    };
  } catch (err) {
    console.error("Vision parse error:", err);
    return null;
  }
}

// server/services/goal-engine.ts
var ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};
function calculateBMR(weightKg, heightCm, ageYears, sex) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}
function calculateTDEE(bmr, activityLevel) {
  return Math.round(bmr * ACTIVITY_MULTIPLIERS[activityLevel]);
}
function calculateMacroTargets(params) {
  const { weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays } = params;
  const bmr = calculateBMR(weightKg, heightCm, ageYears, sex);
  const tdee = calculateTDEE(bmr, activityLevel);
  let calorieAdjustment = 0;
  let proteinMultiplier = 0.82;
  const weightLbs = weightKg * 2.20462;
  if (goalType === "weight_loss" && targetWeightKg && deadlineDays && deadlineDays > 0) {
    const deficitKg = weightKg - targetWeightKg;
    const totalDeficit = deficitKg * 7700;
    const dailyDeficit = totalDeficit / deadlineDays;
    calorieAdjustment = -Math.min(dailyDeficit, 1e3);
    proteinMultiplier = 0.82;
  } else if (goalType === "weight_gain" && targetWeightKg && deadlineDays && deadlineDays > 0) {
    const surplusKg = targetWeightKg - weightKg;
    const totalSurplus = surplusKg * 7700;
    const dailySurplus = totalSurplus / deadlineDays;
    calorieAdjustment = Math.min(dailySurplus, 500);
    proteinMultiplier = 0.9;
  } else if (goalType === "strength") {
    calorieAdjustment = 200;
    proteinMultiplier = 1;
  }
  const calories = Math.round(Math.max(tdee + calorieAdjustment, 1200));
  const proteinG = Math.round(weightLbs * proteinMultiplier);
  const proteinCals = proteinG * 4;
  const fatCals = calories * 0.28;
  const fatG = Math.round(fatCals / 9);
  const carbCals = calories - proteinCals - fatCals;
  const carbsG = Math.max(Math.round(carbCals / 4), 50);
  const waterMl = Math.max(Math.round(weightKg * 35), 2e3);
  return { calories, proteinG, carbsG, fatG, waterMl };
}
function getAgeFromBirthDate(birthDate) {
  const birth = new Date(birthDate);
  const today = /* @__PURE__ */ new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || m === 0 && today.getDate() < birth.getDate()) age--;
  return age;
}

// server/services/exercise-gif.ts
var EXERCISES_JSON_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
var IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";
var cachedExercises = null;
async function loadExercises() {
  if (cachedExercises) return cachedExercises;
  try {
    const res = await fetch(EXERCISES_JSON_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedExercises = await res.json();
    console.log(`[exercise-gif] Loaded ${cachedExercises.length} exercises from free-exercise-db`);
  } catch (err) {
    console.warn("[exercise-gif] Could not load free-exercise-db:", err);
    cachedExercises = [];
  }
  return cachedExercises;
}
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function overlap(a, b) {
  const wa = new Set(a.split(" ").filter((w) => w.length > 2));
  const wb = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  wa.forEach((w) => {
    if (wb.has(w)) common++;
  });
  return common / Math.max(wa.size, wb.size);
}
async function fetchExerciseGif(exerciseName) {
  const list = await loadExercises();
  if (list.length === 0) return null;
  const needle = norm(exerciseName);
  const exact = list.find((e) => norm(e.name) === needle);
  if (exact && exact.images.length > 0) {
    return `${IMAGE_BASE}/${exact.id}`;
  }
  let bestScore = 0;
  let bestMatch = null;
  for (const e of list) {
    const score = overlap(needle, norm(e.name));
    if (score > bestScore) {
      bestScore = score;
      bestMatch = e;
    }
  }
  if (bestMatch && bestScore >= 0.5 && bestMatch.images.length > 0) {
    return `${IMAGE_BASE}/${bestMatch.id}`;
  }
  return null;
}

// server/routes.ts
import { z } from "zod";
function requireAuth(req, res) {
  if (req.isAuthenticated()) return true;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const secret = process.env.SESSION_SECRET ?? "fitcore-jwt-secret";
      const payload = jwt.verify(auth.slice(7), secret);
      req.user = { id: payload.userId };
      return true;
    } catch {
    }
  }
  res.sendStatus(401);
  return false;
}
async function recalculateTargets(userId) {
  const profile = await storage.getProfile(userId);
  const [activeGoal] = (await storage.getGoals(userId)).filter((g) => g.isActive && (g.type === "weight_loss" || g.type === "weight_gain" || g.type === "maintain"));
  const latestMeasurement = await storage.getLatestMeasurement(userId);
  if (!profile || !latestMeasurement || !profile.birthDate || !profile.heightCm) return;
  const weightKg = latestMeasurement.weightGrams / 1e3;
  const heightCm = profile.heightCm;
  const ageYears = getAgeFromBirthDate(profile.birthDate);
  const sex = profile.sex ?? "male";
  const activityLevel = profile.activityLevel ?? "moderate";
  let goalType = "maintain";
  let targetWeightKg;
  let deadlineDays;
  if (activeGoal) {
    goalType = activeGoal.type;
    if (activeGoal.targetValue) targetWeightKg = activeGoal.targetValue / 1e3;
    if (activeGoal.deadline) {
      const days = Math.ceil((new Date(activeGoal.deadline).getTime() - Date.now()) / 864e5);
      deadlineDays = Math.max(days, 1);
    }
  }
  const targets = calculateMacroTargets({ weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays });
  await storage.upsertNutritionTarget(userId, { effectiveDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), ...targets });
}
function registerRoutes(app2) {
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = insertUserSchema.extend({ password: z.string().min(8) }).omit({ passwordHash: true }).parse(req.body);
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "Email already in use" });
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({ email, name, passwordHash });
      req.login(user, (err) => {
        if (err) return res.sendStatus(500);
        res.json({ id: user.id, email: user.email, name: user.name });
      });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (err2) => {
        if (err2) return next(err2);
        res.json({ id: user.id, email: user.email, name: user.name });
      });
    })(req, res, next);
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.logout(() => res.sendStatus(200));
  });
  app2.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const u = req.user;
    res.json({ id: u.id, email: u.email, name: u.name });
  });
  const JWT_SECRET = process.env.SESSION_SECRET ?? "fitcore-jwt-secret";
  function requireMobileAuth(req, res) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.sendStatus(401);
      return null;
    }
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      return { id: payload.userId };
    } catch {
      res.sendStatus(401);
      return null;
    }
  }
  app2.post("/api/auth/login-mobile", async (req, res) => {
    try {
      const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "90d" });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      const isDbError = err.code && /^[0-9A-Z]{5}$/.test(err.code);
      const status = isDbError ? 503 : 400;
      const message = isDbError ? "Server error \u2014 please try again" : err.message;
      console.error("login-mobile error:", err.message);
      res.status(status).json({ message });
    }
  });
  app2.get("/api/auth/me-mobile", async (req, res) => {
    const mobile = requireMobileAuth(req, res);
    if (!mobile) return;
    const user = await storage.getUserById(mobile.id);
    if (!user) return res.sendStatus(404);
    res.json({ id: user.id, email: user.email, name: user.name });
  });
  app2.get("/api/profile", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const profile = await storage.getProfile(userId);
    res.json(profile ?? null);
  });
  app2.put("/api/profile", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    try {
      const data = insertUserProfileSchema.omit({ userId: true }).partial().parse(req.body);
      const profile = await storage.upsertProfile(userId, data);
      await recalculateTargets(userId);
      res.json(profile);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/goals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(await storage.getGoals(req.user.id));
  });
  app2.post("/api/goals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertGoalSchema.omit({ userId: true }).parse(req.body);
      const goal = await storage.createGoal({ ...data, userId });
      await recalculateTargets(userId);
      res.status(201).json(goal);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.patch("/api/goals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const goal = await storage.updateGoal(Number(req.params.id), userId, req.body);
    if (!goal) return res.sendStatus(404);
    await recalculateTargets(userId);
    res.json(goal);
  });
  app2.delete("/api/goals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteGoal(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.get("/api/measurements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const limit = req.query.limit ? Number(req.query.limit) : 90;
    res.json(await storage.getMeasurements(req.user.id, limit));
  });
  app2.post("/api/measurements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertBodyMeasurementSchema.omit({ userId: true }).parse(req.body);
      const m = await storage.createMeasurement({ ...data, userId });
      await recalculateTargets(userId);
      res.status(201).json(m);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/food/search", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const q = req.query.q;
    const typeFilter = req.query.type || "all";
    if (!q || q.length < 2) return res.json([]);
    const ql = q.toLowerCase();
    function normName(s) {
      return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    }
    function wordSet(s) {
      return new Set(normName(s).split(" ").filter((w) => w.length > 2));
    }
    function nameSimilarity(a, b) {
      const wa = wordSet(a);
      const wb = wordSet(b);
      if (!wa.size || !wb.size) return 0;
      let common = 0;
      for (const w of wa) if (wb.has(w)) common++;
      return common / Math.max(wa.size, wb.size);
    }
    function nutritionScore(item) {
      return (item.fiberG != null ? 1 : 0) + (item.sodiumMg != null ? 1 : 0) + (item.sugarG != null ? 1 : 0);
    }
    function mergeNutrition(base, donor) {
      return {
        ...base,
        fiberG: base.fiberG ?? donor.fiberG,
        sodiumMg: base.sodiumMg ?? donor.sodiumMg,
        sugarG: base.sugarG ?? donor.sugarG
      };
    }
    function fuseItems(items) {
      const used = /* @__PURE__ */ new Set();
      const results = [];
      for (let i = 0; i < items.length; i++) {
        if (used.has(i)) continue;
        used.add(i);
        let best = items[i];
        for (let j = i + 1; j < items.length; j++) {
          if (used.has(j)) continue;
          const other = items[j];
          const ba = normName(best.brand || best.brandOwner || "");
          const bb = normName(other.brand || other.brandOwner || "");
          if (ba && bb && ba !== bb) continue;
          if (nameSimilarity(best.name, other.name) < 0.8) continue;
          used.add(j);
          if (nutritionScore(other) > nutritionScore(best)) {
            best = mergeNutrition(other, best);
          } else {
            best = mergeNutrition(best, other);
          }
        }
        results.push(best);
      }
      return results;
    }
    const RESTAURANT_BRANDS = [
      [/chick[\s-]*fil[\s-]*a/i, "chick-fil-a"],
      [/mcdonald/i, "mcdonalds"],
      [/burger\s*king/i, "burger-king"],
      [/wendy/i, "wendys"],
      [/taco\s*bell/i, "taco-bell"],
      [/\bsubway\b/i, "subway"],
      [/chipotle/i, "chipotle"],
      [/panera/i, "panera"],
      [/starbucks/i, "starbucks"],
      [/dunkin/i, "dunkin-donuts"],
      [/domino/i, "dominos-pizza"],
      [/pizza\s*hut/i, "pizza-hut"],
      [/\bkfc\b/i, "kfc"],
      [/popeyes/i, "popeyes"],
      [/five\s*guys/i, "five-guys"],
      [/shake\s*shack/i, "shake-shack"],
      [/whataburger/i, "whataburger"],
      [/in[\s-]*n[\s-]*out/i, "in-n-out-burger"],
      [/\bsonic\b/i, "sonic"],
      [/\barby/i, "arbys"],
      [/dairy\s*queen/i, "dairy-queen"],
      [/chili'?s/i, "chilis"],
      [/applebee'?s/i, "applebees"],
      [/olive\s*garden/i, "olive-garden"],
      [/red\s*lobster/i, "red-lobster"],
      [/raising\s*cane/i, "raising-canes"],
      [/\bcanes\b/i, "raising-canes"],
      [/wingstop/i, "wingstop"],
      [/panda\s*express/i, "panda-express"],
      [/\bpanerabread\b/i, "panera"],
      [/jimmy\s*john/i, "jimmy-johns"],
      [/jersey\s*mike/i, "jersey-mikes"],
      [/firehouse/i, "firehouse-subs"],
      [/\bchilis\b/i, "chilis"]
    ];
    const matchedBrand = RESTAURANT_BRANDS.find(([rx]) => rx.test(q));
    const isRestaurant = typeFilter === "restaurant" || !!matchedBrand;
    const brandSlug = matchedBrand?.[1] ?? q;
    const matchedBrandNorm = matchedBrand ? normName(matchedBrand[1]) : null;
    const foodOnlyQuery = matchedBrand ? q.replace(matchedBrand[0], "").replace(/\s+/g, " ").trim() || q : q;
    const queryWords = wordSet(q);
    function relevanceScore(item) {
      const brandNorm = normName(item.brand || item.brandOwner || "");
      const nameNorm = normName(item.name || "");
      const qNorm = normName(q);
      const qWords = wordSet(qNorm);
      const itemWords = /* @__PURE__ */ new Set([...wordSet(brandNorm), ...wordSet(nameNorm)]);
      const sim = nameSimilarity(brandNorm + " " + nameNorm, qNorm);
      if (matchedBrandNorm && brandNorm) {
        if (brandNorm.replace(/\s/g, "").includes(matchedBrandNorm.replace(/\s/g, "")) || matchedBrandNorm.replace(/\s/g, "").includes(brandNorm.replace(/\s/g, ""))) {
          return -1 + (1 - sim) * 0.9;
        }
      }
      let matches = 0;
      for (const w of qWords) if (itemWords.has(w)) matches++;
      const ratio = qWords.size > 0 ? matches / qWords.size : 0;
      if (ratio >= 1) return 0 + (1 - sim) * 0.9;
      if (ratio >= 0.67) return 1 + (1 - sim) * 0.9;
      if (ratio >= 0.5) return 2 + (1 - sim) * 0.9;
      return 3 + (1 - ratio) - nutritionScore(item) * 0.01;
    }
    const filterWords = isRestaurant && foodOnlyQuery ? wordSet(foodOnlyQuery) : queryWords;
    function isRelevant(item) {
      if (filterWords.size < 2) return true;
      if (matchedBrandNorm) {
        const b = normName(item.brand || item.brandOwner || "").replace(/\s/g, "");
        const mn = matchedBrandNorm.replace(/\s/g, "");
        if (b && (b.includes(mn) || mn.includes(b))) return true;
      }
      const nameWords = wordSet(item.name || "");
      let matches = 0;
      for (const w of filterWords) if (nameWords.has(w)) matches++;
      return matches / filterWords.size >= 0.5;
    }
    const local = await storage.searchFoodItems(q, isRestaurant ? foodOnlyQuery : void 0);
    if (!isRestaurant && local.length >= 10) {
      const scored = local.filter(isRelevant).sort((a, b) => relevanceScore(a) - relevanceScore(b));
      return res.json(scored.slice(0, 30));
    }
    const apiQuery = isRestaurant ? foodOnlyQuery : q;
    const [usda, fs, cn, off, offBrand] = await Promise.all([
      searchUSDA(apiQuery, isRestaurant ? 40 : 25, isRestaurant),
      searchFatSecret(q, 20),
      // FatSecret handles brand names well — keep full query
      searchCalorieNinjas(apiQuery, 15),
      // OFF Meilisearch: always run with full query to fill any gaps in USDA/FatSecret;
      // for restaurants also add a food-only search to catch items not indexed under the brand
      searchOFF(q, isRestaurant ? 30 : 25),
      isRestaurant ? searchBrandOFF(brandSlug, 30) : Promise.resolve([])
    ]);
    console.log(`[food/search] q="${q}" isRestaurant=${isRestaurant} brandSlug="${brandSlug}" | usda=${usda.length} fs=${fs.length} cn=${cn.length} off=${off.length} offBrand=${offBrand.length} local=${local.length}`);
    const allExternal = [...usda, ...cn, ...off, ...offBrand, ...fs];
    const fused = fuseItems([...local, ...allExternal]);
    const relevant = fused.filter(isRelevant).sort((a, b) => relevanceScore(a) - relevanceScore(b));
    res.json(relevant.slice(0, 30));
  });
  app2.get("/api/food/barcode/:code", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const code = req.params.code;
    const cached = await storage.getFoodItemByBarcode(code);
    if (cached) return res.json(cached);
    const data = await lookupBarcode(code);
    if (!data) return res.status(404).json({ message: "Product not found" });
    const item = await storage.createFoodItem({
      barcode: code,
      name: data.name,
      brand: data.brand,
      servingSizeG: data.servingSizeG,
      servingUnit: data.servingUnit,
      calories: data.calories,
      proteinG: data.proteinG,
      carbsG: data.carbsG,
      fatG: data.fatG,
      fiberG: data.fiberG,
      sodiumMg: data.sodiumMg,
      sugarG: data.sugarG,
      source: "openfoodfacts"
    });
    res.json(item);
  });
  app2.post("/api/food/scan-label", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ message: "imageBase64 and mediaType required" });
    const result = await parseNutritionLabel(imageBase64, mediaType);
    if (!result) return res.status(422).json({ message: "Could not parse nutrition label" });
    res.json(result);
  });
  app2.get("/api/food/items/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    let item = await storage.getFoodItemById(Number(req.params.id));
    if (!item) return res.sendStatus(404);
    if (item.fiberG == null || item.sodiumMg == null || item.sugarG == null || item.saturatedFatG == null || item.cholesterolMg == null || item.potassiumMg == null || item.calciumMg == null || item.ironMg == null) {
      try {
        const patch = await enrichMissingNutrition(item);
        if (Object.keys(patch).length > 0) {
          const updated = await storage.updateFoodItem(item.id, patch);
          if (updated) item = updated;
          console.log(`[food/enrich] id=${item.id} "${item.name}" patched:`, patch);
        }
      } catch (err) {
        console.warn(`[food/enrich] id=${item.id} failed:`, err?.message ?? err);
      }
    }
    res.json(item);
  });
  app2.post("/api/food/items", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertFoodItemSchema.parse(req.body);
      const item = await storage.createFoodItem(data);
      res.status(201).json(item);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/meals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(await storage.getMeals(req.user.id));
  });
  app2.post("/api/meals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const { name, description, ingredients } = req.body;
      if (!name || !Array.isArray(ingredients) || ingredients.length === 0)
        return res.status(400).json({ message: "name and ingredients[] required" });
      const meal = await storage.createMeal({ userId, name, description }, ingredients);
      res.status(201).json(meal);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const meal = await storage.getMeal(Number(req.params.id), req.user.id);
    if (!meal) return res.sendStatus(404);
    res.json(meal);
  });
  app2.patch("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const { name, description, ingredients } = req.body;
      const meal = await storage.updateMeal(Number(req.params.id), userId, { name, description }, ingredients);
      if (!meal) return res.sendStatus(404);
      res.json(meal);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.delete("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteMeal(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.post("/api/meals/:id/log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const mealId = Number(req.params.id);
      const { date: date2, mealType } = req.body;
      if (!date2 || !mealType) return res.status(400).json({ message: "date and mealType required" });
      const entries = await storage.logMeal(mealId, userId, date2, mealType);
      res.status(201).json(entries);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/food-log/summary", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const period = req.query.period ?? "1M";
    res.json(await storage.getFoodLogSummary(req.user.id, period));
  });
  app2.get("/api/food-log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date2 = req.query.date || (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA");
    res.json(await storage.getFoodLog(req.user.id, date2));
  });
  app2.post("/api/food-log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertFoodLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createFoodLogEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.patch("/api/food-log/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const entry = await storage.updateFoodLogEntry(Number(req.params.id), req.user.id, req.body);
    if (!entry) return res.sendStatus(404);
    res.json(entry);
  });
  app2.delete("/api/food-log/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteFoodLogEntry(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.get("/api/food-log/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 730);
    const rows = [];
    const now = /* @__PURE__ */ new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const entries = await storage.getFoodLog(userId, dateStr);
      rows.push({
        date: dateStr,
        calories: Math.round(entries.reduce((s, e) => s + e.caloriesActual, 0)),
        protein: Math.round(entries.reduce((s, e) => s + e.proteinActual, 0)),
        carbs: Math.round(entries.reduce((s, e) => s + e.carbsActual, 0)),
        fat: Math.round(entries.reduce((s, e) => s + e.fatActual, 0))
      });
    }
    res.json(rows);
  });
  app2.get("/api/targets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const target = await storage.getNutritionTarget(req.user.id);
    res.json(target ?? null);
  });
  app2.post("/api/targets/recalculate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await recalculateTargets(req.user.id);
    const target = await storage.getNutritionTarget(req.user.id);
    res.json(target ?? null);
  });
  app2.patch("/api/targets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const existing = await storage.getNutritionTarget(userId);
      const allowed = ["calories", "proteinG", "carbsG", "fatG", "waterMl"];
      const patch = {};
      for (const key of allowed) {
        const val = req.body[key];
        if (typeof val === "number" && val >= 0) {
          patch[key] = Math.round(val);
        }
      }
      const merged = {
        effectiveDate: existing?.effectiveDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        calories: existing?.calories ?? 2200,
        proteinG: existing?.proteinG ?? 150,
        carbsG: existing?.carbsG ?? 220,
        fatG: existing?.fatG ?? 70,
        waterMl: existing?.waterMl ?? 2500,
        ...patch
      };
      const t = await storage.upsertNutritionTarget(userId, merged);
      res.json(t);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/water/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 365);
    res.json(await storage.getWaterHistory(req.user.id, days));
  });
  app2.get("/api/water", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date2 = req.query.date || (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA");
    res.json(await storage.getWaterLog(req.user.id, date2));
  });
  app2.post("/api/water", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertWaterLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createWaterEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.delete("/api/water/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWaterEntry(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.get("/api/supplements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date2 = req.query.date || (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA");
    res.json(await storage.getSupplementLog(req.user.id, date2));
  });
  app2.post("/api/supplements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertSupplementLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createSupplementEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.delete("/api/supplements/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteSupplementEntry(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.get("/api/supplements/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 365);
    const sup = req.query.supplement || "creatine";
    res.json(await storage.getSupplementHistory(req.user.id, days, sup));
  });
  app2.get("/api/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { muscle, search } = req.query;
    res.json(await storage.getExercises(req.user.id, muscle, search));
  });
  app2.post("/api/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertExerciseSchema.parse({ ...req.body, userId, isCustom: true });
      const exercise = await storage.createExercise(data);
      res.status(201).json(exercise);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/exercises/logged-ids", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const ids = await storage.getLoggedExerciseIds(req.user.id);
    res.json(ids);
  });
  app2.get("/api/exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const exercise = await storage.getExerciseById(Number(req.params.id));
    if (!exercise) return res.sendStatus(404);
    res.json(exercise);
  });
  app2.get("/api/exercises/:id/previous-sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sets = await storage.getPreviousWorkoutSets(req.user.id, Number(req.params.id));
    res.json(sets);
  });
  app2.get("/api/exercises/:id/gif", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = Number(req.params.id);
    const exercise = await storage.getExerciseById(id);
    if (!exercise) return res.sendStatus(404);
    if (exercise.gifUrl) return res.json({ gifUrl: exercise.gifUrl });
    const gifUrl = await fetchExerciseGif(exercise.name);
    if (gifUrl) {
      await storage.updateExerciseGifUrl(id, gifUrl);
      return res.json({ gifUrl });
    }
    res.json({ gifUrl: null });
  });
  app2.get("/api/templates", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const templates = await storage.getTemplates(req.user.id);
    const result = await Promise.all(templates.map(async (t) => ({
      ...t,
      exercises: await storage.getTemplateExercises(t.id)
    })));
    res.json(result);
  });
  app2.get("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const templateId = Number(req.params.id);
    const templates = await storage.getTemplates(userId);
    const template = templates.find((t) => t.id === templateId);
    if (!template) return res.sendStatus(404);
    const rawEx = await storage.getTemplateExercises(templateId);
    const exercises2 = await storage.getTemplateExercisesWithDetails(templateId);
    console.log(`[template/${templateId}] raw=${rawEx.length} joined=${exercises2.length} ids=${rawEx.map((e) => e.exerciseId).join(",")}`);
    const result = exercises2.length > 0 ? exercises2 : rawEx.map((te) => ({
      ...te,
      exerciseName: `Exercise ${te.exerciseId}`,
      primaryMuscle: "",
      category: ""
    }));
    res.json({ ...template, exercises: result });
  });
  app2.post("/api/templates", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertWorkoutTemplateSchema.omit({ userId: true }).parse(req.body);
      const template = await storage.createTemplate({ ...data, userId });
      res.status(201).json(template);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.patch("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const t = await storage.updateTemplate(Number(req.params.id), req.user.id, req.body);
    if (!t) return res.sendStatus(404);
    res.json(t);
  });
  app2.delete("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteTemplate(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.post("/api/templates/:id/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertTemplateExerciseSchema.omit({ templateId: true }).parse(req.body);
      const te = await storage.addTemplateExercise({ ...data, templateId: Number(req.params.id) });
      res.status(201).json(te);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.patch("/api/template-exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { targetSets, targetReps, targetWeightGrams, orderIndex } = req.body;
    const data = {};
    if (targetSets !== void 0) data.targetSets = Number(targetSets);
    if (targetReps !== void 0) data.targetReps = String(targetReps);
    if (targetWeightGrams !== void 0)
      data.targetWeightGrams = targetWeightGrams === null ? null : Number(targetWeightGrams);
    if (orderIndex !== void 0) data.orderIndex = Number(orderIndex);
    const te = await storage.updateTemplateExercise(Number(req.params.id), data);
    if (!te) return res.sendStatus(404);
    res.json(te);
  });
  app2.delete("/api/template-exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.removeTemplateExercise(Number(req.params.id));
    res.sendStatus(204);
  });
  app2.get("/api/exercises/:id/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const history = await storage.getExerciseHistory(
      Number(req.params.id),
      req.user.id
    );
    res.json(history);
  });
  app2.get("/api/workouts", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const list = await storage.getWorkouts(req.user.id, limit);
    res.json(list);
  });
  app2.post("/api/workouts", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = req.user.id;
      const data = insertWorkoutSchema.omit({ userId: true }).parse(req.body);
      const w = await storage.createWorkout({ ...data, userId });
      res.status(201).json(w);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.get("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const w = await storage.getWorkoutById(Number(req.params.id), req.user.id);
    if (!w) return res.sendStatus(404);
    const sets = await storage.getWorkoutSets(w.id);
    res.json({ ...w, sets });
  });
  app2.patch("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const w = await storage.updateWorkout(Number(req.params.id), req.user.id, req.body);
    if (!w) return res.sendStatus(404);
    res.json(w);
  });
  app2.delete("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWorkout(Number(req.params.id), req.user.id);
    res.sendStatus(204);
  });
  app2.get("/api/workouts/:id/sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sets = await storage.getWorkoutSets(Number(req.params.id));
    res.json(sets);
  });
  app2.post("/api/workouts/:id/sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertWorkoutSetSchema.omit({ workoutId: true }).parse(req.body);
      const s = await storage.createWorkoutSet({ ...data, workoutId: Number(req.params.id) });
      res.status(201).json(s);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
  app2.patch("/api/sets/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const s = await storage.updateWorkoutSet(Number(req.params.id), req.body);
    if (!s) return res.sendStatus(404);
    res.json(s);
  });
  app2.delete("/api/sets/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWorkoutSet(Number(req.params.id));
    res.sendStatus(204);
  });
  app2.post("/api/workouts/import-csv", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ message: "No CSV provided" });
    try {
      let parseCSVRow2 = function(line) {
        const result = [];
        let current = "";
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuote = !inQuote;
            continue;
          }
          if (ch === "," && !inQuote) {
            result.push(current);
            current = "";
            continue;
          }
          current += ch;
        }
        result.push(current);
        return result;
      }, parseHevyDate2 = function(s) {
        const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const m = s.match(/(\d+)\s+(\w+)\s+(\d{4}),\s+(\d+):(\d+)/);
        if (!m) return { date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), iso: (/* @__PURE__ */ new Date()).toISOString() };
        const [, day, mon, year, hour, min] = m;
        const d = new Date(parseInt(year), months[mon], parseInt(day), parseInt(hour), parseInt(min));
        return { date: d.toISOString().slice(0, 10), iso: d.toISOString() };
      };
      var parseCSVRow = parseCSVRow2, parseHevyDate = parseHevyDate2;
      const lines = csv.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0];
      const rows = lines.slice(1);
      const sessions = /* @__PURE__ */ new Map();
      for (const line of rows) {
        if (!line) continue;
        const cols = parseCSVRow2(line);
        const [title, startTime, endTime] = cols;
        const key = `${title}|||${startTime}`;
        if (!sessions.has(key)) sessions.set(key, { title, startTime, endTime, rows: [] });
        sessions.get(key).rows.push(cols);
      }
      const allExercises = await storage.getExercises(userId);
      const exerciseByName = new Map(allExercises.map((e) => [e.name.toLowerCase(), e]));
      let imported = 0;
      let skipped = 0;
      for (const [, session2] of sessions) {
        const { date: date2, iso: startIso } = parseHevyDate2(session2.startTime);
        const { iso: endIso } = parseHevyDate2(session2.endTime);
        const durationMinutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 6e4);
        const existing = await storage.getWorkouts(userId, 500);
        const isDupe = existing.some((w) => w.name === session2.title && w.date === date2);
        if (isDupe) {
          skipped++;
          continue;
        }
        const workout = await storage.createWorkout({
          userId,
          name: session2.title,
          date: date2,
          durationMinutes: durationMinutes > 0 ? durationMinutes : void 0,
          completedAt: new Date(endIso)
        });
        const exGroups = /* @__PURE__ */ new Map();
        for (const cols of session2.rows) {
          const exerciseName = cols[4];
          const setIndex = parseInt(cols[7]) || 0;
          const setType = cols[8] || "normal";
          const weightLbs = cols[9] ? parseFloat(cols[9]) : null;
          const reps = cols[10] ? parseInt(cols[10]) : null;
          if (!exGroups.has(exerciseName)) exGroups.set(exerciseName, []);
          exGroups.get(exerciseName).push({ setIndex, weightLbs, reps, setType });
        }
        for (const [exName, sets] of exGroups) {
          let exercise = exerciseByName.get(exName.toLowerCase());
          if (!exercise) {
            exercise = await storage.createExercise({
              name: exName,
              primaryMuscle: "Other",
              secondaryMuscles: [],
              category: "compound",
              equipment: "other",
              isCustom: true,
              userId
            });
            exerciseByName.set(exName.toLowerCase(), exercise);
          }
          const sortedSets = sets.sort((a, b) => a.setIndex - b.setIndex);
          for (const set of sortedSets) {
            await storage.createWorkoutSet({
              workoutId: workout.id,
              exerciseId: exercise.id,
              setNumber: set.setIndex + 1,
              reps: set.reps ?? 0,
              weightGrams: set.weightLbs ? Math.round(set.weightLbs * 453.592) : 0,
              isWarmup: set.setType === "warmup"
            });
          }
        }
        imported++;
      }
      res.json({ imported, skipped, total: sessions.size });
    } catch (err) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  app2.post("/api/routines/generate-ai", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { goal, daysPerWeek, equipment, notes } = req.body;
      const client2 = new Anthropic2({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `You are a personal trainer. Create a single workout routine (one session, not a full weekly plan).

Goal: ${goal}
Available equipment: ${equipment?.join(", ") || "any"}
${notes ? `Notes: ${notes}` : ""}

Return a JSON object with this exact structure:
{
  "name": "Routine name (e.g. Push Day, Leg Day, Full Body)",
  "exercises": [
    {
      "name": "Exercise name",
      "sets": 3,
      "reps": "8-12",
      "muscle": "primary muscle group"
    }
  ]
}

Include 6-10 exercises. Use common gym exercise names. Return ONLY the JSON, no markdown.`;
      const msg = await client2.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      const text2 = msg.content[0].text;
      const routine = JSON.parse(text2);
      res.json(routine);
    } catch (err) {
      console.error("AI routine generation error:", err);
      res.status(500).json({ message: "Failed to generate routine" });
    }
  });
  app2.post("/api/heart-rate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const schema = z.object({
      readings: z.array(z.object({ ts: z.number(), bpm: z.number().int().positive() })).min(1).max(500)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid readings" });
    const entries = parsed.data.readings.map((r) => ({
      userId,
      ts: new Date(r.ts),
      bpm: r.bpm
    }));
    await storage.bulkInsertHeartRate(entries);
    res.json({ saved: entries.length });
  });
  app2.get("/api/heart-rate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = req.user.id;
    const date2 = req.query.date || (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA");
    const summary = await storage.getHeartRateSummary(userId, date2);
    res.json(summary.map((r) => ({ ts: r.ts.getTime(), bpm: r.bpm })));
  });
}

// server/services/exercises-seed.ts
var SEED_EXERCISES = [
  // Chest
  { name: "Barbell Bench Press", primaryMuscle: "Chest", secondaryMuscles: ["Triceps", "Front Delts"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Incline Barbell Bench Press", primaryMuscle: "Chest", secondaryMuscles: ["Triceps", "Front Delts"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Dumbbell Bench Press", primaryMuscle: "Chest", secondaryMuscles: ["Triceps", "Front Delts"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Incline Dumbbell Bench Press", primaryMuscle: "Chest", secondaryMuscles: ["Triceps", "Front Delts"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Cable Fly", primaryMuscle: "Chest", secondaryMuscles: [], category: "isolation", equipment: "cable", isCustom: false },
  { name: "Dumbbell Fly", primaryMuscle: "Chest", secondaryMuscles: [], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Push-Up", primaryMuscle: "Chest", secondaryMuscles: ["Triceps", "Front Delts"], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Chest Dip", primaryMuscle: "Chest", secondaryMuscles: ["Triceps"], category: "compound", equipment: "bodyweight", isCustom: false },
  // Back
  { name: "Barbell Deadlift", primaryMuscle: "Back", secondaryMuscles: ["Glutes", "Hamstrings", "Traps"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Barbell Row", primaryMuscle: "Back", secondaryMuscles: ["Biceps", "Rear Delts"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Pull-Up", primaryMuscle: "Back", secondaryMuscles: ["Biceps"], category: "compound", equipment: "bodyweight", isCustom: false },
  { name: "Lat Pulldown", primaryMuscle: "Back", secondaryMuscles: ["Biceps"], category: "compound", equipment: "cable", isCustom: false },
  { name: "Seated Cable Row", primaryMuscle: "Back", secondaryMuscles: ["Biceps", "Rear Delts"], category: "compound", equipment: "cable", isCustom: false },
  { name: "Dumbbell Row", primaryMuscle: "Back", secondaryMuscles: ["Biceps"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "T-Bar Row", primaryMuscle: "Back", secondaryMuscles: ["Biceps"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Face Pull", primaryMuscle: "Back", secondaryMuscles: ["Rear Delts", "External Rotators"], category: "isolation", equipment: "cable", isCustom: false },
  // Shoulders
  { name: "Overhead Press", primaryMuscle: "Shoulders", secondaryMuscles: ["Triceps", "Upper Chest"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Dumbbell Shoulder Press", primaryMuscle: "Shoulders", secondaryMuscles: ["Triceps"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Lateral Raise", primaryMuscle: "Shoulders", secondaryMuscles: [], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Cable Lateral Raise", primaryMuscle: "Shoulders", secondaryMuscles: [], category: "isolation", equipment: "cable", isCustom: false },
  { name: "Front Raise", primaryMuscle: "Shoulders", secondaryMuscles: [], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Arnold Press", primaryMuscle: "Shoulders", secondaryMuscles: ["Triceps"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Upright Row", primaryMuscle: "Shoulders", secondaryMuscles: ["Traps"], category: "compound", equipment: "barbell", isCustom: false },
  // Arms
  { name: "Barbell Curl", primaryMuscle: "Biceps", secondaryMuscles: [], category: "isolation", equipment: "barbell", isCustom: false },
  { name: "Dumbbell Curl", primaryMuscle: "Biceps", secondaryMuscles: [], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Hammer Curl", primaryMuscle: "Biceps", secondaryMuscles: ["Brachialis"], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Preacher Curl", primaryMuscle: "Biceps", secondaryMuscles: [], category: "isolation", equipment: "barbell", isCustom: false },
  { name: "Cable Curl", primaryMuscle: "Biceps", secondaryMuscles: [], category: "isolation", equipment: "cable", isCustom: false },
  { name: "Tricep Pushdown", primaryMuscle: "Triceps", secondaryMuscles: [], category: "isolation", equipment: "cable", isCustom: false },
  { name: "Overhead Tricep Extension", primaryMuscle: "Triceps", secondaryMuscles: [], category: "isolation", equipment: "dumbbell", isCustom: false },
  { name: "Skull Crusher", primaryMuscle: "Triceps", secondaryMuscles: [], category: "isolation", equipment: "barbell", isCustom: false },
  { name: "Tricep Dip", primaryMuscle: "Triceps", secondaryMuscles: [], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Close-Grip Bench Press", primaryMuscle: "Triceps", secondaryMuscles: ["Chest"], category: "compound", equipment: "barbell", isCustom: false },
  // Legs
  { name: "Barbell Squat", primaryMuscle: "Quads", secondaryMuscles: ["Glutes", "Hamstrings", "Core"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Front Squat", primaryMuscle: "Quads", secondaryMuscles: ["Glutes", "Core"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Leg Press", primaryMuscle: "Quads", secondaryMuscles: ["Glutes", "Hamstrings"], category: "compound", equipment: "machine", isCustom: false },
  { name: "Romanian Deadlift", primaryMuscle: "Hamstrings", secondaryMuscles: ["Glutes", "Back"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Leg Curl", primaryMuscle: "Hamstrings", secondaryMuscles: [], category: "isolation", equipment: "machine", isCustom: false },
  { name: "Leg Extension", primaryMuscle: "Quads", secondaryMuscles: [], category: "isolation", equipment: "machine", isCustom: false },
  { name: "Bulgarian Split Squat", primaryMuscle: "Quads", secondaryMuscles: ["Glutes", "Hamstrings"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Hip Thrust", primaryMuscle: "Glutes", secondaryMuscles: ["Hamstrings"], category: "compound", equipment: "barbell", isCustom: false },
  { name: "Glute Bridge", primaryMuscle: "Glutes", secondaryMuscles: ["Hamstrings"], category: "compound", equipment: "bodyweight", isCustom: false },
  { name: "Calf Raise", primaryMuscle: "Calves", secondaryMuscles: [], category: "isolation", equipment: "machine", isCustom: false },
  { name: "Seated Calf Raise", primaryMuscle: "Calves", secondaryMuscles: [], category: "isolation", equipment: "machine", isCustom: false },
  { name: "Hack Squat", primaryMuscle: "Quads", secondaryMuscles: ["Glutes"], category: "compound", equipment: "machine", isCustom: false },
  { name: "Lunges", primaryMuscle: "Quads", secondaryMuscles: ["Glutes", "Hamstrings"], category: "compound", equipment: "dumbbell", isCustom: false },
  { name: "Sumo Deadlift", primaryMuscle: "Hamstrings", secondaryMuscles: ["Glutes", "Quads"], category: "compound", equipment: "barbell", isCustom: false },
  // Core
  { name: "Plank", primaryMuscle: "Core", secondaryMuscles: [], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Crunch", primaryMuscle: "Core", secondaryMuscles: [], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Cable Crunch", primaryMuscle: "Core", secondaryMuscles: [], category: "isolation", equipment: "cable", isCustom: false },
  { name: "Hanging Leg Raise", primaryMuscle: "Core", secondaryMuscles: ["Hip Flexors"], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Ab Wheel Rollout", primaryMuscle: "Core", secondaryMuscles: [], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  { name: "Russian Twist", primaryMuscle: "Core", secondaryMuscles: [], category: "bodyweight", equipment: "bodyweight", isCustom: false },
  // Cardio
  { name: "Treadmill", primaryMuscle: "Cardio", secondaryMuscles: [], category: "cardio", equipment: "machine", isCustom: false },
  { name: "Elliptical", primaryMuscle: "Cardio", secondaryMuscles: [], category: "cardio", equipment: "machine", isCustom: false },
  { name: "Stationary Bike", primaryMuscle: "Cardio", secondaryMuscles: [], category: "cardio", equipment: "machine", isCustom: false },
  { name: "Rowing Machine", primaryMuscle: "Cardio", secondaryMuscles: ["Back", "Arms"], category: "cardio", equipment: "machine", isCustom: false },
  { name: "Jump Rope", primaryMuscle: "Cardio", secondaryMuscles: [], category: "cardio", equipment: "none", isCustom: false },
  { name: "Battle Ropes", primaryMuscle: "Cardio", secondaryMuscles: ["Shoulders", "Arms"], category: "cardio", equipment: "none", isCustom: false }
];

// server/index.ts
var app = express();
var PORT = process.env.PORT || 5173;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isLocalDev = typeof origin === "string" && /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(origin);
  const isProduction = process.env.NODE_ENV === "production";
  if (isLocalDev || isProduction) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "10mb" }));
var PgSession = connectPgSimple(session);
var pool2 = new pg2.Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep connections alive so Neon's serverless DB doesn't drop them after inactivity
  keepAlive: true,
  idleTimeoutMillis: 6e4,
  // release idle clients after 60 s
  connectionTimeoutMillis: 5e3
});
pool2.on("error", (err) => {
  console.warn("Session pool error (will reconnect):", err.message);
});
app.use(
  session({
    store: new PgSession({ pool: pool2, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "fitcore-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      // HTTPS in prod (Replit), HTTP in dev
      maxAge: 30 * 24 * 60 * 60 * 1e3
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
registerRoutes(app);
{
  const { default: path } = await import("path");
  const { fileURLToPath } = await import("url");
  const { existsSync } = await import("fs");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.join(__dirname, "public"),
    // prod: dist/public  (node dist/index.js)
    path.join(process.cwd(), "dist", "public")
    // dev: <root>/dist/public
  ];
  const publicPath = candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[0];
  console.log(`[static] publicPath=${publicPath} exists=${existsSync(publicPath)}`);
  app.use(express.static(publicPath));
  app.get("*", (_req, res) => {
    const indexFile = path.join(publicPath, "index.html");
    if (existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(503).send("App not yet built \u2014 run `npm run build` first");
    }
  });
}
app.use((err, _req, res, _next) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  const message = err?.message ?? "Internal server error";
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(status).json({ message });
});
app.listen(PORT, async () => {
  console.log(`FitCore server running on port ${PORT}`);
  fetch("https://api.ipify.org?format=json").then((r) => r.json()).then((d) => console.log(`[server] outbound IP: ${d.ip}  \u2190 add this to FatSecret IP whitelist`)).catch(() => {
  });
  try {
    const count = await storage.countExercises();
    if (count === 0) {
      await storage.seedExercises(SEED_EXERCISES);
      console.log(`Seeded ${SEED_EXERCISES.length} exercises`);
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
});
