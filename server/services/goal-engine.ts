// TDEE & macro target calculation engine

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Sex = "male" | "female" | "other";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Mifflin-St Jeor BMR
export function calculateBMR(weightKg: number, heightCm: number, ageYears: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

export function calculateTDEE(bmr: number, activityLevel: ActivityLevel): number {
  return Math.round(bmr * ACTIVITY_MULTIPLIERS[activityLevel]);
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
}

export function calculateMacroTargets(params: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goalType: "weight_loss" | "weight_gain" | "maintain" | "strength" | "body_comp";
  targetWeightKg?: number;
  deadlineDays?: number;
  /** Measured maintenance calories from adaptive TDEE. When provided (> 0) this
   *  replaces the Mifflin-St Jeor formula estimate so targets reflect the user's
   *  real metabolism + activity rather than a textbook approximation. */
  overrideTdee?: number;
}): MacroTargets {
  const { weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays, overrideTdee } = params;

  const bmr = calculateBMR(weightKg, heightCm, ageYears, sex);
  const tdee = overrideTdee && overrideTdee > 0 ? Math.round(overrideTdee) : calculateTDEE(bmr, activityLevel);

  let calorieAdjustment = 0;
  let proteinMultiplier = 0.82; // g per lb bodyweight

  const weightLbs = weightKg * 2.20462;

  if (goalType === "weight_loss" && targetWeightKg && deadlineDays && deadlineDays > 0) {
    const deficitKg = weightKg - targetWeightKg;
    // 1 lb fat ≈ 3500 kcal, 1 kg ≈ 7700 kcal
    const totalDeficit = deficitKg * 7700;
    const dailyDeficit = totalDeficit / deadlineDays;
    calorieAdjustment = -Math.min(dailyDeficit, 1000); // cap at -1000/day
    proteinMultiplier = 0.82; // preserve muscle on cut
  } else if (goalType === "weight_gain" && targetWeightKg && deadlineDays && deadlineDays > 0) {
    const surplusKg = targetWeightKg - weightKg;
    const totalSurplus = surplusKg * 7700;
    const dailySurplus = totalSurplus / deadlineDays;
    calorieAdjustment = Math.min(dailySurplus, 500); // cap at +500/day
    proteinMultiplier = 0.9; // support muscle growth
  } else if (goalType === "strength") {
    calorieAdjustment = 200; // small surplus for strength
    proteinMultiplier = 1.0;
  }

  const calories = Math.round(Math.max(tdee + calorieAdjustment, 1200));
  const proteinG = Math.round(weightLbs * proteinMultiplier);
  const proteinCals = proteinG * 4;
  const fatCals = calories * 0.28;
  const fatG = Math.round(fatCals / 9);
  const carbCals = calories - proteinCals - fatCals;
  const carbsG = Math.max(Math.round(carbCals / 4), 50);

  // Water: 35ml per kg bodyweight, min 2000ml
  const waterMl = Math.max(Math.round(weightKg * 35), 2000);

  return { calories, proteinG, carbsG, fatG, waterMl };
}

export function getAgeFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ── Adaptive TDEE ───────────────────────────────────────────────────────────
// Back-solves real maintenance calories from logged intake + measured weight
// trend, instead of relying on the Mifflin-St Jeor formula. This is what makes
// targets self-correcting: if the formula under/over-estimates, actual weight
// change reveals the true expenditure.
//
//   energy balance:  Δweight/day (kg) = (intake − TDEE) / 7700
//   ⇒  TDEE = avgIntake − slopeKgPerDay × 7700

const KCAL_PER_KG = 7700; // ~7700 kcal per kg of body mass change

export interface AdaptiveTDEEResult {
  tdee: number;                 // measured maintenance calories
  avgIntake: number;            // mean logged calories over the window
  weightSlopeKgPerWeek: number; // negative = losing, positive = gaining
  loggedDays: number;           // # days with a real food log in the window
  weightSpanDays: number;       // days between first & last weigh-in used
  confidence: "low" | "medium" | "high";
}

/** Least-squares slope of y over x. Returns 0 when degenerate. */
function linregSlope(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

/**
 * Estimate maintenance calories from recent intake + weight data.
 * Returns null when there isn't enough quality data to trust the estimate
 * (caller should fall back to the formula TDEE).
 */
export function estimateAdaptiveTDEE(params: {
  intake: { date: string; calories: number }[];   // daily calorie totals
  weights: { date: string; weightKg: number }[];   // weigh-ins (any order)
  windowDays?: number;                             // default 21
}): AdaptiveTDEEResult | null {
  const windowDays = params.windowDays ?? 21;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Only count days the user actually logged a meaningful amount of food.
  // < 800 kcal almost always means a partial/forgotten day that would bias the mean low.
  const logged = params.intake.filter(d => d.date >= cutoffStr && d.calories >= 800);
  if (logged.length < 10) return null;

  const weights = params.weights
    .filter(w => w.date >= cutoffStr && w.weightKg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length < 2) return null;

  const firstDay = new Date(weights[0].date + "T00:00:00").getTime();
  const lastDay  = new Date(weights[weights.length - 1].date + "T00:00:00").getTime();
  const spanDays = Math.round((lastDay - firstDay) / 86400000);
  if (spanDays < 10) return null; // too short a span — slope is noise

  const avgIntake = logged.reduce((s, d) => s + d.calories, 0) / logged.length;

  // Regress weight (kg) against day-offset from the first weigh-in
  const slopePerDay = linregSlope(
    weights.map(w => ({
      x: (new Date(w.date + "T00:00:00").getTime() - firstDay) / 86400000,
      y: w.weightKg,
    })),
  );

  const tdee = Math.round(avgIntake - slopePerDay * KCAL_PER_KG);

  // Reject physiologically implausible results — usually a sign of bad/sparse data
  if (tdee < 1000 || tdee > 6000) return null;

  let confidence: AdaptiveTDEEResult["confidence"] = "low";
  if (logged.length >= 17 && weights.length >= 4 && spanDays >= 18) confidence = "high";
  else if (logged.length >= 13 && weights.length >= 3) confidence = "medium";

  return {
    tdee,
    avgIntake: Math.round(avgIntake),
    weightSlopeKgPerWeek: Math.round(slopePerDay * 7 * 100) / 100,
    loggedDays: logged.length,
    weightSpanDays: spanDays,
    confidence,
  };
}

// Project date to reach strength goal at current rate
export function projectStrengthGoalDate(
  currentMax: number,
  targetMax: number,
  weeklyGainRate: number // grams per week
): Date | null {
  if (weeklyGainRate <= 0 || currentMax >= targetMax) return null;
  const weeksNeeded = (targetMax - currentMax) / weeklyGainRate;
  const result = new Date();
  result.setDate(result.getDate() + Math.ceil(weeksNeeded * 7));
  return result;
}
