interface CircleRingProps {
  number?: number | string;
  size?: number;
  progress?: number; // 0–1
  strokeWidth?: number;
  color?: string;
}

export function CircleRing({
  number,
  size = 72,
  progress = 0,
  strokeWidth = 5,
  color = "hsl(var(--primary))",
}: CircleRingProps) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * Math.min(Math.max(progress, 0), 1);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="hsl(var(--secondary))"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      {progress > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      {/* Center label */}
      {number !== undefined && (
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={size * 0.32}
          fontWeight="700"
          fontFamily="inherit"
        >
          {number}
        </text>
      )}
    </svg>
  );
}
