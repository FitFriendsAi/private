/**
 * use-health.ts
 *
 * Full Apple HealthKit integration for FitCore (iOS only).
 * On Android / Web the hook returns stubs and write functions are no-ops.
 *
 * READS  → steps today, 7-day step history, today's active calories
 * WRITES → body weight, workouts, dietary nutrition (calories/macros), water
 * SYNC   → import historical weight samples (last 90 days)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Platform } from "react-native";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DailySteps = {
  date: string;   // YYYY-MM-DD
  steps: number;
};

export type WriteWorkoutOpts = {
  /** ISO date string when the workout started */
  startDate: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Estimated kcal burned (optional) */
  calories?: number;
};

export type WriteFoodOpts = {
  /** Display name saved to Health (e.g. "Breakfast") */
  mealName: string;
  mealType: "Breakfast" | "Lunch" | "Dinner" | "Snack";
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type HealthState = {
  /** HealthKit is available on this device */
  available: boolean;
  /** User has granted permissions */
  authorized: boolean;
  /** Steps counted today (null = not yet loaded) */
  todaySteps: number | null;
  /** Steps for the last 7 days, oldest-first */
  weekSteps: DailySteps[];
  /** Active (exercise) calories burned today */
  todayActiveCalories: number | null;
  /** Trigger the HealthKit permission dialog */
  authorize: () => void;
  /** Re-fetch all read data */
  refresh: () => void;
  /** Import weight samples from Health into FitCore (last 90 days) */
  syncWeightFromHealth: (
    onSample: (date: string, weightKg: number) => Promise<void>,
    onDone: (count: number) => void,
    onError: (msg: string) => void,
  ) => void;
  /** Write body weight to Health (kg) */
  writeWeight: (weightKg: number) => void;
  /** Write a completed workout to Health */
  writeWorkout: (opts: WriteWorkoutOpts) => void;
  /** Write a food / meal entry to Health */
  writeFood: (opts: WriteFoodOpts) => void;
  /** Write water intake to Health (litres) */
  writeWater: (litres: number) => void;
};

// ── Native module loader ──────────────────────────────────────────────────────

function getAHK(): any | null {
  if (Platform.OS !== "ios") return null;
  try {
    const mod = require("react-native-health");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// ── Permissions (requested once on authorize) ─────────────────────────────────

const READ_PERMS  = ["StepCount", "ActiveEnergyBurned", "HeartRate", "Weight"];
const WRITE_PERMS = [
  "Weight",
  "Workout",
  "ActiveEnergyBurned",
  "DietaryEnergyConsumed",
  "DietaryProtein",
  "DietaryCarbohydrates",
  "DietaryFatTotal",
  "DietaryWater",
];

function buildPermissions(AHK: any) {
  // react-native-health accepts either string names or Permissions constants
  return {
    permissions: {
      read:  READ_PERMS,
      write: WRITE_PERMS,
    },
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useHealth(): HealthState {
  const [available,           setAvailable]           = useState(false);
  const [authorized,          setAuthorized]          = useState(false);
  const [todaySteps,          setTodaySteps]          = useState<number | null>(null);
  const [weekSteps,           setWeekSteps]           = useState<DailySteps[]>([]);
  const [todayActiveCalories, setTodayActiveCalories] = useState<number | null>(null);

  const AHK = useRef(getAHK()).current;

  // ── Fetch steps + active calories ──────────────────────────────────────────
  const fetchData = useCallback(() => {
    if (!AHK) return;

    const now      = new Date();
    const todayISO = now.toISOString();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // Today's cumulative steps
    AHK.getStepCount({ date: todayISO }, (err: any, result: any) => {
      if (!err && result != null) setTodaySteps(Math.round(result.value ?? 0));
    });

    // Last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    AHK.getDailyStepCountSamples(
      { startDate: weekAgo.toISOString(), endDate: todayISO },
      (err: any, results: any[]) => {
        if (!err && Array.isArray(results)) {
          setWeekSteps(
            results.map((r: any) => ({
              date:  (r.startDate as string).slice(0, 10),
              steps: Math.round(r.value ?? 0),
            }))
          );
        }
      }
    );

    // Today's active (exercise) calories
    AHK.getActiveEnergyBurned(
      { startDate: startOfDay.toISOString(), endDate: todayISO },
      (err: any, results: any[]) => {
        if (!err && Array.isArray(results)) {
          const total = results.reduce((s: number, r: any) => s + (r.value ?? 0), 0);
          setTodayActiveCalories(Math.round(total));
        }
      }
    );
  }, [AHK]);

  // ── Request permissions ───────────────────────────────────────────────────
  const authorize = useCallback(() => {
    if (!AHK) return;
    AHK.initHealthKit(buildPermissions(AHK), (err: any) => {
      if (err) {
        console.warn("[HealthKit] Permission denied:", err);
        return;
      }
      setAuthorized(true);
      fetchData();
    });
  }, [AHK, fetchData]);

  // ── Silent init on mount (resolves instantly if already authorized) ────────
  useEffect(() => {
    if (!AHK) { setAvailable(false); return; }
    setAvailable(true);
    AHK.initHealthKit(buildPermissions(AHK), (err: any) => {
      if (!err) {
        setAuthorized(true);
        fetchData();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync historical weight from Health → FitCore ──────────────────────────
  const syncWeightFromHealth = useCallback(
    (
      onSample: (date: string, weightKg: number) => Promise<void>,
      onDone:   (count: number) => void,
      onError:  (msg: string)  => void,
    ) => {
      if (!AHK) { onError("HealthKit not available"); return; }
      const end   = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 90);
      AHK.getWeightSamples(
        { startDate: start.toISOString(), endDate: end.toISOString(), unit: "kilogram", limit: 500, ascending: true },
        async (err: any, results: any[]) => {
          if (err || !results?.length) { onDone(0); return; }
          let count = 0;
          for (const r of results) {
            try {
              await onSample(
                new Date(r.startDate).toISOString().slice(0, 10),
                r.value, // kg
              );
              count++;
            } catch {}
          }
          onDone(count);
        }
      );
    },
    [AHK]
  );

  // ── Write: body weight (kg) ───────────────────────────────────────────────
  const writeWeight = useCallback((weightKg: number) => {
    if (!AHK || !authorized) return;
    AHK.saveWeight(
      { value: weightKg * 2.20462, unit: "pound" }, // react-native-health default unit is lbs
      (err: any) => { if (err) console.warn("[HealthKit] saveWeight error:", err); }
    );
  }, [AHK, authorized]);

  // ── Write: completed workout ──────────────────────────────────────────────
  const writeWorkout = useCallback((opts: WriteWorkoutOpts) => {
    if (!AHK || !authorized) return;
    try {
      const start   = new Date(opts.startDate);
      const end     = new Date(start.getTime() + opts.durationMinutes * 60_000);
      const ActType = AHK.Constants?.Activities?.TraditionalStrengthTraining ?? 50;
      AHK.saveWorkout(
        {
          type:              ActType,
          startDate:         start.toISOString(),
          endDate:           end.toISOString(),
          duration:          opts.durationMinutes * 60,
          energyBurned:      opts.calories ?? 0,
          energyBurnedUnit:  "calorie",
          totalDistance:     0,
          totalDistanceUnit: "meter",
        },
        (err: any) => { if (err) console.warn("[HealthKit] saveWorkout error:", err); }
      );
    } catch (e) {
      console.warn("[HealthKit] saveWorkout exception:", e);
    }
  }, [AHK, authorized]);

  // ── Write: food / meal ────────────────────────────────────────────────────
  const writeFood = useCallback((opts: WriteFoodOpts) => {
    if (!AHK || !authorized) return;
    try {
      AHK.saveFood(
        {
          foodName:          opts.mealName,
          mealType:          opts.mealType,
          servings:          1,
          calories:          opts.calories,
          protein:           opts.proteinG,
          totalCarbohydrate: opts.carbsG,
          totalFat:          opts.fatG,
        },
        (err: any) => { if (err) console.warn("[HealthKit] saveFood error:", err); }
      );
    } catch (e) {
      console.warn("[HealthKit] saveFood exception:", e);
    }
  }, [AHK, authorized]);

  // ── Write: water (litres) ─────────────────────────────────────────────────
  const writeWater = useCallback((litres: number) => {
    if (!AHK || !authorized) return;
    try {
      AHK.saveWater(
        { amount: litres, unit: "liter" },
        (err: any) => { if (err) console.warn("[HealthKit] saveWater error:", err); }
      );
    } catch (e) {
      console.warn("[HealthKit] saveWater exception:", e);
    }
  }, [AHK, authorized]);

  return {
    available,
    authorized,
    todaySteps,
    weekSteps,
    todayActiveCalories,
    authorize,
    refresh: fetchData,
    syncWeightFromHealth,
    writeWeight,
    writeWorkout,
    writeFood,
    writeWater,
  };
}
