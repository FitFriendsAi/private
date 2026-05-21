// Simplified abstract muscle diagram — front and back views

const FRONT_MUSCLES: Record<string, { d: string; type: "path" | "ellipse"; cx?: number; cy?: number; rx?: number; ry?: number }> = {
  // ─── Neck / traps (visible front) ────────────────────────────────────────────
  // ─── Chest ────────────────────────────────────────────────────────────────────
  chest: { type: "path", d: "M 38 52 Q 48 48 56 52 L 56 72 Q 48 76 38 72 Z M 56 52 Q 64 48 74 52 L 74 72 Q 64 76 56 72 Z" },
  // ─── Shoulders (front) ────────────────────────────────────────────────────────
  shoulders: { type: "path", d: "M 28 45 Q 22 52 26 62 Q 32 58 38 52 Z M 74 52 Q 86 58 86 62 Q 90 52 84 45 Z" },
  // ─── Biceps ───────────────────────────────────────────────────────────────────
  biceps: { type: "path", d: "M 22 64 Q 18 74 20 84 Q 26 80 30 72 Z M 80 72 Q 84 80 92 84 Q 94 74 90 64 Z" },
  // ─── Forearms (front) ─────────────────────────────────────────────────────────
  forearms: { type: "path", d: "M 18 86 Q 14 98 16 110 Q 22 106 24 96 Z M 84 96 Q 86 106 96 110 Q 98 98 94 86 Z" },
  // ─── Abs ──────────────────────────────────────────────────────────────────────
  abs: { type: "path", d: "M 42 74 L 58 74 L 58 118 L 42 118 Z" },
  // ─── Quads ────────────────────────────────────────────────────────────────────
  quads: { type: "path", d: "M 38 122 Q 34 148 36 168 Q 46 170 50 168 L 52 122 Z M 60 122 L 62 168 Q 66 170 76 168 Q 78 148 74 122 Z" },
  // ─── Calves (front) ───────────────────────────────────────────────────────────
  calves: { type: "path", d: "M 36 172 Q 34 192 36 210 Q 42 212 46 208 Q 48 190 46 172 Z M 66 172 Q 64 190 66 208 Q 70 212 76 210 Q 78 192 76 172 Z" },
};

const BACK_MUSCLES: Record<string, { d: string }> = {
  // ─── Traps ────────────────────────────────────────────────────────────────────
  traps: { d: "M 40 30 Q 56 22 72 30 Q 68 46 56 48 Q 44 46 40 30 Z" },
  // ─── Upper back (rhomboids / mid-traps) ────────────────────────────────────────
  upperBack: { d: "M 36 52 Q 56 48 76 52 L 74 72 Q 56 76 38 72 Z" },
  // ─── Lats ─────────────────────────────────────────────────────────────────────
  lats: { d: "M 26 58 Q 22 80 30 96 Q 40 90 38 72 Z M 86 72 Q 84 90 82 96 Q 90 80 86 58 Z" },
  // ─── Shoulders (back view) ────────────────────────────────────────────────────
  shoulders: { d: "M 28 42 Q 22 52 26 62 Q 32 58 36 52 Z M 76 52 Q 80 58 86 62 Q 90 52 84 42 Z" },
  // ─── Lower back ───────────────────────────────────────────────────────────────
  lowerBack: { d: "M 40 96 Q 56 92 72 96 L 70 118 Q 56 122 42 118 Z" },
  // ─── Glutes ───────────────────────────────────────────────────────────────────
  glutes: { d: "M 36 120 Q 34 136 40 142 Q 56 146 72 142 Q 78 136 76 120 Q 56 124 36 120 Z" },
  // ─── Hamstrings ───────────────────────────────────────────────────────────────
  hamstrings: { d: "M 38 144 Q 34 166 36 172 Q 46 174 50 170 L 52 144 Z M 60 144 L 62 170 Q 66 174 76 172 Q 78 166 74 144 Z" },
  // ─── Calves (back) ────────────────────────────────────────────────────────────
  calves: { d: "M 36 174 Q 34 194 36 212 Q 42 214 46 210 Q 48 192 46 174 Z M 66 174 Q 64 192 66 210 Q 70 214 76 212 Q 78 194 76 174 Z" },
  // ─── Triceps ─────────────────────────────────────────────────────────────────
  triceps: { d: "M 22 64 Q 18 76 20 86 Q 26 82 28 72 Z M 82 72 Q 86 82 92 86 Q 94 76 90 64 Z" },
};

// Body silhouette paths
const FRONT_SILHOUETTE = "M 56 6 Q 44 8 36 18 Q 28 28 28 38 Q 22 42 20 52 Q 18 66 24 80 Q 18 90 16 106 Q 14 122 18 136 Q 30 140 36 120 L 38 168 Q 40 186 38 210 Q 44 216 56 216 Q 68 216 74 210 Q 72 186 74 168 L 76 120 Q 82 140 94 136 Q 98 122 96 106 Q 94 90 88 80 Q 94 66 92 52 Q 90 42 84 38 Q 84 28 76 18 Q 68 8 56 6 Z";

const BACK_SILHOUETTE = "M 56 6 Q 44 8 36 18 Q 28 28 28 38 Q 22 42 20 52 Q 18 66 24 80 Q 18 90 16 106 Q 14 122 18 136 Q 30 140 36 120 L 38 168 Q 40 186 38 210 Q 44 216 56 216 Q 68 216 74 210 Q 72 186 74 168 L 76 120 Q 82 140 94 136 Q 98 122 96 106 Q 94 90 88 80 Q 94 66 92 52 Q 90 42 84 38 Q 84 28 76 18 Q 68 8 56 6 Z";

// Muscles that belong to the back view
const BACK_VIEW_MUSCLES = new Set(["traps", "lats", "upperBack", "lowerBack", "hamstrings", "glutes", "triceps"]);
const FRONT_VIEW_MUSCLES = new Set(["chest", "shoulders", "biceps", "forearms", "abs", "quads", "calves"]);

function pickView(primary: string[]): "front" | "back" {
  let frontScore = 0;
  let backScore = 0;
  for (const m of primary) {
    if (FRONT_VIEW_MUSCLES.has(m)) frontScore++;
    if (BACK_VIEW_MUSCLES.has(m)) backScore++;
  }
  return backScore > frontScore ? "back" : "front";
}

interface MuscleMapProps {
  primary: string[];
  secondary?: string[];
  size?: number;
  view?: "front" | "back" | "auto";
}

export function MuscleMap({ primary, secondary = [], size = 160, view = "auto" }: MuscleMapProps) {
  const resolvedView = view === "auto" ? pickView(primary) : view;
  const primarySet = new Set(primary.map(m => m.toLowerCase()));
  const secondarySet = new Set(secondary.map(m => m.toLowerCase()));

  const muscles = resolvedView === "front" ? FRONT_MUSCLES : BACK_MUSCLES;
  const silhouette = resolvedView === "front" ? FRONT_SILHOUETTE : BACK_SILHOUETTE;

  // SVG viewBox is 0 0 112 222
  const vbW = 112;
  const vbH = 222;

  return (
    <svg
      width={size}
      height={size * (vbH / vbW)}
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      {/* Body silhouette */}
      <path d={silhouette} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />

      {/* Muscle regions */}
      {Object.entries(muscles).map(([name, shape]) => {
        const isPrimary = primarySet.has(name);
        const isSecondary = secondarySet.has(name);
        const fill = isPrimary
          ? "rgba(255,255,255,0.85)"
          : isSecondary
          ? "rgba(255,255,255,0.3)"
          : "rgba(255,255,255,0.08)";

        return (
          <path
            key={name}
            data-muscle={name}
            d={shape.d}
            fill={fill}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="0.75"
          />
        );
      })}
    </svg>
  );
}
