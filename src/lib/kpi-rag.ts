import type { RagStatus } from './types';

export type ClientPath = 'on-path' | 'off-path' | 'no-signal';

/** Coerce Firestore number | string fields used in KPI RAG math. */
export function coerceKpiNumber(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val == null || val === '') return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '').trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/** Rate/efficiency KPIs — weekly value is comparable to the full monthly target. */
const RATE_KPI_PATTERN =
  /(^|[^a-z])(cpa|cpc|cpm|cpl|cpi|cps|ctr|cvr|roas|aov|rpc|rpi|arpu|cac|rpm|ecpm)([^a-z]|$)|rate|ratio|percent|%|bounce|margin|frequency/i;

/** Volume/cumulative KPIs — monthly target is hit by consolidating weeks. */
const VOLUME_KPI_PATTERN =
  /(lead|revenue|sale|gmv|order|conversion|install|signup|sign[\s-]?up|registrat|click|impression|spend|budget|session|user|traffic|booking|enquir|inquir|download|applicant|application|volume|units?|qty|quantity|visits?)/i;

const DESC_KPI_NAME_PATTERN =
  /(^|[^a-z])(cpa|cpc|cpm|cpl|cpi|cps|cac)([^a-z]|$)|bounce|churn|drop[\s-]?off|cost per/i;

/** Parse Direction from uploads: ASC = higher is better, DESC = lower is better. */
export function parseKpiDirection(raw: unknown, kpiName?: string): 'ASC' | 'DESC' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s) {
    if (
      s.includes('lower') ||
      s.includes('less is') ||
      s.includes('descending') ||
      s.includes('desc') ||
      s.includes('decrease') ||
      s.includes('down') ||
      s.includes('minimi') ||
      s === '-' ||
      s === '-1'
    ) {
      return 'DESC';
    }
    if (
      s.includes('higher') ||
      s.includes('more is') ||
      s.includes('ascending') ||
      s.includes('asc') ||
      s.includes('increase') ||
      s.includes('up') ||
      s.includes('maximi') ||
      s === '+' ||
      s === '+1' ||
      s === '1'
    ) {
      return 'ASC';
    }
  }
  return inferDirectionFromKpiName(kpiName);
}

export function inferDirectionFromKpiName(kpiName?: string): 'ASC' | 'DESC' {
  const name = (kpiName || '').trim();
  if (!name) return 'ASC';
  if (DESC_KPI_NAME_PATTERN.test(name)) return 'DESC';
  return 'ASC';
}

export function usesProRatedWeeklyTarget(kpiName: string, direction: 'ASC' | 'DESC'): boolean {
  const name = (kpiName || '').trim();
  if (!name) return direction === 'ASC';
  if (RATE_KPI_PATTERN.test(name)) return false;
  if (VOLUME_KPI_PATTERN.test(name)) return true;
  return direction === 'ASC';
}

export function getEffectiveWeeklyTarget(opts: {
  kpiName: string;
  direction: 'ASC' | 'DESC';
  monthlyTarget: unknown;
  weekTarget?: unknown;
  weeksInMonth: number;
}): number | null {
  const weekTarget = coerceKpiNumber(opts.weekTarget);
  if (weekTarget > 0) return weekTarget;
  const monthlyTarget = coerceKpiNumber(opts.monthlyTarget);
  if (monthlyTarget <= 0) return null;
  if (usesProRatedWeeklyTarget(opts.kpiName, opts.direction) && opts.weeksInMonth > 0) {
    return monthlyTarget / opts.weeksInMonth;
  }
  return monthlyTarget;
}

/** ASC = higher is better; DESC = lower is better. Coerces string Firestore values. */
export function meetsTarget(
  achieved: unknown,
  target: unknown,
  direction: 'ASC' | 'DESC' = 'ASC'
): boolean {
  const a = coerceKpiNumber(achieved);
  const t = coerceKpiNumber(target);
  if (direction === 'DESC') return a <= t;
  return a >= t;
}

export function improvedVsPrevious(
  current: unknown,
  previous: unknown,
  direction: 'ASC' | 'DESC'
): boolean {
  const c = coerceKpiNumber(current);
  const p = coerceKpiNumber(previous);
  if (direction === 'DESC') return c <= p;
  return c >= p;
}

/** Monthly / MTD RAG: achieved vs monthly target, direction-aware. */
export function getMonthlyStatus(
  achieved: unknown,
  target: unknown,
  direction: 'ASC' | 'DESC' = 'ASC'
): RagStatus {
  const a = coerceKpiNumber(achieved);
  const t = coerceKpiNumber(target);
  if (t === 0 && a === 0) return 'N/A';
  return meetsTarget(a, t, direction) ? 'Green' : 'Red';
}

/**
 * Weekly RAG: vs effective weekly target AND previous week.
 * Green = both good · Amber = mixed · Red = both bad
 */
export function getWeeklyStatus(
  achieved: unknown,
  weeklyPacingTarget: number | null,
  prevAchieved: unknown,
  direction: 'ASC' | 'DESC'
): RagStatus {
  const vsTarget =
    weeklyPacingTarget != null && weeklyPacingTarget > 0
      ? meetsTarget(achieved, weeklyPacingTarget, direction)
      : null;
  const vsPrev =
    prevAchieved != null && prevAchieved !== ''
      ? improvedVsPrevious(achieved, prevAchieved, direction)
      : null;

  if (vsTarget === null && vsPrev === null) return 'N/A';
  if (vsTarget === null) return vsPrev ? 'Green' : 'Red';
  if (vsPrev === null) return vsTarget ? 'Green' : 'Red';
  if (vsTarget && vsPrev) return 'Green';
  if (!vsTarget && !vsPrev) return 'Red';
  return 'Amber';
}

export function ragStatusTextClass(status: RagStatus): string {
  if (status === 'Green') return 'text-success';
  if (status === 'Amber') return 'text-warning';
  if (status === 'Red') return 'text-destructive';
  return '';
}

export function isExplicitPrimaryKpiType(kpiType: unknown): boolean {
  return String(kpiType ?? '')
    .trim()
    .toUpperCase()
    .replace(/_/g, '-') === 'PRIMARY';
}

/** Missing kpiType defaults to PRIMARY (legacy rows). */
export function isPrimaryKpiType(kpiType: unknown): boolean {
  if (kpiType == null || String(kpiType).trim() === '') return true;
  return isExplicitPrimaryKpiType(kpiType);
}

type PrimaryKpiLike = {
  kpiType?: string;
  kpi?: string;
  channel?: string;
  achievedMonthTillYesterday?: unknown;
  targetMonth?: unknown;
  direction?: 'ASC' | 'DESC';
};

/**
 * Choose Primary KPI rows for path rollup.
 * Prefer explicitly marked PRIMARY so unmarked legacy KPIs do not steal the path
 * when the client already has a designated Primary.
 */
export function selectPrimaryKpisForPath<T extends PrimaryKpiLike>(kpis: T[]): T[] {
  const primaries = kpis.filter((k) => isPrimaryKpiType(k.kpiType));
  if (!primaries.length) return [];
  const explicit = primaries.filter((k) => isExplicitPrimaryKpiType(k.kpiType));
  return explicit.length > 0 ? explicit : primaries;
}

function statusSeverity(status: RagStatus): number {
  if (status === 'Red') return 0;
  if (status === 'Amber') return 1;
  if (status === 'Green') return 2;
  return 3;
}

/**
 * Client path from Primary KPI MTD statuses (same formula as KPI Tracker).
 * Any Red → Off Path; else any Green → On Path; else No Signal.
 */
export function clientPathFromPrimaryKpis<T extends PrimaryKpiLike>(
  kpis: T[]
): {
  path: ClientPath;
  pathStatus: RagStatus;
  representative: T | null;
  achieved: number;
  target: number;
  direction: 'ASC' | 'DESC';
} {
  const pool = selectPrimaryKpisForPath(kpis);
  if (!pool.length) {
    return {
      path: 'no-signal',
      pathStatus: 'N/A',
      representative: null,
      achieved: 0,
      target: 0,
      direction: 'ASC',
    };
  }

  const scored = pool.map((kpi) => {
    const achieved = coerceKpiNumber(kpi.achievedMonthTillYesterday);
    const target = coerceKpiNumber(kpi.targetMonth);
    const direction: 'ASC' | 'DESC' = parseKpiDirection(kpi.direction, kpi.kpi);
    const pathStatus = getMonthlyStatus(achieved, target, direction);
    return { kpi, achieved, target, direction, pathStatus };
  });

  const hasRed = scored.some((s) => s.pathStatus === 'Red');
  const hasGreen = scored.some((s) => s.pathStatus === 'Green');
  const path: ClientPath = hasRed ? 'off-path' : hasGreen ? 'on-path' : 'no-signal';
  const pathStatus: RagStatus = hasRed ? 'Red' : hasGreen ? 'Green' : 'N/A';

  // Representative row for labels: prefer matching path status, then name.
  scored.sort((a, b) => {
    const aMatch = a.pathStatus === pathStatus ? 0 : 1;
    const bMatch = b.pathStatus === pathStatus ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    const sev = statusSeverity(a.pathStatus) - statusSeverity(b.pathStatus);
    if (sev !== 0) return sev;
    return String(a.kpi.kpi || '').localeCompare(String(b.kpi.kpi || ''));
  });
  const best = scored[0];

  return {
    path,
    pathStatus,
    representative: best.kpi,
    achieved: best.achieved,
    target: best.target,
    direction: best.direction,
  };
}

export function formatKpiNumber(val: number, currency?: string): string {
  if (val == null || Number.isNaN(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (currency && currency !== 'INR' && currency !== 'UNITS') {
    if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
    return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  }
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}

export function kpiAttainmentPct(
  achieved: number,
  target: number,
  direction: 'ASC' | 'DESC' = 'ASC'
): number | null {
  if (!target || target <= 0) return null;
  if (direction === 'DESC') {
    // Lower is better: 100% when at/under target
    if (achieved <= 0) return 100;
    return Math.min(100, (target / achieved) * 100);
  }
  return Math.min(150, (achieved / target) * 100);
}
