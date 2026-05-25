// Open Food Facts API wrapper

/** Fetch with an AbortController timeout. Default 7 s — well under the mobile client's 10 s limit. */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface NutritionFacts {
  name: string;
  brand?: string;
  barcode?: string;
  servingSizeG: number;
  servingUnit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
  saturatedFatG?: number;
  transFatG?: number;
  cholesterolMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  vitaminDMcg?: number;
  vitaminCMg?: number;
}

export async function lookupBarcode(barcode: string): Promise<NutritionFacts | null> {
  try {
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      { headers: { "User-Agent": "FitCore/1.0 (fitness tracker)" } }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const n = p.nutriments || {};

    // Prefer "per serving" values when available
    const perServing = p.serving_size ? true : false;
    const servingG = parseServingSize(p.serving_size) || 100;
    const scale = perServing ? 1 : servingG / 100;

    const calories = extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale) ??
      (extractNutrient(n, "energy", "energy_serving", scale) ?? 0) / 4.184;

    return {
      name: p.product_name || p.product_name_en || "Unknown Product",
      brand: p.brands,
      barcode,
      servingSizeG: servingG,
      servingUnit: p.serving_size || "100g",
      calories: Math.round(calories),
      proteinG:      extractNutrient(n, "proteins",         "proteins_serving",         scale) ?? 0,
      carbsG:        extractNutrient(n, "carbohydrates",    "carbohydrates_serving",    scale) ?? 0,
      fatG:          extractNutrient(n, "fat",              "fat_serving",              scale) ?? 0,
      fiberG:        extractNutrient(n, "fiber",            "fiber_serving",            scale),
      sodiumMg:      extractOFFSodium(n, scale),
      sugarG:        extractNutrient(n, "sugars",           "sugars_serving",           scale),
      saturatedFatG: extractNutrient(n, "saturated-fat",    "saturated-fat_serving",    scale),
      transFatG:     extractNutrient(n, "trans-fat",        "trans-fat_serving",        scale),
      cholesterolMg: extractOFFCholesterol(n, scale),
      potassiumMg:   extractOFFMineral(n, "potassium", scale),
      calciumMg:     extractOFFMineral(n, "calcium",   scale),
      ironMg:        extractOFFMineral(n, "iron",      scale),
      vitaminDMcg:   extractOFFVitamin(n, "vitamin-d", scale),
      vitaminCMg:    extractOFFVitamin(n, "vitamin-c", scale),
    };
  } catch {
    return null;
  }
}

function extractNutrient(
  n: Record<string, any>,
  per100Key: string,
  servingKey: string,
  scale: number
): number | undefined {
  if (n[servingKey] !== undefined) return Math.round(n[servingKey] * 10) / 10;
  if (n[per100Key]  !== undefined) return Math.round(n[per100Key] * scale * 10) / 10;
  return undefined;
}

// OFF stores sodium in g (not mg) — convert to mg
function extractOFFSodium(n: Record<string, any>, scale: number): number | undefined {
  const v = extractNutrient(n, "sodium", "sodium_serving", scale);
  return v !== undefined ? v * 1000 : undefined;
}

// OFF stores cholesterol in g — convert to mg
function extractOFFCholesterol(n: Record<string, any>, scale: number): number | undefined {
  const v = extractNutrient(n, "cholesterol", "cholesterol_serving", scale);
  return v !== undefined ? v * 1000 : undefined;
}

// OFF stores potassium/calcium/iron in g — convert to mg
function extractOFFMineral(n: Record<string, any>, key: string, scale: number): number | undefined {
  const v = extractNutrient(n, key, `${key}_serving`, scale);
  return v !== undefined ? v * 1000 : undefined;
}

// OFF stores vitamins in g — convert to µg (vitamin D) or mg (vitamin C)
function extractOFFVitamin(n: Record<string, any>, key: string, scale: number): number | undefined {
  const v = extractNutrient(n, key, `${key}_serving`, scale);
  // Both vitamin-d (µg) and vitamin-c (mg) are stored in g in OFF → multiply by 1000
  return v !== undefined ? Math.round(v * 1000 * 10) / 10 : undefined;
}

function parseServingSize(serving: string | undefined): number | null {
  if (!serving) return null;
  const match = serving.match(/(\d+\.?\d*)\s*g/i);
  if (match) return parseFloat(match[1]);
  const mlMatch = serving.match(/(\d+\.?\d*)\s*ml/i);
  if (mlMatch) return parseFloat(mlMatch[1]); // approximate ml ≈ g
  const ozMatch = serving.match(/(\d+\.?\d*)\s*oz/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.35;
  return null;
}

// ── FatSecret Premier ─────────────────────────────────────────────────────────
// Comprehensive food + restaurant database with Premier Free access.
// Premier Free unlocks: food.find_id_for_barcode, foods.autocomplete,
// food.get.v4 (full nutrition panels), and food categories.
// OAuth 2.0 client credentials — token cached in memory, auto-refreshed.
// NOTE: read from process.env at call time (not module init) so Render env vars
// are always available regardless of ESM bundle initialization order.

const FS_API = "https://platform.fatsecret.com/rest/server.api";

let _fsToken: string | null = null;
let _fsTokenExpiry = 0;

async function getFatSecretToken(): Promise<string | null> {
  const FS_CLIENT_ID     = process.env.FATSECRET_CLIENT_ID?.trim();
  const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET?.trim();
  if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) {
    console.warn("[FatSecret] credentials missing — set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET");
    return null;
  }
  if (_fsToken && Date.now() < _fsTokenExpiry) return _fsToken;
  try {
    const creds = Buffer.from(`${FS_CLIENT_ID}:${FS_CLIENT_SECRET}`).toString("base64");
    const res = await fetchWithTimeout("https://oauth.fatsecret.com/connect/token", {
      method: "POST",
      headers: {
        "Authorization":  `Basic ${creds}`,
        "Content-Type":   "application/x-www-form-urlencoded",
      },
      // Premier Free scope — unlocks barcode, autocomplete, and food.get.v4
      body: "grant_type=client_credentials&scope=premier",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[FatSecret] token fetch failed: HTTP ${res.status} — ${body}`);
      return null;
    }
    const data = await res.json() as any;
    if (!data.access_token) {
      console.error("[FatSecret] token response missing access_token:", JSON.stringify(data));
      return null;
    }
    _fsToken = data.access_token;
    _fsTokenExpiry = Date.now() + (data.expires_in - 120) * 1000; // refresh 2 min early
    console.log(`[FatSecret] premier token acquired, expires in ${data.expires_in}s`);
    return _fsToken;
  } catch (err: any) {
    console.error("[FatSecret] token fetch threw:", err?.message ?? err);
    return null;
  }
}

/** Parse a single FatSecret serving object (from food.get.v4) into NutritionFacts.
 *  Returns the first "normal" serving (non-100g generic) when available. */
function parseFSServing(foodName: string, brandName: string | undefined, servings: any): NutritionFacts | null {
  const list: any[] = Array.isArray(servings?.serving) ? servings.serving : servings?.serving ? [servings.serving] : [];
  if (list.length === 0) return null;

  // Prefer a real measured serving over the generic "100g" entry
  const serving = list.find(s => s.serving_description?.toLowerCase() !== "100g") ?? list[0];

  const servingG = parseFloat(serving.metric_serving_amount ?? serving.serving_description?.match(/([\d.]+)g/i)?.[1] ?? "100");
  const servingUnit = serving.serving_description ?? `${servingG}g`;

  const n = (key: string) => {
    const v = parseFloat(serving[key]);
    return isNaN(v) ? undefined : v;
  };
  const calories = n("calories");
  if (!calories) return null;

  return {
    name:          foodName,
    brand:         brandName || undefined,
    servingSizeG:  servingG || 100,
    servingUnit,
    calories:      Math.round(calories),
    proteinG:      Math.round((n("protein")         ?? 0) * 10) / 10,
    carbsG:        Math.round((n("carbohydrate")     ?? 0) * 10) / 10,
    fatG:          Math.round((n("fat")              ?? 0) * 10) / 10,
    fiberG:        n("fiber") != null            ? Math.round(n("fiber")!         * 10) / 10  : undefined,
    sugarG:        n("sugar") != null            ? Math.round(n("sugar")!         * 10) / 10  : undefined,
    saturatedFatG: n("saturated_fat") != null    ? Math.round(n("saturated_fat")! * 10) / 10  : undefined,
    transFatG:     n("trans_fat") != null        ? Math.round(n("trans_fat")!     * 10) / 10  : undefined,
    sodiumMg:      n("sodium") != null           ? Math.round(n("sodium")!)                   : undefined,
    cholesterolMg: n("cholesterol") != null      ? Math.round(n("cholesterol")!)               : undefined,
    potassiumMg:   n("potassium") != null        ? Math.round(n("potassium")!)                 : undefined,
    calciumMg:     n("calcium") != null          ? Math.round(n("calcium")!)                   : undefined,
    ironMg:        n("iron") != null             ? Math.round(n("iron")!     * 100) / 100      : undefined,
    vitaminDMcg:   n("vitamin_d") != null        ? Math.round(n("vitamin_d")!     * 10)  / 10  : undefined,
    vitaminCMg:    n("vitamin_c") != null        ? Math.round(n("vitamin_c")!     * 10)  / 10  : undefined,
  };
}

/** Fetch full nutrition for a FatSecret food ID using food.get.v4 (Premier). */
async function getFSFoodById(token: string, foodId: string): Promise<NutritionFacts | null> {
  try {
    const url = `${FS_API}?method=food.get.v4&food_id=${encodeURIComponent(foodId)}&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!res.ok) {
      console.error(`[FatSecret] food.get.v4 failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    const food = data.food;
    if (!food) return null;
    return parseFSServing(food.food_name, food.brand_name, food.servings);
  } catch {
    return null;
  }
}

/** Look up a barcode using FatSecret Premier's food.find_id_for_barcode endpoint.
 *  Returns full NutritionFacts or null if not found. */
export async function lookupBarcodeFS(barcode: string): Promise<NutritionFacts | null> {
  const token = await getFatSecretToken();
  if (!token) return null;
  try {
    // Step 1: Resolve barcode → food_id
    const url = `${FS_API}?method=food.find_id_for_barcode&barcode=${encodeURIComponent(barcode)}&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!res.ok) {
      console.error(`[FatSecret] barcode lookup failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    const foodId = data.food_id?.value ?? data.food_id;
    if (!foodId) return null;

    // Step 2: Fetch full nutrition panel for that food_id
    const facts = await getFSFoodById(token, String(foodId));
    if (facts) console.log(`[FatSecret] barcode ${barcode} → food_id ${foodId} → "${facts.name}"`);
    return facts;
  } catch {
    return null;
  }
}

/** Autocomplete suggestions for the search bar (Premier feature). */
export async function autocompleteFatSecret(query: string, maxResults = 8): Promise<string[]> {
  const token = await getFatSecretToken();
  if (!token) return [];
  try {
    const url = `${FS_API}?method=foods.autocomplete` +
      `&expression=${encodeURIComponent(query)}&max_results=${maxResults}&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const raw = data.suggestions?.suggestion;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  } catch {
    return [];
  }
}

export async function searchFatSecret(query: string, limit = 25): Promise<NutritionFacts[]> {
  const token = await getFatSecretToken();
  if (!token) return [];
  try {
    // Use foods.search to get IDs + brief descriptions
    const url = `${FS_API}` +
      `?method=foods.search&search_expression=${encodeURIComponent(query)}` +
      `&format=json&max_results=${limit}&page_number=0`;
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!res.ok) {
      console.error(`[FatSecret] search failed: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as any;
    const raw = data.foods?.food;
    if (!raw) return [];
    const foods: any[] = Array.isArray(raw) ? raw : [raw];

    // For each search result fetch full nutrition via food.get.v4 in parallel
    // (cap at 10 concurrent fetches to avoid rate limits)
    const TOP = Math.min(foods.length, 10);
    const enriched = await Promise.all(
      foods.slice(0, TOP).map(async (f: any) => {
        if (!f.food_id) return fallbackFSItem(f);
        const full = await getFSFoodById(token, String(f.food_id));
        if (full) return full;
        return fallbackFSItem(f); // fall back to parsing the description string
      })
    );

    // Append any remaining results using the fast description-parse fallback
    const rest = foods.slice(TOP).map(fallbackFSItem);
    return [...enriched, ...rest].filter((x): x is NutritionFacts => x !== null);
  } catch {
    return [];
  }
}

/** Quick parse of a foods.search result's food_description string (no extra API call).
 *  Used as a fallback when food.get.v4 fails or for tail results. */
function fallbackFSItem(f: any): NutritionFacts | null {
  if (!f.food_description) return null;
  // "Per 1 burger (210g) - Calories: 563kcal | Fat: 33.00g | Carbs: 44.00g | Protein: 26.00g"
  const desc     = f.food_description as string;
  const calories = parseFloat(desc.match(/Calories:\s*([\d.]+)/i)?.[1] ?? "0");
  const fat      = parseFloat(desc.match(/Fat:\s*([\d.]+)/i)?.[1] ?? "0");
  const carbs    = parseFloat(desc.match(/Carbs:\s*([\d.]+)/i)?.[1] ?? "0");
  const protein  = parseFloat(desc.match(/Protein:\s*([\d.]+)/i)?.[1] ?? "0");
  const servingG = parseFloat(desc.match(/\(([\d.]+)g\)/i)?.[1] ?? "100");
  const servingLabel = desc.match(/^Per (.+?) -/i)?.[1] ?? "1 serving";
  if (!calories) return null;
  return {
    name:         f.food_name,
    brand:        f.brand_name || undefined,
    servingSizeG: servingG || 100,
    servingUnit:  servingLabel,
    calories:     Math.round(calories),
    proteinG:     Math.round(protein * 10) / 10,
    carbsG:       Math.round(carbs   * 10) / 10,
    fatG:         Math.round(fat     * 10) / 10,
  };
}

// ── CalorieNinjas ─────────────────────────────────────────────────────────────
// Good coverage of restaurant / branded foods via natural-language queries.
// Free tier: 10,000 calls/month — sign up at https://calorieninjas.com/api
// Set CALORIENINJA_API_KEY in your .env to enable.
export async function searchCalorieNinjas(query: string, limit = 20): Promise<NutritionFacts[]> {
  const CN_KEY = process.env.CALORIENINJA_API_KEY?.trim();
  if (!CN_KEY) return [];
  try {
    const res = await fetchWithTimeout(
      `https://api.calorieninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`,
      { headers: { "X-Api-Key": CN_KEY, "Accept": "application/json" } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const items: any[] = (data.items || []).slice(0, limit);
    return items
      .filter((item: any) => item.calories != null)
      .map((item: any): NutritionFacts => ({
        name:         toTitleCaseCN(item.name),
        servingSizeG: item.serving_size_g || 100,
        servingUnit:  `${item.serving_size_g || 100}g`,
        calories:  Math.round(item.calories             || 0),
        proteinG:  Math.round((item.protein_g           || 0) * 10) / 10,
        carbsG:    Math.round((item.carbohydrates_total_g || 0) * 10) / 10,
        fatG:      Math.round((item.fat_total_g         || 0) * 10) / 10,
        fiberG:    item.fiber_g   != null ? Math.round(item.fiber_g   * 10) / 10 : undefined,
        sodiumMg:  item.sodium_mg != null ? Math.round(item.sodium_mg)            : undefined,
        sugarG:    item.sugar_g   != null ? Math.round(item.sugar_g   * 10) / 10  : undefined,
      }));
  } catch {
    return [];
  }
}
function toTitleCaseCN(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Open Food Facts — brand browse ────────────────────────────────────────────
// When the query looks like a brand/restaurant name, fetches products for that
// brand directly from OFF. Much better coverage than generic text search.
export async function searchBrandOFF(brandQuery: string, limit = 25): Promise<NutritionFacts[]> {
  try {
    // OFF brand slugs: lowercase, no apostrophes, spaces → hyphens
    const slug = brandQuery.toLowerCase()
      .replace(/[''']/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/brand/${slug}/1.json?page_size=${limit}&fields=product_name,brands,serving_size,nutriments,code`,
      { headers: { "User-Agent": "FitCore/1.0" } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const products = (data.products || []) as any[];
    return products
      .filter((p: any) => p.product_name && p.nutriments?.["energy-kcal_100g"])
      .map((p: any) => {
        const n = p.nutriments || {};
        const servingG = parseServingSize(p.serving_size) || 100;
        const scale = p.serving_size ? 1 : servingG / 100;
        return {
          name:          p.product_name,
          brand:         p.brands,
          barcode:       p.code,
          servingSizeG:  servingG,
          servingUnit:   p.serving_size || "100g",
          calories:      Math.round(extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale) ?? 0),
          proteinG:      extractNutrient(n, "proteins",      "proteins_serving",      scale) ?? 0,
          carbsG:        extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
          fatG:          extractNutrient(n, "fat",           "fat_serving",           scale) ?? 0,
          fiberG:        extractNutrient(n, "fiber",         "fiber_serving",         scale),
          sodiumMg:      extractOFFSodium(n, scale),
          sugarG:        extractNutrient(n, "sugars",        "sugars_serving",        scale),
          saturatedFatG: extractNutrient(n, "saturated-fat", "saturated-fat_serving", scale),
          transFatG:     extractNutrient(n, "trans-fat",     "trans-fat_serving",     scale),
          cholesterolMg: extractOFFCholesterol(n, scale),
          potassiumMg:   extractOFFMineral(n, "potassium", scale),
          calciumMg:     extractOFFMineral(n, "calcium",   scale),
          ironMg:        extractOFFMineral(n, "iron",      scale),
          vitaminDMcg:   extractOFFVitamin(n, "vitamin-d", scale),
          vitaminCMg:    extractOFFVitamin(n, "vitamin-c", scale),
        } as NutritionFacts;
      });
  } catch {
    return [];
  }
}

// ── USDA FoodData Central ─────────────────────────────────────────────────────
// Free, no-auth key needed (DEMO_KEY = 1000 req/hr per IP).
// Branded Foods dataset covers McDonald's, Chipotle, Starbucks, etc.
// Read at call time — see note above re: module init order
function getUsdaKey() { return process.env.USDA_API_KEY?.trim() || "DEMO_KEY"; }

/** Build a variant of the query with apostrophes injected before trailing 's'
 *  so "McDonalds" also searches "McDonald's", "Wendys" → "Wendy's", etc. */
function apostropheVariant(q: string): string | null {
  if (q.includes("'") || q.includes("’")) return null; // already has apostrophe
  const variant = q.replace(/([a-zA-Z]+)s\b/g, "$1's");
  return variant !== q ? variant : null;
}

async function fetchUSDA(query: string, limit: number, brandedOnly = false): Promise<any[]> {
  try {
    const dataType = brandedOnly ? "Branded" : "Branded,Survey%20(FNDDS)";
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search` +
      `?query=${encodeURIComponent(query)}&pageSize=${limit}&api_key=${getUsdaKey()}` +
      `&dataType=${dataType}`;
    const res = await fetchWithTimeout(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.foods || []) as any[];
  } catch {
    return [];
  }
}

export async function searchUSDA(query: string, limit = 20, brandedOnly = false): Promise<NutritionFacts[]> {
  try {
    // Run original query + apostrophe variant in parallel for better brand matching
    // e.g. "McDonalds" → also tries "McDonald's" since USDA indexes the apostrophe
    const variant = apostropheVariant(query);
    const [foods1, foods2] = await Promise.all([
      fetchUSDA(query, limit, brandedOnly),
      variant ? fetchUSDA(variant, Math.ceil(limit / 2), brandedOnly) : Promise.resolve([]),
    ]);

    // Merge, deduplicate by fdcId
    const seenIds = new Set<number>();
    const foods: any[] = [];
    for (const f of [...foods1, ...foods2]) {
      if (!seenIds.has(f.fdcId)) {
        seenIds.add(f.fdcId);
        foods.push(f);
      }
    }

    return foods
      .filter((f: any) => {
        const hasCalories = f.foodNutrients?.some(
          (n: any) => n.nutrientId === 1008 || n.nutrientName === "Energy"
        );
        return f.description && hasCalories;
      })
      .map((f: any) => {
        const nMap: Record<number, number> = {};
        for (const n of (f.foodNutrients || [])) {
          nMap[n.nutrientId] = n.value ?? 0;
        }
        // USDA nutrient IDs: 1008=Energy(kcal), 1003=Protein, 1005=Carbs, 1004=Fat
        //                    1079=Fiber, 1093=Sodium(mg), 2000=Sugars
        const servingSizeG = f.servingSize && f.servingSizeUnit?.toLowerCase() === "g"
          ? f.servingSize
          : f.servingSize && f.servingSizeUnit?.toLowerCase() === "oz"
          ? f.servingSize * 28.35
          : 100;

        // Most USDA values are per-100g — scale to serving
        const scale = servingSizeG / 100;

        return {
          name: toTitleCase(f.description),
          brand: f.brandOwner || f.brandName,
          servingSizeG,
          servingUnit: f.servingSize
            ? `${f.servingSize}${f.servingSizeUnit || "g"}`
            : "100g",
          calories:       Math.round((nMap[1008] || 0) * scale),
          proteinG:       Math.round((nMap[1003] || 0) * scale * 10) / 10,
          carbsG:         Math.round((nMap[1005] || 0) * scale * 10) / 10,
          fatG:           Math.round((nMap[1004] || 0) * scale * 10) / 10,
          fiberG:         nMap[1079] != null ? Math.round(nMap[1079] * scale * 10) / 10  : undefined,
          sodiumMg:       nMap[1093] != null ? Math.round(nMap[1093] * scale)             : undefined,
          sugarG:         nMap[2000] != null ? Math.round(nMap[2000] * scale * 10) / 10  : undefined,
          // USDA nutrient IDs: 1258=Sat fat, 1257=Trans fat, 1253=Cholesterol(mg),
          // 1092=Potassium(mg), 1087=Calcium(mg), 1089=Iron(mg),
          // 1114=Vit D(µg), 1162=Vit C(mg)
          saturatedFatG:  nMap[1258] != null ? Math.round(nMap[1258] * scale * 10) / 10  : undefined,
          transFatG:      nMap[1257] != null ? Math.round(nMap[1257] * scale * 10) / 10  : undefined,
          cholesterolMg:  nMap[1253] != null ? Math.round(nMap[1253] * scale)             : undefined,
          potassiumMg:    nMap[1092] != null ? Math.round(nMap[1092] * scale)             : undefined,
          calciumMg:      nMap[1087] != null ? Math.round(nMap[1087] * scale)             : undefined,
          ironMg:         nMap[1089] != null ? Math.round(nMap[1089] * scale * 100) / 100 : undefined,
          vitaminDMcg:    nMap[1114] != null ? Math.round(nMap[1114] * scale * 10)  / 10  : undefined,
          vitaminCMg:     nMap[1162] != null ? Math.round(nMap[1162] * scale * 10)  / 10  : undefined,
        } as NutritionFacts;
      });
  } catch {
    return [];
  }
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Open Food Facts — legacy CGI text search (kept for barcode-adjacent lookups) ──
export async function searchFoodByName(query: string, limit = 20): Promise<NutritionFacts[]> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encoded}&search_simple=1&action=process&json=1&page_size=${limit}&fields=product_name,brands,serving_size,nutriments,code`,
      { headers: { "User-Agent": "FitCore/1.0" } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    const products = (data.products || []) as any[];
    return mapOFFProducts(products);
  } catch {
    return [];
  }
}

// ── Open Food Facts — Meilisearch full-text search ────────────────────────────
// Uses OFF's faster, higher-quality search index at search.openfoodfacts.org.
// Returns products with complete nutrition data (calories, protein, carbs, fat),
// including fiber, sodium, and sugar when available.
// Called for every query (not just thin-cache fallback) so OFF supplements
// any gaps left by USDA / FatSecret.
export async function searchOFF(query: string, limit = 20): Promise<NutritionFacts[]> {
  try {
    const res = await fetchWithTimeout(
      `https://search.openfoodfacts.org/search` +
      `?q=${encodeURIComponent(query)}&page_size=${limit}` +
      `&fields=product_name,brands,serving_size,nutriments,code`,
      { headers: { "User-Agent": "FitCore/1.0 (fitness tracker)" } },
      8000
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    // Meilisearch returns { hits: [...] } vs CGI's { products: [...] }
    const products = (data.hits || []) as any[];
    return mapOFFProducts(products);
  } catch {
    return [];
  }
}

/** Shared OFF product → NutritionFacts mapper (works for both CGI and Meilisearch). */
function mapOFFProducts(products: any[]): NutritionFacts[] {
  return products
    .filter((p: any) => p.product_name && (p.nutriments?.["energy-kcal_100g"] || p.nutriments?.["energy-kcal_serving"]))
    .map((p: any): NutritionFacts | null => {
      const n = p.nutriments || {};
      const servingG   = parseServingSize(p.serving_size) || 100;
      const hasServing = !!p.serving_size;
      // scale=1 when the product has a serving size (use _serving keys directly);
      // scale=servingG/100 when we only have per-100g values.
      const scale = hasServing ? 1 : servingG / 100;

      const cals = extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale);
      if (!cals || cals <= 0) return null; // skip zero-calorie or missing entries

      return {
        name:          p.product_name,
        brand:         p.brands || undefined,
        barcode:       p.code   || undefined,
        servingSizeG:  servingG,
        servingUnit:   p.serving_size || "100g",
        calories:      Math.round(cals),
        proteinG:      extractNutrient(n, "proteins",      "proteins_serving",      scale) ?? 0,
        carbsG:        extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
        fatG:          extractNutrient(n, "fat",           "fat_serving",           scale) ?? 0,
        fiberG:        extractNutrient(n, "fiber",         "fiber_serving",         scale),
        sodiumMg:      extractOFFSodium(n, scale),
        sugarG:        extractNutrient(n, "sugars",        "sugars_serving",        scale),
        saturatedFatG: extractNutrient(n, "saturated-fat", "saturated-fat_serving", scale),
        transFatG:     extractNutrient(n, "trans-fat",     "trans-fat_serving",     scale),
        cholesterolMg: extractOFFCholesterol(n, scale),
        potassiumMg:   extractOFFMineral(n, "potassium", scale),
        calciumMg:     extractOFFMineral(n, "calcium",   scale),
        ironMg:        extractOFFMineral(n, "iron",      scale),
        vitaminDMcg:   extractOFFVitamin(n, "vitamin-d", scale),
        vitaminCMg:    extractOFFVitamin(n, "vitamin-c", scale),
      };
    })
    .filter((x): x is NutritionFacts => x !== null);
}

// ── Nutrition enrichment ───────────────────────────────────────────────────────
// Called when a cached food item is missing any optional nutrition fields.
// Tries OFF barcode lookup first (exact match), then Meilisearch text search.
// Returns only the fields that were missing so the caller can merge safely.

export type NutritionPatch = Partial<Pick<NutritionFacts,
  "fiberG" | "sodiumMg" | "sugarG" |
  "saturatedFatG" | "transFatG" | "cholesterolMg" |
  "potassiumMg" | "calciumMg" | "ironMg" |
  "vitaminDMcg" | "vitaminCMg"
>>;

const ENRICHABLE_FIELDS = [
  "fiberG", "sodiumMg", "sugarG",
  "saturatedFatG", "transFatG", "cholesterolMg",
  "potassiumMg", "calciumMg", "ironMg",
  "vitaminDMcg", "vitaminCMg",
] as const;

/**
 * Attempt to fill all missing optional nutrition fields for a cached food item.
 *
 * Strategy:
 *   1. If the item has a barcode → exact OFF barcode lookup (authoritative)
 *   2. Meilisearch text search with "name brand" — pick the hit whose name
 *      is most similar to the cached name (≥ 60% word overlap)
 *
 * Returns a (possibly empty) patch object; caller decides whether to persist.
 */
export async function enrichMissingNutrition(item: {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  servingSizeG?: number | null;
} & Partial<Record<typeof ENRICHABLE_FIELDS[number], number | null>>): Promise<NutritionPatch> {
  // Check if anything is actually missing
  const missing = ENRICHABLE_FIELDS.filter(f => item[f] == null);
  if (missing.length === 0) return {};

  let donor: NutritionFacts | null = null;

  // ① Barcode lookup — most reliable (exact product match)
  if (item.barcode) {
    donor = await lookupBarcode(item.barcode);
  }

  // ② Text search — find the best-matching OFF product by name + brand
  if (!donor) {
    const query = [item.name, item.brand].filter(Boolean).join(" ");
    const hits  = await searchOFF(query, 15);
    if (hits.length) {
      // Include BOTH name and brand words so "Vanilla Iced Coffee" + brand "Chick-fil-A"
      // correctly matches "Chick-Fil-A, Cold Brew Iced Coffee, Vanilla, Large" from OFF.
      // Without brand, overlap = 3/8 = 37% (fails). With brand = 5/8 = 62% (passes).
      const toWords = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      const itemWords = new Set([
        ...toWords(item.name),
        ...toWords(item.brand ?? ""),
      ]);

      let bestScore = 0;
      for (const h of hits) {
        // Compare against OFF hit name + brand combined
        const hWords = new Set([
          ...toWords(h.name),
          ...toWords(h.brand ?? ""),
        ]);
        let common = 0;
        for (const w of itemWords) if (hWords.has(w)) common++;
        const score = itemWords.size ? common / Math.max(itemWords.size, hWords.size) : 0;
        if (score > bestScore) { bestScore = score; donor = h; }
      }
      // Require ≥50% word overlap (relaxed slightly from 60% since brand words
      // are now included on both sides, making the denominator larger)
      if (bestScore < 0.5) donor = null;
    }
  }

  if (!donor) return {};

  // If the donor's serving size doesn't match our item's (e.g. OFF returned per-100g
  // values and our item has a real serving like 360g), rescale the donor's nutrient
  // values so they correspond to our item's serving size before patching.
  let scaledDonor = donor;
  if (
    item.servingSizeG &&
    donor.servingSizeG &&
    Math.abs(donor.servingSizeG - item.servingSizeG) / item.servingSizeG > 0.15
  ) {
    const ratio = item.servingSizeG / donor.servingSizeG;
    const rescale = (v: number | undefined) => v != null ? Math.round(v * ratio * 10) / 10 : undefined;
    scaledDonor = {
      ...donor,
      fiberG:        rescale(donor.fiberG),
      sodiumMg:      donor.sodiumMg != null ? Math.round(donor.sodiumMg * ratio) : undefined,
      sugarG:        rescale(donor.sugarG),
      saturatedFatG: rescale(donor.saturatedFatG),
      transFatG:     rescale(donor.transFatG),
      cholesterolMg: donor.cholesterolMg != null ? Math.round(donor.cholesterolMg * ratio) : undefined,
      potassiumMg:   donor.potassiumMg   != null ? Math.round(donor.potassiumMg   * ratio) : undefined,
      calciumMg:     donor.calciumMg     != null ? Math.round(donor.calciumMg     * ratio) : undefined,
      ironMg:        rescale(donor.ironMg),
      vitaminDMcg:   rescale(donor.vitaminDMcg),
      vitaminCMg:    rescale(donor.vitaminCMg),
    };
  }

  // Build patch: only fill fields that were null in the cached item
  const patch: NutritionPatch = {};
  for (const f of missing) {
    const val = (scaledDonor as any)[f];
    if (val != null) (patch as any)[f] = val;
  }
  return patch;
}
