/**
 * Weekly spend date helpers — normalize heterogeneous week labels and
 * coerce spend amounts so Snapshot / dashboard WoW charts aggregate correctly.
 */
import { addDays, format, isMatch, isValid, parse, startOfWeek, subWeeks } from 'date-fns';

const WEEK_DATE_FORMATS = [
  'dd-MM-yyyy',
  'd-M-yyyy',
  'dd/MM/yyyy',
  'd/M/yyyy',
  'yyyy-MM-dd',
  'dd-MMM-yyyy',
  'd-MMM-yyyy',
  'dd MMM yyyy',
  'd MMM yyyy',
  'dd-MMM-yy',
  'MMM d, yyyy',
  'MMM dd, yyyy',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'yyyy/MM/dd',
] as const;

/** Coerce Firestore/CSV spend values to a finite number (avoids string concat). */
export function toSpendNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val == null || val === '') return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function isFirestoreTimestamp(value: unknown): value is { toDate: () => Date } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  );
}

/** Noon local on a Y-M-D so Monday-week keys are not shifted by timezone. */
function calendarDateAtNoon(year: number, monthIndex: number, day: number): Date | null {
  const d = new Date(year, monthIndex, day, 12, 0, 0, 0);
  return isValid(d) ? d : null;
}

function fromDateInstant(d: Date): Date | null {
  if (!isValid(d)) return null;
  // UTC-midnight instants (Excel / ISO-Z) must use the UTC calendar day.
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return calendarDateAtNoon(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return calendarDateAtNoon(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse a weekly spend `week` label across common upload formats. */
export function parseSpendWeekDate(week: unknown): Date | null {
  if (week == null || week === '') return null;

  if (week instanceof Date) {
    return fromDateInstant(week);
  }

  if (isFirestoreTimestamp(week)) {
    try {
      return fromDateInstant(week.toDate());
    } catch {
      return null;
    }
  }

  if (typeof week === 'object') {
    const seconds = (week as { seconds?: unknown }).seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return fromDateInstant(new Date(seconds * 1000));
    }
  }

  if (typeof week === 'number' && Number.isFinite(week)) {
    // Excel serial date (allow fractional day)
    if (week > 20000 && week < 100000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return fromDateInstant(new Date(excelEpoch.getTime() + week * 86400000));
    }
    return null;
  }

  const s = String(week).trim();
  if (!s || s === '[object Object]') return null;

  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000) {
    return parseSpendWeekDate(Number(s));
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return fromDateInstant(new Date(s));
  }

  for (const f of WEEK_DATE_FORMATS) {
    try {
      if (!isMatch(s, f)) continue;
      const d = parse(s, f, new Date());
      if (isValid(d) && d.getFullYear() >= 2000) {
        return calendarDateAtNoon(d.getFullYear(), d.getMonth(), d.getDate());
      }
    } catch {
      // try next format
    }
  }

  return fromDateInstant(new Date(s));
}

/** Monday (ISO) week-start key: yyyy-MM-dd */
export function spendWeekStartKey(week: unknown): string | null {
  const d = parseSpendWeekDate(week);
  if (!d) return null;
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function formatWeekStartLabel(weekStartKey: string, pattern = 'dd MMM'): string {
  try {
    const d = parse(weekStartKey, 'yyyy-MM-dd', new Date());
    return isValid(d) ? format(d, pattern) : weekStartKey;
  } catch {
    return weekStartKey;
  }
}

/**
 * Display date for a week bucket: the latest source `week` value in the rows
 * (week-ending dumps like 09-08-2026, not the Monday week-start key).
 */
export function formatLatestWeekDateLabel<T extends { week?: unknown }>(
  rows: T[] | null | undefined,
  pattern = 'dd-MM-yyyy'
): string {
  let latest: Date | null = null;
  for (const row of rows || []) {
    const d = parseSpendWeekDate(row.week);
    if (!d) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest ? format(latest, pattern) : '';
}

/**
 * Aggregate weekly rows by Monday week-start.
 * Returns sorted ascending keys with totals.
 */
export function aggregateSpendByWeekStart<T extends { week?: string; spendsInr?: unknown }>(
  rows: T[] | null | undefined
): { keys: string[]; totals: Record<string, number>; rowsByKey: Record<string, T[]> } {
  const totals: Record<string, number> = {};
  const rowsByKey: Record<string, T[]> = {};

  (rows || []).forEach((row) => {
    const key = spendWeekStartKey(row.week);
    if (!key) return;
    totals[key] = (totals[key] || 0) + toSpendNumber(row.spendsInr);
    if (!rowsByKey[key]) rowsByKey[key] = [];
    rowsByKey[key].push(row);
  });

  const keys = Object.keys(totals).sort((a, b) => a.localeCompare(b));
  return { keys, totals, rowsByKey };
}

/**
 * Build a fixed-length WoW momentum series ending on the latest week that has
 * data (falls back to the current calendar week). Missing weeks are 0.
 * @deprecated Prefer {@link buildWowSpendsTrend} to match Spends Dashboard.
 */
export function buildWowMomentumSeries(
  spendByWeekStart: Record<string, number>,
  weekCount = 12
): { week: string; weekStartKey: string; spend: number }[] {
  const dataKeys = Object.keys(spendByWeekStart).sort((a, b) => a.localeCompare(b));
  let anchor: Date;
  if (dataKeys.length > 0) {
    const latest = parse(dataKeys[dataKeys.length - 1], 'yyyy-MM-dd', new Date());
    anchor = isValid(latest) ? latest : startOfWeek(new Date(), { weekStartsOn: 1 });
  } else {
    anchor = startOfWeek(new Date(), { weekStartsOn: 1 });
  }

  const series: { week: string; weekStartKey: string; spend: number }[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const weekStart = subWeeks(anchor, i);
    const weekStartKey = format(weekStart, 'yyyy-MM-dd');
    series.push({
      week: format(weekStart, 'dd MMM'),
      weekStartKey,
      spend: spendByWeekStart[weekStartKey] || 0,
    });
  }
  return series;
}

export type WowSpendTrendPoint = {
  /** Display label (dd MMM), same as Spends Dashboard WoW chart */
  week: string;
  /** Original week field value from weeklySpends */
  weekKey: string;
  timestamp: number;
  spend: number;
};

/**
 * Spends Dashboard WoW chart parity:
 * group by the raw `week` label (not Monday-normalized), sum spends, sort by
 * date, take the last N weeks that exist in the dataset (no zero-filled gaps).
 */
export function buildWowSpendsTrend<T extends { week?: string; spendsInr?: unknown }>(
  rows: T[] | null | undefined,
  weekCount = 12
): WowSpendTrendPoint[] {
  const groups: Record<string, number> = {};
  (rows || []).forEach((item) => {
    const week = (item.week || '').toString().trim();
    if (!week) return;
    groups[week] = (groups[week] || 0) + toSpendNumber(item.spendsInr);
  });

  return Object.entries(groups)
    .map(([weekKey, spend]) => {
      const d = parseSpendWeekDate(weekKey);
      const timestamp = d ? d.getTime() : Number.NaN;
      const label = d ? format(d, 'dd MMM') : weekKey;
      return { week: label, weekKey, timestamp, spend };
    })
    .filter((row) => Number.isFinite(row.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-weekCount);
}

export type ChannelSpendPoint = { name: string; value: number };

export type ChannelSpendPulse = {
  channels: ChannelSpendPoint[];
  weekStartKey: string | null;
};

/**
 * Depletion Pulse: spend by channel for the latest ISO week that has data.
 * Collapses mixed week labels (Mon dump + mid-week as-of dates) onto the same
 * Monday key — unlike {@link buildWowSpendsTrend}, which keeps raw labels.
 */
export function buildChannelSpendPulse<
  T extends { week?: unknown; spendsInr?: unknown; channelVendor?: string | null },
>(
  rows: T[] | null | undefined,
  canonicalize: (channel: string | null | undefined) => string
): ChannelSpendPulse {
  const { keys, rowsByKey } = aggregateSpendByWeekStart(rows);

  for (let i = keys.length - 1; i >= 0; i--) {
    const weekStartKey = keys[i];
    const channelTotals: Record<string, number> = {};
    (rowsByKey[weekStartKey] || []).forEach((row) => {
      const channel = canonicalize(row.channelVendor);
      channelTotals[channel] = (channelTotals[channel] || 0) + toSpendNumber(row.spendsInr);
    });
    const channels = Object.entries(channelTotals)
      .map(([name, value]) => ({ name, value }))
      .filter((row) => row.value !== 0)
      .sort((a, b) => b.value - a.value);
    if (channels.length > 0) {
      return { channels, weekStartKey };
    }
  }

  return { channels: [], weekStartKey: null };
}

/**
 * Resolve current + previous week-start keys from available weekly data
 * (newest first). Prefers consecutive ISO weeks present in the dataset.
 */
export function resolveWowWeekPair(weekStartKeysAsc: string[]): {
  currentKey: string;
  previousKey: string;
} {
  const keys = [...weekStartKeysAsc].sort((a, b) => b.localeCompare(a));
  const currentKey = keys[0] || '';
  if (!currentKey) return { currentKey: '', previousKey: '' };

  const expectedPrev = format(
    subWeeks(parse(currentKey, 'yyyy-MM-dd', new Date()), 1),
    'yyyy-MM-dd'
  );
  const previousKey = keys.includes(expectedPrev) ? expectedPrev : keys[1] || '';
  return { currentKey, previousKey };
}

/** Month key (yyyy-MM) for a weekly spend, using Thursday of the ISO week. */
export function spendWeekMonthKey(week: unknown): string {
  const d = parseSpendWeekDate(week);
  if (!d) return '';
  const monday = startOfWeek(d, { weekStartsOn: 1 });
  const thursday = addDays(monday, 3);
  return format(thursday, 'yyyy-MM');
}

export function rowSpendAmount(row: { actualSpendsInr?: unknown; spendsInr?: unknown }): number {
  if (Object.prototype.hasOwnProperty.call(row, 'actualSpendsInr')) {
    return toSpendNumber(row.actualSpendsInr);
  }
  return toSpendNumber(row.spendsInr);
}

export function normalizeSpendTypeLabel(type?: string | null): string {
  const t = String(type || '').trim();
  return t || 'PERFORMANCE';
}

export type BrandSpendBreakdown = {
  spendMap: Record<string, number>;
  typeSpendMap: Record<string, Record<string, number>>;
  teamByType: Record<string, Record<string, string>>;
};

/** Totals by brand, plus spend by type so gainer/loser labels can show the driver. */
export function aggregateBrandSpendBreakdown(
  data: Array<{
    brandName?: string;
    type?: string;
    team?: string;
    actualSpendsInr?: unknown;
    spendsInr?: unknown;
  }>
): BrandSpendBreakdown {
  const spendMap: Record<string, number> = {};
  const typeSpendMap: Record<string, Record<string, number>> = {};
  const teamByType: Record<string, Record<string, string>> = {};

  for (const d of data) {
    const brand = (d.brandName || '').trim();
    if (!brand) continue;
    const type = normalizeSpendTypeLabel(d.type);
    const val = rowSpendAmount(d);
    spendMap[brand] = (spendMap[brand] || 0) + val;
    if (!typeSpendMap[brand]) typeSpendMap[brand] = {};
    typeSpendMap[brand][type] = (typeSpendMap[brand][type] || 0) + val;
    if (!teamByType[brand]) teamByType[brand] = {};
    if (!teamByType[brand][type] && d.team) teamByType[brand][type] = d.team;
  }

  return { spendMap, typeSpendMap, teamByType };
}

/**
 * Spend type with the largest rupee change in the same direction as the brand.
 * Percent moves are ignored — a small Branding jump must not beat a larger Performance jump.
 */
export function dominantImpactSpendType(
  currByType: Record<string, number> | undefined,
  prevByType: Record<string, number> | undefined,
  brandDelta: number,
): string {
  const curr = currByType || {};
  const prev = prevByType || {};
  const types = Array.from(new Set([...Object.keys(curr), ...Object.keys(prev)]));
  if (types.length === 0) return 'PERFORMANCE';
  if (types.length === 1) return types[0];

  const wantGain = brandDelta >= 0;
  let bestType = types[0];
  let bestRupee = -Infinity;
  for (const type of types) {
    const delta = (curr[type] || 0) - (prev[type] || 0);
    const rupee = wantGain ? delta : -delta;
    if (rupee > bestRupee) {
      bestRupee = rupee;
      bestType = type;
    }
  }
  if (bestRupee > 0) return bestType;

  let fallback = types[0];
  let maxVol = -1;
  for (const type of types) {
    const vol = Math.abs(curr[type] || 0) + Math.abs(prev[type] || 0);
    if (vol > maxVol) {
      maxVol = vol;
      fallback = type;
    }
  }
  return fallback;
}

/** Same large accounts Snapshot excludes from 12-Week Momentum (Orion Retail, Nova Mobility). */
export const LARGE_SPEND_CLIENT_IDS = new Set(['CLID0081', 'CLID0084']);

export function isLargeSyntheticClient(row: { clientId?: string | null; brandName?: string | null }): boolean {
  const id = (row.clientId || '').trim().toUpperCase();
  if (LARGE_SPEND_CLIENT_IDS.has(id)) return true;
  const brand = (row.brandName || '').toLowerCase();
  return brand.includes('orion retail') || /\bola\b/.test(brand);
}

export type BrandPeriodMover = {
  brand: string;
  type: string;
  team: string;
  current: number;
  previous: number;
  diff: number;
  percentage: number;
};

/** Rank brands by absolute rupee change between two periods (largest movers first). */
export function rankBrandPeriodMovers(
  curr: BrandSpendBreakdown,
  prev: BrandSpendBreakdown,
): BrandPeriodMover[] {
  const allBrands = Array.from(new Set([...Object.keys(curr.spendMap), ...Object.keys(prev.spendMap)]));
  return allBrands
    .map((brand) => {
      const current = curr.spendMap[brand] || 0;
      const previous = prev.spendMap[brand] || 0;
      const diff = current - previous;
      const type = dominantImpactSpendType(curr.typeSpendMap[brand], prev.typeSpendMap[brand], diff);
      const team = curr.teamByType[brand]?.[type] || prev.teamByType[brand]?.[type] || 'N/A';
      return {
        brand,
        type,
        team,
        current,
        previous,
        diff,
        percentage: previous > 0 ? (diff / previous) * 100 : current > 0 ? 100 : 0,
      };
    })
    .filter((row) => row.diff !== 0 || row.current !== 0 || row.previous !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
