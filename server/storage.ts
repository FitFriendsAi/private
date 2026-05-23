import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc, gte, lte, like, or, isNull, sql } from "drizzle-orm";
import {
  users, userProfiles, goals, bodyMeasurements, foodItems, foodLog,
  nutritionTargets, waterLog, supplementLog, exercises, workoutTemplates,
  templateExercises, workouts, workoutSets, heartRateLog, savedMeals, mealIngredients,
  type User, type UserProfile, type Goal, type BodyMeasurement, type FoodItem,
  type FoodLogEntry, type NutritionTarget, type WaterLogEntry, type SupplementLogEntry,
  type Exercise, type WorkoutTemplate, type TemplateExercise, type Workout, type WorkoutSet,
  type HeartRateLogEntry, type InsertHeartRateLogEntry,
  type SavedMeal, type MealIngredient, type InsertSavedMeal, type InsertMealIngredient,
  type InsertUser, type InsertUserProfile, type InsertGoal, type InsertBodyMeasurement,
  type InsertFoodItem, type InsertFoodLogEntry, type InsertNutritionTarget,
  type InsertWaterLogEntry, type InsertSupplementLogEntry, type InsertExercise,
  type InsertWorkoutTemplate, type InsertTemplateExercise, type InsertWorkout, type InsertWorkoutSet,
} from "../shared/schema.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 5_000,
});
const db = drizzle(pool);

export const storage = {
  // ── Users ──────────────────────────────────────────────────────────────────
  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  },
  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  async getProfile(userId: number): Promise<UserProfile | undefined> {
    const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return p;
  },
  async upsertProfile(userId: number, data: Partial<InsertUserProfile>): Promise<UserProfile> {
    const existing = await this.getProfile(userId);
    if (existing) {
      const [p] = await db.update(userProfiles).set({ ...data, updatedAt: new Date() }).where(eq(userProfiles.userId, userId)).returning();
      return p;
    }
    const [p] = await db.insert(userProfiles).values({ userId, ...data }).returning();
    return p;
  },

  // ── Goals ──────────────────────────────────────────────────────────────────
  async getGoals(userId: number): Promise<Goal[]> {
    return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.createdAt));
  },
  async createGoal(data: InsertGoal): Promise<Goal> {
    const [g] = await db.insert(goals).values(data).returning();
    return g;
  },
  async updateGoal(id: number, userId: number, data: Partial<InsertGoal>): Promise<Goal | undefined> {
    const [g] = await db.update(goals).set(data).where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();
    return g;
  },
  async deleteGoal(id: number, userId: number): Promise<void> {
    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  },

  // ── Body Measurements ──────────────────────────────────────────────────────
  async getMeasurements(userId: number, limit = 90): Promise<BodyMeasurement[]> {
    return db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)).orderBy(desc(bodyMeasurements.date)).limit(limit);
  },
  async createMeasurement(data: InsertBodyMeasurement): Promise<BodyMeasurement> {
    const [m] = await db.insert(bodyMeasurements).values(data).returning();
    return m;
  },
  async getLatestMeasurement(userId: number): Promise<BodyMeasurement | undefined> {
    const [m] = await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.userId, userId)).orderBy(desc(bodyMeasurements.date)).limit(1);
    return m;
  },

  // ── Food Items ─────────────────────────────────────────────────────────────
  async getFoodItemById(id: number): Promise<FoodItem | undefined> {
    const [item] = await db.select().from(foodItems).where(eq(foodItems.id, id));
    return item;
  },
  async getFoodItemByBarcode(barcode: string): Promise<FoodItem | undefined> {
    const [item] = await db.select().from(foodItems).where(eq(foodItems.barcode, barcode));
    return item;
  },
  async searchFoodItems(query: string): Promise<FoodItem[]> {
    return db.select().from(foodItems)
      .where(or(like(foodItems.name, `%${query}%`), like(foodItems.brand ?? foodItems.name, `%${query}%`)))
      .limit(30);
  },
  async createFoodItem(data: InsertFoodItem): Promise<FoodItem> {
    const [item] = await db.insert(foodItems).values(data).returning();
    return item;
  },

  // ── Food Log ───────────────────────────────────────────────────────────────
  async getFoodLog(userId: number, date: string): Promise<FoodLogEntry[]> {
    return db.select().from(foodLog).where(and(eq(foodLog.userId, userId), eq(foodLog.date, date))).orderBy(foodLog.loggedAt);
  },
  async createFoodLogEntry(data: InsertFoodLogEntry): Promise<FoodLogEntry> {
    const [entry] = await db.insert(foodLog).values(data).returning();
    return entry;
  },
  async updateFoodLogEntry(id: number, userId: number, data: Partial<InsertFoodLogEntry>): Promise<FoodLogEntry | undefined> {
    const [entry] = await db.update(foodLog).set(data).where(and(eq(foodLog.id, id), eq(foodLog.userId, userId))).returning();
    return entry;
  },
  async deleteFoodLogEntry(id: number, userId: number): Promise<void> {
    await db.delete(foodLog).where(and(eq(foodLog.id, id), eq(foodLog.userId, userId)));
  },

  /** Aggregated food-log summary for charts.
   *  Always returns a COMPLETE scaffold of every period bucket (zeros for days with no data),
   *  so the x-axis is fully populated regardless of logging history.
   */
  async getFoodLogSummary(
    userId: number,
    period: string,
  ): Promise<{ period: string; label: string; calories: number; protein: number; carbs: number; fat: number }[]> {
    const today  = new Date();
    const ds     = (d: Date) => d.toISOString().slice(0, 10);
    const addDay = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

    const DAY_ABBR   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    // ── 1. Build the full bucket scaffold ────────────────────────────────────
    type BucketMeta = { key: string; label: string };
    let buckets: BucketMeta[];
    let groupBy: "day" | "week" | "month";

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
      // Start from Monday ~13 weeks ago
      const start = addDay(today, -90);
      const dow   = start.getDay();
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
          key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          label: MONTH_ABBR[d.getMonth()],
        };
      });

    } else {
      // "All" — months from 2020-01 to now
      groupBy = "month";
      buckets = [];
      for (let d = new Date(2020, 0, 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.getFullYear() === today.getFullYear()
          ? MONTH_ABBR[d.getMonth()]
          : `${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
        buckets.push({ key, label });
      }
    }

    // ── 2. Fetch actual daily totals from DB ──────────────────────────────────
    const fromDate = buckets[0].key;
    const toDate   = ds(today);

    const rows = await db
      .select({
        date:     foodLog.date,
        calories: sql<number>`coalesce(sum(${foodLog.caloriesActual}), 0)`,
        protein:  sql<number>`coalesce(sum(${foodLog.proteinActual}), 0)`,
        carbs:    sql<number>`coalesce(sum(${foodLog.carbsActual}), 0)`,
        fat:      sql<number>`coalesce(sum(${foodLog.fatActual}), 0)`,
      })
      .from(foodLog)
      .where(and(
        eq(foodLog.userId, userId),
        gte(foodLog.date, fromDate),
        lte(foodLog.date, toDate),
      ))
      .groupBy(foodLog.date)
      .orderBy(foodLog.date);

    // Normalise Date objects that pg returns for date columns
    const normDate = (raw: unknown): string => {
      if ((raw as any) instanceof Date) return (raw as Date).toISOString().slice(0, 10);
      return String(raw).slice(0, 10);
    };

    // ── 3. Build a daily data map ─────────────────────────────────────────────
    type Nums = { cal: number; prt: number; crb: number; fat: number };
    const dayMap = new Map<string, Nums>();
    for (const r of rows) {
      dayMap.set(normDate(r.date), {
        cal: Number(r.calories), prt: Number(r.protein),
        crb: Number(r.carbs),   fat: Number(r.fat),
      });
    }

    // ── 4. Merge into buckets ─────────────────────────────────────────────────
    if (groupBy === "day") {
      return buckets.map(b => {
        const d = dayMap.get(b.key) ?? { cal: 0, prt: 0, crb: 0, fat: 0 };
        return { period: b.key, label: b.label, calories: d.cal, protein: d.prt, carbs: d.crb, fat: d.fat };
      });
    }

    // Week / month: aggregate daily entries into the matching bucket, then avg
    type BucketAcc = Nums & { days: number };
    const accMap = new Map<string, BucketAcc>();
    for (const [dateStr, d] of dayMap) {
      let bucketKey: string;
      if (groupBy === "week") {
        const date = new Date(dateStr + "T00:00:00");
        const dow  = date.getDay();
        const mon  = new Date(date);
        mon.setDate(date.getDate() - ((dow === 0 ? 7 : dow) - 1));
        bucketKey = ds(mon);
      } else {
        bucketKey = dateStr.slice(0, 7);
      }
      if (!buckets.some(b => b.key === bucketKey)) continue; // outside scaffold range
      const cur = accMap.get(bucketKey) ?? { cal: 0, prt: 0, crb: 0, fat: 0, days: 0 };
      accMap.set(bucketKey, {
        cal:  cur.cal  + d.cal,
        prt:  cur.prt  + d.prt,
        crb:  cur.crb  + d.crb,
        fat:  cur.fat  + d.fat,
        days: cur.days + (d.cal > 0 ? 1 : 0), // only count days with actual data
      });
    }

    return buckets.map(b => {
      const v = accMap.get(b.key);
      const n = v?.days ?? 0;
      return {
        period:   b.key,
        label:    b.label,
        calories: n > 0 ? Math.round(v!.cal / n) : 0,
        protein:  n > 0 ? Math.round(v!.prt / n) : 0,
        carbs:    n > 0 ? Math.round(v!.crb / n) : 0,
        fat:      n > 0 ? Math.round(v!.fat / n) : 0,
      };
    });
  },

  // ── Nutrition Targets ──────────────────────────────────────────────────────
  async getNutritionTarget(userId: number): Promise<NutritionTarget | undefined> {
    const [t] = await db.select().from(nutritionTargets).where(eq(nutritionTargets.userId, userId)).orderBy(desc(nutritionTargets.effectiveDate)).limit(1);
    return t;
  },
  async upsertNutritionTarget(userId: number, data: Omit<InsertNutritionTarget, "userId">): Promise<NutritionTarget> {
    const existing = await this.getNutritionTarget(userId);
    if (existing) {
      const [t] = await db.update(nutritionTargets).set({ ...data, updatedAt: new Date() }).where(eq(nutritionTargets.userId, userId)).returning();
      return t;
    }
    const [t] = await db.insert(nutritionTargets).values({ userId, ...data }).returning();
    return t;
  },

  // ── Water Log ──────────────────────────────────────────────────────────────
  async getWaterLog(userId: number, date: string): Promise<WaterLogEntry[]> {
    return db.select().from(waterLog).where(and(eq(waterLog.userId, userId), eq(waterLog.date, date)));
  },
  async createWaterEntry(data: InsertWaterLogEntry): Promise<WaterLogEntry> {
    const [entry] = await db.insert(waterLog).values(data).returning();
    return entry;
  },
  async deleteWaterEntry(id: number, userId: number): Promise<void> {
    await db.delete(waterLog).where(and(eq(waterLog.id, id), eq(waterLog.userId, userId)));
  },
  async getWaterHistory(userId: number, days: number): Promise<{ date: string; totalMl: number }[]> {
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    const sinceStr = since.toISOString().slice(0, 10);
    const rows = await db
      .select({ date: waterLog.date, totalMl: sql<number>`sum(${waterLog.amountMl})` })
      .from(waterLog)
      .where(and(eq(waterLog.userId, userId), gte(waterLog.date, sinceStr)))
      .groupBy(waterLog.date)
      .orderBy(waterLog.date);
    return rows;
  },

  // ── Supplement Log ─────────────────────────────────────────────────────────
  async getSupplementLog(userId: number, date: string): Promise<SupplementLogEntry[]> {
    return db.select().from(supplementLog).where(and(eq(supplementLog.userId, userId), eq(supplementLog.date, date)));
  },
  async createSupplementEntry(data: InsertSupplementLogEntry): Promise<SupplementLogEntry> {
    const [entry] = await db.insert(supplementLog).values(data).returning();
    return entry;
  },
  async deleteSupplementEntry(id: number, userId: number): Promise<void> {
    await db.delete(supplementLog).where(and(eq(supplementLog.id, id), eq(supplementLog.userId, userId)));
  },
  async getSupplementHistory(userId: number, days: number, supplement: string): Promise<{ date: string; totalG: number }[]> {
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    const sinceStr = since.toLocaleDateString("en-CA");
    return db
      .select({ date: supplementLog.date, totalG: sql<number>`sum(${supplementLog.amountG})` })
      .from(supplementLog)
      .where(and(eq(supplementLog.userId, userId), gte(supplementLog.date, sinceStr), eq(supplementLog.supplement, supplement)))
      .groupBy(supplementLog.date)
      .orderBy(supplementLog.date);
  },

  // ── Exercises ──────────────────────────────────────────────────────────────
  async getExercises(userId: number, muscle?: string, search?: string): Promise<Exercise[]> {
    let q = db.select().from(exercises).where(or(isNull(exercises.userId), eq(exercises.userId, userId)));
    const results = await q.orderBy(exercises.name);
    return results.filter(e => {
      if (muscle && e.primaryMuscle.toLowerCase() !== muscle.toLowerCase()) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  },
  async createExercise(data: InsertExercise): Promise<Exercise> {
    const [e] = await db.insert(exercises).values(data as any).returning();
    return e;
  },
  async getExerciseById(id: number): Promise<Exercise | undefined> {
    const [e] = await db.select().from(exercises).where(eq(exercises.id, id));
    return e;
  },
  async updateExerciseGifUrl(id: number, gifUrl: string): Promise<void> {
    await db.update(exercises).set({ gifUrl }).where(eq(exercises.id, id));
  },
  async countExercises(): Promise<number> {
    const result = await db.select().from(exercises).where(isNull(exercises.userId));
    return result.length;
  },
  async seedExercises(data: InsertExercise[]): Promise<void> {
    await db.insert(exercises).values(data as any[]);
  },

  // ── Workout Templates ──────────────────────────────────────────────────────
  async getTemplates(userId: number): Promise<WorkoutTemplate[]> {
    return db.select().from(workoutTemplates).where(eq(workoutTemplates.userId, userId)).orderBy(workoutTemplates.name);
  },
  async createTemplate(data: InsertWorkoutTemplate): Promise<WorkoutTemplate> {
    const [t] = await db.insert(workoutTemplates).values(data).returning();
    return t;
  },
  async updateTemplate(id: number, userId: number, data: Partial<InsertWorkoutTemplate>): Promise<WorkoutTemplate | undefined> {
    const [t] = await db.update(workoutTemplates).set(data).where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId))).returning();
    return t;
  },
  async deleteTemplate(id: number, userId: number): Promise<void> {
    await db.delete(workoutTemplates).where(and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, userId)));
  },

  // ── Template Exercises ─────────────────────────────────────────────────────
  async getTemplateExercises(templateId: number): Promise<TemplateExercise[]> {
    return db.select().from(templateExercises).where(eq(templateExercises.templateId, templateId)).orderBy(templateExercises.orderIndex);
  },
  /** Returns template exercises joined with exercise details (name, muscle, category). */
  async getTemplateExercisesWithDetails(templateId: number) {
    return db
      .select({
        id:                templateExercises.id,
        templateId:        templateExercises.templateId,
        exerciseId:        templateExercises.exerciseId,
        orderIndex:        templateExercises.orderIndex,
        targetSets:        templateExercises.targetSets,
        targetReps:        templateExercises.targetReps,
        targetWeightGrams: templateExercises.targetWeightGrams,
        exerciseName:      exercises.name,
        primaryMuscle:     exercises.primaryMuscle,
        category:          exercises.category,
      })
      .from(templateExercises)
      .innerJoin(exercises, eq(templateExercises.exerciseId, exercises.id))
      .where(eq(templateExercises.templateId, templateId))
      .orderBy(templateExercises.orderIndex);
  },
  async addTemplateExercise(data: InsertTemplateExercise): Promise<TemplateExercise> {
    const [te] = await db.insert(templateExercises).values(data).returning();
    return te;
  },
  async updateTemplateExercise(id: number, data: Partial<{
    targetSets: number; targetReps: string; targetWeightGrams: number | null; orderIndex: number;
  }>): Promise<TemplateExercise | undefined> {
    const [te] = await db.update(templateExercises).set(data).where(eq(templateExercises.id, id)).returning();
    return te;
  },
  async removeTemplateExercise(id: number): Promise<void> {
    await db.delete(templateExercises).where(eq(templateExercises.id, id));
  },

  // ── Workouts ───────────────────────────────────────────────────────────────
  async getWorkouts(userId: number, limit = 20): Promise<Workout[]> {
    return db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(limit);
  },
  async createWorkout(data: InsertWorkout): Promise<Workout> {
    const [w] = await db.insert(workouts).values(data).returning();
    return w;
  },
  async getWorkoutById(id: number, userId: number): Promise<Workout | undefined> {
    const [w] = await db.select().from(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, userId)));
    return w;
  },
  async updateWorkout(id: number, userId: number, data: Partial<InsertWorkout>): Promise<Workout | undefined> {
    const [w] = await db.update(workouts).set(data).where(and(eq(workouts.id, id), eq(workouts.userId, userId))).returning();
    return w;
  },
  async deleteWorkout(id: number, userId: number): Promise<void> {
    await db.delete(workouts).where(and(eq(workouts.id, id), eq(workouts.userId, userId)));
  },

  // ── Workout Sets ───────────────────────────────────────────────────────────
  async getWorkoutSets(workoutId: number): Promise<WorkoutSet[]> {
    return db.select().from(workoutSets).where(eq(workoutSets.workoutId, workoutId)).orderBy(workoutSets.exerciseId, workoutSets.setNumber);
  },
  /** Returns max weight (grams) + total reps per workout session for one exercise. */
  async getExerciseHistory(exerciseId: number, userId: number): Promise<
    {
      date: string;
      maxWeightGrams: number;   // heaviest weight lifted in any set
      e1rmGrams: number;        // best estimated 1RM (Epley): w*(1+r/30)
      bestSetVolume: number;    // max(reps*weight) across sets (grams)
      sessionVolume: number;    // sum(reps*weight) across all sets (grams)
      totalReps: number;
      sets: number;
      setsData: { reps: number; weightGrams: number }[];  // individual sets in order
    }[]
  > {
    const rows = await db
      .select({
        date:        workouts.date,
        weightGrams: workoutSets.weightGrams,
        reps:        workoutSets.reps,
        setNumber:   workoutSets.setNumber,
      })
      .from(workoutSets)
      .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
      .where(and(eq(workoutSets.exerciseId, exerciseId), eq(workouts.userId, userId)))
      .orderBy(workouts.date, workoutSets.setNumber);

    function toDateStr(d: unknown): string {
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      if (typeof d === "string") return d.slice(0, 10);
      return String(d).slice(0, 10);
    }

    const byDate = new Map<string, {
      maxW: number; bestE1rm: number; bestSetVol: number;
      sessionVol: number; totalReps: number; sets: number;
      setsData: { reps: number; weightGrams: number }[];
    }>();

    for (const r of rows) {
      const key = toDateStr(r.date);
      const w   = r.weightGrams ?? 0;
      const rep = r.reps ?? 0;
      const e1rm      = rep > 0 ? w * (1 + rep / 30) : w;   // Epley formula
      const setVol    = w * rep;
      const cur = byDate.get(key) ?? {
        maxW: 0, bestE1rm: 0, bestSetVol: 0, sessionVol: 0, totalReps: 0, sets: 0, setsData: [],
      };
      byDate.set(key, {
        maxW:       Math.max(cur.maxW, w),
        bestE1rm:   Math.max(cur.bestE1rm, e1rm),
        bestSetVol: Math.max(cur.bestSetVol, setVol),
        sessionVol: cur.sessionVol + setVol,
        totalReps:  cur.totalReps + rep,
        sets:       cur.sets + 1,
        setsData:   [...cur.setsData, { reps: rep, weightGrams: w }],
      });
    }

    return Array.from(byDate.entries()).map(([date, v]) => ({
      date,
      maxWeightGrams: v.maxW,
      e1rmGrams:      Math.round(v.bestE1rm),
      bestSetVolume:  v.bestSetVol,
      sessionVolume:  v.sessionVol,
      totalReps:      v.totalReps,
      sets:           v.sets,
      setsData:       v.setsData,
    }));
  },

  /** Returns the distinct exercise IDs the user has ever logged a set for. */
  async getLoggedExerciseIds(userId: number): Promise<number[]> {
    const rows = await db
      .selectDistinct({ exerciseId: workoutSets.exerciseId })
      .from(workoutSets)
      .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
      .where(eq(workouts.userId, userId));
    return rows.map(r => r.exerciseId);
  },
  async createWorkoutSet(data: InsertWorkoutSet): Promise<WorkoutSet> {
    const [s] = await db.insert(workoutSets).values(data).returning();
    return s;
  },
  async updateWorkoutSet(id: number, data: Partial<InsertWorkoutSet>): Promise<WorkoutSet | undefined> {
    const [s] = await db.update(workoutSets).set(data).where(eq(workoutSets.id, id)).returning();
    return s;
  },
  async deleteWorkoutSet(id: number): Promise<void> {
    await db.delete(workoutSets).where(eq(workoutSets.id, id));
  },
  // ── Heart Rate Log ─────────────────────────────────────────────────────────
  /** Bulk-insert a batch of readings (called from client flush every 30s) */
  async bulkInsertHeartRate(entries: InsertHeartRateLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await db.insert(heartRateLog).values(entries);
  },
  /** Return all readings for a given UTC date (YYYY-MM-DD) */
  async getHeartRateForDate(userId: number, date: string): Promise<HeartRateLogEntry[]> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end   = new Date(`${date}T23:59:59.999Z`);
    return db.select().from(heartRateLog)
      .where(and(
        eq(heartRateLog.userId, userId),
        gte(heartRateLog.ts, start),
        lte(heartRateLog.ts, end),
      ))
      .orderBy(heartRateLog.ts);
  },
  /** Return one row per minute (last reading in that minute) for charting */
  async getHeartRateSummary(userId: number, date: string): Promise<{ ts: Date; bpm: number }[]> {
    const rows = await this.getHeartRateForDate(userId, date);
    // Downsample: keep last reading per 60-second bucket
    const buckets = new Map<number, { ts: Date; bpm: number }>();
    for (const r of rows) {
      const bucket = Math.floor(r.ts.getTime() / 60_000);
      buckets.set(bucket, { ts: r.ts, bpm: r.bpm });
    }
    return Array.from(buckets.values()).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  },

  async getPreviousWorkoutSets(userId: number, exerciseId: number): Promise<WorkoutSet[]> {
    const [lastWorkout] = await db.select().from(workouts)
      .where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(1);
    if (!lastWorkout) return [];
    const sessions = await db.select().from(workouts).where(eq(workouts.userId, userId)).orderBy(desc(workouts.date)).limit(10);
    for (const session of sessions) {
      const sets = await db.select().from(workoutSets)
        .where(and(eq(workoutSets.workoutId, session.id), eq(workoutSets.exerciseId, exerciseId)));
      if (sets.length > 0) return sets;
    }
    return [];
  },

  // ── Saved Meals ────────────────────────────────────────────────────────────
  async getMeals(userId: number): Promise<(SavedMeal & { ingredients: MealIngredient[] })[]> {
    const meals = await db.select().from(savedMeals)
      .where(eq(savedMeals.userId, userId))
      .orderBy(desc(savedMeals.createdAt));
    const result = [];
    for (const meal of meals) {
      const ingredients = await db.select().from(mealIngredients)
        .where(eq(mealIngredients.mealId, meal.id));
      result.push({ ...meal, ingredients });
    }
    return result;
  },

  async getMeal(id: number, userId: number): Promise<(SavedMeal & { ingredients: MealIngredient[] }) | null> {
    const [meal] = await db.select().from(savedMeals)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
    if (!meal) return null;
    const ingredients = await db.select().from(mealIngredients)
      .where(eq(mealIngredients.mealId, id));
    return { ...meal, ingredients };
  },

  async createMeal(
    data: InsertSavedMeal,
    ingredients: InsertMealIngredient[]
  ): Promise<SavedMeal & { ingredients: MealIngredient[] }> {
    const [meal] = await db.insert(savedMeals).values(data).returning();
    const rows = await db.insert(mealIngredients)
      .values(ingredients.map(i => ({ ...i, mealId: meal.id })))
      .returning();
    return { ...meal, ingredients: rows };
  },

  async updateMeal(
    id: number,
    userId: number,
    data: Partial<InsertSavedMeal>,
    ingredients?: InsertMealIngredient[]
  ): Promise<(SavedMeal & { ingredients: MealIngredient[] }) | null> {
    const [meal] = await db.update(savedMeals)
      .set({ name: data.name, description: data.description })
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
      .returning();
    if (!meal) return null;
    if (ingredients) {
      await db.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
      await db.insert(mealIngredients)
        .values(ingredients.map(i => ({ ...i, mealId: id })));
    }
    const rows = await db.select().from(mealIngredients)
      .where(eq(mealIngredients.mealId, id));
    return { ...meal, ingredients: rows };
  },

  async deleteMeal(id: number, userId: number): Promise<void> {
    await db.delete(savedMeals)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)));
  },

  async logMeal(
    mealId: number,
    userId: number,
    date: string,
    mealType: string
  ): Promise<FoodLogEntry[]> {
    const [meal] = await db.select().from(savedMeals)
      .where(and(eq(savedMeals.id, mealId), eq(savedMeals.userId, userId)));
    if (!meal) throw new Error("Meal not found");
    const ingredients = await db.select().from(mealIngredients)
      .where(eq(mealIngredients.mealId, mealId));
    const entries = await db.insert(foodLog)
      .values(ingredients.map(ing => ({
        userId,
        date,
        mealType,
        foodItemId: ing.foodItemId,
        foodName: ing.foodName,
        servings: ing.servings,
        caloriesActual: ing.caloriesActual,
        proteinActual: ing.proteinActual,
        carbsActual: ing.carbsActual,
        fatActual: ing.fatActual,
      })))
      .returning();
    return entries;
  },
};
