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
}): MacroTargets {
  const { weightKg, heightCm, ageYears, sex, activityLevel, goalType, targetWeightKg, deadlineDays } = params;

  const bmr = calculateBMR(weightKg, heightCm, ageYears, sex);
  const tdee = calculateTDEE(bmr, activityLevel);

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
