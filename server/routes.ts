import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import { storage } from "./storage.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { passport } from "./auth.js";
import { lookupBarcode, lookupBarcodeFS, autocompleteFatSecret, searchFoodByName, searchOFF, searchUSDA, searchFatSecret, searchCalorieNinjas, searchBrandOFF, enrichMissingNutrition } from "./services/food-lookup.js";
import { parseNutritionLabel } from "./services/vision.js";
import { calculateMacroTargets, getAgeFromBirthDate } from "./services/goal-engine.js";
import { fetchExerciseGif } from "./services/exercise-gif.js";
import { sendInviteEmail, sendInviteSms } from "./services/notifications.js";
import {
  insertUserSchema, insertUserProfileSchema, insertGoalSchema, insertBodyMeasurementSchema,
  insertFoodItemSchema, insertFoodLogSchema, insertWaterLogSchema, insertSupplementLogSchema,
  insertExerciseSchema, insertWorkoutTemplateSchema, insertTemplateExerciseSchema,
  insertWorkoutSchema, insertWorkoutSetSchema, insertHeartRateLogSchema,
  insertSavedMealSchema, insertMealIngredientSchema,
} from "../shared/schema.js";
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

  const targets = calculateMacroTargets({ weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays });
  await storage.upsertNutritionTarget(userId, { effectiveDate: new Date().toISOString().slice(0, 10), ...targets });
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

    try {
      // ── Gather user context ─────────────────────────────────────────────────
      const [profile, goals, measurements, target, recentWorkouts, foodSummary] = await Promise.all([
        storage.getProfile(userId),
        storage.getGoals(userId),
        storage.getMeasurements(userId, 30),   // more history for trend detection
        storage.getNutritionTarget(userId),
        storage.getWorkouts(userId, 10),
        storage.getFoodLogSummary(userId, "1W"),
      ]);

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
      const totalDays     = foodSummary.length;
      const loggedCount   = loggedDays.length;
      const avgCalLogged  = loggedCount > 0
        ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / loggedCount)
        : null;
      const avgProtLogged = loggedCount > 0
        ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedCount)
        : null;

      let dietLoggingStatus: string;
      if (loggedCount === 0) {
        dietLoggingStatus = `No diet logs in the last ${totalDays} days. User has NOT been logging — do NOT assume they ate nothing. Base recommendations on goals and profile only.`;
      } else if (loggedCount < totalDays * 0.5) {
        dietLoggingStatus = `Inconsistent: logged ${loggedCount}/${totalDays} days. On logged days avg ${avgCalLogged} kcal, ${avgProtLogged}g protein. True intake is likely higher — acknowledge the gap.`;
      } else {
        dietLoggingStatus = `Consistent: logged ${loggedCount}/${totalDays} days. On logged days avg ${avgCalLogged} kcal, ${avgProtLogged}g protein. Reasonably reliable.`;
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

DIET LOGGING STATUS (last 7 days):
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
      { "day": "Monday",    "focus": "...", "type": "strength|cardio|rest|active_recovery" },
      { "day": "Tuesday",   "focus": "...", "type": "..." },
      { "day": "Wednesday", "focus": "...", "type": "..." },
      { "day": "Thursday",  "focus": "...", "type": "..." },
      { "day": "Friday",    "focus": "...", "type": "..." },
      { "day": "Saturday",  "focus": "...", "type": "..." },
      { "day": "Sunday",    "focus": "...", "type": "..." }
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

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 4096,
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

      res.json(plan);
    } catch (err: any) {
      console.error("AI analysis error:", err?.message ?? err);
      const msg = err?.status === 401
        ? "AI service authentication failed — check ANTHROPIC_API_KEY."
        : err?.status === 529
        ? "AI service is overloaded. Please try again in a moment."
        : "Failed to generate AI analysis. Please try again.";
      res.status(500).json({ message: msg });
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

  // ── Food Search / Barcode / Vision ──────────────────────────────────────────
  app.get("/api/food/search", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const q = req.query.q as string;
    // FatSecret is primary; USDA + OFF fill gaps when results are thin
    const typeFilter = (req.query.type as string) || "all";
    if (!q || q.length < 2) return res.json([]);

    const ql = q.toLowerCase();

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

      // Tier -1: restaurant brand exact match — always first
      if (matchedBrandNorm && brandNorm) {
        if (brandNorm.replace(/\s/g, "").includes(matchedBrandNorm.replace(/\s/g, "")) ||
            matchedBrandNorm.replace(/\s/g, "").includes(brandNorm.replace(/\s/g, ""))) {
          return -1 + (1 - sim) * 0.9;
        }
      }

      let matches = 0;
      for (const w of qWords) if (itemWords.has(w)) matches++;
      const ratio = qWords.size > 0 ? matches / qWords.size : 0;

      if (ratio >= 1.0)  return 0 + (1 - sim) * 0.9;
      if (ratio >= 0.67) return 1 + (1 - sim) * 0.9;
      if (ratio >= 0.5)  return 2 + (1 - sim) * 0.9;
      return 3 + (1 - ratio) - nutritionScore(item) * 0.01;
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
      const merged = {
        effectiveDate: existing?.effectiveDate ?? new Date().toISOString().slice(0, 10),
        calories: existing?.calories ?? 2200,
        proteinG: existing?.proteinG ?? 150,
        carbsG:   existing?.carbsG   ?? 220,
        fatG:     existing?.fatG     ?? 70,
        waterMl:  existing?.waterMl  ?? 2500,
        ...patch,
      };
      const t = await storage.upsertNutritionTarget(userId, merged);
      res.json(t);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
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

  // Return cached gifUrl, or fetch-and-cache from ExerciseDB if missing
  app.get("/api/exercises/:id/gif", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const id = Number(req.params.id);
    const exercise = await storage.getExerciseById(id);
    if (!exercise) return res.sendStatus(404);

    // Serve from cache
    if (exercise.gifUrl) return res.json({ gifUrl: exercise.gifUrl });

    // Lazy-fetch from ExerciseDB, then cache
    const gifUrl = await fetchExerciseGif(exercise.name);
    if (gifUrl) {
      await storage.updateExerciseGifUrl(id, gifUrl);
      return res.json({ gifUrl });
    }

    res.json({ gifUrl: null });
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
    const w = await storage.updateWorkout(Number(req.params.id), (req.user as any).id, req.body);
    if (!w) return res.sendStatus(404);
    res.json(w);
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

      let imported = 0;
      let skipped = 0;

      for (const [, session] of sessions) {
        const { date, iso: startIso } = parseHevyDate(session.startTime);
        const { iso: endIso } = parseHevyDate(session.endTime);
        const durationMinutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);

        // Check for duplicate (same name + date)
        const existing = await storage.getWorkouts(userId, 500);
        const isDupe = existing.some(w => w.name === session.title && w.date === date);
        if (isDupe) { skipped++; continue; }

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
          // Find or create exercise
          let exercise = exerciseByName.get(exName.toLowerCase());
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
    try {
      const { goal, daysPerWeek, equipment, notes } = req.body;

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

      const msg = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text = (msg.content[0] as any).text;
      const routine = JSON.parse(text);
      res.json(routine);
    } catch (err: any) {
      console.error("AI routine generation error:", err);
      res.status(500).json({ message: "Failed to generate routine" });
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
    const user   = await storage.getUserById(friendUserId);
    if (!user) return null;
    const [streak, points] = await Promise.all([
      storage.computeStreak(friendUserId),
      storage.computePoints(friendUserId),
    ]);
    return {
      id:       user.id,
      name:     user.name,
      initials: (user.name[0] ?? "?").toUpperCase(),
      color:    friendColor(user.id),
      streak,
      points,
    };
  }

  /** GET /api/friends — list accepted friends with stats */
  app.get("/api/friends", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const userId = (req.user as any).id;
    const friends = await storage.getFriends(userId);
    const cards = await Promise.all(friends.map(f => buildFriendCard(f.friend.id)));
    res.json(cards.filter(Boolean));
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
   * Send an email or SMS invitation to someone who isn't on FitCore yet.
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
