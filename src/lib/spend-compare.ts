import { addMonths, format, isValid, parse, subMonths, subWeeks, subYears } from 'date-fns';
import { parseSpendWeekDate, rowSpendAmount } from './spend-week';

export type SpendCompareGrain = 'month' | 'quarter' | 'year' | 'week';

export type SpendPeriodOption = {
  id: string;
  label: string;
  sortKey: string;
};

export const COMPARE_GRAINS: { value: SpendCompareGrain; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'week', label: 'Week' },
];

export function monthQuarterKey(month: string): string | null {
  const d = parse(month, 'yyyy-MM', new Date());
  if (!isValid(d)) return null;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function formatMonthLabel(month: string): string {
  const d = parse(month, 'yyyy-MM', new Date());
  return isValid(d) ? format(d, 'MMM yyyy') : month;
}

export function formatYtdLabel(month: string): string {
  const d = parse(month, 'yyyy-MM', new Date());
  if (!isValid(d)) return month;
  return `Jan–${format(d, 'MMM yyyy')}`;
}

export function formatQuarterLabel(quarterId: string): string {
  return quarterId.replace('-', ' ');
}

export function formatWeekLabel(week: string): string {
  const d = parseSpendWeekDate(week);
  return d ? format(d, 'dd MMM yyyy') : week;
}

export function listPeriodOptions(
  grain: SpendCompareGrain,
  months: string[],
  weeks: string[]
): SpendPeriodOption[] {
  const uniqueMonths = Array.from(new Set(months.filter(Boolean))).sort();
  const uniqueWeeks = Array.from(new Set(weeks.filter(Boolean)));

  if (grain === 'month') {
    return uniqueMonths.map((id) => ({ id, label: formatMonthLabel(id), sortKey: id }));
  }
  if (grain === 'quarter') {
    const qs = new Set<string>();
    uniqueMonths.forEach((m) => {
      const q = monthQuarterKey(m);
      if (q) qs.add(q);
    });
    return Array.from(qs)
      .sort()
      .map((id) => ({ id, label: formatQuarterLabel(id), sortKey: id }));
  }
  if (grain === 'year') {
    const years = Array.from(new Set(uniqueMonths.map((m) => m.slice(0, 4)).filter(Boolean))).sort();
    return years.map((id) => ({ id, label: id, sortKey: id }));
  }
  return uniqueWeeks
    .map((id) => {
      const d = parseSpendWeekDate(id);
      return {
        id,
        label: formatWeekLabel(id),
        sortKey: d ? format(d, 'yyyy-MM-dd') : id,
      };
    })
    .filter((row) => row.sortKey)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export function monthInPeriod(month: string, grain: SpendCompareGrain, periodId: string): boolean {
  if (!month || !periodId) return false;
  if (grain === 'month') return month === periodId;
  if (grain === 'year') return month.startsWith(`${periodId}-`);
  if (grain === 'quarter') return monthQuarterKey(month) === periodId;
  return false;
}

export function weekInPeriod(week: string, periodId: string): boolean {
  return (week || '').trim() === (periodId || '').trim();
}

export function periodYearsAgo(periodId: string, grain: SpendCompareGrain, years: number): string | null {
  if (!periodId || years === 0) return periodId || null;
  if (grain === 'month') {
    const d = parse(periodId, 'yyyy-MM', new Date());
    if (!isValid(d)) return null;
    return format(subYears(d, years), 'yyyy-MM');
  }
  if (grain === 'year') {
    const y = parseInt(periodId, 10);
    if (!Number.isFinite(y)) return null;
    return String(y - years);
  }
  if (grain === 'quarter') {
    const match = periodId.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    return `${parseInt(match[1], 10) - years}-Q${match[2]}`;
  }
  const d = parseSpendWeekDate(periodId);
  if (!d) return null;
  return format(subYears(d, years), 'dd-MM-yyyy');
}

export function priorPeriod(periodId: string, grain: SpendCompareGrain): string | null {
  if (!periodId) return null;
  if (grain === 'month') {
    const d = parse(periodId, 'yyyy-MM', new Date());
    if (!isValid(d)) return null;
    return format(subMonths(d, 1), 'yyyy-MM');
  }
  if (grain === 'year') {
    const y = parseInt(periodId, 10);
    if (!Number.isFinite(y)) return null;
    return String(y - 1);
  }
  if (grain === 'quarter') {
    const match = periodId.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    let year = parseInt(match[1], 10);
    let q = parseInt(match[2], 10) - 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
    return `${year}-Q${q}`;
  }
  const d = parseSpendWeekDate(periodId);
  if (!d) return null;
  return format(subWeeks(d, 1), 'dd-MM-yyyy');
}

export function pickExistingPeriod(candidate: string | null, options: SpendPeriodOption[]): string | null {
  if (!candidate) return null;
  return options.some((o) => o.id === candidate) ? candidate : null;
}

export type CompareProgressPoint = {
  id: string;
  label: string;
  spend: number;
  isEndpoint: boolean;
};

export function enumerateMonthKeys(fromMonth: string, toMonth: string): string[] {
  const a = parse(fromMonth, 'yyyy-MM', new Date());
  const b = parse(toMonth, 'yyyy-MM', new Date());
  if (!isValid(a) || !isValid(b)) return [];
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  const keys: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    keys.push(format(cursor, 'yyyy-MM'));
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

export function enumerateQuarterKeys(fromQ: string, toQ: string): string[] {
  const parseQ = (id: string) => {
    const match = id.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 4 + parseInt(match[2], 10) - 1;
  };
  const a = parseQ(fromQ);
  const b = parseQ(toQ);
  if (a == null || b == null) return [];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const keys: string[] = [];
  for (let i = start; i <= end; i++) {
    keys.push(`${Math.floor(i / 4)}-Q${(i % 4) + 1}`);
  }
  return keys;
}

export function enumerateYearKeys(fromYear: string, toYear: string): string[] {
  const a = parseInt(fromYear, 10);
  const b = parseInt(toYear, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const keys: string[] = [];
  for (let y = start; y <= end; y++) keys.push(String(y));
  return keys;
}

export function buildCompareProgression(params: {
  grain: SpendCompareGrain;
  periodA: string;
  periodB: string;
  monthly: Array<{ month?: string; actualSpendsInr?: unknown; spendsInr?: unknown }>;
  weekly: Array<{ week?: string; actualSpendsInr?: unknown; spendsInr?: unknown }>;
}): CompareProgressPoint[] {
  const { grain, periodA, periodB, monthly, weekly } = params;
  if (!periodA || !periodB) return [];

  if (grain === 'week') {
    const da = parseSpendWeekDate(periodA);
    const db = parseSpendWeekDate(periodB);
    if (!da || !db) return [];
    const start = da <= db ? da.getTime() : db.getTime();
    const end = da <= db ? db.getTime() : da.getTime();
    const totals: Record<string, number> = {};
    weekly.forEach((row) => {
      const week = (row.week || '').trim();
      const d = parseSpendWeekDate(week);
      if (!d) return;
      const t = d.getTime();
      if (t < start || t > end) return;
      totals[week] = (totals[week] || 0) + rowSpendAmount(row);
    });
    return Object.entries(totals)
      .map(([id, spend]) => {
        const d = parseSpendWeekDate(id);
        return {
          id,
          label: d ? format(d, 'dd MMM yy') : id,
          spend,
          isEndpoint: id === periodA || id === periodB,
          sort: d ? d.getTime() : 0,
        };
      })
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _sort, ...row }) => row);
  }

  const monthTotals: Record<string, number> = {};
  monthly.forEach((row) => {
    const month = row.month || '';
    if (!month) return;
    monthTotals[month] = (monthTotals[month] || 0) + rowSpendAmount(row);
  });

  if (grain === 'quarter') {
    const keys = enumerateQuarterKeys(periodA, periodB);
    return keys.map((id, i) => ({
      id,
      label: formatQuarterLabel(id),
      spend: Object.entries(monthTotals).reduce(
        (sum, [month, amt]) => sum + (monthQuarterKey(month) === id ? amt : 0),
        0
      ),
      isEndpoint: id === periodA || id === periodB || i === 0 || i === keys.length - 1,
    }));
  }

  if (grain === 'year') {
    const keys = enumerateYearKeys(periodA, periodB);
    return keys.map((id, i) => ({
      id,
      label: id,
      spend: Object.entries(monthTotals).reduce(
        (sum, [month, amt]) => sum + (month.startsWith(`${id}-`) ? amt : 0),
        0
      ),
      isEndpoint: id === periodA || id === periodB || i === 0 || i === keys.length - 1,
    }));
  }

  const monthKeys = enumerateMonthKeys(periodA, periodB);
  return monthKeys.map((id, i) => {
    const d = parse(id, 'yyyy-MM', new Date());
    return {
      id,
      label: isValid(d) ? format(d, 'MMM yy') : id,
      spend: monthTotals[id] || 0,
      isEndpoint: id === periodA || id === periodB || i === 0 || i === monthKeys.length - 1,
    };
  });
}

export type ClientCompareRow = BrandPeriodMover & {
  series: Record<string, number>;
};

function periodIdForMonthlyRow(month: string, grain: SpendCompareGrain): string | null {
  if (!month) return null;
  if (grain === 'month') return month;
  if (grain === 'quarter') return monthQuarterKey(month);
  if (grain === 'year') return month.slice(0, 4) || null;
  return null;
}

/** Per-client spend for every period on the compare chart (does not apply client click-filter). */
export function buildClientCompareRows(params: {
  grain: SpendCompareGrain;
  periodA: string;
  periodB: string;
  monthly: Array<{
    month?: string;
    brandName?: string;
    type?: string;
    team?: string;
    actualSpendsInr?: unknown;
    spendsInr?: unknown;
  }>;
  weekly: Array<{
    week?: string;
    brandName?: string;
    type?: string;
    team?: string;
    actualSpendsInr?: unknown;
    spendsInr?: unknown;
  }>;
}): ClientCompareRow[] {
  const progression = buildCompareProgression(params);
  const allowed = new Set(progression.map((p) => p.id));
  if (allowed.size === 0) return [];

  const series: Record<string, Record<string, number>> = {};
  const typeSpend: Record<string, Record<string, number>> = {};
  const teamByBrand: Record<string, string> = {};

  const add = (brand: string, periodId: string | null, amount: number, type?: string, team?: string) => {
    const name = (brand || '').trim();
    if (!name || !periodId || !allowed.has(periodId) || !amount) return;
    if (!series[name]) series[name] = {};
    series[name][periodId] = (series[name][periodId] || 0) + amount;
    const t = (type || '').trim() || 'PERFORMANCE';
    if (!typeSpend[name]) typeSpend[name] = {};
    typeSpend[name][t] = (typeSpend[name][t] || 0) + amount;
    if (team && !teamByBrand[name]) teamByBrand[name] = team;
  };

  if (params.grain === 'week') {
    params.weekly.forEach((row) => {
      add(row.brandName || '', (row.week || '').trim(), rowSpendAmount(row), row.type, row.team);
    });
  } else {
    params.monthly.forEach((row) => {
      add(
        row.brandName || '',
        periodIdForMonthlyRow(row.month || '', params.grain),
        rowSpendAmount(row),
        row.type,
        row.team
      );
    });
  }

  return Object.keys(series)
    .map((brand) => {
      const byPeriod = series[brand];
      const previous = byPeriod[params.periodA] || 0;
      const current = byPeriod[params.periodB] || 0;
      const diff = current - previous;
      const types = typeSpend[brand] || {};
      const type =
        Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'PERFORMANCE';
      return {
        brand,
        type,
        team: teamByBrand[brand] || 'N/A',
        previous,
        current,
        diff,
        percentage: previous > 0 ? (diff / previous) * 100 : current > 0 ? 100 : 0,
        series: byPeriod,
      };
    })
    .filter((row) => row.diff !== 0 || row.current !== 0 || row.previous !== 0 || Object.values(row.series).some((v) => v))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
