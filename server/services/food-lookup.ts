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
      proteinG: extractNutrient(n, "proteins", "proteins_serving", scale) ?? 0,
      carbsG: extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
      fatG: extractNutrient(n, "fat", "fat_serving", scale) ?? 0,
      fiberG: extractNutrient(n, "fiber", "fiber_serving", scale) ?? undefined,
      sodiumMg: extractNutrient(n, "sodium", "sodium_serving", scale) !== undefined
        ? (extractNutrient(n, "sodium", "sodium_serving", scale)! * 1000)
        : undefined,
      sugarG: extractNutrient(n, "sugars", "sugars_serving", scale) ?? undefined,
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
  if (n[per100Key] !== undefined) return Math.round(n[per100Key] * scale * 10) / 10;
  return undefined;
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

// ── FatSecret ─────────────────────────────────────────────────────────────────
// Comprehensive food + restaurant database. Free tier at platform.fatsecret.com
// OAuth 2.0 client credentials — token cached in memory, auto-refreshed.
// NOTE: read from process.env at call time (not module init) so Render env vars
// are always available regardless of ESM bundle initialization order.

let _fsToken: string | null = null;
let _fsTokenExpiry = 0;

async function getFatSecretToken(): Promise<string | null> {
  const FS_CLIENT_ID     = process.env.FATSECRET_CLIENT_ID?.trim();
  const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET?.trim();
  console.log(`[FatSecret] credentials check: id=${FS_CLIENT_ID ? "SET(" + FS_CLIENT_ID.slice(0,6) + "...)" : "MISSING"} secret=${FS_CLIENT_SECRET ? "SET" : "MISSING"}`);
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
      body: "grant_type=client_credentials&scope=basic",
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
    console.log(`[FatSecret] token acquired, expires in ${data.expires_in}s`);
    return _fsToken;
  } catch (err: any) {
    console.error("[FatSecret] token fetch threw:", err?.message ?? err);
    return null;
  }
}

export async function searchFatSecret(query: string, limit = 25): Promise<NutritionFacts[]> {
  const token = await getFatSecretToken();
  if (!token) return [];
  try {
    const url = `https://platform.fatsecret.com/rest/server.api` +
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
    const foods = Array.isArray(raw) ? raw : [raw];

    return foods
      .filter((f: any) => f.food_description)
      .map((f: any): NutritionFacts => {
        // food_description: "Per 1 burger (210g) - Calories: 563kcal | Fat: 33.00g | Carbs: 44.00g | Protein: 26.00g"
        const desc     = f.food_description as string;
        const calories = parseFloat(desc.match(/Calories:\s*([\d.]+)/i)?.[1] ?? "0");
        const fat      = parseFloat(desc.match(/Fat:\s*([\d.]+)/i)?.[1] ?? "0");
        const carbs    = parseFloat(desc.match(/Carbs:\s*([\d.]+)/i)?.[1] ?? "0");
        const protein  = parseFloat(desc.match(/Protein:\s*([\d.]+)/i)?.[1] ?? "0");
        const servingG = parseFloat(desc.match(/\(([\d.]+)g\)/i)?.[1] ?? "100");
        const servingLabel = desc.match(/^Per (.+?) -/i)?.[1] ?? "1 serving";
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
      });
  } catch {
    return [];
  }
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
          name:         p.product_name,
          brand:        p.brands,
          barcode:      p.code,
          servingSizeG: servingG,
          servingUnit:  p.serving_size || "100g",
          calories:  Math.round(extractNutrient(n, "energy-kcal", "energy-kcal_serving", scale) ?? 0),
          proteinG:  extractNutrient(n, "proteins",      "proteins_serving",      scale) ?? 0,
          carbsG:    extractNutrient(n, "carbohydrates", "carbohydrates_serving", scale) ?? 0,
          fatG:      extractNutrient(n, "fat",           "fat_serving",           scale) ?? 0,
          fiberG:    extractNutrient(n, "fiber",         "fiber_serving",         scale),
          sodiumMg:  extractNutrient(n, "sodium",        "sodium_serving",        scale) !== undefined
            ? extractNutrient(n, "sodium", "sodium_serving", scale)! * 1000 : undefined,
          sugarG:    extractNutrient(n, "sugars",        "sugars_serving",        scale),
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
          calories:  Math.round((nMap[1008] || 0) * scale),
          proteinG:  Math.round((nMap[1003] || 0) * scale * 10) / 10,
          carbsG:    Math.round((nMap[1005] || 0) * scale * 10) / 10,
          fatG:      Math.round((nMap[1004] || 0) * scale * 10) / 10,
          fiberG:    nMap[1079]  ? Math.round(nMap[1079]  * scale * 10) / 10 : undefined,
          sodiumMg:  nMap[1093]  ? Math.round(nMap[1093]  * scale)            : undefined,
          sugarG:    nMap[2000]  ? Math.round(nMap[2000]  * scale * 10) / 10  : undefined,
        } as NutritionFacts;
      });
  } catch {
    return [];
  }
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Open Food Facts ───────────────────────────────────────────────────────────
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
    return products
      .filter((p: any) => p.product_name && p.nutriments?.["energy-kcal_100g"])
      .map((p: any) => {
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
          sodiumMg: extractNutrient(n, "sodium", "sodium_serving", scale) !== undefined
            ? extractNutrient(n, "sodium", "sodium_serving", scale)! * 1000
            : undefined,
          sugarG: extractNutrient(n, "sugars", "sugars_serving", scale),
        } as NutritionFacts;
      });
  } catch {
    return [];
  }
}
