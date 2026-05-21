import { useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";

export interface Palette {
  id: string;
  label: string;
  accent: string;
  accentText: string; // text color on top of accent bg
  card: string;
  cardBorder: string;
  bg: string;
  text: string;
  muted: string;
  tabBar: string;
}

export const PALETTES: Palette[] = [
  {
    // "White" = dark theme with WHITE accent (matches web preview)
    id: "white",
    label: "White",
    accent: "#ffffff",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
  {
    id: "dark",
    label: "Dark",
    accent: "#c8e84c",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
  {
    id: "pink",
    label: "Pink",
    accent: "#f8c8dc",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
  {
    id: "blue",
    label: "Blue",
    accent: "#9bd1ff",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
  {
    id: "peach",
    label: "Peach",
    accent: "#ffb88c",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
  {
    id: "purple",
    label: "Purple",
    accent: "#d3a8ff",
    accentText: "#0a0a0a",
    card: "#1a1a1a",
    cardBorder: "#2a2a2a",
    bg: "#0a0a0a",
    text: "#f4f4f4",
    muted: "#888888",
    tabBar: "#111111",
  },
];

const STORAGE_KEY = "fitcore_palette";

export function useTheme() {
  const [paletteId, setPaletteId] = useState("white");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((id) => {
      if (id && PALETTES.find((p) => p.id === id)) setPaletteId(id);
    });
  }, []);

  const setTheme = useCallback(async (id: string) => {
    setPaletteId(id);
    await AsyncStorage.setItem(STORAGE_KEY, id);
  }, []);

  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
  const isWhite = paletteId === "white";

  return { palette, paletteId, setTheme, isWhite };
}
