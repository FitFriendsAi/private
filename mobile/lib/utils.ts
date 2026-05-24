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

/** Current local time as a user-editable string, e.g. "8:42 AM". */
export function nowTimeStr(): string {
  const now = new Date();
  const h   = now.getHours() % 12 || 12;
  const m   = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${now.getHours() < 12 ? "AM" : "PM"}`;
}

/** Convert a "H:MM AM/PM" string to a full ISO timestamp (today's date). */
export function timeStrToISO(t: string): string {
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return new Date().toISOString();
  let h   = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ap = (match[3] ?? "").toUpperCase();
  if (ap === "PM" && h < 12)  h += 12;
  if (ap === "AM" && h === 12) h = 0;
  const d = new Date();
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
