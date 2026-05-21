import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface MacroRingProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  color: string;
}

export function MacroRing({ label, current, target, unit, color }: MacroRingProps) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const remaining = 100 - pct;

  const data = [
    { value: pct },
    { value: remaining },
  ];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={28} outerRadius={36} startAngle={90} endAngle={-270} dataKey="value" strokeWidth={0}>
              <Cell fill={color} />
              <Cell fill="hsl(var(--secondary))" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold">{Math.round(pct)}%</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold">{Math.round(current)}<span className="text-xs text-muted-foreground">/{Math.round(target)}{unit}</span></div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
