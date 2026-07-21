import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import { storage } from "./storage.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { passport } from "./auth.js";
import { lookupBarcode, lookupBarcodeFS, autocompleteFatSecret, searchFoodByName, searchOFF, searchUSDA, searchFatSecret, searchCalorieNinjas, searchBrandOFF, enrichMissingNutrition } from "./services/food-lookup.js";
import { parseNutritionLabel, parseMealText, parseMealPhoto, type ParsedMealItem } from "./services/vision.js";
import { calculateMacroTargets, getAgeFromBirthDate, estimateAdaptiveTDEE, calculateBMR, calculateTDEE, type AdaptiveTDEEResult, type ActivityLevel, type Sex } from "./services/goal-engine.js";
import { wilksScore, sessionBests, currentBests, avgProgressPct, avgProgressAbsKg, streakFromDates } from "./services/scoring.js";
import { fetchExerciseGif } from "./services/exercise-gif.js";
import { sendInviteEmail, sendInviteSms } from "./services/notifications.js";
import { rollForward, completeCurrentDay, buildDaysFromSchedule, type ActiveRoutineState } from "./services/active-routine.js";
import { generateAdaptiveProposals } from "./services/training-coach.js";
import {
  insertUserSchema, insertUserProfileSchema, insertGoalSchema, insertBodyMeasurementSchema,
  insertProgressPhotoSchema,
  insertFoodItemSchema, insertFoodLogSchema, insertWaterLogSchema, insertSupplementLogSchema,
  insertExerciseSchema, insertWorkoutTemplateSchema, insertTemplateExerciseSchema,
  insertWorkoutSchema, insertWorkoutSetSchema, insertHeartRateLogSchema,
  insertSavedMealSchema, insertMealIngredientSchema,
} from "../shared/schema.js";
import { getStrengthStandard, computeThresholds, getLevelIndex, LEVEL_NAMES } from "../shared/strength-standards.js";
import { z } from "zod";

/**
 * Accepts either session auth (web) or Bearer JWT (mobile).
 * Sets req.user if valid, returns true. Otherwise sends 401 and returns false.
 *
 * NOTE: reads SESSION_SECRET at call-time (not module-load-time) so that
 * dotenv has already populated process.env before the secret is resolved.
 */
function requireAuth(req: Request, res: Response): boolean {
  // Session-based (web)
  if (req.isAuthenticated()) return true;
  // JWT-based (mobile)
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const secret = process.env.SESSION_SECRET ?? "fitcore-jwt-secret";
      const payload = jwt.verify(auth.slice(7), secret) as { userId: number };
      (req as any).user = { id: payload.userId };
      return true;
    } catch { /* invalid / expired token — fall through to 401 */ }
  }
  res.sendStatus(401);
  return false;
}

async function recalculateTargets(userId: number) {
  const profile = await storage.getProfile(userId);
  const [activeGoal] = (await storage.getGoals(userId)).filter(g => g.isActive && (g.type === "weight_loss" || g.type === "weight_gain" || g.type === "maintain"));
  const latestMeasurement = await storage.getLatestMeasurement(userId);

  if (!profile || !latestMeasurement || !profile.birthDate || !profile.heightCm) return;

  const weightKg = latestMeasurement.weightGrams / 1000;
  const heightCm = profile.heightCm;
  const ageYears = getAgeFromBirthDate(profile.birthDate);
  const sex = (profile.sex as "male" | "female" | "other") ?? "male";
  const activityLevel = (profile.activityLevel as any) ?? "moderate";

  let goalType: "weight_loss" | "weight_gain" | "maintain" | "strength" | "body_comp" = "maintain";
  let targetWeightKg: number | undefined;
  let deadlineDays: number | undefined;

  if (activeGoal) {
    goalType = activeGoal.type as any;
    if (activeGoal.targetValue) targetWeightKg = activeGoal.targetValue / 1000;
    if (activeGoal.deadline) {
      const days = Math.ceil((new Date(activeGoal.deadline).getTime() - Date.now()) / 86400000);
      deadlineDays = Math.max(days, 1);
    }
  }

  // ── Adaptive TDEE ──────────────────────────────────────────────────────────
  // Back-solve real maintenance calories from logged intake + weight trend.
  // When we have enough data we trust the measured number over the formula and
  // persist it so the dashboard can show it; otherwise fall back to the formula.
  const [intake, weightRows] = await Promise.all([
    storage.getDailyCalorieTotals(userId, 28),
    storage.getMeasurements(userId, 60),
  ]);
  const adaptive = estimateAdaptiveTDEE({
    intake,
    weights: weightRows.map(w => ({ date: String(w.date).slice(0, 10), weightKg: w.weightGrams / 1000 })),
  });
  let blendedTdee: number | undefined;
  if (adaptive) {
    await storage.upsertProfile(userId, { estimatedTdee: adaptive.tdee, tdeeUpdatedAt: new Date() });
    const formulaBmr = calculateBMR(weightKg, heightCm, ageYears, sex);
    const formulaTdee = calculateTDEE(formulaBmr, activityLevel);
    const w = adaptive.confidence === "high" ? 1.0
            : adaptive.confidence === "medium" ? 0.6
            : 0.3;
    blendedTdee = Math.round(formulaTdee * (1 - w) + adaptive.tdee * w);
  }

  const targets = calculateMacroTargets({
    weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays,
    overrideTdee: blendedTdee,
  });
  await storage.upsertNutritionTarget(userId, { effectiveDate: new Date().toISOString().slice(0, 10), ...targets, source: "auto_calc", reason: blendedTdee ? `blended TDEE (${adaptive!.confidence} confidence)` : null });
}

export function registerRoutes(app: Express) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
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
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (err) => {
        if (err) return next(err);
        res.json({ id: user.id, email: user.email, name: user.name });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => res.sendStatus(200));
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const u = req.user as any;
    res.json({ id: u.id, email: u.email, name: u.name });
  });

  // ── Mobile JWT auth ──────────────────────────────────────────────────────────
  const JWT_SECRET = process.env.SESSION_SECRET ?? "fitcore-jwt-secret";

  /** Middleware that accepts Bearer JWT for mobile clients */
  function requireMobileAuth(req: Request, res: Response): { id: number } | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) { res.sendStatus(401); return null; }
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
      return { id: payload.userId };
    } catch {
      res.sendStatus(401);
      return null;
    }
  }

  /** POST /api/auth/login-mobile — returns JWT for mobile clients */
  app.post("/api/auth/login-mobile", async (req, res) => {
    try {
      const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ message: "Invalid credentials" });
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "90d" });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err: any) {
      // Distinguish DB errors from validation errors
      const isDbError = err.code && /^[0-9A-Z]{5}$/.test(err.code);
      const status = isDbError ? 503 : 400;
      const message = isDbError ? "Server error — please try again" : err.message;
      console.error("login-mobile error:", err.message);
      res.status(status).json({ message });
    }
  });

  /** GET /api/auth/me-mobile — verify JWT and return user */
  app.get("/api/auth/me-mobile", async (req, res) => {
    const mobile = requireMobileAuth(req, res);
    if (!mobile) return;
    const user = await storage.getUserById(mobile.id);
    if (!user) return res.sendStatus(404);
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  // ── Profile ─────────────────────────────────────────────────────────────────
  app.get("/api/profile", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const profile = await storage.getProfile(userId);
    res.json(profile ?? null);
  });

  app.put("/api/profile", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    try {
      const data = insertUserProfileSchema.omit({ userId: true }).partial().parse(req.body);
      const profile = await storage.upsertProfile(userId, data);
      await recalculateTargets(userId);
      res.json(profile);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Goals ───────────────────────────────────────────────────────────────────
  app.get("/api/goals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(await storage.getGoals((req.user as any).id));
  });

  app.post("/api/goals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertGoalSchema.omit({ userId: true }).parse(req.body);
      const goal = await storage.createGoal({ ...data, userId });
      await recalculateTargets(userId);
      res.status(201).json(goal);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/goals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const goal = await storage.updateGoal(Number(req.params.id), userId, req.body);
    if (!goal) return res.sendStatus(404);
    await recalculateTargets(userId);
    res.json(goal);
  });

  app.delete("/api/goals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteGoal(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  /**
   * POST /api/goals/ai-analysis
   * Sends the user's full profile, active goals, measurements, and training
   * history to Claude and returns a comprehensive structured plan covering
   * nutrition, hydration, workout schedule, and actionable priorities.
   */
  app.post("/api/goals/ai-analysis", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;

    // Optional pre-flight preferences from the questionnaire modal
    const preferences: {
      experience?: "beginner" | "intermediate" | "advanced";
      duration?: 30 | 45 | 60 | 90;
      equipment?: "full_gym" | "dumbbells_cables" | "dumbbells_only" | "bodyweight";
      limitations?: string;
    } | null = req.body?.preferences ?? null;

    try {
      // ── Gather user context ─────────────────────────────────────────────────
      const [profile, goals, measurements, target, recentWorkouts, foodSummary] = await Promise.all([
        storage.getProfile(userId),
        storage.getGoals(userId),
        storage.getMeasurements(userId, 30),   // more history for trend detection
        storage.getNutritionTarget(userId),
        storage.getWorkouts(userId, 10),
        storage.getFoodLogSummary(userId, "1M"),
      ]);

      // ── Top lifts context (feature 1) ────────────────────────────────────────
      const loggedExerciseIds = await storage.getLoggedExerciseIds(userId);
      const topExerciseIds = loggedExerciseIds.slice(0, 10);
      const [lastWeights, allExercises] = await Promise.all([
        storage.getLastWeightsForExercises(userId, topExerciseIds),
        storage.getExercises(userId),
      ]);
      const exerciseNameMap: Record<number, string> = {};
      for (const ex of allExercises) exerciseNameMap[ex.id] = ex.name;
      const topLiftsLines = topExerciseIds
        .filter(id => lastWeights[id] && lastWeights[id] > 0)
        .map(id => {
          const lbs = Math.round(lastWeights[id] / 453.592);
          return `  - ${exerciseNameMap[id] ?? `Exercise #${id}`}: ${lbs} lbs`;
        });
      const topLiftsContext = topLiftsLines.length > 0
        ? `TOP LIFTS (current max weights):\n${topLiftsLines.join("\n")}`
        : "TOP LIFTS: No strength training data recorded yet.";

      const activeGoals = goals.filter(g => g.isActive);
      const latestWeight = measurements[0];
      const weightKg = latestWeight ? latestWeight.weightGrams / 1000 : null;
      const weightLbs = weightKg ? Math.round(weightKg * 2.205) : null;
      const heightCm  = profile?.heightCm ?? null;
      const heightIn  = heightCm ? Math.round(heightCm / 2.54) : null;
      const ageYears  = profile?.birthDate ? getAgeFromBirthDate(profile.birthDate) : null;
      const sex       = profile?.sex ?? "unspecified";
      const activity  = profile?.activityLevel ?? "moderate";

      // Workout frequency over last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      const recentCount = recentWorkouts.filter(w => new Date(w.date) >= thirtyDaysAgo).length;

      // ── Weight trend (computed server-side so Claude gets hard numbers) ──────
      // Use the two measurements furthest apart (>= 7 days) for a reliable rate.
      let weightTrendLbsPerWeek: number | null = null;
      let trendWindowDays: number | null = null;
      if (measurements.length >= 2) {
        const newest = measurements[0];
        const oldest = measurements[measurements.length - 1];
        const ms = new Date(newest.date).getTime() - new Date(oldest.date).getTime();
        const days = ms / 86400000;
        if (days >= 7) {
          const changeLbs = (newest.weightGrams - oldest.weightGrams) / 453.592;
          weightTrendLbsPerWeek = (changeLbs / days) * 7;
          trendWindowDays = Math.round(days);
        }
      }

      const recentMeasurementsText = measurements.slice(0, 8).map(m => {
        const lbs = (m.weightGrams / 453.592).toFixed(1);
        return `  ${m.date}: ${lbs} lbs`;
      }).join("\n");

      const trendText = trendWindowDays
        ? `Actual rate over last ${trendWindowDays} days: ${weightTrendLbsPerWeek! >= 0 ? "+" : ""}${weightTrendLbsPerWeek!.toFixed(2)} lbs/week (${weightTrendLbsPerWeek! > 0 ? "gaining" : weightTrendLbsPerWeek! < 0 ? "losing" : "stable"})`
        : "Insufficient measurement history to calculate trend (need at least 2 weigh-ins 7+ days apart)";

      // ── Diet logging context ─────────────────────────────────────────────────
      const loggedDays    = foodSummary.filter(d => d.calories > 0);
      const totalDays     = foodSummary.length; // up to 30 days
      const loggedCount   = loggedDays.length;
      const avgCalLogged  = loggedCount > 0
        ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / loggedCount)
        : null;
      const avgProtLogged = loggedCount > 0
        ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedCount)
        : null;

      let dietLoggingStatus: string;
      if (loggedCount === 0) {
        dietLoggingStatus = `No diet logs in the last 30 days. User has NOT been logging — do NOT assume they ate nothing. Base recommendations on goals and profile only.`;
      } else if (loggedCount < totalDays * 0.5) {
        dietLoggingStatus = `Inconsistent: logged ${loggedCount}/${totalDays} days over the last 30 days. On logged days avg ${avgCalLogged} kcal, ${avgProtLogged}g protein. True intake is likely higher — acknowledge the gap.`;
      } else {
        dietLoggingStatus = `Consistent: logged ${loggedCount}/${totalDays} days over the last 30 days. On logged days avg ${avgCalLogged} kcal, ${avgProtLogged}g protein. Reasonably reliable.`;
      }

      // ── Today's date (for deadline math) ────────────────────────────────────
      const today = new Date().toISOString().slice(0, 10);

      // ── Build prompt ────────────────────────────────────────────────────────
      const userContext = `
TODAY: ${today}

USER PROFILE:
- Age: ${ageYears ?? "unknown"}
- Sex: ${sex}
- Height: ${heightIn ? `${Math.floor(heightIn / 12)}'${heightIn % 12}"` : "unknown"} (${heightCm ?? "unknown"} cm)
- Current weight: ${weightLbs ? `${weightLbs} lbs` : "unknown"} (${weightKg ? `${weightKg.toFixed(1)} kg` : "unknown"})
- Activity level: ${activity}
- Workouts in last 30 days: ${recentCount}

WEIGHT HISTORY (newest first):
${recentMeasurementsText || "  No measurements recorded yet."}
${trendText}

DIET LOGGING STATUS (last 30 days):
${dietLoggingStatus}

ACTIVE GOALS (include id in feasibility analysis):
${activeGoals.length === 0 ? "No active goals set." : activeGoals.map(g => {
  const targetLbs = (g.unit === "lbs" && g.targetValue) ? (g.targetValue / 453.592).toFixed(1) : null;
  const startLbs  = (g.unit === "lbs" && g.startValue)  ? (g.startValue  / 453.592).toFixed(1) : null;
  const deadline  = g.deadline ? `deadline ${g.deadline}` : "no deadline";
  const daysLeft  = g.deadline ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000) : null;
  return `- [goalId:${g.id}] "${g.label}" — type: ${g.type}, target: ${targetLbs ? targetLbs + " lbs" : g.targetValue + " " + g.unit}, start: ${startLbs ? startLbs + " lbs" : (g.startValue ?? "unknown")}, ${deadline}${daysLeft !== null ? ` (${daysLeft} days remaining)` : ""}`;
}).join("\n")}

CURRENT AUTO-CALCULATED TARGETS:
- Calories: ${target ? Math.round(target.calories) : "not set"} kcal/day
- Protein:  ${target ? Math.round(target.proteinG) : "not set"} g/day
- Carbs:    ${target ? Math.round(target.carbsG)   : "not set"} g/day
- Fat:      ${target ? Math.round(target.fatG)     : "not set"} g/day
- Water:    ${target ? Math.round((target.waterMl ?? 2500) / 29.57) : "not set"} oz/day

${topLiftsContext}
${preferences ? `
USER PREFERENCES (collected before plan generation):
- Training experience: ${preferences.experience ?? "unspecified"}
- Preferred workout duration: ${preferences.duration ? `${preferences.duration} minutes` : "unspecified"}
- Available equipment: ${(() => {
  const map: Record<string, string> = {
    full_gym: "Full gym (barbells, cables, machines, everything)",
    dumbbells_cables: "Dumbbells + cables (no barbell)",
    dumbbells_only: "Dumbbells only",
    bodyweight: "Bodyweight only (no weights)",
  };
  return map[preferences.equipment ?? ""] ?? preferences.equipment ?? "unspecified";
})()}
- Physical limitations/injuries: ${preferences.limitations?.trim() || "None stated"}` : ""}
`.trim();

      const prompt = `You are an expert fitness and nutrition coach. Analyze the user's data below and produce a comprehensive, personalized plan.

${userContext}

IMPORTANT RULES:
1. For each active goal with a deadline, calculate whether it is realistically achievable:
   - Weight loss/gain: safe maximum is 2 lbs/week loss, 1 lb/week gain (0.5 lb/week if body-recomp)
   - Strength goals: natural progression is roughly 5 lbs/week on main lifts for beginners, 1-2 lbs/week intermediate
   - If the required rate exceeds safe limits, the goal is NOT achievable in time — compute the minimum additional days needed and provide a concrete suggested new deadline date (YYYY-MM-DD format).
2. If weight trend data is available and the user is falling behind their required rate, generate a progressAdjustment with two concrete options (extend deadline OR adjust nutrition). Do NOT make this choice for them — present both options.
3. For the "adjust_nutrition" option, provide specific updated macro numbers (not just "eat less") that would get them back on track, keeping protein ≥ 0.8 g per lb bodyweight and total calories ≥ 1400 kcal.
4. Never assume zero food intake when logging is absent or inconsistent.
5. For each strength or cardio training day in the schedule, provide 4-6 exercises with sets and rep ranges. Rest and active_recovery days get an empty exercises array []. Where the user has logged TOP LIFTS, prefer to include those exercises and reference their current weights when suggesting progressions.
6. For the training schedule, use the TOP LIFTS data to make personalized recommendations — if the user has bench press at 185 lbs, suggest appropriate weight ranges in the assessment.
7. NEW USER / NO HISTORY RULES (apply when TOP LIFTS shows no strength data):
   - Calculate macros directly from the user's profile (height, weight, age, sex, activity level) even if no food has been logged. Use the Mifflin-St Jeor formula for BMR, apply the activity multiplier, then adjust for the active goal (deficit or surplus).
   - Set protein at 0.82 g per lb of current bodyweight (or 0.7 g/lb on a cut). Fill remaining calories with carbs (≥40% kcal) and fat (25-30% kcal).
   - For a complete beginner (experience: beginner), include a "weightNote" on every exercise in the exercises array. The weightNote should give a friendly starting-weight suggestion (e.g., "Start with the empty bar (45 lbs) and add 5 lbs each session" or "Use 10-15 lb dumbbells for your first session — focus on form").
   - For intermediate/advanced, weightNote is optional — only include it if you have specific TOP LIFTS data to reference.
8. EQUIPMENT CONSTRAINT: If USER PREFERENCES specify equipment other than "full_gym", you MUST only include exercises that can be performed with that equipment. No barbell exercises if dumbbells_only or bodyweight; no machine exercises if bodyweight.
9. WORKOUT DURATION: Fit the number of exercises to the stated workout duration. 30 min → 3-4 exercises; 45 min → 4-5 exercises; 60 min → 5-6 exercises; 90 min → 6-8 exercises.

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "summary": "2-3 sentence overall assessment",
  "nutrition": {
    "calories": <integer>,
    "proteinG": <integer>,
    "carbsG": <integer>,
    "fatG": <integer>,
    "reasoning": "1-2 sentences",
    "tips": ["tip1", "tip2", "tip3"]
  },
  "hydration": {
    "dailyOz": <integer>,
    "reasoning": "1 sentence",
    "tips": ["tip1", "tip2"]
  },
  "training": {
    "daysPerWeek": <integer>,
    "restDays": <integer>,
    "split": "e.g. Push/Pull/Legs",
    "schedule": [
      { "day": "Monday",    "focus": "...", "type": "strength|cardio|rest|active_recovery", "exercises": [{ "name": "...", "sets": 3, "reps": "8-10", "weightNote": "optional beginner guidance or null" }] },
      { "day": "Tuesday",   "focus": "...", "type": "...", "exercises": [] },
      { "day": "Wednesday", "focus": "...", "type": "...", "exercises": [] },
      { "day": "Thursday",  "focus": "...", "type": "...", "exercises": [] },
      { "day": "Friday",    "focus": "...", "type": "...", "exercises": [] },
      { "day": "Saturday",  "focus": "...", "type": "...", "exercises": [] },
      { "day": "Sunday",    "focus": "...", "type": "...", "exercises": [] }
    ],
    "reasoning": "1-2 sentences",
    "tips": ["tip1", "tip2", "tip3"]
  },
  "goalFeasibility": [
    {
      "goalId": <integer — the goalId from the context>,
      "goalLabel": "label string",
      "status": "on_track|achievable|tight|not_achievable|no_deadline",
      "requiredRatePerWeek": "e.g. 1.8 lbs/week — null if not applicable",
      "safeMaxRate": "e.g. 2 lbs/week — null if not applicable",
      "currentRate": "e.g. 0.4 lbs/week from trend data, or null if unknown",
      "assessment": "1-2 sentences explaining the assessment",
      "recommendedAdditionalDays": <integer or null — extra days needed beyond current deadline, 0 if achievable>,
      "suggestedDeadline": "YYYY-MM-DD or null if no change needed"
    }
  ],
  "progressAdjustment": {
    "needed": <true if user is measurably behind on at least one goal, false otherwise>,
    "observation": "1-2 sentences describing the gap between actual progress and required progress. Omit if needed=false.",
    "options": [
      {
        "type": "extend_deadline",
        "label": "Give me more time",
        "description": "1 sentence: what changes and by how much",
        "goalId": <integer — which goal's deadline to extend>,
        "newDeadline": "YYYY-MM-DD"
      },
      {
        "type": "adjust_nutrition",
        "label": "Tighten my diet",
        "description": "1 sentence: what changes and by how much",
        "newCalories": <integer>,
        "newProteinG": <integer>,
        "newCarbsG": <integer>,
        "newFatG": <integer>
      }
    ]
  },
  "priorityActions": ["action1", "action2", "action3", "action4", "action5"],
  "goalNotes": "1-2 sentences on goal interactions, synergies, conflicts"
}

If progressAdjustment.needed is false, set options to an empty array [].
If there are no active goals with deadlines, set goalFeasibility to [] and progressAdjustment.needed to false.`;

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.error("AI analysis: ANTHROPIC_API_KEY is not set in environment");
        return res.status(500).json({ message: "AI service is not configured. Contact support." });
      }
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const rawText = (msg.content[0] as any).text ?? "";

      // Strip markdown fences, then extract the outermost JSON object even
      // if Claude prepended/appended explanation text.
      const stripped = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = stripped.indexOf("{");
      const jsonEnd   = stripped.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        console.error("AI analysis: no JSON object found in response:", stripped.slice(0, 300));
        return res.status(500).json({ message: "AI returned an unexpected response format. Please try again." });
      }
      const jsonSlice = stripped.slice(jsonStart, jsonEnd + 1);

      let plan: any;
      try {
        plan = JSON.parse(jsonSlice);
      } catch (parseErr) {
        console.error("AI analysis JSON parse failed:", parseErr, "\nRaw slice:", jsonSlice.slice(0, 500));
        return res.status(500).json({ message: "AI response could not be parsed. Please try again." });
      }

      // Embed preferences in the plan so the client can pre-fill the questionnaire on next open
      if (preferences) plan.preferences = preferences;

      // Persist the plan so the client can restore it on next load (feature 2)
      await storage.saveAiCoachPlan(userId, plan);

      res.json(plan);
    } catch (err: any) {
      console.error("AI analysis error:", err?.status, err?.message ?? err);
      const msg = err?.status === 401
        ? "AI service authentication failed — check ANTHROPIC_API_KEY."
        : err?.status === 529
        ? "AI service is overloaded. Please try again in a moment."
        : err?.status === 400
        ? `AI request was invalid (${err?.message ?? "bad request"}). Please try again.`
        : err?.status === 404
        ? "AI model not found. Please contact support."
        : err?.status === 429
        ? "AI service rate limit reached. Please wait a moment and try again."
        : err?.message?.includes("API key")
        ? "AI service is not configured — ANTHROPIC_API_KEY missing in environment."
        : `Failed to generate AI analysis: ${err?.message ?? "unknown error"}. Please try again.`;
      res.status(500).json({ message: msg });
    }
  });

  /**
   * GET /api/goals/ai-plan
   * Returns the last persisted AI coach plan for the user, or null.
   */
  app.get("/api/goals/ai-plan", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const plan = await storage.getAiCoachPlan((req.user as any).id);
    res.json(plan);
  });

  /**
   * POST /api/goals/ai-checkin
   * Lightweight quick check-in: returns a short status assessment.
   */
  app.post("/api/goals/ai-checkin", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;

    try {
      const [goals, measurements, foodSummary, currentTargets, targetHistory, adherence] = await Promise.all([
        storage.getGoals(userId),
        storage.getMeasurements(userId, 14),
        storage.getFoodLogSummary(userId, "1W"),
        storage.getNutritionTarget(userId),
        storage.getNutritionTargetHistory(userId, 10),
        storage.getNutritionAdherence(userId, 14),
      ]);

      const activeGoals = goals.filter(g => g.isActive);
      const today = new Date().toISOString().slice(0, 10);

      // Compute recent weight trend
      let trendText = "Insufficient data for trend.";
      if (measurements.length >= 2) {
        const newest = measurements[0];
        const oldest = measurements[measurements.length - 1];
        const days = (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) / 86400000;
        if (days >= 7) {
          const changeLbs = (newest.weightGrams - oldest.weightGrams) / 453.592;
          const rate = (changeLbs / days) * 7;
          trendText = `Weight trend: ${rate >= 0 ? "+" : ""}${rate.toFixed(2)} lbs/week over ${Math.round(days)} days`;
        }
      }

      const loggedDays = foodSummary.filter(d => d.calories > 0);
      const avgCal = loggedDays.length > 0
        ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / loggedDays.length)
        : null;

      const goalsText = activeGoals.length === 0
        ? "No active goals."
        : activeGoals.map(g => {
            const targetLbs = g.unit === "lbs" && g.targetValue ? (g.targetValue / 453.592).toFixed(1) : null;
            const deadline = g.deadline ? `deadline ${g.deadline}` : "no deadline";
            return `- "${g.label}" (${g.type}), target: ${targetLbs ? targetLbs + " lbs" : g.targetValue + " " + g.unit}, ${deadline}`;
          }).join("\n");

      const targetsText = currentTargets
        ? `Current daily targets: ${Math.round(currentTargets.calories)} kcal, ${Math.round(currentTargets.proteinG ?? 0)}g protein, ${Math.round(currentTargets.carbsG ?? 0)}g carbs, ${Math.round(currentTargets.fatG ?? 0)}g fat (source: ${currentTargets.source ?? "auto_calc"})`
        : "No nutrition targets set.";

      const historyText = targetHistory.length > 1
        ? "TARGET HISTORY (most recent first):\n" + targetHistory.map(t =>
            `  ${t.effectiveDate}: ${Math.round(t.calories)} kcal, ${Math.round(t.proteinG)}g P / ${Math.round(t.carbsG)}g C / ${Math.round(t.fatG)}g F (${t.source ?? "auto_calc"}${t.reason ? " — " + t.reason : ""})`
          ).join("\n")
        : "No prior target changes on record.";

      const adherenceText = adherence.periods.length > 0
        ? "TARGET ADHERENCE (last 14 days):\n" + adherence.periods.map(p =>
            `  ${p.startDate} to ${p.endDate} (target: ${Math.round(p.calories)} kcal): logged ${p.daysLogged} days, hit target (±10%) ${p.daysHit}/${p.daysLogged} days, avg intake ${p.avgCalories} kcal, ${p.avgProtein}g P / ${p.avgCarbs}g C / ${p.avgFat}g F`
          ).join("\n")
        : "No adherence data available.";

      const hasWeightGoal = activeGoals.some(g => g.type === "weight_loss" || g.type === "weight_gain");

      const checkinPrompt = `You are a fitness coach giving a brief weekly check-in. Today is ${today}.

ACTIVE GOALS:
${goalsText}

RECENT MEASUREMENTS:
${measurements.slice(0, 5).map(m => `  ${m.date}: ${(m.weightGrams / 453.592).toFixed(1)} lbs`).join("\n") || "  None"}

${trendText}

DIET (last 7 days): logged ${loggedDays.length}/7 days${avgCal ? `, avg ${avgCal} kcal/day` : ", no data"}.

${targetsText}

${historyText}

${adherenceText}

IMPORTANT CONTEXT FOR ADJUSTMENTS:
- Review the target history to understand what has already been tried.
- Check adherence data: if the user consistently missed a previous target, don't just set the same number again. If they hit their targets, the plan is working — only adjust if progress has stalled or the goal requires it.
- Consider the user's goal timeline (deadline) and current progress rate when deciding how aggressively to adjust.
- A user who was recently given new targets and IS hitting them does NOT need another adjustment — acknowledge their progress instead.

Return ONLY valid JSON (no markdown):
{
  "status": "on_track|behind|ahead",
  "headline": "1 sentence assessment",
  "observations": ["observation1", "observation2", "observation3"],
  "topAction": "Single most important thing to do this week"${hasWeightGoal ? `,
  "nutritionAdjustment": {
    "calories": <integer>,
    "proteinG": <integer grams>,
    "carbsG": <integer grams>,
    "fatG": <integer grams>,
    "reasoning": "1 sentence explaining adjustment — reference what changed vs previous targets and why"
  }` : ""}
}
${hasWeightGoal ? 'Include "nutritionAdjustment" only if the current targets need meaningful adjustment based on the goal, trend, AND adherence history. Omit the field entirely if targets are already appropriate or were recently adjusted and the user is complying.' : 'Do not include a nutritionAdjustment field.'}`;

      const apiKey2 = process.env.ANTHROPIC_API_KEY;
      if (!apiKey2) return res.status(500).json({ message: "AI service is not configured." });
      const client = new Anthropic({ apiKey: apiKey2 });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: checkinPrompt }],
      });

      const rawText = (msg.content[0] as any).text ?? "";
      const stripped = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = stripped.indexOf("{");
      const jsonEnd   = stripped.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        return res.status(500).json({ message: "AI returned an unexpected response format." });
      }
      const checkin = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1));
      res.json(checkin);
    } catch (err: any) {
      console.error("AI checkin error:", err?.message ?? err);
      res.status(500).json({ message: "Failed to generate check-in. Please try again." });
    }
  });

  // ── Measurements ────────────────────────────────────────────────────────────
  app.get("/api/measurements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const limit = req.query.limit ? Number(req.query.limit) : 90;
    res.json(await storage.getMeasurements((req.user as any).id, limit));
  });

  app.post("/api/measurements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertBodyMeasurementSchema.omit({ userId: true }).parse(req.body);
      const m = await storage.createMeasurement({ ...data, userId });
      await recalculateTargets(userId);
      res.status(201).json(m);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/measurements/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertBodyMeasurementSchema.omit({ userId: true }).partial().parse(req.body);
      const m = await storage.updateMeasurement(Number(req.params.id), userId, data);
      if (!m) return res.status(404).json({ message: "Measurement not found" });
      await recalculateTargets(userId);
      res.json(m);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/measurements/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    await storage.deleteMeasurement(Number(req.params.id), userId);
    await recalculateTargets(userId);
    res.sendStatus(204);
  });

  // ── Progress Photos ──────────────────────────────────────────────────────────
  const MAX_PROGRESS_PHOTO_BYTES = 5 * 1024 * 1024;

  app.get("/api/progress-photos", async (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(await storage.getProgressPhotos((req.user as any).id));
  });

  app.post("/api/progress-photos", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertProgressPhotoSchema.omit({ userId: true }).parse(req.body);
      if (data.imageData.length > MAX_PROGRESS_PHOTO_BYTES) {
        return res.status(413).json({ message: "Image too large" });
      }
      const p = await storage.createProgressPhoto({ ...data, userId });
      res.status(201).json(p);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/progress-photos/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    await storage.deleteProgressPhoto(Number(req.params.id), userId);
    res.sendStatus(204);
  });

  // ── Food Search / Barcode / Vision ──────────────────────────────────────────
  app.get("/api/food/search", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const q = req.query.q as string;
    // FatSecret is primary; USDA + OFF fill gaps when results are thin
    const typeFilter = (req.query.type as string) || "all";
    if (!q || q.length < 2) return res.json([]);

    const ql = q.toLowerCase();

    // Foods this user has logged before — boosted to the top of their results
    // so items they (or others) already added are easy to find again.
    const userFoodIds = await storage.getUserFoodItemIds((req.user as any).id);

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Strip punctuation, lowercase, collapse spaces */
    function normName(s: string): string {
      return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    }

    /** Words longer than 2 chars from a normalized name */
    function wordSet(s: string): Set<string> {
      return new Set(normName(s).split(" ").filter(w => w.length > 2));
    }

    /** Jaccard-style word overlap — how similar are two item names? (0–1) */
    function nameSimilarity(a: string, b: string): number {
      const wa = wordSet(a);
      const wb = wordSet(b);
      if (!wa.size || !wb.size) return 0;
      let common = 0;
      for (const w of wa) if (wb.has(w)) common++;
      return common / Math.max(wa.size, wb.size);
    }

    /** How many extra nutrition fields does an item have? (0–3) */
    function nutritionScore(item: any): number {
      return (item.fiberG   != null ? 1 : 0)
           + (item.sodiumMg != null ? 1 : 0)
           + (item.sugarG   != null ? 1 : 0);
    }

    /** Patch missing fiber/sodium/sugar from `donor` into `base` */
    function mergeNutrition(base: any, donor: any): any {
      return {
        ...base,
        fiberG:   base.fiberG   ?? donor.fiberG,
        sodiumMg: base.sodiumMg ?? donor.sodiumMg,
        sugarG:   base.sugarG   ?? donor.sugarG,
      };
    }

    /**
     * Fuse a flat list of items from all sources into deduplicated, enriched results.
     * Items that are clearly the same food (same brand + ≥80% word overlap in name)
     * are collapsed into one entry that carries the most complete nutrition data.
     * O(n²) — fine for n ≤ ~150.
     */
    function fuseItems(items: any[]): any[] {
      const used = new Set<number>();
      const results: any[] = [];

      for (let i = 0; i < items.length; i++) {
        if (used.has(i)) continue;
        used.add(i);

        // Start with this item as the group representative
        let best = items[i];

        for (let j = i + 1; j < items.length; j++) {
          if (used.has(j)) continue;
          const other = items[j];

          // Different brands → definitely different foods
          const ba = normName(best.brand  || best.brandOwner  || "");
          const bb = normName(other.brand || other.brandOwner || "");
          if (ba && bb && ba !== bb) continue;

          // Name must overlap ≥ 80% to be considered the same item
          if (nameSimilarity(best.name, other.name) < 0.80) continue;

          // Same item — merge: pick the base with better nutrition, patch gaps from the other
          used.add(j);
          if (nutritionScore(other) > nutritionScore(best)) {
            best = mergeNutrition(other, best); // other has more data, use as base
          } else {
            best = mergeNutrition(best, other); // best has more (or equal) data, keep as base
          }
        }

        results.push(best);
      }
      return results;
    }

    // ── Restaurant brand detection (needed for scoring + API selection) ─────────
    const RESTAURANT_BRANDS: [RegExp, string][] = [
      [/chick[\s-]*fil[\s-]*a/i,   "chick-fil-a"],
      [/mcdonald/i,                "mcdonalds"],
      [/burger\s*king/i,           "burger-king"],
      [/wendy/i,                   "wendys"],
      [/taco\s*bell/i,             "taco-bell"],
      [/\bsubway\b/i,              "subway"],
      [/chipotle/i,                "chipotle"],
      [/panera/i,                  "panera"],
      [/starbucks/i,               "starbucks"],
      [/dunkin/i,                  "dunkin-donuts"],
      [/domino/i,                  "dominos-pizza"],
      [/pizza\s*hut/i,             "pizza-hut"],
      [/little\s*caesars?/i,       "little-caesars"],
      [/\bkfc\b/i,                 "kfc"],
      [/popeyes/i,                 "popeyes"],
      [/five\s*guys/i,             "five-guys"],
      [/shake\s*shack/i,           "shake-shack"],
      [/whataburger/i,             "whataburger"],
      [/in[\s-]*n[\s-]*out/i,      "in-n-out-burger"],
      [/\bsonic\b/i,               "sonic"],
      [/\barby/i,                  "arbys"],
      [/dairy\s*queen/i,           "dairy-queen"],
      [/chili'?s/i,                "chilis"],
      [/applebee'?s/i,             "applebees"],
      [/olive\s*garden/i,          "olive-garden"],
      [/red\s*lobster/i,           "red-lobster"],
      [/raising\s*cane/i,          "raising-canes"],
      [/\bcanes\b/i,               "raising-canes"],
      [/wingstop/i,                "wingstop"],
      [/panda\s*express/i,         "panda-express"],
      [/\bpanerabread\b/i,         "panera"],
      [/jimmy\s*john/i,            "jimmy-johns"],
      [/jersey\s*mike/i,           "jersey-mikes"],
      [/firehouse/i,               "firehouse-subs"],
      [/\bchilis\b/i,              "chilis"],
    ];
    const matchedBrand    = RESTAURANT_BRANDS.find(([rx]) => rx.test(q));
    const isRestaurant    = typeFilter === "restaurant" || !!matchedBrand;
    const brandSlug       = matchedBrand?.[1] ?? q;
    // Normalized brand slug for item-level brand matching (e.g. "chickfila")
    const matchedBrandNorm = matchedBrand ? normName(matchedBrand[1]) : null;

    // For restaurant queries, strip the brand name from the USDA/FatSecret query
    // so "chick-fil-a spicy chicken sandwich" → searches for "spicy chicken sandwich"
    // This prevents USDA tokenizing "chick" and returning "Chick Peas" etc.
    const foodOnlyQuery = matchedBrand
      ? q.replace(matchedBrand[0], "").replace(/\s+/g, " ").trim() || q
      : q;

    // ── Scoring helpers (defined early so they can also rank local-cache results) ─
    const queryWords = wordSet(q);

    /**
     * Relevance score — lower = better (used for sort).
     *
     * Tier -1 (score -1 to 0): item's brand matches the restaurant named in query
     *                           e.g. searching "chick-fil-a sandwich" → Chick-fil-A items first
     * Tier  0 (score  0 to 1): ALL query words found in item brand+name
     * Tier  1 (score  1 to 2): ≥ 67% of query words matched
     * Tier  2 (score  2 to 3): ≥ 50% of query words matched
     * Tier  3 (score  3 to 4): < 50% matched (barely relevant)
     */
    function relevanceScore(item: any): number {
      const brandNorm = normName(item.brand || item.brandOwner || "");
      const nameNorm  = normName(item.name  || "");
      const qNorm     = normName(q);
      const qWords    = wordSet(qNorm);
      const itemWords = new Set([...wordSet(brandNorm), ...wordSet(nameNorm)]);
      const sim       = nameSimilarity(brandNorm + " " + nameNorm, qNorm);

      // Foods the user has eaten before, surface them ahead of equally-relevant
      // items they've never logged — they're the most likely match.
      const ownBoost = item.id && userFoodIds.has(item.id) ? -0.5 : 0;

      // Tier -1: restaurant brand exact match — always first
      if (matchedBrandNorm && brandNorm) {
        if (brandNorm.replace(/\s/g, "").includes(matchedBrandNorm.replace(/\s/g, "")) ||
            matchedBrandNorm.replace(/\s/g, "").includes(brandNorm.replace(/\s/g, ""))) {
          return -1 + (1 - sim) * 0.9 + ownBoost;
        }
      }

      let matches = 0;
      for (const w of qWords) if (itemWords.has(w)) matches++;
      const ratio = qWords.size > 0 ? matches / qWords.size : 0;

      if (ratio >= 1.0)  return 0 + (1 - sim) * 0.9 + ownBoost;
      if (ratio >= 0.67) return 1 + (1 - sim) * 0.9 + ownBoost;
      if (ratio >= 0.5)  return 2 + (1 - sim) * 0.9 + ownBoost;
      return 3 + (1 - ratio) - nutritionScore(item) * 0.01 + ownBoost;
    }

    // For restaurant queries, filter on food-only words (brand stripped out).
    // e.g. "chick-fil-a spicy chicken sandwich" → filterWords = {"spicy","chicken","sandwich"}
    // This stops USDA stemming ("chicken"→"chick") from leaking "Chick Peas" into results.
    const filterWords = (isRestaurant && foodOnlyQuery)
      ? wordSet(foodOnlyQuery)
      : queryWords;

    /**
     * Relevance filter — require ≥ 50% of filterWords to appear in item name+brand.
     * Restaurant-brand items (e.g. Chick-fil-A) always pass so they are never dropped.
     */
    function isRelevant(item: any): boolean {
      if (filterWords.size < 2) return true;

      // Always keep items from the matched restaurant brand
      if (matchedBrandNorm) {
        const b = normName(item.brand || item.brandOwner || "").replace(/\s/g, "");
        const mn = matchedBrandNorm.replace(/\s/g, "");
        if (b && (b.includes(mn) || mn.includes(b))) return true;
      }

      const nameWords = wordSet(item.name  || "");
      // For relevance, only check the item NAME (not brand) so "Goya — Chick Peas" can't
      // sneak through on a brand word accidentally overlapping a query word.
      let matches = 0;
      for (const w of filterWords) if (nameWords.has(w)) matches++;
      return (matches / filterWords.size) >= 0.5;
    }

    // 1. Local DB cache
    // For restaurant queries always skip early-return and hit external APIs —
    // the local cache may have unrelated items (e.g. "Chick Peas" cached from
    // a previous search for "chick") that would flood the results.
    const local = await storage.searchFoodItems(q, isRestaurant ? foodOnlyQuery : undefined);
    if (!isRestaurant && local.length >= 10) {
      const scored = local
        .filter(isRelevant)
        .sort((a: any, b: any) => relevanceScore(a) - relevanceScore(b));
      return res.json(scored.slice(0, 30));
    }

    // 2. All external APIs in parallel
    // For restaurant queries use foodOnlyQuery (brand name stripped) for USDA/CalorieNinjas
    // to avoid noise like "Chick Peas" when searching "chick-fil-a chicken sandwich".
    // OFF text search always gets the full query because it handles brand+food combos well.
    const apiQuery = isRestaurant ? foodOnlyQuery : q;
    const [usda, fs, cn, off, offBrand] = await Promise.all([
      searchUSDA(apiQuery, isRestaurant ? 40 : 25, isRestaurant),
      searchFatSecret(q, 20),           // FatSecret handles brand names well — keep full query
      searchCalorieNinjas(apiQuery, 15),
      // OFF Meilisearch: always run with full query to fill any gaps in USDA/FatSecret;
      // for restaurants also add a food-only search to catch items not indexed under the brand
      searchOFF(q, isRestaurant ? 30 : 25),
      isRestaurant ? searchBrandOFF(brandSlug, 30) : Promise.resolve([]),
    ]);

    console.log(`[food/search] q="${q}" isRestaurant=${isRestaurant} brandSlug="${brandSlug}" | usda=${usda.length} fs=${fs.length} cn=${cn.length} off=${off.length} offBrand=${offBrand.length} local=${local.length}`);

    // 3. Fuse all sources — full-nutrition sources first so they become the base
    const allExternal = [...usda, ...cn, ...off, ...offBrand, ...fs];
    const fused = fuseItems([...local, ...allExternal]);

    // 4. Filter (≥50% word match) then sort by relevance score
    const relevant = fused
      .filter(isRelevant)
      .sort((a, b) => relevanceScore(a) - relevanceScore(b));

    res.json(relevant.slice(0, 30));
  });

  // FatSecret Premier autocomplete — returns up to 8 name suggestions for the search bar
  app.get("/api/food/autocomplete", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json([]);
    const suggestions = await autocompleteFatSecret(q, 8);
    res.json(suggestions);
  });

  app.get("/api/food/barcode/:code", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const code = req.params.code;

    // Check cache
    const cached = await storage.getFoodItemByBarcode(code);
    if (cached) return res.json(cached);

    // Try Open Food Facts first, then FatSecret Premier as fallback
    let data = await lookupBarcode(code);
    let source = "openfoodfacts";
    if (!data) {
      data = await lookupBarcodeFS(code);
      source = "fatsecret";
    }
    if (!data) return res.status(404).json({ message: "Product not found" });

    // Cache it
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
      source,
    });
    res.json(item);
  });

  app.post("/api/food/scan-label", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ message: "imageBase64 and mediaType required" });

    const result = await parseNutritionLabel(imageBase64, mediaType);
    if (!result) return res.status(422).json({ message: "Could not parse nutrition label" });
    res.json(result);
  });

  // Natural-language meal logging: "2 eggs, toast with butter, black coffee"
  // → structured food items with estimated macros for the user to review.
  app.post("/api/food/parse-text", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ message: "text required" });
    if (text.length > 1000) return res.status(400).json({ message: "text too long" });
    const items = await parseMealText(text);
    if (items === null) return res.status(422).json({ message: "Could not understand that meal" });
    res.json({ items });
  });

  // Plated-meal photo → estimated food items (visual portion estimation).
  app.post("/api/food/parse-photo", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ message: "imageBase64 and mediaType required" });
    const items = await parseMealPhoto(imageBase64, mediaType);
    if (items === null) return res.status(422).json({ message: "Could not read that photo" });
    res.json({ items });
  });

  app.get("/api/food/recent", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const items = await storage.getRecentFoodItems((req.user as any).id, 20);
    res.json(items);
  });

  app.get("/api/food/items/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    let item = await storage.getFoodItemById(Number(req.params.id));
    if (!item) return res.sendStatus(404);

    // If any optional nutrition fields are missing, try to enrich from OFF silently.
    // The enriched fields are persisted so subsequent opens are instant.
    if (item.fiberG == null || item.sodiumMg == null || item.sugarG == null ||
        item.saturatedFatG == null || item.cholesterolMg == null || item.potassiumMg == null ||
        item.calciumMg == null || item.ironMg == null) {
      try {
        const patch = await enrichMissingNutrition(item);
        if (Object.keys(patch).length > 0) {
          const updated = await storage.updateFoodItem(item.id, patch);
          if (updated) item = updated;
          console.log(`[food/enrich] id=${item.id} "${item.name}" patched:`, patch);
        }
      } catch (err: any) {
        // Non-fatal — return whatever we have
        console.warn(`[food/enrich] id=${item.id} failed:`, err?.message ?? err);
      }
    }

    res.json(item);
  });

  app.post("/api/food/items", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertFoodItemSchema.parse(req.body);
      // Pool user-submitted foods into shared records instead of creating
      // near-duplicates every time the same item is scanned/entered again.
      const existing = await storage.findSimilarFoodItem(data.name, data.brand);
      if (existing) return res.json(existing);
      const item = await storage.createFoodItem(data);
      res.status(201).json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Saved Meals ─────────────────────────────────────────────────────────────
  app.get("/api/meals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    res.json(await storage.getMeals((req.user as any).id));
  });

  app.post("/api/meals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const { name, description, ingredients } = req.body;
      if (!name || !Array.isArray(ingredients) || ingredients.length === 0)
        return res.status(400).json({ message: "name and ingredients[] required" });
      const meal = await storage.createMeal({ userId, name, description }, ingredients);
      res.status(201).json(meal);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const meal = await storage.getMeal(Number(req.params.id), (req.user as any).id);
    if (!meal) return res.sendStatus(404);
    res.json(meal);
  });

  app.patch("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const { name, description, ingredients } = req.body;
      const meal = await storage.updateMeal(Number(req.params.id), userId, { name, description }, ingredients);
      if (!meal) return res.sendStatus(404);
      res.json(meal);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/meals/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteMeal(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  // Log all ingredients of a saved meal to the food log
  app.post("/api/meals/:id/log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const mealId = Number(req.params.id);
      const { date, mealType } = req.body;
      if (!date || !mealType) return res.status(400).json({ message: "date and mealType required" });
      const entries = await storage.logMeal(mealId, userId, date, mealType);
      res.status(201).json(entries);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Food Log ────────────────────────────────────────────────────────────────
  // Must be before /api/food-log so Express doesn't treat "summary" as an :id
  app.get("/api/food-log/summary", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const period = (req.query.period as string) ?? "1M";
    res.json(await storage.getFoodLogSummary((req.user as any).id, period));
  });

  app.get("/api/food-log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date = (req.query.date as string) || new Date().toLocaleDateString("en-CA");
    res.json(await storage.getFoodLog((req.user as any).id, date));
  });

  app.post("/api/food-log", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertFoodLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createFoodLogEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Batch-log AI-parsed meal items (from /parse-text or /parse-photo) after the
  // user reviews them. Each item is saved as a cached food (source "ai") and a
  // log entry with servings = 1 (macros already represent the amount eaten).
  app.post("/api/food-log/quick", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const { date, mealType, items } = req.body as { date?: string; mealType?: string; items?: ParsedMealItem[] };
      const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
      if (!date || !mealType || !MEAL_TYPES.includes(mealType))
        return res.status(400).json({ message: "date and valid mealType required" });
      if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "items[] required" });

      const created = [];
      for (const it of items) {
        const calories = Math.round(Number(it.calories) || 0);
        if (!it.name || calories <= 0) continue;
        const num = (v: any) => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);
        const foodItem = await storage.createFoodItem({
          name: String(it.name),
          brand: it.brand || undefined,
          servingSizeG: Math.max(1, Math.round(Number(it.servingSizeG) || 100)),
          servingUnit: it.quantity ? String(it.quantity) : "1 serving",
          calories,
          proteinG: num(it.proteinG),
          carbsG: num(it.carbsG),
          fatG: num(it.fatG),
          fiberG: it.fiberG != null ? num(it.fiberG) : undefined,
          sodiumMg: it.sodiumMg != null ? Math.round(Number(it.sodiumMg) || 0) : undefined,
          sugarG: it.sugarG != null ? num(it.sugarG) : undefined,
          source: "ai",
        });
        const entry = await storage.createFoodLogEntry({
          userId,
          date,
          mealType,
          foodItemId: foodItem.id,
          foodName: foodItem.name,
          servings: 1,
          caloriesActual: calories,
          proteinActual: num(it.proteinG),
          carbsActual: num(it.carbsG),
          fatActual: num(it.fatG),
          fiberActual: it.fiberG != null ? num(it.fiberG) : undefined,
        });
        created.push(entry);
      }
      if (created.length === 0) return res.status(422).json({ message: "No valid items to log" });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/food-log/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const entry = await storage.updateFoodLogEntry(Number(req.params.id), (req.user as any).id, req.body);
    if (!entry) return res.sendStatus(404);
    res.json(entry);
  });

  app.delete("/api/food-log/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteFoodLogEntry(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  app.get("/api/food-log/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 730);
    const rows: { date: string; calories: number; protein: number; carbs: number; fat: number }[] = [];
    const now = new Date();
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
        fat: Math.round(entries.reduce((s, e) => s + e.fatActual, 0)),
      });
    }
    res.json(rows);
  });

  // ── Targets ─────────────────────────────────────────────────────────────────
  app.get("/api/targets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const target = await storage.getNutritionTarget((req.user as any).id);
    res.json(target ?? null);
  });

  app.post("/api/targets/recalculate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await recalculateTargets((req.user as any).id);
    const target = await storage.getNutritionTarget((req.user as any).id);
    res.json(target ?? null);
  });

  // Partial update of nutrition targets — used by the dashboard to let the user
  // customize their water goal (and, in the future, any other macro target)
  // without having to recompute via the goal engine.
  app.patch("/api/targets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const existing = await storage.getNutritionTarget(userId);
      const allowed = ["calories", "proteinG", "carbsG", "fatG", "waterMl"] as const;
      const patch: Record<string, number> = {};
      for (const key of allowed) {
        const val = (req.body as Record<string, unknown>)[key];
        if (typeof val === "number" && val >= 0) {
          patch[key] = Math.round(val);
        }
      }
      const source = typeof req.body.__source === "string" ? req.body.__source : "manual";
      const reason = typeof req.body.__reason === "string" ? req.body.__reason : undefined;
      const merged = {
        effectiveDate: new Date().toISOString().slice(0, 10),
        calories: existing?.calories ?? 2200,
        proteinG: existing?.proteinG ?? 150,
        carbsG:   existing?.carbsG   ?? 220,
        fatG:     existing?.fatG     ?? 70,
        waterMl:  existing?.waterMl  ?? 2500,
        ...patch,
        source,
        reason: reason ?? null,
      };
      const t = await storage.upsertNutritionTarget(userId, merged);
      res.json(t);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/targets/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const history = await storage.getNutritionTargetHistory(userId, 20);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Adaptive TDEE ─────────────────────────────────────────────────────────
  // Live energy-expenditure breakdown for the dashboard: the measured TDEE
  // (back-solved from intake + weight trend) alongside the formula estimate,
  // plus which one is currently driving the user's calorie target.
  app.get("/api/tdee", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;

    const [profile, latest, intake, weightRows] = await Promise.all([
      storage.getProfile(userId),
      storage.getLatestMeasurement(userId),
      storage.getDailyCalorieTotals(userId, 28),
      storage.getMeasurements(userId, 60),
    ]);

    // Formula estimate (needs profile + a weight)
    let formulaTdee: number | null = null;
    let bmr: number | null = null;
    const activityLevel = (profile?.activityLevel as ActivityLevel) ?? "moderate";
    const sex = (profile?.sex as Sex) ?? "male";
    if (profile?.birthDate && profile?.heightCm && latest) {
      const age = getAgeFromBirthDate(profile.birthDate);
      bmr = Math.round(calculateBMR(
        latest.weightGrams / 1000,
        profile.heightCm,
        age,
        sex,
      ));
      formulaTdee = calculateTDEE(bmr, activityLevel);
    }

    const adaptive: AdaptiveTDEEResult | null = estimateAdaptiveTDEE({
      intake,
      weights: weightRows.map(w => ({ date: String(w.date).slice(0, 10), weightKg: w.weightGrams / 1000 })),
    });

    let tdee: number | null = formulaTdee;
    let method: "formula" | "adaptive" | "blended" = "formula";
    let blendWeight: number | null = null;

    if (adaptive && formulaTdee) {
      const w = adaptive.confidence === "high" ? 1.0
              : adaptive.confidence === "medium" ? 0.6
              : 0.3;
      tdee = Math.round(formulaTdee * (1 - w) + adaptive.tdee * w);
      method = w === 1.0 ? "adaptive" : "blended";
      blendWeight = w;
    } else if (adaptive) {
      tdee = adaptive.tdee;
      method = "adaptive";
    }

    res.json({
      method,
      tdee,
      formulaTdee,
      bmr,
      activityLevel,
      sex,
      adaptive,
      blendWeight,
      updatedAt: profile?.tdeeUpdatedAt ?? null,
    });
  });

  // ── Water ───────────────────────────────────────────────────────────────────
  app.get("/api/water/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 365);
    res.json(await storage.getWaterHistory((req.user as any).id, days));
  });

  app.get("/api/water", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date = (req.query.date as string) || new Date().toLocaleDateString("en-CA");
    res.json(await storage.getWaterLog((req.user as any).id, date));
  });

  app.post("/api/water", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertWaterLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createWaterEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/water/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { loggedAt } = req.body;
    const patch: { loggedAt?: Date } = {};
    if (loggedAt) patch.loggedAt = new Date(loggedAt);
    const entry = await storage.updateWaterEntry(Number(req.params.id), (req.user as any).id, patch);
    if (!entry) return res.sendStatus(404);
    res.json(entry);
  });

  app.delete("/api/water/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWaterEntry(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  // ── Supplements ─────────────────────────────────────────────────────────────
  app.get("/api/supplements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const date = (req.query.date as string) || new Date().toLocaleDateString("en-CA");
    res.json(await storage.getSupplementLog((req.user as any).id, date));
  });

  app.post("/api/supplements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertSupplementLogSchema.omit({ userId: true }).parse(req.body);
      const entry = await storage.createSupplementEntry({ ...data, userId });
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/supplements/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteSupplementEntry(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  app.get("/api/supplements/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 365);
    const sup  = (req.query.supplement as string) || "creatine";
    res.json(await storage.getSupplementHistory((req.user as any).id, days, sup));
  });

  // ── Exercises ───────────────────────────────────────────────────────────────
  app.get("/api/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { muscle, search } = req.query as Record<string, string>;
    res.json(await storage.getExercises((req.user as any).id, muscle, search));
  });

  app.post("/api/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertExerciseSchema.parse({ ...req.body, userId, isCustom: true });
      const exercise = await storage.createExercise(data);
      res.status(201).json(exercise);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Exercises with logged data (must be before /:id to avoid route conflict) ──
  app.get("/api/exercises/logged-ids", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const ids = await storage.getLoggedExerciseIds((req.user as any).id);
    res.json(ids);
  });

  // Bulk last-weight lookup — ?ids=1,2,3
  app.get("/api/exercises/last-weights", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const raw = String(req.query.ids ?? "");
    const ids = raw.split(",").map(Number).filter(n => n > 0);
    const weights = await storage.getLastWeightsForExercises((req.user as any).id, ids);
    res.json(weights);
  });

  app.get("/api/exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const exercise = await storage.getExerciseById(Number(req.params.id));
    if (!exercise) return res.sendStatus(404);
    res.json(exercise);
  });

  app.get("/api/exercises/:id/previous-sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sets = await storage.getPreviousWorkoutSets((req.user as any).id, Number(req.params.id));
    res.json(sets);
  });

  // WorkoutX GIFs require an X-WorkoutX-Key header to fetch the image bytes,
  // which an <Image> tag can't attach (and the key must never reach the client).
  // Any cached URL on this domain is routed through our own proxy instead.
  const WORKOUTX_GIF_BASE = "https://api.workoutxapp.com";

  // Return cached gifUrl, or fetch-and-cache from ExerciseDB if missing
  app.get("/api/exercises/:id/gif", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = Number(req.params.id);
    const exercise = await storage.getExerciseById(id);
    if (!exercise) return res.sendStatus(404);

    const toClientUrl = (url: string) =>
      url.startsWith(WORKOUTX_GIF_BASE) ? `/api/exercises/${id}/gif-image` : url;

    // Serve from cache
    if (exercise.gifUrl) return res.json({ gifUrl: toClientUrl(exercise.gifUrl) });

    // Lazy-fetch (WorkoutX first, ExerciseDB fallback), then cache the source URL
    const gifUrl = await fetchExerciseGif(exercise.name, exercise.equipment);
    if (gifUrl) {
      await storage.updateExerciseGifUrl(id, gifUrl);
      return res.json({ gifUrl: toClientUrl(gifUrl) });
    }

    res.json({ gifUrl: null });
  });

  // Proxies WorkoutX GIF bytes server-side (auth header never reaches the client).
  // No requireAuth: exercise GIFs are generic, non-sensitive media, same as the
  // previously-public free-exercise-db URLs this replaces for <Image> tags.
  app.get("/api/exercises/:id/gif-image", async (req, res) => {
    const id = Number(req.params.id);
    const exercise = await storage.getExerciseById(id);
    if (!exercise?.gifUrl) return res.sendStatus(404);

    if (!exercise.gifUrl.startsWith(WORKOUTX_GIF_BASE)) {
      return res.redirect(exercise.gifUrl);
    }

    const apiKey = process.env.WORKOUTX_API_KEY;
    if (!apiKey) return res.sendStatus(404);

    try {
      const upstream = await fetch(exercise.gifUrl, { headers: { "X-WorkoutX-Key": apiKey } });
      if (!upstream.ok || !upstream.body) return res.sendStatus(502);
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/gif");
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err) {
      console.warn("[exercise gif-image] proxy failed:", err);
      res.sendStatus(502);
    }
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  app.get("/api/templates", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const templates = await storage.getTemplates((req.user as any).id);
    // Include exercises for each
    const result = await Promise.all(templates.map(async t => ({
      ...t,
      exercises: await storage.getTemplateExercises(t.id),
    })));
    res.json(result);
  });

  app.get("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId     = (req.user as any).id;
    const templateId = Number(req.params.id);
    const templates  = await storage.getTemplates(userId);
    const template   = templates.find(t => t.id === templateId);
    if (!template) return res.sendStatus(404);
    const rawEx      = await storage.getTemplateExercises(templateId);
    const exercises  = await storage.getTemplateExercisesWithDetails(templateId);
    console.log(`[template/${templateId}] raw=${rawEx.length} joined=${exercises.length} ids=${rawEx.map(e => e.exerciseId).join(",")}`);
    // Fallback: if JOIN drops rows (exercise IDs not in exercises table), surface raw rows
    const result = exercises.length > 0 ? exercises : rawEx.map(te => ({
      ...te, exerciseName: `Exercise ${te.exerciseId}`, primaryMuscle: "", category: "",
    }));
    res.json({ ...template, exercises: result });
  });

  app.post("/api/templates", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertWorkoutTemplateSchema.omit({ userId: true }).parse(req.body);
      const template = await storage.createTemplate({ ...data, userId });
      res.status(201).json(template);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const t = await storage.updateTemplate(Number(req.params.id), (req.user as any).id, req.body);
    if (!t) return res.sendStatus(404);
    res.json(t);
  });

  app.delete("/api/templates/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteTemplate(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  app.post("/api/templates/:id/share", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const templateId = Number(req.params.id);
    const { friendUserId } = req.body as { friendUserId: number };
    if (!friendUserId) return res.status(400).json({ message: "friendUserId is required" });

    try {
      const friendship = await storage.getFriendship(userId, friendUserId);
      if (!friendship || friendship.status !== "accepted") {
        return res.status(403).json({ message: "You can only share routines with accepted friends" });
      }

      const userTemplates = await storage.getTemplates(userId);
      const srcTemplate = userTemplates.find(t => t.id === templateId);
      if (!srcTemplate) return res.status(404).json({ message: "Routine not found" });

      const srcExercises = await storage.getTemplateExercises(templateId);

      const newTemplate = await storage.createTemplate({ userId: friendUserId, name: srcTemplate.name, description: srcTemplate.description });

      for (const ex of srcExercises) {
        await storage.addTemplateExercise({
          templateId: newTemplate.id,
          exerciseId: ex.exerciseId,
          orderIndex: ex.orderIndex,
          targetSets: ex.targetSets,
          targetReps: ex.targetReps,
          targetWeightGrams: ex.targetWeightGrams,
        });
      }

      const sender = await storage.getUserById(userId);
      res.status(201).json({ templateId: newTemplate.id, sharedTo: friendUserId, name: newTemplate.name, sharedBy: sender?.name ?? "a friend" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/templates/:id/exercises", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertTemplateExerciseSchema.omit({ templateId: true }).parse(req.body);
      const te = await storage.addTemplateExercise({ ...data, templateId: Number(req.params.id) });
      res.status(201).json(te);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/template-exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { targetSets, targetReps, targetWeightGrams, orderIndex } = req.body;
    const data: Record<string, any> = {};
    if (targetSets    !== undefined) data.targetSets    = Number(targetSets);
    if (targetReps    !== undefined) data.targetReps    = String(targetReps);
    if (targetWeightGrams !== undefined)
      data.targetWeightGrams = targetWeightGrams === null ? null : Number(targetWeightGrams);
    if (orderIndex    !== undefined) data.orderIndex    = Number(orderIndex);
    const te = await storage.updateTemplateExercise(Number(req.params.id), data);
    if (!te) return res.sendStatus(404);
    res.json(te);
  });

  app.delete("/api/template-exercises/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.removeTemplateExercise(Number(req.params.id));
    res.sendStatus(204);
  });

  app.get("/api/exercises/:id/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const history = await storage.getExerciseHistory(
      Number(req.params.id),
      (req.user as any).id
    );
    res.json(history);
  });

  app.get("/api/exercises/:id/strength-standard", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const exercise = await storage.getExerciseById(Number(req.params.id));
    if (!exercise) return res.sendStatus(404);

    const standard = getStrengthStandard(exercise.name);
    if (!standard) return res.json({ hasStandard: false });

    const [measurement, profile] = await Promise.all([
      storage.getLatestMeasurement(userId),
      storage.getProfile(userId),
    ]);

    if (!measurement?.weightGrams) return res.json({ hasStandard: false });

    const sex = profile?.sex ?? "male";
    const multipliers = sex === "female" ? standard.female : standard.male;
    const thresholds = computeThresholds(multipliers, measurement.weightGrams);

    const history = await storage.getExerciseHistory(Number(req.params.id), userId);
    const bestE1rmGrams = history.length > 0
      ? Math.max(...history.map((h: any) => h.e1rmGrams ?? 0))
      : 0;

    const levelIndex = getLevelIndex(bestE1rmGrams, measurement.weightGrams, multipliers);

    const nextIdx = levelIndex < LEVEL_NAMES.length - 1 ? levelIndex + 1 : null;
    const nextLevelGrams = nextIdx !== null && nextIdx >= 1 ? thresholds[nextIdx - 1] : null;

    res.json({
      hasStandard: true,
      perArm: standard.perArm ?? false,
      thresholds: {
        beginner:     thresholds[0],
        novice:       thresholds[1],
        intermediate: thresholds[2],
        advanced:     thresholds[3],
        elite:        thresholds[4],
      },
      bestE1rmGrams,
      levelIndex,
      levelName: LEVEL_NAMES[levelIndex],
      nextLevelName: nextIdx !== null ? LEVEL_NAMES[nextIdx] : null,
      nextLevelGrams,
      bodyweightGrams: measurement.weightGrams,
    });
  });

  /**
   * GET /api/muscle-volume?days=7|30
   * Aggregates training volume per muscle region for the heatmap.
   * Effective sets: primary muscle = 1.0 per set, secondary = 0.5.
   * lastTrained is computed over the past 365 days regardless of the window.
   */
  app.get("/api/muscle-volume", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);

    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
    const since    = new Date(); since.setDate(since.getDate() - days);
    const yearAgo  = new Date(); yearAgo.setDate(yearAgo.getDate() - 365);

    // One query over the full year; the window aggregation filters in JS
    const rows = await storage.getSetsWithMuscles(userId, toDateStr(yearAgo));
    const sinceStr = toDateStr(since);

    // Canonical heatmap regions
    type Region =
      | "chest" | "back" | "traps" | "shoulders" | "biceps" | "triceps"
      | "forearms" | "core" | "glutes" | "quads" | "hamstrings" | "calves";

    // Muscle-name → [region, weightFactor] contributions
    const contributions = (muscle: string): [Region, number][] => {
      const m = muscle.toLowerCase();
      if (m.includes("chest") || m.includes("pec"))            return [["chest", 1]];
      if (m.includes("trap"))                                  return [["traps", 1]];
      if (m.includes("lat") || m === "back")                   return [["back", 1]];
      if (m.includes("delt") || m.includes("shoulder") || m.includes("rotator")) return [["shoulders", 1]];
      if (m.includes("bicep") || m.includes("brachialis"))     return [["biceps", 1]];
      if (m.includes("tricep"))                                return [["triceps", 1]];
      if (m.includes("forearm"))                               return [["forearms", 1]];
      if (m.includes("core") || m.includes("abs") || m.includes("oblique") || m.includes("hip flexor")) return [["core", 1]];
      if (m.includes("glute") || m.includes("abductor"))       return [["glutes", 1]];
      if (m.includes("quad") || m.includes("adductor"))        return [["quads", 1]];
      if (m.includes("hamstring"))                             return [["hamstrings", 1]];
      if (m.includes("calf") || m.includes("calves"))          return [["calves", 1]];
      if (m.includes("leg"))                                   return [["quads", 0.5], ["hamstrings", 0.5]];
      if (m.includes("arm"))                                   return [["biceps", 0.5], ["triceps", 0.5]];
      return []; // cardio / unknown — not mapped
    };

    const REGIONS: Region[] = [
      "chest", "back", "traps", "shoulders", "biceps", "triceps",
      "forearms", "core", "glutes", "quads", "hamstrings", "calves",
    ];
    const agg: Record<Region, { sets: number; volumeGrams: number; lastTrained: string | null }> =
      Object.fromEntries(REGIONS.map(r => [r, { sets: 0, volumeGrams: 0, lastTrained: null }])) as any;

    for (const row of rows) {
      const setVolume = (row.weightGrams ?? 0) * (row.reps ?? 0);
      const contribs: [Region, number][] = [];
      for (const [region, f] of contributions(row.primaryMuscle)) contribs.push([region, f]);
      for (const sec of row.secondaryMuscles) {
        for (const [region, f] of contributions(sec)) contribs.push([region, f * 0.5]);
      }
      for (const [region, factor] of contribs) {
        const a = agg[region];
        // lastTrained over the full year window
        if (!a.lastTrained || row.date > a.lastTrained) a.lastTrained = row.date;
        // sets/volume only within the requested window
        if (row.date >= sinceStr) {
          a.sets        += factor;
          a.volumeGrams += setVolume * factor;
        }
      }
    }

    // Round effective sets to 1 decimal
    for (const r of REGIONS) agg[r].sets = Math.round(agg[r].sets * 10) / 10;

    res.json({ days, muscles: agg });
  });

  // ── Workouts ────────────────────────────────────────────────────────────────
  app.get("/api/workouts", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const list = await storage.getWorkouts((req.user as any).id, limit);
    res.json(list);
  });

  app.post("/api/workouts", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;
      const data = insertWorkoutSchema.omit({ userId: true }).parse(req.body);
      const w = await storage.createWorkout({ ...data, userId });
      res.status(201).json(w);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const w = await storage.getWorkoutById(Number(req.params.id), (req.user as any).id);
    if (!w) return res.sendStatus(404);
    const sets = await storage.getWorkoutSets(w.id);
    res.json({ ...w, sets });
  });

  app.patch("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const userId = (req.user as any).id;

      // Drizzle's timestamp columns expect Date instances (it calls
      // .toISOString() on the value) — clients send ISO strings over JSON,
      // so convert here or the update query throws.
      const data = { ...req.body };
      if (typeof data.completedAt === "string") data.completedAt = new Date(data.completedAt);
      if (typeof data.startedAt === "string") data.startedAt = new Date(data.startedAt);

      const w = await storage.updateWorkout(Number(req.params.id), userId, data);
      if (!w) return res.sendStatus(404);

      // If this workout was just completed and matches the active routine's
      // "next up" day, advance the routine to the following day.
      if (req.body?.completedAt && w.templateId != null) {
        const routine = await storage.getActiveRoutine(userId);
        if (routine) {
          const today = new Date().toISOString().slice(0, 10);
          const state: ActiveRoutineState = { days: routine.days, currentIndex: routine.currentIndex, lastCheckedDate: routine.lastCheckedDate };
          const rolled = rollForward(state, today);
          if (rolled.days[rolled.currentIndex]?.templateId === w.templateId) {
            const advanced = completeCurrentDay(rolled, today);
            await storage.updateActiveRoutineState(routine.id, advanced.currentIndex, advanced.lastCheckedDate);
          } else if (rolled.currentIndex !== state.currentIndex || rolled.lastCheckedDate !== state.lastCheckedDate) {
            await storage.updateActiveRoutineState(routine.id, rolled.currentIndex, rolled.lastCheckedDate);
          }
        }
      }

      res.json(w);
    } catch (err: any) {
      console.error("PATCH /api/workouts/:id failed:", err);
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/workouts/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWorkout(Number(req.params.id), (req.user as any).id);
    res.sendStatus(204);
  });

  // ── Workout Sets ────────────────────────────────────────────────────────────
  app.get("/api/workouts/:id/sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const sets = await storage.getWorkoutSets(Number(req.params.id));
    res.json(sets);
  });

  app.post("/api/workouts/:id/sets", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const data = insertWorkoutSetSchema.omit({ workoutId: true }).parse(req.body);
      const s = await storage.createWorkoutSet({ ...data, workoutId: Number(req.params.id) });
      res.status(201).json(s);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/sets/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const s = await storage.updateWorkoutSet(Number(req.params.id), req.body);
    if (!s) return res.sendStatus(404);
    res.json(s);
  });

  app.delete("/api/sets/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.deleteWorkoutSet(Number(req.params.id));
    res.sendStatus(204);
  });

  // ── CSV Import (Hevy format) ─────────────────────────────────────────────────
  app.post("/api/workouts/import-csv", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const { csv } = req.body as { csv: string };
    if (!csv) return res.status(400).json({ message: "No CSV provided" });

    try {
      const lines = csv.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const header = lines[0];
      const rows = lines.slice(1);

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

      // Parse Hevy date: "18 May 2026, 11:12" → ISO date string
      function parseHevyDate(s: string): { date: string; iso: string } {
        const months: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
        const m = s.match(/(\d+)\s+(\w+)\s+(\d{4}),\s+(\d+):(\d+)/);
        if (!m) return { date: new Date().toISOString().slice(0, 10), iso: new Date().toISOString() };
        const [, day, mon, year, hour, min] = m;
        const d = new Date(parseInt(year), months[mon], parseInt(day), parseInt(hour), parseInt(min));
        return { date: d.toISOString().slice(0, 10), iso: d.toISOString() };
      }

      // Group rows by (title + start_time) = one workout session
      const sessions = new Map<string, { title: string; startTime: string; endTime: string; rows: string[][] }>();
      for (const line of rows) {
        if (!line) continue;
        const cols = parseCSVRow(line);
        const [title, startTime, endTime] = cols;
        const key = `${title}|||${startTime}`;
        if (!sessions.has(key)) sessions.set(key, { title, startTime, endTime, rows: [] });
        sessions.get(key)!.rows.push(cols);
      }

      // Cache existing exercises by name (lowercase)
      const allExercises = await storage.getExercises(userId);
      const exerciseByName = new Map(allExercises.map(e => [e.name.toLowerCase(), e]));

      // Fetch existing workouts ONCE for duplicate detection
      const existingWorkouts = await storage.getWorkouts(userId, 2000);
      const existingKeys = new Set(existingWorkouts.map(w => `${w.name}|||${w.date}`));

      let imported = 0;
      let skipped = 0;

      for (const [, session] of sessions) {
        const { date, iso: startIso } = parseHevyDate(session.startTime);
        const { iso: endIso } = parseHevyDate(session.endTime);
        const durationMinutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);

        // Check for duplicate (same name + date) — uses cached set
        if (existingKeys.has(`${session.title}|||${date}`)) { skipped++; continue; }
        existingKeys.add(`${session.title}|||${date}`);

        const workout = await storage.createWorkout({
          userId,
          name: session.title,
          date,
          durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
          completedAt: new Date(endIso),
        });

        // Group sets by exercise within this session
        const exGroups = new Map<string, { setIndex: number; weightLbs: number | null; reps: number | null; setType: string }[]>();
        for (const cols of session.rows) {
          const exerciseName = cols[4];
          const setIndex = parseInt(cols[7]) || 0;
          const setType = cols[8] || "normal";
          const weightLbs = cols[9] ? parseFloat(cols[9]) : null;
          const reps = cols[10] ? parseInt(cols[10]) : null;
          if (!exGroups.has(exerciseName)) exGroups.set(exerciseName, []);
          exGroups.get(exerciseName)!.push({ setIndex, weightLbs, reps, setType });
        }

        for (const [exName, sets] of exGroups) {
          // Find or create exercise — try exact match, then fuzzy match
          let exercise = exerciseByName.get(exName.toLowerCase());
          if (!exercise) {
            const norm = exName.toLowerCase().trim();
            const stripped = norm.replace(/\s*\([^)]*\)\s*/g, " ").trim();
            for (const [key, ex] of exerciseByName) {
              const keyStripped = key.replace(/\s*\([^)]*\)\s*/g, " ").trim();
              if (keyStripped === stripped || key === stripped || keyStripped === norm) {
                exercise = ex; break;
              }
            }
            if (!exercise) {
              const words = new Set(stripped.split(/\s+/).filter(w => w.length > 2));
              let bestMatch: any = undefined;
              let bestScore = 0;
              for (const [key, ex] of exerciseByName) {
                const kw = new Set(key.replace(/\s*\([^)]*\)\s*/g, " ").trim().split(/\s+/).filter(w => w.length > 2));
                let common = 0; for (const w of words) if (kw.has(w)) common++;
                const score = Math.max(words.size, kw.size) > 0 ? common / Math.max(words.size, kw.size) : 0;
                if (score > bestScore && score >= 0.6) { bestScore = score; bestMatch = ex; }
              }
              if (bestMatch) exercise = bestMatch;
            }
          }
          if (!exercise) {
            exercise = await storage.createExercise({
              name: exName,
              primaryMuscle: "Other",
              secondaryMuscles: [],
              category: "compound",
              equipment: "other",
              isCustom: true,
              userId,
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
              isWarmup: set.setType === "warmup",
            });
          }
        }
        imported++;
      }

      res.json({ imported, skipped, total: sessions.size });
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── AI Routine Generator ────────────────────────────────────────────────────
  app.post("/api/routines/generate-ai", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    try {
      const { goal, equipment, notes } = req.body;

      const equipmentLabel: Record<string, string> = {
        full_gym:         "Full gym (barbells, cables, machines, everything)",
        dumbbells_cables: "Dumbbells + cables (no barbell)",
        dumbbells_only:   "Dumbbells only",
        bodyweight:       "Bodyweight only",
      };
      const equipLabel = equipmentLabel[equipment] ?? equipment ?? "any equipment";

      // ── Gather user training context ────────────────────────────────────────
      const [rawTemplates, recentWorkouts, loggedExerciseIds, allExercises] = await Promise.all([
        storage.getTemplates(userId),
        storage.getWorkouts(userId, 15),
        storage.getLoggedExerciseIds(userId),
        storage.getExercises(userId),
      ]);

      // Enrich templates with their exercises
      const templates = await Promise.all(rawTemplates.map(async t => {
        const tes = await storage.getTemplateExercisesWithDetails(t.id);
        return { name: t.name, exercises: tes.map((e: any) => e.exerciseName ?? e.name) };
      }));

      // Top lifts: last weight for up to 12 most-logged exercises
      const topExerciseIds = loggedExerciseIds.slice(0, 12);
      const lastWeights = topExerciseIds.length > 0
        ? await storage.getLastWeightsForExercises(userId, topExerciseIds)
        : {};
      const exerciseNameMap: Record<number, string> = {};
      for (const ex of allExercises) exerciseNameMap[ex.id] = ex.name;

      const topLiftsLines = topExerciseIds
        .filter(id => lastWeights[id] && lastWeights[id] > 0)
        .map(id => {
          const lbs = Math.round(lastWeights[id] / 453.592);
          return `  - ${exerciseNameMap[id] ?? `Exercise #${id}`}: ${lbs} lbs most recent`;
        });

      // Recent workout frequency
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      const recentCount = recentWorkouts.filter((w: any) => new Date(w.date) >= thirtyDaysAgo).length;
      const recentNames = recentWorkouts.slice(0, 8).map((w: any) => `  - ${w.date}: ${w.name}`).join("\n");

      // Build context block
      const existingRoutinesText = templates.length === 0
        ? "No saved routines yet — this will be the user's first."
        : templates.map(t => `  • ${t.name}: ${t.exercises.length > 0 ? t.exercises.join(", ") : "no exercises added yet"}`).join("\n");

      const topLiftsText = topLiftsLines.length > 0
        ? topLiftsLines.join("\n")
        : "  No lift history recorded yet — treat as a new trainee.";

      const apiKey3 = process.env.ANTHROPIC_API_KEY;
      if (!apiKey3) return res.status(500).json({ message: "AI service is not configured." });
      const client = new Anthropic({ apiKey: apiKey3 });

      const prompt = `You are an expert personal trainer reviewing a user's training history to build a new workout routine.

━━━ USER'S CURRENT TRAINING CONTEXT ━━━

SAVED ROUTINES (what they already have):
${existingRoutinesText}

RECENT WORKOUTS (last ${recentCount} sessions in 30 days):
${recentNames || "  None logged yet."}

TOP LIFTS (most recent weights):
${topLiftsText}

━━━ NEW ROUTINE REQUEST ━━━

Goal: ${goal}
Available equipment: ${equipLabel}
${notes ? `Additional notes: ${notes}` : ""}

━━━ INSTRUCTIONS ━━━

1. Study the user's existing routines. Identify any gaps: muscle groups that are undertrained, imbalances (e.g. lots of chest/push but no rear-delt or upper-back work), missing movement patterns (e.g. no hinge, no unilateral work), or exercises that overlap too much with what they already have.
2. Design the new routine to COMPLEMENT what they already do — don't just duplicate their existing exercises unless specifically requested. If they have a Push Day with bench press, don't make another routine that also centers on bench press.
3. Where the user has lift history, reference their actual weights to suggest appropriate starting weights or progressions in the weightNote field.
4. Flag any specific observations about their current training in the "coachFeedback" array — these are honest, concrete notes like "Your existing Push Day has no rear-delt work — I've added face pulls here" or "You're squatting frequently but have no Romanian deadlift — added it for hamstring balance." Maximum 4 observations, minimum 0 if nothing notable.
5. Only include exercises achievable with the stated equipment.
6. Every exercise must be DISTINCT — never list the same exercise more than once in the routine.

Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "Routine name",
  "exercises": [
    {
      "name": "Exercise name",
      "sets": 3,
      "reps": "8-12",
      "muscle": "primary muscle group",
      "weightNote": "e.g. 'Based on your 135 lb bench, start curls at 35 lbs' — or null"
    }
  ],
  "coachFeedback": [
    "Specific observation about the user's existing training or this routine's purpose"
  ]
}`;

      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1600,
        messages: [{ role: "user", content: prompt }],
      });

      const rawText = (msg.content[0] as any).text ?? "";
      const stripped = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = stripped.indexOf("{");
      const jsonEnd   = stripped.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        return res.status(500).json({ message: "AI returned an unexpected format. Please try again." });
      }
      const routine = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1));

      // ── Auto-create template + exercises in DB ──────────────────────────────
      const template = await storage.createTemplate({ userId, name: routine.name });

      const muscleToCategory = (muscle: string): "compound" | "isolation" | "cardio" => {
        const m = muscle.toLowerCase();
        if (m === "cardio") return "cardio";
        return ["chest", "back", "quads", "hamstrings", "glutes"].includes(m) ? "compound" : "isolation";
      };

      const norm     = (s: string) => s.toLowerCase().trim();
      const wordsOf  = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));

      // Resolve an AI exercise name to an existing DB exercise: exact name, then
      // substring (either direction), then ≥60% word overlap. Returns undefined if
      // nothing is a confident match — the old "first word" match collapsed distinct
      // movements (e.g. every "Barbell …" onto Barbell Bench Press).
      const resolveExercise = (name: string): any | undefined => {
        const target = norm(name);
        let m = allExercises.find((e: any) => norm(e.name) === target);
        if (m) return m;
        m = allExercises.find((e: any) => { const n = norm(e.name); return n.includes(target) || target.includes(n); });
        if (m) return m;
        const tw = wordsOf(name);
        let best: any = undefined, bestScore = 0;
        for (const e of allExercises) {
          const ew = wordsOf(e.name);
          let common = 0; for (const w of tw) if (ew.has(w)) common++;
          const score = tw.size ? common / Math.max(tw.size, ew.size) : 0;
          if (score > bestScore) { bestScore = score; best = e; }
        }
        return bestScore >= 0.6 ? best : undefined;
      };

      const created: any[]    = [];
      const usedNames = new Set<string>();  // skip exercises the AI listed twice verbatim
      const usedIds   = new Set<number>();  // never add the same DB exercise twice
      let orderIndex  = 0;
      for (const ae of routine.exercises) {
        if (!ae?.name) continue;
        const key = norm(ae.name);
        if (usedNames.has(key)) continue;   // AI repeated the same exercise — drop the dup
        usedNames.add(key);

        let match = resolveExercise(ae.name);
        // If the match collapses onto an exercise already in this routine, treat it
        // as a distinct movement and create it fresh rather than duplicating.
        if (match && usedIds.has(match.id)) match = undefined;
        if (!match) {
          match = await storage.createExercise({
            name: ae.name,
            primaryMuscle: ae.muscle ?? "other",
            secondaryMuscles: [],
            category: muscleToCategory(ae.muscle ?? ""),
            equipment: equipment === "bodyweight" ? "bodyweight" : "dumbbell",
            isCustom: true,
            userId,
          });
        }
        usedIds.add((match as any).id);
        await storage.addTemplateExercise({
          templateId: template.id,
          exerciseId: (match as any).id,
          orderIndex: orderIndex++,
          targetSets: ae.sets ?? 3,
          targetReps: ae.reps ?? "8-12",
          targetWeightGrams: null,
        });
        created.push({ ...ae, exerciseId: (match as any).id });
      }

      res.json({
        templateId:    template.id,
        name:          template.name,
        exercises:     created,
        coachFeedback: routine.coachFeedback ?? [],
      });
    } catch (err: any) {
      console.error("AI routine generation error:", err);
      res.status(500).json({ message: "Failed to generate routine. Please try again." });
    }
  });

  // ── AI Routine Adjustment ─────────────────────────────────────────────────
  app.post("/api/routines/adjust-ai", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    try {
      const { templateId, instruction } = req.body as { templateId: number; instruction?: string };
      if (!templateId) return res.status(400).json({ message: "templateId is required" });

      const userTemplates = await storage.getTemplates(userId);
      const template = userTemplates.find(t => t.id === templateId);
      if (!template) return res.status(404).json({ message: "Routine not found" });

      const templateExs = await storage.getTemplateExercisesWithDetails(templateId);
      const allExercises = await storage.getExercises(userId);
      const loggedExerciseIds = await storage.getLoggedExerciseIds(userId);

      const topExerciseIds = loggedExerciseIds.slice(0, 20);
      const lastWeights = topExerciseIds.length > 0
        ? await storage.getLastWeightsForExercises(userId, topExerciseIds)
        : {};
      const exerciseNameMap: Record<number, string> = {};
      for (const ex of allExercises) exerciseNameMap[ex.id] = ex.name;

      const currentExercises = templateExs.map((te: any) => {
        const lbs = lastWeights[te.exerciseId] ? Math.round(lastWeights[te.exerciseId] / 453.592) : null;
        return `  - ${te.exerciseName ?? exerciseNameMap[te.exerciseId] ?? "?"}: ${te.targetSets}×${te.targetReps}${lbs ? ` (last used: ${lbs} lbs)` : ""}`;
      }).join("\n");

      const goals = await storage.getGoals(userId);
      const activeGoals = goals.filter(g => g.isActive);
      const goalsText = activeGoals.length > 0
        ? activeGoals.map(g => `  - ${g.label} (${g.type})`).join("\n")
        : "  No active goals set.";

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "AI service is not configured." });
      const client = new Anthropic({ apiKey });

      const prompt = `You are an expert personal trainer adjusting an existing workout routine.

━━━ CURRENT ROUTINE: "${template.name}" ━━━
${currentExercises}

━━━ USER'S ACTIVE GOALS ━━━
${goalsText}

━━━ ADJUSTMENT REQUEST ━━━
${instruction || "Review the routine and suggest improvements based on the user's performance data and goals. Consider progressive overload, exercise variety, and muscle balance."}

━━━ INSTRUCTIONS ━━━
Modify the routine by:
- Adjusting weights/reps for progressive overload where lift history shows the user is ready
- Adding exercises to address gaps or imbalances
- Removing or replacing exercises that overlap or are less effective
- Adjusting sets/reps to match the user's goals (strength = lower reps, hypertrophy = 8-12, endurance = 15+)

Return ONLY valid JSON:
{
  "name": "${template.name}",
  "exercises": [
    {
      "name": "Exercise name",
      "sets": 3,
      "reps": "8-12",
      "muscle": "primary muscle group",
      "weightNote": "explanation of any change — e.g. 'Increased from 3 to 4 sets based on your progress' or null",
      "action": "keep|modified|added|removed"
    }
  ],
  "changes": [
    "Summary of each change made and why"
  ]
}

Include ALL exercises in the final list (kept, modified, and added). Mark removed exercises with "action": "removed" — they won't be added to the updated routine. Every exercise must be DISTINCT.`;

      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const rawText = (msg.content[0] as any).text ?? "";
      const stripped = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = stripped.indexOf("{");
      const jsonEnd   = stripped.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        return res.status(500).json({ message: "AI returned an unexpected format. Please try again." });
      }
      const result = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1));

      res.json({
        templateId,
        templateName: template.name,
        proposedExercises: result.exercises ?? [],
        changes: result.changes ?? [],
      });
    } catch (err: any) {
      console.error("AI routine adjustment error:", err);
      res.status(500).json({ message: "Failed to adjust routine. Please try again." });
    }
  });

  app.post("/api/routines/apply-adjustment", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    try {
      const { templateId, exercises } = req.body as { templateId: number; exercises: any[] };
      if (!templateId || !exercises) return res.status(400).json({ message: "templateId and exercises required" });

      const userTemplates = await storage.getTemplates(userId);
      if (!userTemplates.find(t => t.id === templateId)) return res.status(404).json({ message: "Routine not found" });

      const allExercises = await storage.getExercises(userId);
      const norm = (s: string) => s.toLowerCase().trim();
      const wordsOf = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
      const resolveExercise = (name: string): any | undefined => {
        const target = norm(name);
        let m = allExercises.find((e: any) => norm(e.name) === target);
        if (m) return m;
        m = allExercises.find((e: any) => { const n = norm(e.name); return n.includes(target) || target.includes(n); });
        if (m) return m;
        const tw = wordsOf(name);
        let best: any = undefined, bestScore = 0;
        for (const e of allExercises) {
          const ew = wordsOf(e.name);
          let common = 0; for (const w of tw) if (ew.has(w)) common++;
          const score = tw.size ? common / Math.max(tw.size, ew.size) : 0;
          if (score > bestScore) { bestScore = score; best = e; }
        }
        return bestScore >= 0.6 ? best : undefined;
      };

      const existingTes = await storage.getTemplateExercises(templateId);
      for (const te of existingTes) await storage.removeTemplateExercise(te.id);

      const kept = exercises.filter((e: any) => e.action !== "removed");
      const usedIds = new Set<number>();
      let orderIndex = 0;
      for (const ae of kept) {
        if (!ae?.name) continue;
        let match = resolveExercise(ae.name);
        if (match && usedIds.has(match.id)) match = undefined;
        if (!match) {
          match = await storage.createExercise({
            name: ae.name,
            primaryMuscle: ae.muscle ?? "other",
            secondaryMuscles: [],
            category: "compound",
            equipment: "other",
            isCustom: true,
            userId,
          });
        }
        usedIds.add(match.id);
        await storage.addTemplateExercise({
          templateId,
          exerciseId: match.id,
          orderIndex: orderIndex++,
          targetSets: ae.sets ?? 3,
          targetReps: ae.reps ?? "8-12",
          targetWeightGrams: null,
        });
      }

      res.json({ templateId, exerciseCount: orderIndex });
    } catch (err: any) {
      console.error("Apply adjustment error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Active Routine (applied AI weekly plan) ─────────────────────────────────

  /**
   * POST /api/routine/apply
   * Turns the user's latest AI Coach Plan weekly schedule into an Active Routine:
   * creates a workout template for each training/cardio day and starts a
   * rotating sequence at day 0.
   */
  app.post("/api/routine/apply", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    try {
      const plan = await storage.getAiCoachPlan(userId);
      if (!plan?.training?.schedule) {
        return res.status(400).json({ message: "No AI Coach Plan found. Generate one from the Goals page first." });
      }

      const allExercises = await storage.getExercises(userId);

      const norm    = (s: string) => s.toLowerCase().trim();
      const wordsOf = (s: string) => new Set(norm(s).split(/\s+/).filter(w => w.length > 2));
      const resolveExercise = (name: string): any | undefined => {
        const target = norm(name);
        let m = allExercises.find((e: any) => norm(e.name) === target);
        if (m) return m;
        m = allExercises.find((e: any) => { const n = norm(e.name); return n.includes(target) || target.includes(n); });
        if (m) return m;
        const tw = wordsOf(name);
        let best: any = undefined, bestScore = 0;
        for (const e of allExercises) {
          const ew = wordsOf(e.name);
          let common = 0; for (const w of tw) if (ew.has(w)) common++;
          const score = tw.size ? common / Math.max(tw.size, ew.size) : 0;
          if (score > bestScore) { bestScore = score; best = e; }
        }
        return bestScore >= 0.6 ? best : undefined;
      };

      const days = buildDaysFromSchedule(plan.training.schedule);

      for (const day of days) {
        if (day.type === "rest" || day.type === "active_recovery" || day.exercises.length === 0) continue;

        const template = await storage.createTemplate({ userId, name: `${day.dayLabel}: ${day.focus}` });
        const usedIds = new Set<number>();
        let orderIndex = 0;
        for (const ex of day.exercises) {
          let match = resolveExercise(ex.name);
          if (match && usedIds.has(match.id)) match = undefined;
          if (!match) {
            match = await storage.createExercise({
              name: ex.name,
              primaryMuscle: "other",
              secondaryMuscles: [],
              category: "isolation",
              equipment: "other",
              isCustom: true,
              userId,
            });
            allExercises.push(match);
          }
          usedIds.add(match.id);
          await storage.addTemplateExercise({
            templateId: template.id,
            exerciseId: match.id,
            orderIndex: orderIndex++,
            targetSets: ex.sets ?? 3,
            targetReps: ex.reps ?? "8-12",
            targetWeightGrams: null,
          });
        }
        day.templateId = template.id;
      }

      const today = new Date().toISOString().slice(0, 10);
      const routine = await storage.setActiveRoutine(userId, days, today);
      res.json(routine);
    } catch (err: any) {
      console.error("Apply routine error:", err);
      res.status(500).json({ message: "Failed to apply routine. Please try again." });
    }
  });

  /**
   * GET /api/routine/active
   * Returns the user's active routine rolled forward to today, plus the
   * "next up" day. Returns null if no routine is active.
   */
  app.get("/api/routine/active", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const routine = await storage.getActiveRoutine(userId);
    if (!routine) return res.json(null);

    const today = new Date().toISOString().slice(0, 10);
    const state: ActiveRoutineState = { days: routine.days, currentIndex: routine.currentIndex, lastCheckedDate: routine.lastCheckedDate };
    const rolled = rollForward(state, today);
    if (rolled.currentIndex !== state.currentIndex || rolled.lastCheckedDate !== state.lastCheckedDate) {
      await storage.updateActiveRoutineState(routine.id, rolled.currentIndex, rolled.lastCheckedDate);
    }

    res.json({
      ...routine,
      currentIndex: rolled.currentIndex,
      lastCheckedDate: rolled.lastCheckedDate,
      currentDay: rolled.days[rolled.currentIndex] ?? null,
    });
  });

  /**
   * DELETE /api/routine/active
   * Stops following the active routine.
   */
  app.delete("/api/routine/active", async (req, res) => {
    if (!requireAuth(req, res)) return;
    await storage.clearActiveRoutine((req.user as any).id);
    res.sendStatus(204);
  });

  /**
   * GET /api/routine/adapt-proposals
   * Approval-gated suggestions to bump target weights on the active routine's
   * template exercises, based on recent performance. Nothing is applied here —
   * the client must PATCH /api/template-exercises/:id per approved item.
   */
  app.get("/api/routine/adapt-proposals", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const result = await generateAdaptiveProposals((req.user as any).id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Heart Rate Log ──────────────────────────────────────────────────────────

  /**
   * POST /api/heart-rate
   * Body: { readings: { ts: number; bpm: number }[] }
   * Accepts a batch of readings from the client flush (every 30s).
   * `ts` is epoch-ms from Date.now() on the client.
   */
  app.post("/api/heart-rate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const schema = z.object({
      readings: z.array(z.object({ ts: z.number(), bpm: z.number().int().positive() })).min(1).max(500),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid readings" });

    const entries = parsed.data.readings.map(r => ({
      userId,
      ts: new Date(r.ts),
      bpm: r.bpm,
    }));
    await storage.bulkInsertHeartRate(entries);
    res.json({ saved: entries.length });
  });

  /**
   * GET /api/heart-rate?date=YYYY-MM-DD
   * Returns one data-point per minute for that date (for charting history).
   */
  app.get("/api/heart-rate", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const date = (req.query.date as string) || new Date().toLocaleDateString("en-CA");
    const summary = await storage.getHeartRateSummary(userId, date);
    res.json(summary.map(r => ({ ts: r.ts.getTime(), bpm: r.bpm })));
  });

  // ── Social / Friends ───────────────────────────────────────────────────────

  /** Deterministic avatar colour derived from userId */
  function friendColor(id: number): string {
    const COLORS = ["#f8c8dc", "#c8e84c", "#ffb88c", "#9bd1ff", "#d3a8ff", "#a8f0c6", "#ffd6a5", "#b5ead7"];
    return COLORS[id % COLORS.length];
  }

  /** Build public friend card (name, stats, color) for a userId */
  async function buildFriendCard(friendUserId: number) {
    const user = await storage.getUserById(friendUserId);
    if (!user) return null;
    const score = await storage.getScore(friendUserId);
    return {
      id:       user.id,
      name:     user.name,
      initials: (user.name[0] ?? "?").toUpperCase(),
      color:    friendColor(user.id),
      streak:   score.streak,
      points:   score.points,
      workouts: score.workouts,
      prs:      score.prs,
    };
  }

  // Per-user metrics for the head-to-head comparison over a trailing window.
  async function compareMetrics(userId: number, periodDays: number) {
    const since = new Date();
    since.setDate(since.getDate() - periodDays);
    const sinceStr = periodDays >= 9999 ? "0000-00-00" : since.toISOString().slice(0, 10);

    const [user, profile, latestM, strengthSets, activeDates] = await Promise.all([
      storage.getUserById(userId),
      storage.getProfile(userId),
      storage.getLatestMeasurement(userId),
      storage.getStrengthSets(userId),
      storage.getActivityDates(userId),
    ]);

    const bwKg = latestM ? latestM.weightGrams / 1000 : 0;
    const sex  = profile?.sex ?? "male";
    const bests = sessionBests(strengthSets);
    const cur   = currentBests(bests); // Map<exerciseId, {name, e1rmKg}>

    let bestWilks = 0, bestWilksLift = "";
    let bestLiftKg = 0, bestLiftName = "";
    for (const { name, e1rmKg } of cur.values()) {
      const w = wilksScore(e1rmKg, bwKg, sex);
      if (w > bestWilks) { bestWilks = w; bestWilksLift = name; }
      if (e1rmKg > bestLiftKg) { bestLiftKg = e1rmKg; bestLiftName = name; }
    }

    // Active + training days within the window
    const windowDays = Math.min(periodDays, 3650);
    let activeDays = 0;
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (activeDates.has(d.toISOString().slice(0, 10))) activeDays++;
    }
    const trainingDays = new Set(strengthSets.filter(s => s.date >= sinceStr).map(s => s.date)).size;

    return {
      name: user?.name ?? "User",
      bwKg, sex,
      streak:       streakFromDates(activeDates),
      activeDays,
      trainingDays,
      progressPct:    avgProgressPct(bests, sinceStr),
      progressAbsLbs: Math.round(avgProgressAbsKg(bests, sinceStr) * 2.20462 * 10) / 10,
      bestWilks:    Math.round(bestWilks * 10) / 10,
      bestWilksLift,
      bestLiftLbs:  Math.round(bestLiftKg * 2.20462),
      bestLiftName,
      bestLifts:    cur, // for shared-lift comparison
    };
  }

  /** GET /api/users/search?q= — search platform users by name or email */
  app.get("/api/users/search", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const q = String(req.query.q ?? "").trim();
    const results = await storage.searchUsers(userId, q);
    res.json(results.map(u => ({
      id:               u.id,
      name:             u.name,
      initials:         (u.name[0] ?? "?").toUpperCase(),
      color:            friendColor(u.id),
      friendshipStatus: u.friendshipStatus,
      friendshipId:     u.friendshipId,
    })));
  });

  /** POST /api/friends/request-by-id — send friend request by user ID */
  app.post("/api/friends/request-by-id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const { targetId } = z.object({ targetId: z.number().int().positive() }).parse(req.body);
    if (targetId === userId) return res.status(400).json({ message: "Cannot add yourself" });
    const existing = await storage.getFriendship(userId, targetId);
    if (existing) return res.status(409).json({ message: "Friendship already exists" });
    const target = await storage.getUserById(targetId);
    if (!target) return res.status(404).json({ message: "User not found" });
    const f = await storage.sendFriendRequest(userId, targetId);
    res.status(201).json(f);
  });

  /** GET /api/friends — list accepted friends with stats */
  app.get("/api/friends", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const friends = await storage.getFriends(userId);
    const cards = await Promise.all(friends.map(f => buildFriendCard(f.friend.id)));
    res.json(cards.filter(Boolean));
  });

  // Leaderboard = me + friends with real points/streaks, ranked. (Must be before
  // "/api/friends/:id" so "leaderboard" isn't parsed as an id.)
  app.get("/api/friends/leaderboard", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const friends = await storage.getFriends(userId);
    const ids = [userId, ...friends.map(f => f.friend.id)];
    const cards = (await Promise.all(ids.map(buildFriendCard))).filter(Boolean) as any[];
    cards.forEach(c => { c.isMe = c.id === userId; });
    cards.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    res.json(cards);
  });

  // Head-to-head comparison between the current user and a friend.
  app.get("/api/friends/:id/compare", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId   = (req.user as any).id;
    const friendId = Number(req.params.id);
    if (userId !== friendId && !(await storage.areFriends(userId, friendId))) {
      return res.status(403).json({ message: "Not friends" });
    }
    const periodDays = Math.max(1, Math.min(Number(req.query.period) || 90, 9999));

    const [me, fr] = await Promise.all([
      compareMetrics(userId, periodDays),
      compareMetrics(friendId, periodDays),
    ]);

    const decide = (a: number, b: number) => a > b ? "me" : b > a ? "friend" : "tie";

    // Consistency: active days in window, tie-broken by current streak — same in either mode.
    const consistencyRound = { key: "consistency", label: "Consistency",
      winner: me.activeDays !== fr.activeDays ? decide(me.activeDays, fr.activeDays) : decide(me.streak, fr.streak) };

    // Fair mode: normalized for bodyweight/sex (Wilks) and relative to each person's own baseline (%).
    const rounds = [
      consistencyRound,
      { key: "progress", label: "Progress",
        winner: decide(me.progressPct, fr.progressPct) },
      { key: "strength", label: "Strength (Wilks)",
        winner: decide(me.bestWilks, fr.bestWilks) },
    ];

    // Absolute mode: raw numbers — actual weight lifted, actual lbs gained.
    const roundsAbsolute = [
      consistencyRound,
      { key: "progress", label: "Progress",
        winner: decide(me.progressAbsLbs, fr.progressAbsLbs) },
      { key: "strength", label: "Strength",
        winner: decide(me.bestLiftLbs, fr.bestLiftLbs) },
    ];

    // Shared lifts both have logged — includes both Wilks (fair) and raw lbs (absolute).
    const sharedLifts: any[] = [];
    for (const [exId, mine] of me.bestLifts) {
      const theirs = fr.bestLifts.get(exId);
      if (!theirs) continue;
      const meWilks = Math.round(wilksScore(mine.e1rmKg, me.bwKg, me.sex) * 10) / 10;
      const frWilks = Math.round(wilksScore(theirs.e1rmKg, fr.bwKg, fr.sex) * 10) / 10;
      const meLbs = Math.round(mine.e1rmKg * 2.20462);
      const friendLbs = Math.round(theirs.e1rmKg * 2.20462);
      sharedLifts.push({
        name: mine.name,
        meLbs, friendLbs,
        meWilks, friendWilks: frWilks,
        winner: decide(meWilks, frWilks),
        winnerAbsolute: decide(meLbs, friendLbs),
      });
    }
    sharedLifts.sort((a, b) => Math.max(b.meWilks, b.friendWilks) - Math.max(a.meWilks, a.friendWilks));

    const tally = (rs: typeof rounds) => {
      const meWins = rs.filter(r => r.winner === "me").length;
      const frWins = rs.filter(r => r.winner === "friend").length;
      return { me: meWins, friend: frWins, winner: meWins > frWins ? "me" : frWins > meWins ? "friend" : "tie" } as const;
    };

    const strip = (m: typeof me) => ({
      name: m.name, streak: m.streak, activeDays: m.activeDays, trainingDays: m.trainingDays,
      progressPct: m.progressPct, progressAbsLbs: m.progressAbsLbs,
      bestWilks: m.bestWilks, bestWilksLift: m.bestWilksLift,
      bestLiftLbs: m.bestLiftLbs, bestLiftName: m.bestLiftName,
    });

    res.json({
      period: periodDays,
      me: strip(me),
      friend: strip(fr),
      rounds,
      roundsAbsolute,
      sharedLifts: sharedLifts.slice(0, 8),
      overall: tally(rounds),
      overallAbsolute: tally(roundsAbsolute),
    });
  });

  /** GET /api/friends/requests — pending incoming requests */
  app.get("/api/friends/requests", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const pending = await storage.getPendingRequests(userId);
    res.json(pending.map(p => ({
      id:        p.friendship.id,
      senderId:  p.sender.id,
      senderName: p.sender.name,
      color:     friendColor(p.sender.id),
      initials:  (p.sender.name[0] ?? "?").toUpperCase(),
    })));
  });

  /** POST /api/friends/request — send friend request by email */
  app.post("/api/friends/request", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const target = await storage.getUserByEmail(email);
    if (!target) return res.status(404).json({ message: "No user with that email" });
    if (target.id === userId) return res.status(400).json({ message: "Cannot add yourself" });
    const existing = await storage.getFriendship(userId, target.id);
    if (existing) return res.status(409).json({ message: "Friendship already exists" });
    const f = await storage.sendFriendRequest(userId, target.id);
    res.status(201).json(f);
  });

  /** PATCH /api/friends/:id/accept — accept a pending request */
  app.patch("/api/friends/:id/accept", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const f = await storage.acceptFriendRequest(Number(req.params.id), userId);
    if (!f) return res.status(404).json({ message: "Request not found" });
    res.json(f);
  });

  /** DELETE /api/friends/:friendId — remove friend (by their userId, not friendship id) */
  app.delete("/api/friends/:friendId", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    await storage.removeFriendship(userId, Number(req.params.friendId));
    res.sendStatus(204);
  });

  /** GET /api/friends/:id — public profile card for a friend */
  app.get("/api/friends/:id", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId   = (req.user as any).id;
    const friendId = Number(req.params.id);
    // Allow self-lookup (for the /me card) or verified friend
    if (userId !== friendId && !(await storage.areFriends(userId, friendId))) {
      return res.status(403).json({ message: "Not friends" });
    }
    const card = await buildFriendCard(friendId);
    if (!card) return res.sendStatus(404);
    res.json(card);
  });

  /** GET /api/friends/:id/measurements — friend's weight history */
  app.get("/api/friends/:id/measurements", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId   = (req.user as any).id;
    const friendId = Number(req.params.id);
    if (userId !== friendId && !(await storage.areFriends(userId, friendId))) {
      return res.status(403).json({ message: "Not friends" });
    }
    const data = await storage.getMeasurements(friendId, 90);
    res.json(data);
  });

  /** GET /api/friends/:id/food-log/summary?period= — friend's nutrition summary */
  app.get("/api/friends/:id/food-log/summary", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId   = (req.user as any).id;
    const friendId = Number(req.params.id);
    if (userId !== friendId && !(await storage.areFriends(userId, friendId))) {
      return res.status(403).json({ message: "Not friends" });
    }
    const period = (req.query.period as string) || "1M";
    const data = await storage.getFoodLogSummary(friendId, period);
    res.json(data);
  });

  /** GET /api/friends/:id/exercises/:exerciseId/history — friend's strength history */
  app.get("/api/friends/:id/exercises/:exerciseId/history", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId     = (req.user as any).id;
    const friendId   = Number(req.params.id);
    const exerciseId = Number(req.params.exerciseId);
    if (userId !== friendId && !(await storage.areFriends(userId, friendId))) {
      return res.status(403).json({ message: "Not friends" });
    }
    const data = await storage.getExerciseHistory(exerciseId, friendId);
    res.json(data);
  });

  // ── Invitations ─────────────────────────────────────────────────────────────

  /**
   * POST /api/invite
   * Send an email or SMS invitation to someone who isn't on Fit Friends yet.
   * Body: { method: "email"|"sms", contact: string, personalNote?: string }
   */
  app.post("/api/invite", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;

    const schema = z.object({
      method:       z.enum(["email", "sms"]),
      contact:      z.string().min(1),
      personalNote: z.string().max(280).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request: " + parsed.error.issues[0]?.message });
    }

    const { method, contact, personalNote } = parsed.data;
    const sender = await storage.getUserById(userId);
    if (!sender) return res.sendStatus(401);
    const inviterName = sender.name;

    try {
      if (method === "email") {
        // Basic email format check
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
          return res.status(400).json({ message: "Please enter a valid email address." });
        }
        // Don't invite someone who already has an account
        const existing = await storage.getUserByEmail(contact);
        if (existing) {
          return res.status(409).json({
            message: "That email is already registered. Use 'Add Friend' to connect with them instead.",
            alreadyRegistered: true,
          });
        }
        await sendInviteEmail({ toEmail: contact, inviterName, personalNote });
        return res.json({ sent: true, method: "email", contact });
      } else {
        // Normalise phone: strip spaces/dashes/parens, ensure leading +
        const digits = contact.replace(/[\s\-().]/g, "");
        const normalised = digits.startsWith("+") ? digits : `+1${digits}`; // default +1 (US)
        if (!/^\+\d{10,15}$/.test(normalised)) {
          return res.status(400).json({ message: "Please enter a valid phone number (10+ digits)." });
        }
        await sendInviteSms({ toPhone: normalised, inviterName, personalNote });
        return res.json({ sent: true, method: "sms", contact: normalised });
      }
    } catch (err: any) {
      console.error("Invite send error:", err);
      // Surface the human-readable config error vs generic failure
      const isConfig = err.message?.includes("not configured");
      return res.status(isConfig ? 503 : 500).json({ message: err.message ?? "Failed to send invitation" });
    }
  });
}
