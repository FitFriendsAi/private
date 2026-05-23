// Shared chart utilities used by ExpandCardModal instances

export const DAY_NAMES  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export interface ChartBar {
  value: number;
  label: string;
  showLabel: boolean;
  isToday: boolean;
}

/** Zero-fills missing days (7/30) or aggregates into weekly averages (90). */
export function buildChartBars(
  rawData: { date: string; value: number }[],
  period: 7 | 30 | 90,
): ChartBar[] {
  const byDate: Record<string, number> = {};
  rawData.forEach(d => { byDate[d.date] = d.value; });

  if (period === 90) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 89);
    const weeks: ChartBar[] = [];
    let weekTotal = 0, weekDays = 0, weekFirst: Date | null = null;
    let prevMonth = -1;
    for (let i = 0; i < 90; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      if (!weekFirst) weekFirst = d;
      const ds = localDateStr(d);
      weekTotal += byDate[ds] ?? 0;
      weekDays++;
      if (weekDays === 7 || i === 89) {
        const month = (weekFirst as Date).getMonth();
        weeks.push({
          value: weekDays > 0 ? weekTotal / weekDays : 0,
          label: MONTH_ABBR[month],
          showLabel: month !== prevMonth,
          isToday: false,
        });
        prevMonth = month;
        weekTotal = 0; weekDays = 0; weekFirst = null;
      }
    }
    return weeks;
  }

  const today = new Date();
  return Array.from({ length: period }, (_, idx) => {
    const offset = period - 1 - idx;
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const ds = localDateStr(d);
    const isToday = offset === 0;
    let label = "", showLabel = false;
    if (period === 7) {
      label = DAY_NAMES[d.getDay()];
      showLabel = true;
    } else {
      label = String(d.getDate());
      showLabel = idx % 5 === 0 || idx === period - 1;
    }
    return { value: byDate[ds] ?? 0, label, showLabel, isToday };
  });
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
