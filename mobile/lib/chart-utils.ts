// Shared chart utilities used by ExpandCardModal instances

export const DAY_NAMES  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export interface ChartBar {
  value: number;
  /** Optional raw value used in tooltip when bar is range-normalized (e.g. body weight). */
  tooltipValue?: number;
  label: string;
  showLabel: boolean;
  isToday: boolean;
}

/**
 * Build chart bars from raw data.
 *
 * - period 7/30: zero-fills every day in the window.
 * - period 90 (default): groups into weekly averages (13 bars).
 * - period 90 + rawPoints: returns only actual data points within the window,
 *   no zero-fill or averaging. Ideal for sparse data like body weight.
 */
export function buildChartBars(
  rawData: { date: string; value: number }[],
  period: 7 | 30 | 90,
  options?: { rawPoints?: boolean },
): ChartBar[] {
  const byDate: Record<string, number> = {};
  rawData.forEach(d => { byDate[d.date] = d.value; });

  // ── Raw-points mode (90 days, actual entries only, no averaging) ──
  if (period === 90 && options?.rawPoints) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 89);
    const cutoffStr = localDateStr(cutoff);
    const todayStr  = localDateStr(new Date());
    let prevMonth   = -1;
    return rawData
      .filter(d => d.date >= cutoffStr && d.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const date    = new Date(d.date + "T12:00:00");
        const month   = date.getMonth();
        const showLabel = month !== prevMonth;
        if (showLabel) prevMonth = month;
        return {
          value:        d.value,
          tooltipValue: d.value,
          label:        MONTH_ABBR[month],
          showLabel,
          isToday: d.date === todayStr,
        };
      });
  }

  // ── Weekly-average mode (90 days, default) ──
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
