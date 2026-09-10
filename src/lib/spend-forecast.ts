import { addMonths, format, parse } from 'date-fns';
import type { MonthlySpend } from '@/lib/types';
import {
  type ForecastModelId,
  modelLabel as modelIdLabel,
  runForecastModel,
} from '@/lib/spend-forecast-models';

export type { ForecastModelId } from '@/lib/spend-forecast-models';
export {
  FORECAST_MODEL_OPTIONS,
  modelLabel as forecastModelLabel,
  modelDescription,
  runForecastModel,
} from '@/lib/spend-forecast-models';

export const FORECAST_HORIZON_MONTHS = 12;

/** @deprecated Use ForecastModelId */
export type ForecastModelKind = ForecastModelId;

export interface MonthAmount {
  month: string; // yyyy-MM
  amount: number;
}

export interface ForecastMonthRow {
  month: string;
  label: string;
  forecast: number;
  isForecast: true;
}

export interface HistoryMonthRow {
  month: string;
  label: string;
  actual: number;
  isForecast: false;
}

export interface MomComparisonRow {
  month: string;
  label: string;
  kind: 'actual' | 'forecast';
  spend: number;
}

export type SpendSeriesPoint = HistoryMonthRow | ForecastMonthRow;

export interface ForecastWidget {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'primary' | 'success' | 'warning' | 'destructive' | 'muted';
}

export interface SpendForecastResult {
  history: HistoryMonthRow[];
  forecast: ForecastMonthRow[];
  series: SpendSeriesPoint[];
  momComparison: MomComparisonRow[];
  model: ForecastModelId;
  modelLabel: string;
  modelNote?: string;
  latestDataMonth: string | null;
  yearTotal: number;
  avgMonthly: number;
  nextMonthValue: number;
  nextMonthLabel: string;
  peakMonthLabel: string;
  peakValue: number;
  troughMonthLabel: string;
  troughValue: number;
  last12ActualTotal: number;
  vsLast12Pct: number;
  horizonGrowthPct: number;
  vsNaivePct: number;
  naiveYearTotal: number;
  widgets: ForecastWidget[];
}

function parseMonth(month: string): Date {
  return parse(month, 'yyyy-MM', new Date());
}

export function formatMonthLabel(month: string): string {
  try {
    return format(parseMonth(month), 'MMM-yy');
  } catch {
    return month;
  }
}

export function shiftMonth(month: string, delta: number): string {
  return format(addMonths(parseMonth(month), delta), 'yyyy-MM');
}

function monthsBetweenInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = shiftMonth(cur, 1);
    if (out.length > 240) break;
  }
  return out;
}

function formatInrCompact(val: number): string {
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (absVal >= 10000000) return `₹${sign}${(absVal / 10000000).toFixed(2)}Cr`;
  if (absVal >= 100000) return `₹${sign}${(absVal / 100000).toFixed(2)}L`;
  return `₹${sign}${Math.round(absVal).toLocaleString('en-IN')}`;
}

function formatPctSigned(val: number): string {
  if (!Number.isFinite(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(1)}%`;
}

/** Aggregate monthlySpends into a contiguous yyyy-MM → total map. */
export function aggregateMonthlyTotals(
  spends: MonthlySpend[],
  filter?: (row: MonthlySpend) => boolean
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of spends) {
    if (!row.month || typeof row.actualSpendsInr !== 'number') continue;
    if (filter && !filter(row)) continue;
    map.set(row.month, (map.get(row.month) || 0) + (row.actualSpendsInr || 0));
  }
  return map;
}

export function toContiguousSeries(totals: Map<string, number>): MonthAmount[] {
  if (totals.size === 0) return [];
  const months = Array.from(totals.keys()).sort();
  const start = months[0];
  const end = months[months.length - 1];
  return monthsBetweenInclusive(start, end).map((month) => ({
    month,
    amount: totals.get(month) || 0,
  }));
}

/**
 * Holt-Winters wrapper — prefer `runForecastModel('holt-winters', …)`.
 */
export function forecastHoltWinters(
  history: MonthAmount[],
  horizon = FORECAST_HORIZON_MONTHS
): { values: number[]; model: ForecastModelId } {
  const result = runForecastModel('holt-winters', history, horizon);
  return { values: result.values, model: result.model };
}

export function modelLabel(kind: ForecastModelId): string {
  return modelIdLabel(kind);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function stdev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(v);
}

function buildModelWidgets(args: {
  model: ForecastModelId;
  history: MonthAmount[];
  forecastValues: number[];
  forecastRows: ForecastMonthRow[];
  yearTotal: number;
  avgMonthly: number;
  nextMonthValue: number;
  nextMonthLabel: string;
  peakMonthLabel: string;
  peakValue: number;
  troughMonthLabel: string;
  troughValue: number;
  last12ActualTotal: number;
  vsLast12Pct: number;
  horizonGrowthPct: number;
  vsNaivePct: number;
  naiveYearTotal: number;
}): ForecastWidget[] {
  const {
    model,
    history,
    forecastValues,
    yearTotal,
    avgMonthly,
    nextMonthValue,
    nextMonthLabel,
    peakMonthLabel,
    peakValue,
    troughMonthLabel,
    troughValue,
    last12ActualTotal,
    vsLast12Pct,
    horizonGrowthPct,
    vsNaivePct,
    naiveYearTotal,
  } = args;

  const hist = history.map((h) => h.amount);
  const lastActual = hist[hist.length - 1] ?? 0;
  const seasonalAmp =
    avgMonthly > 0 ? ((peakValue - troughValue) / avgMonthly) * 100 : 0;

  // Shared core widgets (values still differ by model)
  const core: ForecastWidget[] = [
    {
      id: 'year-total',
      title: '12-mo Forecast',
      value: formatInrCompact(yearTotal),
      subtitle: `${modelIdLabel(model)} · full horizon`,
      tone: 'primary',
    },
    {
      id: 'next-month',
      title: `Next · ${nextMonthLabel}`,
      value: formatInrCompact(nextMonthValue),
      subtitle:
        lastActual > 0
          ? `${formatPctSigned(((nextMonthValue - lastActual) / lastActual) * 100)} vs last actual`
          : 'First forecast month',
      tone: nextMonthValue >= lastActual ? 'success' : 'warning',
    },
    {
      id: 'vs-history',
      title: 'Vs last 12 actual',
      value: formatPctSigned(vsLast12Pct),
      subtitle: `Actual ${formatInrCompact(last12ActualTotal)} → forecast ${formatInrCompact(yearTotal)}`,
      tone: vsLast12Pct >= 0 ? 'success' : 'destructive',
    },
    {
      id: 'vs-naive',
      title: 'Vs YoY naive',
      value: model === 'seasonal-naive' ? 'Baseline' : formatPctSigned(vsNaivePct),
      subtitle:
        model === 'seasonal-naive'
          ? `Naive total ${formatInrCompact(naiveYearTotal)}`
          : `Naive ${formatInrCompact(naiveYearTotal)} · this model ${formatInrCompact(yearTotal)}`,
      tone: model === 'seasonal-naive' ? 'muted' : vsNaivePct >= 0 ? 'success' : 'warning',
    },
  ];

  // Model-specific fifth/sixth widgets so the row visibly changes
  let specific: ForecastWidget[] = [];

  switch (model) {
    case 'holt-winters': {
      specific = [
        {
          id: 'hw-peak',
          title: 'Seasonal peak',
          value: peakMonthLabel,
          subtitle: formatInrCompact(peakValue),
          tone: 'success',
        },
        {
          id: 'hw-amp',
          title: 'Seasonality amp.',
          value: formatPctSigned(seasonalAmp).replace('+', ''),
          subtitle: `Peak−trough ÷ avg (${formatInrCompact(troughValue)} → ${formatInrCompact(peakValue)})`,
          tone: 'primary',
        },
      ];
      break;
    }
    case 'seasonal-naive': {
      let yoyScale = 1;
      if (hist.length >= 24) {
        const recent = hist.slice(-12).reduce((s, v) => s + v, 0);
        const prior = hist.slice(-24, -12).reduce((s, v) => s + v, 0);
        if (prior > 0) yoyScale = recent / prior;
      }
      specific = [
        {
          id: 'sn-scale',
          title: 'YoY scale factor',
          value: `${yoyScale.toFixed(2)}×`,
          subtitle: 'Recent 12 ÷ prior 12 applied to last year',
          tone: yoyScale >= 1 ? 'success' : 'warning',
        },
        {
          id: 'sn-peak',
          title: 'Repeated peak month',
          value: peakMonthLabel,
          subtitle: formatInrCompact(peakValue),
          tone: 'primary',
        },
      ];
      break;
    }
    case 'linear': {
      const n = hist.length;
      const slope =
        n >= 2 ? (forecastValues[forecastValues.length - 1] - nextMonthValue) / Math.max(1, forecastValues.length - 1) : 0;
      // Better: fit slope from history end
      const histSlope =
        n >= 7 ? (hist[n - 1] - hist[n - 7]) / 6 : n >= 2 ? hist[n - 1] - hist[n - 2] : 0;
      specific = [
        {
          id: 'lin-slope',
          title: 'Implied MoM slope',
          value: formatInrCompact(histSlope),
          subtitle: 'Approx. change per month (recent history)',
          tone: histSlope >= 0 ? 'success' : 'destructive',
        },
        {
          id: 'lin-end',
          title: 'Horizon end level',
          value: formatInrCompact(forecastValues[forecastValues.length - 1] ?? 0),
          subtitle: `${formatPctSigned(horizonGrowthPct)} across forecast path`,
          tone: 'primary',
        },
      ];
      break;
    }
    case 'polynomial': {
      const mid = forecastValues[Math.floor(forecastValues.length / 2)] ?? 0;
      const end = forecastValues[forecastValues.length - 1] ?? 0;
      const firstHalf = mid - nextMonthValue;
      const secondHalf = end - mid;
      const accel = secondHalf - firstHalf;
      specific = [
        {
          id: 'poly-curve',
          title: 'Curvature',
          value: accel >= 0 ? 'Accelerating' : 'Decelerating',
          subtitle: `2nd-half Δ ${formatInrCompact(secondHalf)} vs 1st-half Δ ${formatInrCompact(firstHalf)}`,
          tone: accel >= 0 ? 'success' : 'warning',
        },
        {
          id: 'poly-avg',
          title: 'Avg monthly F/C',
          value: formatInrCompact(avgMonthly),
          subtitle: 'Mean of quadratic path',
          tone: 'primary',
        },
      ];
      break;
    }
    case 'arima': {
      const diffs = forecastValues.slice(1).map((v, i) => v - forecastValues[i]);
      const momVol = stdev(diffs);
      const momentum = diffs.length ? mean(diffs) : 0;
      specific = [
        {
          id: 'arima-mom',
          title: 'Path momentum',
          value: formatInrCompact(momentum),
          subtitle: 'Avg MoM change on forecast path',
          tone: momentum >= 0 ? 'success' : 'destructive',
        },
        {
          id: 'arima-vol',
          title: 'Path volatility',
          value: formatInrCompact(momVol),
          subtitle: 'Stdev of MoM forecast diffs',
          tone: 'warning',
        },
      ];
      break;
    }
    case 'sarima': {
      const lastYearSlice = hist.slice(-12);
      const lastYearAvg = mean(lastYearSlice);
      const lift =
        lastYearAvg > 0 ? ((avgMonthly - lastYearAvg) / lastYearAvg) * 100 : 0;
      specific = [
        {
          id: 'sarima-lift',
          title: 'Seasonal lift',
          value: formatPctSigned(lift),
          subtitle: `F/C avg vs last-12 avg (${formatInrCompact(lastYearAvg)})`,
          tone: lift >= 0 ? 'success' : 'destructive',
        },
        {
          id: 'sarima-trough',
          title: 'Seasonal trough',
          value: troughMonthLabel,
          subtitle: formatInrCompact(troughValue),
          tone: 'muted',
        },
      ];
      break;
    }
    case 'regression-features': {
      const lag1 = lastActual;
      const lag12 = hist.length >= 12 ? hist[hist.length - 12] : lag1;
      const lagGap = lag1 - lag12;
      specific = [
        {
          id: 'feat-lag',
          title: 'Lag-1 vs Lag-12',
          value: formatInrCompact(lagGap),
          subtitle: `L1 ${formatInrCompact(lag1)} · L12 ${formatInrCompact(lag12)}`,
          tone: lagGap >= 0 ? 'success' : 'warning',
        },
        {
          id: 'feat-peak',
          title: 'Featured peak',
          value: peakMonthLabel,
          subtitle: formatInrCompact(peakValue),
          tone: 'primary',
        },
      ];
      break;
    }
    case 'prophet': {
      // Trend proxy: end - start of forecast / months
      const trendPerMo =
        forecastValues.length > 1
          ? (forecastValues[forecastValues.length - 1] - forecastValues[0]) /
            (forecastValues.length - 1)
          : 0;
      specific = [
        {
          id: 'prophet-trend',
          title: 'Trend / month',
          value: formatInrCompact(trendPerMo),
          subtitle: 'Fourier+trend path slope over horizon',
          tone: trendPerMo >= 0 ? 'success' : 'destructive',
        },
        {
          id: 'prophet-amp',
          title: 'Yearly amplitude',
          value: formatPctSigned(seasonalAmp).replace('+', ''),
          subtitle: 'Peak−trough relative to avg forecast',
          tone: 'primary',
        },
      ];
      break;
    }
  }

  return [...core, ...specific];
}

export function buildSpendForecast(
  spends: MonthlySpend[],
  options?: {
    horizon?: number;
    filter?: (row: MonthlySpend) => boolean;
    model?: ForecastModelId;
  }
): SpendForecastResult {
  const horizon = options?.horizon ?? FORECAST_HORIZON_MONTHS;
  const selectedModel = options?.model ?? 'holt-winters';
  const filtered = options?.filter ? spends.filter(options.filter) : spends;
  const totals = aggregateMonthlyTotals(filtered);
  const contiguous = toContiguousSeries(totals);

  const latestDataMonth =
    contiguous.length > 0 ? contiguous[contiguous.length - 1].month : null;

  const history: HistoryMonthRow[] = contiguous.map((h) => ({
    month: h.month,
    label: formatMonthLabel(h.month),
    actual: h.amount,
    isForecast: false as const,
  }));

  const modelResult = runForecastModel(selectedModel, contiguous, horizon);
  const naiveResult = runForecastModel('seasonal-naive', contiguous, horizon);

  const forecast: ForecastMonthRow[] = modelResult.values.map((value, i) => {
    const month = latestDataMonth
      ? shiftMonth(latestDataMonth, i + 1)
      : format(addMonths(new Date(), i + 1), 'yyyy-MM');
    return {
      month,
      label: formatMonthLabel(month),
      forecast: value,
      isForecast: true as const,
    };
  });

  const yearTotal = forecast.reduce((s, f) => s + f.forecast, 0);
  const naiveYearTotal = naiveResult.values.reduce((s, v) => s + v, 0);
  const avgMonthly = forecast.length ? yearTotal / forecast.length : 0;
  const nextMonthValue = forecast[0]?.forecast ?? 0;
  const nextMonthLabel = forecast[0]?.label ?? '—';

  let peak = forecast[0];
  let trough = forecast[0];
  for (const f of forecast) {
    if (!peak || f.forecast > peak.forecast) peak = f;
    if (!trough || f.forecast < trough.forecast) trough = f;
  }

  const last12 = contiguous.slice(-12);
  const last12ActualTotal = last12.reduce((s, h) => s + h.amount, 0);
  const vsLast12Pct =
    last12ActualTotal > 0 ? ((yearTotal - last12ActualTotal) / last12ActualTotal) * 100 : 0;

  const firstFc = forecast[0]?.forecast ?? 0;
  const lastFc = forecast[forecast.length - 1]?.forecast ?? 0;
  const horizonGrowthPct = firstFc > 0 ? ((lastFc - firstFc) / firstFc) * 100 : 0;
  const vsNaivePct =
    naiveYearTotal > 0 ? ((yearTotal - naiveYearTotal) / naiveYearTotal) * 100 : 0;

  const widgets = buildModelWidgets({
    model: modelResult.model,
    history: contiguous,
    forecastValues: modelResult.values,
    forecastRows: forecast,
    yearTotal,
    avgMonthly,
    nextMonthValue,
    nextMonthLabel,
    peakMonthLabel: peak?.label ?? '—',
    peakValue: peak?.forecast ?? 0,
    troughMonthLabel: trough?.label ?? '—',
    troughValue: trough?.forecast ?? 0,
    last12ActualTotal,
    vsLast12Pct,
    horizonGrowthPct,
    vsNaivePct,
    naiveYearTotal,
  });

  const momComparison: MomComparisonRow[] = [
    ...history.slice(-18).map((h) => ({
      month: h.month,
      label: h.label,
      kind: 'actual' as const,
      spend: h.actual,
    })),
    ...forecast.map((f) => ({
      month: f.month,
      label: f.label,
      kind: 'forecast' as const,
      spend: f.forecast,
    })),
  ];

  return {
    history,
    forecast,
    series: [...history, ...forecast],
    momComparison,
    model: modelResult.model,
    modelLabel: modelLabel(modelResult.model),
    modelNote: modelResult.note,
    latestDataMonth,
    yearTotal,
    avgMonthly,
    nextMonthValue,
    nextMonthLabel,
    peakMonthLabel: peak?.label ?? '—',
    peakValue: peak?.forecast ?? 0,
    troughMonthLabel: trough?.label ?? '—',
    troughValue: trough?.forecast ?? 0,
    last12ActualTotal,
    vsLast12Pct,
    horizonGrowthPct,
    vsNaivePct,
    naiveYearTotal,
    widgets,
  };
}

export function listDataMonths(spends: MonthlySpend[]): string[] {
  return Array.from(new Set(spends.map((s) => s.month).filter(Boolean))).sort();
}

export function monthsEndingAt(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    shiftMonth(endMonth, -(count - 1 - i))
  );
}
