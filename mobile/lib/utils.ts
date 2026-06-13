/** Returns today's date as YYYY-MM-DD in the device's local timezone. */
export function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function gramsToLbs(g: number): number {
  return Math.round((g / 453.592) * 10) / 10;
}

export function lbsToGrams(lbs: number): number {
  return Math.round(lbs * 453.592);
}

export function mlToOz(ml: number): number {
  return Math.round((ml / 29.5735) * 10) / 10;
}

export function ozToMl(oz: number): number {
  return Math.round(oz * 29.5735);
}

// ── Food measurement units ────────────────────────────────────────────────
// Lets users log a food by weight/volume (e.g. "8 oz of milk", "40 g cereal")
// instead of "servings". We convert the amount → grams, then divide by the
// item's per-serving gram weight to get the serving multiplier the log uses.
// Volume units approximate 1 ml ≈ 1 g (accurate for water/milk-like foods).
export const FOOD_UNITS = ["serving", "g", "oz", "lb", "ml", "fl oz", "cup", "tbsp", "tsp"] as const;
export type FoodUnit = typeof FOOD_UNITS[number];

const UNIT_GRAMS: Record<Exclude<FoodUnit, "serving">, number> = {
  g: 1,
  oz: 28.3495,       // weight ounce
  lb: 453.592,
  ml: 1,             // volume ≈ 1 g/ml
  "fl oz": 29.5735,
  cup: 236.588,
  tbsp: 14.7868,
  tsp: 4.92892,
};

/** Convert an amount in `unit` to the serving multiplier for an item whose one
 *  serving weighs `servingSizeG` grams. "serving" passes the amount through. */
export function unitToServings(amount: number, unit: FoodUnit, servingSizeG: number): number {
  if (!amount || amount <= 0) return 0;
  if (unit === "serving") return amount;
  if (!servingSizeG || servingSizeG <= 0) return amount;
  return (amount * UNIT_GRAMS[unit]) / servingSizeG;
}

/** True when the item has a real gram basis, so weight/volume units are meaningful.
 *  Manual "per serving" entries store servingSizeG = 1 and should stay servings-only. */
export function hasGramBasis(servingSizeG: number | null | undefined): boolean {
  return typeof servingSizeG === "number" && servingSizeG >= 2;
}

/** Pull an explicit gram weight from a serving description, e.g. "1 cup (240 g)" → 240.
 *  This is authoritative when present (it literally states the serving's weight). */
function explicitGrams(s?: string | null): number | null {
  if (!s) return null;
  const m = s.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/);
  const v = m ? parseFloat(m[1]) : NaN;
  return v > 0 ? v : null;
}

/** Parse a leading "amount + weight/volume unit" (e.g. "12 fl oz", "1 cup", "16 oz")
 *  into { amount, grams }. Volume units approximate 1 ml ≈ 1 g. Plain grams are
 *  handled separately by explicitGrams. */
function parseMeasure(s?: string | null): { amount: number; grams: number } | null {
  if (!s) return null;
  const m = s.toLowerCase().match(
    /(\d+(?:\.\d+)?)\s*(fl\s*oz|fluid ounces?|floz|ounces?|oz|pounds?|lbs?|lb|milliliters?|ml|liters?|litres?|cups?|tablespoons?|tbsp|teaspoons?|tsp)\b/,
  );
  if (!m) return null;
  const amount = parseFloat(m[1]);
  if (!(amount > 0)) return null;
  const u = m[2];
  let g: number;
  if (/^fl ?oz|fluid/.test(u))        g = 29.5735;
  else if (/^ounce|^oz/.test(u))      g = 28.3495;
  else if (/^pound|^lb/.test(u))      g = 453.592;
  else if (/^milliliter|^ml/.test(u)) g = 1;
  else if (/^liter|^litre/.test(u))   g = 1000;
  else if (/^cup/.test(u))            g = 236.588;
  else if (/^tablespoon|^tbsp/.test(u)) g = 14.7868;
  else if (/^teaspoon|^tsp/.test(u))    g = 4.92892;
  else return null;
  return { amount, grams: amount * g };
}

/** Contents of the first parenthetical containing a digit, e.g. "White Claw (12 oz)" → "12 oz". */
function nameParen(name?: string | null): string | null {
  const m = name ? name.match(/\(([^)]*\d[^)]*)\)/) : null;
  return m ? m[1] : null;
}

/**
 * Best-effort grams in one serving — used for weight/volume unit conversions.
 *
 * `servingSizeG` from search/restaurant sources is frequently wrong: a drink
 * whose serving is "12 oz" often gets stored as servingSizeG = 12 (the unit was
 * dropped). This reconciles the stored value against the serving description and
 * the product name:
 *   ① an explicit gram weight in the serving unit ("(240 g)") is authoritative;
 *   ② otherwise, if the stored value equals the bare number of a declared
 *      weight/volume measure ("12 oz" → stored 12) while the real weight is much
 *      larger, treat it as a dropped-unit bug and use the measure (12 oz → 340 g);
 *   ③ otherwise trust the stored value.
 */
export function resolveServingGrams(
  servingSizeG: number | null | undefined,
  servingUnit?: string | null,
  name?: string | null,
): number {
  const stored = typeof servingSizeG === "number" && servingSizeG > 0 ? servingSizeG : 0;

  // ① Authoritative explicit grams in the serving description.
  const exG = explicitGrams(servingUnit);
  if (exG) return exG;

  // ② Dropped-unit repair (precise: only when stored ≈ the measure's bare number).
  const candidates = [parseMeasure(servingUnit), parseMeasure(nameParen(name))];
  if (stored) {
    for (const c of candidates) {
      if (c && Math.abs(c.amount - stored) / stored < 0.05 && c.grams / stored > 1.5) {
        return c.grams;
      }
    }
    return stored;
  }

  // ③ No usable stored value — fall back to any parsed measure.
  for (const c of candidates) if (c) return c.grams;
  return 0;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Returns dateStr shifted by `days` (can be negative), as YYYY-MM-DD. */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Current local time as a user-editable string, e.g. "8:42 AM". */
export function nowTimeStr(): string {
  const now = new Date();
  const h   = now.getHours() % 12 || 12;
  const m   = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${now.getHours() < 12 ? "AM" : "PM"}`;
}

/** Convert a "H:MM AM/PM" string to a full ISO timestamp on `dateStr` (defaults to today). */
export function timeStrToISO(t: string, dateStr?: string): string {
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (!match) return d.toISOString();
  let h   = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ap = (match[3] ?? "").toUpperCase();
  if (ap === "PM" && h < 12)  h += 12;
  if (ap === "AM" && h === 12) h = 0;
  d.setHours(Math.min(h, 23), Math.min(m, 59), 0, 0);
  return d.toISOString();
}

/** Format an ISO timestamp (or Date-like string) to "8:42 AM". */
export function fmtTime(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
