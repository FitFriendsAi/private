export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
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

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
