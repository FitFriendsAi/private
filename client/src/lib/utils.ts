import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function gramsToLbs(g: number): number {
  return Math.round((g / 453.592) * 10) / 10;
}

export function lbsToGrams(lbs: number): number {
  return Math.round(lbs * 453.592);
}

export function gramsToKg(g: number): number {
  return Math.round((g / 1000) * 10) / 10;
}

export function kgToGrams(kg: number): number {
  return kg * 1000;
}

export function mlToOz(ml: number): number {
  return Math.round((ml / 29.5735) * 10) / 10;
}

export function ozToMl(oz: number): number {
  return Math.round(oz * 29.5735);
}

export function formatWeight(grams: number, unit: "lbs" | "kg" = "lbs"): string {
  if (unit === "kg") return `${gramsToKg(grams)} kg`;
  return `${gramsToLbs(grams)} lbs`;
}

export function formatVolume(ml: number, unit: "oz" | "ml" = "oz"): string {
  if (unit === "ml") return `${ml} ml`;
  return `${mlToOz(ml)} oz`;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export function pct(current: number, target: number): number {
  if (target === 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}
