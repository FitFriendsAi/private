/**
 * MuscleHeatmap — anatomical front/back body figures with muscle regions
 * colored by training volume over the selected window (week / month / 90
 * days / year).
 *
 * Body rendering via react-native-body-highlighter (MIT), which ships
 * clean flat-region front/back SVGs — https://github.com/HichamELBSI/react-native-body-highlighter
 *
 * Data: GET /api/muscle-volume?days=7|30|90|365
 *   { days, muscles: { chest: { sets, volumeGrams, lastTrained }, ... } }
 *
 * Effective sets: primary muscle = 1 per set, secondary = 0.5 (server-side).
 * Fill intensity is scaled relative to the most-trained muscle in the current
 * window (see tierFill) rather than a fixed absolute threshold, so the
 * gradient stays meaningful regardless of the viewer's overall training volume.
 */
import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Body, { type ExtendedBodyPart, type Slug } from "react-native-body-highlighter";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { gramsToLbs } from "@/lib/utils";

const LIME = "#c8e84c";
const GHOST = "#2c2c2c";

// Our canonical heatmap regions (mirrors the server's REGIONS list)
type Region =
  | "chest" | "back" | "traps" | "shoulders" | "biceps" | "triceps"
  | "forearms" | "core" | "glutes" | "quads" | "hamstrings" | "calves";

const LABELS: Record<Region, string> = {
  chest: "Chest", back: "Back", traps: "Traps", shoulders: "Shoulders",
  biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", core: "Core",
  glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};

// Region → library slug(s). Slugs are split by front/back availability in the package.
const FRONT_SLUGS: Partial<Record<Region, Slug[]>> = {
  chest: ["chest"], traps: ["trapezius"], shoulders: ["deltoids"],
  biceps: ["biceps"], triceps: ["triceps"], forearms: ["forearm"],
  core: ["abs", "obliques"], quads: ["quadriceps"], calves: ["calves"],
};
const BACK_SLUGS: Partial<Record<Region, Slug[]>> = {
  back: ["upper-back", "lower-back"], traps: ["trapezius"], shoulders: ["deltoids"],
  triceps: ["triceps"], forearms: ["forearm"], glutes: ["gluteal"],
  hamstrings: ["hamstring"], calves: ["calves"],
};

// Reverse map: slug → region (for tap handling)
const SLUG_TO_REGION: Partial<Record<Slug, Region>> = {};
for (const [region, slugs] of Object.entries(FRONT_SLUGS) as [Region, Slug[]][]) {
  for (const s of slugs) SLUG_TO_REGION[s] = region;
}
for (const [region, slugs] of Object.entries(BACK_SLUGS) as [Region, Slug[]][]) {
  for (const s of slugs) SLUG_TO_REGION[s] = region;
}

type MuscleData = { sets: number; volumeGrams: number; lastTrained: string | null };

const DAY_OPTIONS = [7, 30, 90, 365] as const;
type DayOption = (typeof DAY_OPTIONS)[number];
const DAY_LABELS: Record<DayOption, string> = {
  7: "This Week", 30: "This Month", 90: "90 Days", 365: "This Year",
};
// Natural phrasing for "Not trained ___" — "this week"/"this month"/"this year"
// read fine bare, but "90 Days" needs "in the last" to not sound broken.
const NOT_TRAINED_PHRASE: Record<DayOption, string> = {
  7: "this week", 30: "this month", 90: "in the last 90 days", 365: "this year",
};

/**
 * Fill color scaled relative to whichever muscle got the most sets in the
 * current window, not a fixed absolute threshold — a fixed scale either maxes
 * everything out for a high-volume lifter or leaves everything dim for a
 * lower-volume one, in both cases hiding which muscles got relatively more
 * or less work (the whole point of the legend's gradient). Comparing against
 * the window's own max means the most-trained muscle is always the brightest
 * tier and the rest scale visibly beneath it.
 */
function tierFill(sets: number, maxSets: number): string {
  if (sets <= 0) return GHOST;
  const ratio = maxSets > 0 ? sets / maxSets : 0;
  if (ratio < 0.25) return LIME + "40";
  if (ratio < 0.5)  return LIME + "73";
  if (ratio < 0.75) return LIME + "B3";
  return LIME;
}

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T12:00:00").getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86_400_000));
}

function buildBodyData(
  slugMap: Partial<Record<Region, Slug[]>>,
  muscles: Record<Region, MuscleData> | undefined,
  maxSets: number,
  selected: Region | null,
): ExtendedBodyPart[] {
  const out: ExtendedBodyPart[] = [];
  for (const [region, slugs] of Object.entries(slugMap) as [Region, Slug[]][]) {
    const sets = muscles?.[region]?.sets ?? 0;
    const fill = tierFill(sets, maxSets);
    for (const slug of slugs) {
      out.push({
        slug,
        styles: {
          fill,
          stroke: selected === region ? "#ffffff" : "#00000000",
          strokeWidth: selected === region ? 2 : 0,
        },
      });
    }
  }
  return out;
}

// ── Main card content ──
export function MuscleHeatmap({ width }: { width: number }) {
  const { palette } = useTheme();
  const { text, muted, cardBorder: border } = palette;
  const [days, setDays] = useState<DayOption>(7);
  const [selected, setSelected] = useState<Region | null>(null);

  const { data, isLoading } = useQuery<{ days: number; muscles: Record<Region, MuscleData> }>({
    queryKey: [`/api/muscle-volume`, days],
    queryFn: () => apiRequest("GET", `/api/muscle-volume?days=${days}`),
  });

  const muscles = data?.muscles;
  const figScale = Math.min(1.5, Math.max(0.8, width / 460));
  const maxSets = muscles
    ? Math.max(0, ...(Object.keys(LABELS) as Region[]).map(r => muscles[r]?.sets ?? 0))
    : 0;

  // Neglected: 0 sets in window, sorted by longest-untrained first
  const neglected = muscles
    ? (Object.keys(LABELS) as Region[])
        .filter(r => (muscles[r]?.sets ?? 0) <= 0)
        .sort((a, b) => {
          const da = daysAgo(muscles[a]?.lastTrained ?? null) ?? 9999;
          const db = daysAgo(muscles[b]?.lastTrained ?? null) ?? 9999;
          return db - da;
        })
    : [];

  const sel = selected && muscles ? muscles[selected] : null;
  const selDaysAgo = sel ? daysAgo(sel.lastTrained) : null;

  const onPress = (part: ExtendedBodyPart) => {
    const region = SLUG_TO_REGION[part.slug as Slug];
    if (region) setSelected(prev => (prev === region ? null : region));
  };

  return (
    <View>
      {/* Period toggle */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {DAY_OPTIONS.map(d => {
          const active = days === d;
          return (
            <Pressable
              key={d}
              onPress={() => setDays(d)}
              style={{
                paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
                backgroundColor: active ? LIME : "transparent",
                borderWidth: 1, borderColor: active ? LIME : border,
              }}
            >
              <Text style={{
                fontFamily: "Manrope-Bold", fontSize: 11,
                color: active ? "#111" : muted,
              }}>
                {DAY_LABELS[d]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={{ height: 260, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={LIME} />
        </View>
      ) : (
        <>
          {/* Figures */}
          <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start" }}>
            <View style={{ alignItems: "center" }}>
              <Body
                data={buildBodyData(FRONT_SLUGS, muscles, maxSets, selected)}
                side="front"
                gender="male"
                scale={figScale}
                border="#3a3a3a"
                defaultFill={GHOST}
                onBodyPartPress={onPress}
              />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 1.5, marginTop: 2 }}>
                FRONT
              </Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Body
                data={buildBodyData(BACK_SLUGS, muscles, maxSets, selected)}
                side="back"
                gender="male"
                scale={figScale}
                border="#3a3a3a"
                defaultFill={GHOST}
                onBodyPartPress={onPress}
              />
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 10, color: muted, letterSpacing: 1.5, marginTop: 2 }}>
                BACK
              </Text>
            </View>
          </View>

          {/* Legend */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 12 }}>
            <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted, marginRight: 2 }}>Less</Text>
            {[GHOST, LIME + "40", LIME + "73", LIME + "B3", LIME].map((c, i) => (
              <View key={i} style={{ width: 16, height: 8, borderRadius: 2, backgroundColor: c }} />
            ))}
            <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted, marginLeft: 2 }}>More</Text>
          </View>

          {/* Selected muscle detail */}
          {selected && sel && (
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              marginTop: 12, paddingHorizontal: 12, paddingVertical: 9,
              borderRadius: 12, backgroundColor: "rgba(255,255,255,0.04)",
              borderWidth: 1, borderColor: border,
            }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 13, color: text }}>
                {LABELS[selected]}
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 12, color: LIME }}>
                  {sel.sets} sets
                </Text>
                {sel.volumeGrams > 0 && (
                  <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                    {Math.round(gramsToLbs(sel.volumeGrams)).toLocaleString()} lbs
                  </Text>
                )}
                <Text style={{ fontFamily: "Manrope", fontSize: 12, color: muted }}>
                  {selDaysAgo === null ? "never trained"
                    : selDaysAgo === 0 ? "trained today"
                    : `${selDaysAgo}d ago`}
                </Text>
              </View>
            </View>
          )}

          {/* Neglected muscles */}
          {neglected.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontFamily: "Manrope-Bold", fontSize: 11, color: muted, marginBottom: 6 }}>
                Not trained {NOT_TRAINED_PHRASE[days]}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {neglected.map(r => {
                  const ago = daysAgo(muscles![r]?.lastTrained ?? null);
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setSelected(prev => (prev === r ? null : r))}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 5,
                        paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10,
                        backgroundColor: "rgba(255,140,80,0.08)",
                        borderWidth: 1, borderColor: "rgba(255,140,80,0.25)",
                      }}
                    >
                      <Text style={{ fontFamily: "Manrope-SemiBold", fontSize: 11, color: "#ffab7a" }}>
                        {LABELS[r]}
                      </Text>
                      <Text style={{ fontFamily: "Manrope", fontSize: 10, color: muted }}>
                        {ago === null ? "never" : `${ago}d`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}
