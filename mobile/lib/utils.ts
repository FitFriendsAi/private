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
