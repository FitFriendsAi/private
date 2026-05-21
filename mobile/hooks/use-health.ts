/**
 * use-health.ts
 *
 * Wraps react-native-health (Apple HealthKit) for iOS step & heart-rate data.
 * On Android / Web the hook returns `available: false` and the UI falls back
 * to showing a "Connect" prompt.
 *
 * react-native-health is already in the Expo plugin config (app.json), so no
 * extra native build changes are needed.
 */

import { useState, useEffect, useCallback } from "react";
import { Platform } from "react-native";

export type DailySteps = {
  date: string; // YYYY-MM-DD
  steps: number;
};

export type HealthState = {
  /** Whether HealthKit is available on this device */
  available: boolean;
  /** Whether the user has granted step permission */
  authorized: boolean;
  /** Step count for today (null = not yet loaded) */
  todaySteps: number | null;
  /** Step counts for the last 7 days, oldest-first */
  weekSteps: DailySteps[];
  /** Call this to trigger the HealthKit permission dialog */
  authorize: () => void;
  /** Manually re-fetch step data */
  refresh: () => void;
};

// ── Only import the native module on iOS to avoid bundler errors on web ──────
function getAppleHealthKit() {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-health");
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

const STEP_PERMISSIONS = {
  permissions: {
    read: ["StepCount"],
    write: [] as string[],
  },
};

export function useHealth(): HealthState {
  const [available,   setAvailable]   = useState(false);
  const [authorized,  setAuthorized]  = useState(false);
  const [todaySteps,  setTodaySteps]  = useState<number | null>(null);
  const [weekSteps,   setWeekSteps]   = useState<DailySteps[]>([]);

  const AHK = getAppleHealthKit();

  // ── Fetch today + 7-day history ──────────────────────────────────────────
  const fetchSteps = useCallback(() => {
    if (!AHK) return;

    const now     = new Date();
    const todayISO = now.toISOString();

    // Today's cumulative steps
    AHK.getStepCount({ date: todayISO }, (err: any, result: any) => {
      if (!err && result != null) {
        setTodaySteps(Math.round(result.value ?? 0));
      }
    });

    // Last 7 days (daily buckets)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    AHK.getDailyStepCountSamples(
      { startDate: weekAgo.toISOString(), endDate: todayISO },
      (err: any, results: any[]) => {
        if (!err && Array.isArray(results)) {
          const days: DailySteps[] = results.map((r: any) => ({
            date:  (r.startDate as string).slice(0, 10),
            steps: Math.round(r.value ?? 0),
          }));
          setWeekSteps(days);
        }
      }
    );
  }, [AHK]);

  // ── Request permission + fetch on success ────────────────────────────────
  const authorize = useCallback(() => {
    if (!AHK) return;
    AHK.initHealthKit(STEP_PERMISSIONS, (err: any) => {
      if (err) {
        console.warn("[HealthKit] Permission denied or unavailable:", err);
        return;
      }
      setAuthorized(true);
      fetchSteps();
    });
  }, [AHK, fetchSteps]);

  // ── On mount: check if HealthKit is available, try silent init ───────────
  useEffect(() => {
    if (!AHK) {
      setAvailable(false);
      return;
    }
    setAvailable(true);

    // initHealthKit is idempotent — if already authorized it resolves instantly
    AHK.initHealthKit(STEP_PERMISSIONS, (err: any) => {
      if (!err) {
        setAuthorized(true);
        fetchSteps();
      }
      // If err, user hasn't granted permission yet — wait for authorize() call
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    available,
    authorized,
    todaySteps,
    weekSteps,
    authorize,
    refresh: fetchSteps,
  };
}
