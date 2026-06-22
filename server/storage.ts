import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, desc, gte, lte, gt, like, ilike, or, isNull, sql, inArray, ne } from "drizzle-orm";
import {
  estimate1RMKg, sessionBests, countPRs, computePointsTotal, streakFromDates,
  type StrengthSet,
} from "./services/scoring.js";
import {
  users, userProfiles, goals, bodyMeasurements, progressPhotos, foodItems, foodLog,
  nutritionTargets, waterLog, supplementLog, exercises, workoutTemplates,
  templateExercises, workouts, workoutSets, heartRateLog, savedMeals, mealIngredients,
  friendships, aiCoachPlans, activeRoutines,
  type User, type UserProfile, type Goal, type BodyMeasurement, type ProgressPhoto, type FoodItem,
  type FoodLogEntry, type NutritionTarget, type WaterLogEntry, type SupplementLogEntry,
  type Exercise, type WorkoutTemplate, type TemplateExercise, type Workout, type WorkoutSet,
  type HeartRateLogEntry, type InsertHeartRateLogEntry,
  type SavedMeal, type MealIngredient, type InsertSavedMeal, type InsertMealIngredient,
  type InsertUser, type InsertUserProfile, type InsertGoal, type InsertBodyMeasurement, type InsertProgressPhoto,
  type InsertFoodItem, type InsertFoodLogEntry, type InsertNutritionTarget,
  type InsertWaterLogEntry, type InsertSupplementLogEntry, type InsertExercise,
  type InsertWorkoutTemplate, type InsertTemplateExercise, type InsertWorkout, type InsertWorkoutSet,
  type Friendship, type ActiveRoutine, type RoutineDay,
} from "../shared/schema.js";

// For Supabase connections, parse the URL ourselves and pass explicit params to pg
// so that pg's URL parser never touches sslmode/uselibpqcompat (which break the pooler).
const _rawDbUrl = process.env.DATABASE_URL ?? '';
const _isSupabase = _rawDbUrl.includes('supabase');

let _poolConfig: pg.PoolConfig;
if (_isSupabase) {
  const u = new URL(_rawDbUrl);
  _poolConfig = {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 5432,
    database: u.pathname.replace(/^\//, ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: { rejectUnauthorized: false },
  };
} else {
  _poolConfig = { connectionString: _rawDbUrl };
}

const pool = new pg.Pool({
  ..._poolConfig,
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
  async updateMeasurement(id: number, userId: number, data: Partial<InsertBodyMeasurement>): Promise<BodyMeasurement | undefined> {
    const [m] = await db.update(bodyMeasurements).set(data).where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId))).returning();
    return m;
  },
  async deleteMeasurement(id: number, userId: number): Promise<void> {
    await db.delete(bodyMeasurements).where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId)));
  },

  // ── Progress Photos ────────────────────────────────────────────────────────
  async getProgressPhotos(userId: number): Promise<ProgressPhoto[]> {
    return db.select().from(progressPhotos).where(eq(progressPhotos.userId, userId)).orderBy(desc(progressPhotos.date));
  },
  async createProgressPhoto(data: InsertProgressPhoto): Promise<ProgressPhoto> {
    const [p] = await db.insert(progressPhotos).values(data).returning();
    return p;
  },
  async deleteProgressPhoto(id: number, userId: number): Promise<void> {
    await db.delete(progressPhotos).where(and(eq(progressPhotos.id, id), eq(progressPhotos.userId, userId)));
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
  async searchFoodItems(query: string, foodQuery?: string): Promise<FoodItem[]> {
    // Use foodQuery (brand-stripped) when provided so restaurant searches like
    // "chick-fil-a spicy chicken sandwich" don't pull cached "Chick Peas" entries.
    const q = foodQuery || query;
    return db.select().from(foodItems)
      .where(or(ilike(foodItems.name, `%${q}%`), ilike(foodItems.brand, `%${q}%`)))
      .limit(30);
  },
  async createFoodItem(data: InsertFoodItem): Promise<FoodItem> {
    const [item] = await db.insert(foodItems).values(data).returning();
    return item;
  },
  /** Finds an existing food item with the same name + brand (case-insensitive) so
   *  user-submitted foods (manual entries, label scans, search results) are pooled
   *  into one shared record instead of creating near-duplicates. */
  async findSimilarFoodItem(name: string, brand?: string | null): Promise<FoodItem | undefined> {
    const [item] = await db.select().from(foodItems).where(
      and(
        sql`lower(${foodItems.name}) = lower(${name})`,
        brand ? sql`lower(${foodItems.brand}) = lower(${brand})` : isNull(foodItems.brand)
      )
    ).limit(1);
    return item;
  },
  /** All distinct food_item ids this user has ever logged — used to boost their
   *  own previously-used foods in search results. */
  async getUserFoodItemIds(userId: number): Promise<Set<number>> {
    const rows = await db
      .selectDistinct({ foodItemId: foodLog.foodItemId })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), sql`${foodLog.foodItemId} is not null`));
    return new Set(rows.map(r => r.foodItemId).filter((id): id is number => id != null));
  },
  async updateFoodItem(id: number, patch: Partial<InsertFoodItem>): Promise<FoodItem | undefined> {
    const [item] = await db.update(foodItems).set(patch).where(eq(foodItems.id, id)).returning();
    return item;
  },
  /** Returns distinct food items recently logged by a user, ordered by most-recent use. */
  async getRecentFoodItems(userId: number, limit = 20): Promise<FoodItem[]> {
    const recent = await db
      .select({ foodItemId: foodLog.foodItemId, maxDate: sql<string>`max(${foodLog.date})` })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), sql`${foodLog.foodItemId} is not null`))
      .groupBy(foodLog.foodItemId)
      .orderBy(sql`max(${foodLog.date}) desc`)
      .limit(limit);
    const ids = recent.map(r => r.foodItemId).filter((id): id is number => id != null);
    if (ids.length === 0) return [];
    const items = await db.select().from(foodItems).where(inArray(foodItems.id, ids));
    const map = new Map(items.map(i => [i.id, i]));
    return ids.map(id => map.get(id)).filter((i): i is FoodItem => i != null);
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
  /** Daily calorie totals over the last `days` days (only days with entries are
   *  returned). Used by the adaptive-TDEE estimator. */
  async getDailyCalorieTotals(userId: number, days = 28): Promise<{ date: string; calories: number }[]> {
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    const rows = await db
      .select({
        date:     foodLog.date,
        calories: sql<number>`coalesce(sum(${foodLog.caloriesActual}), 0)`,
      })
      .from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, fromStr)))
      .groupBy(foodLog.date)
      .orderBy(foodLog.date);
    return rows.map(r => {
      const raw = r.date as unknown;
      const date = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
      return { date, calories: Number(r.calories) };
    });
  },

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
    const [t] = await db.select().from(nutritionTargets).where(eq(nutritionTargets.userId, userId)).orderBy(desc(nutritionTargets.effectiveDate), desc(nutritionTargets.id)).limit(1);
    return t;
  },
  async upsertNutritionTarget(userId: number, data: Omit<InsertNutritionTarget, "userId">): Promise<NutritionTarget> {
    const [t] = await db.insert(nutritionTargets).values({
      userId,
      ...data,
      effectiveDate: data.effectiveDate ?? new Date().toISOString().slice(0, 10),
    }).returning();
    return t;
  },
  async getNutritionTargetHistory(userId: number, limit = 10): Promise<NutritionTarget[]> {
    return db.select().from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.effectiveDate), desc(nutritionTargets.id))
      .limit(limit);
  },
  async getNutritionAdherence(userId: number, days = 14): Promise<{
    periods: { targetId: number; startDate: string; endDate: string; calories: number; proteinG: number; carbsG: number; fatG: number; daysLogged: number; daysHit: number; avgCalories: number; avgProtein: number; avgCarbs: number; avgFat: number }[];
  }> {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);
    const startStr = startDate.toISOString().slice(0, 10);
    const todayStr = today.toISOString().slice(0, 10);

    const targets = await db.select().from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(nutritionTargets.effectiveDate);

    const dailyTotals = await db.select({
      date: foodLog.date,
      calories: sql<number>`coalesce(sum(${foodLog.caloriesActual}), 0)`,
      protein: sql<number>`coalesce(sum(${foodLog.proteinActual}), 0)`,
      carbs: sql<number>`coalesce(sum(${foodLog.carbsActual}), 0)`,
      fat: sql<number>`coalesce(sum(${foodLog.fatActual}), 0)`,
    }).from(foodLog)
      .where(and(eq(foodLog.userId, userId), gte(foodLog.date, startStr), lte(foodLog.date, todayStr)))
      .groupBy(foodLog.date);

    const dailyMap = new Map(dailyTotals.map(d => [d.date, d]));

    if (targets.length === 0) return { periods: [] };

    const periods: { targetId: number; startDate: string; endDate: string; calories: number; proteinG: number; carbsG: number; fatG: number; daysLogged: number; daysHit: number; avgCalories: number; avgProtein: number; avgCarbs: number; avgFat: number }[] = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + dayOffset);
      const ds = d.toISOString().slice(0, 10);

      let activeTarget = targets[0];
      for (const t of targets) {
        if (t.effectiveDate <= ds) activeTarget = t;
        else break;
      }

      let period = periods.find(p => p.targetId === activeTarget.id);
      if (!period) {
        period = {
          targetId: activeTarget.id, startDate: ds, endDate: ds,
          calories: activeTarget.calories, proteinG: activeTarget.proteinG,
          carbsG: activeTarget.carbsG, fatG: activeTarget.fatG,
          daysLogged: 0, daysHit: 0, avgCalories: 0, avgProtein: 0, avgCarbs: 0, avgFat: 0,
        };
        periods.push(period);
      }
      period.endDate = ds;

      const log = dailyMap.get(ds);
      if (log && log.calories > 0) {
        period.daysLogged++;
        period.avgCalories += log.calories;
        period.avgProtein += log.protein;
        period.avgCarbs += log.carbs;
        period.avgFat += log.fat;
        const withinRange = Math.abs(log.calories - activeTarget.calories) / activeTarget.calories <= 0.10;
        if (withinRange) period.daysHit++;
      }
    }

    for (const p of periods) {
      if (p.daysLogged > 0) {
        p.avgCalories = Math.round(p.avgCalories / p.daysLogged);
        p.avgProtein = Math.round(p.avgProtein / p.daysLogged);
        p.avgCarbs = Math.round(p.avgCarbs / p.daysLogged);
        p.avgFat = Math.round(p.avgFat / p.daysLogged);
      }
    }

    return { periods };
  },

  // ── Water Log ──────────────────────────────────────────────────────────────
  async getWaterLog(userId: number, date: string): Promise<WaterLogEntry[]> {
    return db.select().from(waterLog).where(and(eq(waterLog.userId, userId), eq(waterLog.date, date)));
  },
  async createWaterEntry(data: InsertWaterLogEntry): Promise<WaterLogEntry> {
    const [entry] = await db.insert(waterLog).values(data).returning();
    return entry;
  },
  async updateWaterEntry(id: number, userId: number, patch: { loggedAt?: Date }): Promise<WaterLogEntry | undefined> {
    const [entry] = await db.update(waterLog).set(patch).where(and(eq(waterLog.id, id), eq(waterLog.userId, userId))).returning();
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
  /** Returns template exercises with exercise details (name, muscle, category).
   *  Uses two separate queries so exercises are never silently dropped if the
   *  exercise row is missing (avoids INNER JOIN dropping rows). */
  async getTemplateExercisesWithDetails(templateId: number) {
    const tes = await db
      .select()
      .from(templateExercises)
      .where(eq(templateExercises.templateId, templateId))
      .orderBy(templateExercises.orderIndex);

    if (tes.length === 0) return [];

    const exIds = [...new Set(tes.map(te => te.exerciseId))];
    const exRows = await db
      .select({ id: exercises.id, name: exercises.name, primaryMuscle: exercises.primaryMuscle, category: exercises.category, equipment: exercises.equipment })
      .from(exercises)
      .where(inArray(exercises.id, exIds));

    const exMap = new Map(exRows.map(e => [e.id, e]));

    return tes.map(te => {
      const ex = exMap.get(te.exerciseId);
      return {
        id:                te.id,
        templateId:        te.templateId,
        exerciseId:        te.exerciseId,
        orderIndex:        te.orderIndex,
        targetSets:        te.targetSets,
        targetReps:        te.targetReps,
        targetWeightGrams: te.targetWeightGrams,
        exerciseName:      ex?.name      ?? `Exercise #${te.exerciseId}`,
        primaryMuscle:     ex?.primaryMuscle ?? "",
        category:          ex?.category  ?? "",
        equipment:         ex?.equipment ?? "",
      };
    });
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

  /** For each exerciseId, find the most-recent set that has a non-zero weight.
   *  Returns a map of exerciseId → weightGrams.
   *  Uses name-based aliasing so CSV-imported exercises (different IDs, same name)
   *  are matched back to the canonical template exercise ID. */
  async getLastWeightsForExercises(userId: number, exerciseIds: number[]): Promise<Record<number, number>> {
    if (exerciseIds.length === 0) return {};

    // 1. Look up the names of the requested exercises
    const exRows = await db.select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(inArray(exercises.id, exerciseIds));
    if (exRows.length === 0) return {};

    // 2. For each name, find ALL exercise IDs that share that name (case-insensitive).
    //    This catches CSV-imported duplicates created with a different ID.
    const nameToCanonicalId: Record<string, number> = {};
    for (const ex of exRows) nameToCanonicalId[ex.name.toLowerCase()] = ex.id;

    const nameList = exRows.map(e => e.name.toLowerCase());
    const aliasRows = await db.select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(inArray(sql`lower(${exercises.name})`, nameList));

    // aliasId → canonicalId (the template exercise ID we need to return)
    const aliasToCanonical: Record<number, number> = {};
    for (const a of aliasRows) {
      const canonical = nameToCanonicalId[a.name.toLowerCase()];
      if (canonical !== undefined) aliasToCanonical[a.id] = canonical;
    }

    // The full set of exercise IDs we're interested in (original + aliases)
    const allRelevantIds = new Set(Object.keys(aliasToCanonical).map(Number));

    // 3. Scan the 50 most recent workouts (more history since CSV data may be old)
    const recentWorkouts = await db.select().from(workouts)
      .where(eq(workouts.userId, userId))
      .orderBy(desc(workouts.completedAt), desc(workouts.date))
      .limit(50);
    if (recentWorkouts.length === 0) return {};

    const result: Record<number, number> = {};
    const found = new Set<number>(); // canonical IDs already resolved

    for (const w of recentWorkouts) {
      if (found.size >= exerciseIds.length) break;
      const sets = await db.select().from(workoutSets)
        .where(eq(workoutSets.workoutId, w.id))
        .orderBy(desc(workoutSets.setNumber));
      for (const s of sets) {
        if (!allRelevantIds.has(s.exerciseId)) continue;
        if (!s.weightGrams || s.weightGrams <= 0) continue;
        const canonicalId = aliasToCanonical[s.exerciseId];
        if (canonicalId !== undefined && !found.has(canonicalId)) {
          result[canonicalId] = s.weightGrams;
          found.add(canonicalId);
        }
      }
    }
    return result;
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
        mealGroupId: mealId,
        mealGroupName: meal.name,
      })))
      .returning();
    return entries;
  },

  // ── Friendships ────────────────────────────────────────────────────────────
  /** Return the friendship row (either direction) between two users, if any */
  async getFriendship(userId: number, friendId: number): Promise<Friendship | undefined> {
    const [row] = await db.select().from(friendships).where(
      or(
        and(eq(friendships.userId, userId), eq(friendships.friendId, friendId)),
        and(eq(friendships.userId, friendId), eq(friendships.friendId, userId)),
      )
    );
    return row;
  },

  /** Create a pending friend request (userId → friendId) */
  async sendFriendRequest(userId: number, friendId: number): Promise<Friendship> {
    const [row] = await db.insert(friendships).values({ userId, friendId, status: "pending" }).returning();
    return row;
  },

  /** Accept a friend request — only the recipient (friendId) may accept */
  async acceptFriendRequest(id: number, recipientUserId: number): Promise<Friendship | undefined> {
    const [row] = await db.update(friendships)
      .set({ status: "accepted" })
      .where(and(eq(friendships.id, id), eq(friendships.friendId, recipientUserId)))
      .returning();
    return row;
  },

  /** Remove a friendship (either direction) */
  async removeFriendship(userId: number, friendId: number): Promise<void> {
    await db.delete(friendships).where(
      or(
        and(eq(friendships.userId, userId), eq(friendships.friendId, friendId)),
        and(eq(friendships.userId, friendId), eq(friendships.friendId, userId)),
      )
    );
  },

  /** Get all accepted friends for a user, joined with their user record */
  async getFriends(userId: number): Promise<{ friendship: Friendship; friend: User }[]> {
    const rows = await db.select().from(friendships)
      .where(and(
        or(eq(friendships.userId, userId), eq(friendships.friendId, userId)),
        eq(friendships.status, "accepted"),
      ));
    const result: { friendship: Friendship; friend: User }[] = [];
    for (const f of rows) {
      const friendUserId = f.userId === userId ? f.friendId : f.userId;
      const [friend] = await db.select().from(users).where(eq(users.id, friendUserId));
      if (friend) result.push({ friendship: f, friend });
    }
    return result;
  },

  /** Pending requests incoming to this user */
  async getPendingRequests(userId: number): Promise<{ friendship: Friendship; sender: User }[]> {
    const rows = await db.select().from(friendships)
      .where(and(eq(friendships.friendId, userId), eq(friendships.status, "pending")));
    const result: { friendship: Friendship; sender: User }[] = [];
    for (const f of rows) {
      const [sender] = await db.select().from(users).where(eq(users.id, f.userId));
      if (sender) result.push({ friendship: f, sender });
    }
    return result;
  },

  /** Check if two users are accepted friends */
  async areFriends(userId: number, friendId: number): Promise<boolean> {
    const row = await this.getFriendship(userId, friendId);
    return row?.status === "accepted";
  },

  /** Search users by name or email, excluding self, returning friendship status.
   *  When query is empty, returns all platform users (browse mode). */
  async searchUsers(currentUserId: number, query: string): Promise<Array<{
    id: number;
    name: string;
    friendshipStatus: "none" | "pending_sent" | "pending_received" | "friends";
    friendshipId?: number;
  }>> {
    const q = query.trim();
    const results = await db.select().from(users)
      .where(
        q
          ? and(
              ne(users.id, currentUserId),
              or(
                sql`lower(${users.name}) like ${`%${q.toLowerCase()}%`}`,
                sql`lower(${users.email}) like ${`%${q.toLowerCase()}%`}`,
              )
            )
          : ne(users.id, currentUserId)
      )
      .orderBy(users.name)
      .limit(50);

    return await Promise.all(results.map(async (u) => {
      const friendship = await this.getFriendship(currentUserId, u.id);
      let friendshipStatus: "none" | "pending_sent" | "pending_received" | "friends" = "none";
      if (friendship) {
        if (friendship.status === "accepted") {
          friendshipStatus = "friends";
        } else if (friendship.userId === currentUserId) {
          friendshipStatus = "pending_sent";
        } else {
          friendshipStatus = "pending_received";
        }
      }
      return { id: u.id, name: u.name, friendshipStatus, friendshipId: friendship?.id };
    }));
  },

  /**
   * Compute workout streak for a user: count consecutive days ending today
   * where at least one workout was logged.
   */
  /** Dates (YYYY-MM-DD) the user logged ANY activity — a workout or food. */
  async getActivityDates(userId: number): Promise<Set<string>> {
    const norm = (raw: unknown) => raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
    const [wk, fd] = await Promise.all([
      db.select({ date: workouts.date }).from(workouts).where(eq(workouts.userId, userId)),
      db.selectDistinct({ date: foodLog.date }).from(foodLog).where(eq(foodLog.userId, userId)),
    ]);
    const set = new Set<string>();
    for (const r of wk) set.add(norm(r.date));
    for (const r of fd) set.add(norm(r.date));
    return set;
  },

  /** Working (non-warmup) sets joined with their workout date + exercise name. */
  async getStrengthSets(userId: number): Promise<StrengthSet[]> {
    const norm = (raw: unknown) => raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
    const rows = await db
      .select({
        exerciseId:  workoutSets.exerciseId,
        name:        exercises.name,
        date:        workouts.date,
        reps:        workoutSets.reps,
        weightGrams: workoutSets.weightGrams,
      })
      .from(workoutSets)
      .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
      .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
      .where(and(eq(workouts.userId, userId), eq(workoutSets.isWarmup, false), gt(workoutSets.weightGrams, 0), gt(workoutSets.reps, 0)));
    return rows.map(r => ({ ...r, date: norm(r.date) }));
  },

  async computeStreak(userId: number): Promise<number> {
    return streakFromDates(await this.getActivityDates(userId));
  },

  /** Rich score breakdown for leaderboards + friend cards. */
  async getScore(userId: number): Promise<{ points: number; streak: number; workouts: number; proteinDays: number; prs: number }> {
    const target = await db.select().from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.effectiveDate), desc(nutritionTargets.id)).limit(1);
    const proteinTarget = target[0]?.proteinG ?? 150;

    const [activeDates, wkCount, proteinDayRows, strengthSets] = await Promise.all([
      this.getActivityDates(userId),
      db.select({ count: sql<number>`count(*)` }).from(workouts).where(eq(workouts.userId, userId)),
      db.select({ date: foodLog.date }).from(foodLog).where(eq(foodLog.userId, userId))
        .groupBy(foodLog.date)
        .having(sql`coalesce(sum(${foodLog.proteinActual}), 0) >= ${proteinTarget * 0.9}`),
      this.getStrengthSets(userId),
    ]);

    const streak      = streakFromDates(activeDates);
    const workoutCnt  = Number(wkCount[0]?.count ?? 0);
    const proteinDays = proteinDayRows.length;
    const prs         = countPRs(sessionBests(strengthSets));
    const points      = computePointsTotal({ workouts: workoutCnt, proteinDays, prs, streak });

    return { points, streak, workouts: workoutCnt, proteinDays, prs };
  },

  // ── AI Coach Plans ─────────────────────────────────────────────────────────
  async getAiCoachPlan(userId: number): Promise<any | null> {
    const [row] = await db.select().from(aiCoachPlans)
      .where(eq(aiCoachPlans.userId, userId))
      .orderBy(desc(aiCoachPlans.createdAt)).limit(1);
    return row?.planJson ?? null;
  },

  async saveAiCoachPlan(userId: number, plan: any): Promise<void> {
    // Delete old, insert new (simple upsert pattern)
    await db.delete(aiCoachPlans).where(eq(aiCoachPlans.userId, userId));
    await db.insert(aiCoachPlans).values({ userId, planJson: plan });
  },

  // ── Active Routine ─────────────────────────────────────────────────────────
  async getActiveRoutine(userId: number): Promise<ActiveRoutine | undefined> {
    const [row] = await db.select().from(activeRoutines).where(eq(activeRoutines.userId, userId));
    return row;
  },

  /** Replace the user's active routine (one per user — simple delete + insert). */
  async setActiveRoutine(userId: number, days: RoutineDay[], lastCheckedDate: string): Promise<ActiveRoutine> {
    await db.delete(activeRoutines).where(eq(activeRoutines.userId, userId));
    const [row] = await db.insert(activeRoutines).values({ userId, days, currentIndex: 0, lastCheckedDate }).returning();
    return row;
  },

  async updateActiveRoutineState(id: number, currentIndex: number, lastCheckedDate: string): Promise<void> {
    await db.update(activeRoutines).set({ currentIndex, lastCheckedDate }).where(eq(activeRoutines.id, id));
  },

  async clearActiveRoutine(userId: number): Promise<void> {
    await db.delete(activeRoutines).where(eq(activeRoutines.userId, userId));
  },

  /**
   * Compute total points for a user:
   * 100 pts per workout logged, 50 pts per day hitting protein ≥ 90% of target
   */
  async computePoints(userId: number): Promise<number> {
    const workoutCount = await db.select({ count: sql<number>`count(*)` })
      .from(workouts).where(eq(workouts.userId, userId));
    const wPts = Number(workoutCount[0]?.count ?? 0) * 100;

    // Days where protein ≥ 90% of target
    const target = await db.select().from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.effectiveDate), desc(nutritionTargets.id)).limit(1);
    const proteinTarget = target[0]?.proteinG ?? 150;

    const proteinDays = await db.select({ date: foodLog.date })
      .from(foodLog)
      .where(eq(foodLog.userId, userId))
      .groupBy(foodLog.date)
      .having(sql`coalesce(sum(${foodLog.proteinActual}), 0) >= ${proteinTarget * 0.9}`);
    const mPts = proteinDays.length * 50;

    return wPts + mPts;
  },
};
