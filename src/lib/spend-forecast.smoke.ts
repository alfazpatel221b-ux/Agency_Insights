/**
 * Smoke checks for pure multi-model spend forecasting (no churn).
 * Run: npx --yes tsx src/lib/spend-forecast.smoke.ts
 */
import {
  buildSpendForecast,
  forecastHoltWinters,
  shiftMonth,
  type MonthAmount,
} from './spend-forecast';
import { runForecastModel, FORECAST_MODEL_OPTIONS } from './spend-forecast-models';
import type { MonthlySpend } from './types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function spend(
  clientId: string,
  month: string,
  amount: number,
  brand = clientId
): MonthlySpend {
  return {
    id: `${clientId}-${month}`,
    clientId,
    brandName: brand,
    industry: 'Tech',
    type: 'Performance',
    subEntity: 'A',
    channelVendor: 'Meta',
    creditLine: 'CL',
    currency: 'INR',
    team: 'Team1',
    month,
    actualSpendsInr: amount,
  };
}

const shortHistory: MonthAmount[] = Array.from({ length: 8 }, (_, i) => ({
  month: `2025-${String(i + 1).padStart(2, '0')}`,
  amount: 1_00_00_000 + i * 10_00_000,
}));
const shortFc = forecastHoltWinters(shortHistory, 12);
assert(shortFc.values.length === 12, 'short forecast length');

const longHistory: MonthAmount[] = Array.from({ length: 30 }, (_, i) => ({
  month: shiftMonth('2023-01', i),
  amount: 80_00_00_000 + (i % 12) * 5_00_00_000 + Math.floor(i / 12) * 8_00_00_000,
}));

const modelTotals: Record<string, number> = {};
for (const opt of FORECAST_MODEL_OPTIONS) {
  const r = runForecastModel(opt.id, longHistory, 12);
  assert(r.values.length === 12, `${opt.id} length`);
  assert(r.values.every((v) => v >= 0 && Number.isFinite(v)), `${opt.id} finite`);
  modelTotals[opt.id] = r.values.reduce((s, v) => s + v, 0);
}

// Models should not all produce identical year totals on seasonal data
const uniqueTotals = new Set(Object.values(modelTotals).map((v) => Math.round(v / 1e5)));
assert(uniqueTotals.size >= 3, `expected diverse model totals, got ${[...uniqueTotals]}`);

const rows: MonthlySpend[] = [];
for (let i = 0; i < 30; i++) {
  rows.push(spend('KEEP', shiftMonth('2023-01', i), 100 * 1_00_00_000 + (i % 12) * 5_00_00_000, 'Keeper'));
}

const hw = buildSpendForecast(rows, { model: 'holt-winters' });
const naive = buildSpendForecast(rows, { model: 'seasonal-naive' });
const linear = buildSpendForecast(rows, { model: 'linear' });

assert(hw.forecast.length === 12, 'hw forecast months');
assert(hw.widgets.length >= 5, 'hw widgets');
assert(naive.widgets.length >= 5, 'naive widgets');
assert(linear.widgets.length >= 5, 'linear widgets');

// Widget titles/content should differ across models (model-specific cards)
const hwTitles = hw.widgets.map((w) => w.title).join('|');
const naiveTitles = naive.widgets.map((w) => w.title).join('|');
const linearTitles = linear.widgets.map((w) => w.title).join('|');
assert(hwTitles !== naiveTitles || hw.widgets.some((w, i) => w.value !== naive.widgets[i]?.value), 'hw vs naive widgets differ');
assert(linearTitles !== hwTitles, 'linear widget titles differ from hw');

// No churn fields on forecast rows
assert('forecast' in hw.forecast[0], 'pure forecast field');
assert(!('churnImpact' in (hw.forecast[0] as object)), 'no churn on forecast');

assert(Math.abs(hw.yearTotal - naive.yearTotal) > 1 || Math.abs(linear.yearTotal - hw.yearTotal) > 1, 'model year totals can differ');

console.log('spend-forecast smoke checks passed');
console.log({
  hwYear: Math.round(hw.yearTotal),
  naiveYear: Math.round(naive.yearTotal),
  linearYear: Math.round(linear.yearTotal),
  hwWidgetTitles: hw.widgets.map((w) => w.title),
  linearWidgetTitles: linear.widgets.map((w) => w.title),
});
