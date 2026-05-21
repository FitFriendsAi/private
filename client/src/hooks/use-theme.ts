import { useState, useEffect, useCallback } from "react";

export const PALETTES = [
  { id: "white",  name: "White",  accent: "#ffffff", lime: "#c8e84c" },
  { id: "pink",   name: "Pink",   accent: "#f8c8dc", lime: "#c8e84c" },
  { id: "blue",   name: "Blue",   accent: "#9bd1ff", lime: "#c8e84c" },
  { id: "purple", name: "Purple", accent: "#d3a8ff", lime: "#c8e84c" },
  { id: "orange", name: "Orange", accent: "#ffb88c", lime: "#c8e84c" },
  { id: "lime",   name: "Lime",   accent: "#c8e84c", lime: "#f8c8dc" },
] as const;

export type PaletteId = typeof PALETTES[number]["id"];

const STORAGE_KEY = "fitcore-accent";
const DEFAULT: PaletteId = "white";

function applyPalette(id: PaletteId) {
  const p = PALETTES.find(p => p.id === id) ?? PALETTES[0];
  const root = document.documentElement;
  root.style.setProperty("--pink", p.accent);
  root.style.setProperty("--lime", p.lime);
  // Mirror into --primary (HSL) for Tailwind/shadcn components
  // We convert hex → approximate HSL string for the primary token
  root.style.setProperty("--primary", hexToHsl(p.accent));
  root.style.setProperty("--ring", hexToHsl(p.accent));
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function useTheme() {
  const [paletteId, setPaletteId] = useState<PaletteId>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as PaletteId | null;
    return stored && PALETTES.some(p => p.id === stored) ? stored : DEFAULT;
  });

  useEffect(() => {
    applyPalette(paletteId);
  }, [paletteId]);

  const setAccent = useCallback((id: PaletteId) => {
    setPaletteId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return { paletteId, setAccent, palettes: PALETTES };
}

// Call once at app startup before first render (no flicker)
export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY) as PaletteId | null;
  const id = stored && PALETTES.some(p => p.id === stored) ? stored : DEFAULT;
  applyPalette(id);
}
