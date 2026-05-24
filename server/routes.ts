import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import { storage } from "./storage.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { passport } from "./auth.js";
import { lookupBarcode, searchFoodByName, searchOFF, searchUSDA, searchFatSecret, searchCalorieNinjas, searchBrandOFF, enrichMissingNutrition } from "./services/food-lookup.js";
import { parseNutritionLabel } from "./services/vision.js";
import { calculateMacroTargets, getAgeFromBirthDate } from "./services/goal-engine.js";
import { fetchExerciseGif } from "./services/exercise-gif.js";
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

  app.get("/api/food/barcode/:code", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const code = req.params.code;

    // Check cache
    const cached = await storage.getFoodItemByBarcode(code);
    if (cached) return res.json(cached);

    // Fetch from Open Food Facts
    const data = await lookupBarcode(code);
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
      source: "openfoodfacts",
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
        model: "claude-opus-4-7",
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
}
