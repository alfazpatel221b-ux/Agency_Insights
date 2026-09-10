/**
 * Selectable forecast engines. Prophet is a pure-TS Prophet-style model
 * (trend + Fourier yearly seasonality) — not the Python facebook/prophet package.
 */

export interface SeriesPoint {
  month: string;
  amount: number;
}
export const FORECAST_HORIZON_MONTHS_DEFAULT = 12;

export type ForecastModelId =
  | 'holt-winters'
  | 'seasonal-naive'
  | 'linear'
  | 'polynomial'
  | 'arima'
  | 'sarima'
  | 'regression-features'
  | 'prophet';

export interface ForecastModelOption {
  id: ForecastModelId;
  label: string;
  shortLabel: string;
  description: string;
}

export const FORECAST_MODEL_OPTIONS: ForecastModelOption[] = [
  {
    id: 'holt-winters',
    label: 'Holt-Winters (seasonal)',
    shortLabel: 'Holt-Winters',
    description: 'Level + trend + yearly seasonality. Strong default for MoM spends.',
  },
  {
    id: 'seasonal-naive',
    label: 'Seasonal naive / YoY',
    shortLabel: 'YoY Naive',
    description: 'Same month last year (optionally scaled by recent YoY growth).',
  },
  {
    id: 'linear',
    label: 'Linear regression (time)',
    shortLabel: 'Linear',
    description: 'Ordinary least squares of spend vs time index.',
  },
  {
    id: 'polynomial',
    label: 'Polynomial regression (time)',
    shortLabel: 'Polynomial',
    description: 'Quadratic fit of spend vs time (captures gentle curves).',
  },
  {
    id: 'arima',
    label: 'ARIMA',
    shortLabel: 'ARIMA',
    description: 'ARIMA(2,1,0)-style: differenced autoregression on recent lags.',
  },
  {
    id: 'sarima',
    label: 'SARIMA',
    shortLabel: 'SARIMA',
    description: 'Seasonal difference (12) + AR on seasonally differenced series.',
  },
  {
    id: 'regression-features',
    label: 'Regression + features',
    shortLabel: 'Features',
    description: 'OLS with trend, month-of-year, lag-1 & lag-12 spends (slice = industry/type filter).',
  },
  {
    id: 'prophet',
    label: 'Prophet-style',
    shortLabel: 'Prophet',
    description: 'Trend + Fourier yearly seasonality (Prophet-inspired, runs in-browser).',
  },
];

export function modelLabel(id: ForecastModelId): string {
  return FORECAST_MODEL_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

export function modelDescription(id: ForecastModelId): string {
  return FORECAST_MODEL_OPTIONS.find((o) => o.id === id)?.description ?? '';
}

export interface ModelForecastResult {
  values: number[];
  model: ForecastModelId;
  /** If the chosen model needed a simpler fallback due to short history. */
  fallbackFrom?: ForecastModelId;
  note?: string;
}

function clampNonNeg(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
}

function series(history: SeriesPoint[]): number[] {
  return history.map((h) => Math.max(0, h.amount));
}

/** Solve Xβ ≈ y via normal equations (Gaussian elimination). */
function ols(X: number[][], y: number[]): number[] | null {
  const n = X.length;
  if (n === 0) return null;
  const p = X[0].length;
  if (y.length !== n || p === 0) return null;

  // XtX and Xty
  const A: number[][] = Array.from({ length: p }, () => Array(p + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      A[a][p] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) {
        A[a][b] += X[i][a] * X[i][b];
      }
    }
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
    }
    const div = A[col][col];
    for (let c = col; c <= p; c++) A[col][c] /= div;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = col; c <= p; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[p]);
}

function linearTrendFallback(y: number[], horizon: number): number[] {
  const n = y.length;
  if (n === 0) return Array(horizon).fill(0);
  const last = y[n - 1] ?? 0;
  let slope = 0;
  if (n >= 2) {
    const k = Math.min(6, n - 1);
    slope = (y[n - 1] - y[n - 1 - k]) / k;
  }
  return Array.from({ length: horizon }, (_, i) => Math.max(0, last + slope * (i + 1)));
}

function forecastSeasonalNaive(y: number[], horizon: number, season = 12): number[] {
  const n = y.length;
  if (n < season) return linearTrendFallback(y, horizon);
  // Scale by recent YoY growth when available
  let scale = 1;
  if (n >= season * 2) {
    const recent = y.slice(n - season).reduce((s, v) => s + v, 0);
    const prior = y.slice(n - season * 2, n - season).reduce((s, v) => s + v, 0);
    if (prior > 0) scale = Math.min(1.5, Math.max(0.5, recent / prior));
  }
  return Array.from({ length: horizon }, (_, i) => {
    const idx = n - season + (i % season);
    return Math.max(0, (y[idx] ?? y[n - 1] ?? 0) * scale);
  });
}

function forecastLinear(y: number[], horizon: number): number[] {
  const n = y.length;
  if (n < 2) return linearTrendFallback(y, horizon);
  const X = y.map((_, t) => [1, t]);
  const beta = ols(X, y);
  if (!beta) return linearTrendFallback(y, horizon);
  const [a, b] = beta;
  return Array.from({ length: horizon }, (_, i) => Math.max(0, a + b * (n + i)));
}

function forecastPolynomial(y: number[], horizon: number): number[] {
  const n = y.length;
  if (n < 3) return forecastLinear(y, horizon);
  // Normalize time to reduce ill-conditioning
  const X = y.map((_, t) => {
    const u = t / Math.max(1, n - 1);
    return [1, u, u * u];
  });
  const beta = ols(X, y);
  if (!beta) return forecastLinear(y, horizon);
  const [a, b, c] = beta;
  return Array.from({ length: horizon }, (_, i) => {
    const u = (n + i) / Math.max(1, n - 1);
    return Math.max(0, a + b * u + c * u * u);
  });
}

/** ARIMA(2,1,0): Δy_t = φ1 Δy_{t-1} + φ2 Δy_{t-2} */
function forecastArima(y: number[], horizon: number): number[] {
  const n = y.length;
  if (n < 6) return linearTrendFallback(y, horizon);

  const dY: number[] = [];
  for (let t = 1; t < n; t++) dY.push(y[t] - y[t - 1]);

  const rows: number[][] = [];
  const targets: number[] = [];
  for (let t = 2; t < dY.length; t++) {
    rows.push([dY[t - 1], dY[t - 2]]);
    targets.push(dY[t]);
  }
  const phi = ols(rows, targets) || [0, 0];
  const [p1, p2] = phi;

  const diffs = dY.slice();
  const forecasts: number[] = [];
  let level = y[n - 1];
  for (let i = 0; i < horizon; i++) {
    const d1 = diffs[diffs.length - 1] ?? 0;
    const d2 = diffs[diffs.length - 2] ?? 0;
    const dNext = p1 * d1 + p2 * d2;
    diffs.push(dNext);
    level = Math.max(0, level + dNext);
    forecasts.push(level);
  }
  return forecasts;
}

/**
 * SARIMA-lite: seasonal difference (lag 12), AR(1) on seasonally differenced
 * series, then invert seasonal differences. Falls back to seasonal naive.
 */
function forecastSarima(y: number[], horizon: number, season = 12): number[] {
  const n = y.length;
  if (n < season + 4) {
    return forecastSeasonalNaive(y, horizon, season);
  }

  const seasonDiff: number[] = [];
  for (let t = season; t < n; t++) {
    seasonDiff.push(y[t] - y[t - season]);
  }

  const rows: number[][] = [];
  const targets: number[] = [];
  for (let t = 1; t < seasonDiff.length; t++) {
    rows.push([1, seasonDiff[t - 1]]);
    targets.push(seasonDiff[t]);
  }
  const beta = ols(rows, targets) || [0, 0];
  const [c, phi] = beta;

  const extended = y.slice();
  let lastSd = seasonDiff[seasonDiff.length - 1] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    lastSd = c + phi * lastSd;
    const seasonalBase = extended[extended.length - season] ?? extended[extended.length - 1] ?? 0;
    const next = Math.max(0, seasonalBase + lastSd);
    extended.push(next);
    out.push(next);
  }
  return out;
}

/**
 * Feature regression: intercept, trend, month-of-year Fourier, lag1, lag12.
 * Industry/type enter via the page slice filter (series already scoped).
 */
function forecastRegressionFeatures(
  history: SeriesPoint[],
  horizon: number,
  season = 12
): number[] {
  const y = series(history);
  const n = y.length;
  if (n < season + 2) return forecastSeasonalNaive(y, horizon, season);

  const monthIndex = (month: string) => {
    const m = Number(month.split('-')[1] || '1');
    return ((m - 1) % 12) + 1; // 1..12
  };

  const X: number[][] = [];
  const targets: number[] = [];
  for (let t = season; t < n; t++) {
    const moy = monthIndex(history[t].month);
    const ang = (2 * Math.PI * moy) / 12;
    X.push([
      1,
      t / n,
      Math.sin(ang),
      Math.cos(ang),
      y[t - 1],
      y[t - season],
    ]);
    targets.push(y[t]);
  }
  const beta = ols(X, targets);
  if (!beta) return forecastSeasonalNaive(y, horizon, season);

  const extendedY = y.slice();
  const extendedMonths = history.map((h) => h.month);
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const t = n + i;
    const lastMonth = extendedMonths[extendedMonths.length - 1];
    // next calendar month label approx via increment — caller uses real months;
    // for features we only need month-of-year index.
    const lastMoy = monthIndex(lastMonth);
    const nextMoy = (lastMoy % 12) + 1;
    const ang = (2 * Math.PI * nextMoy) / 12;
    const lag1 = extendedY[extendedY.length - 1] ?? 0;
    const lag12 = extendedY[extendedY.length - season] ?? lag1;
    const pred = Math.max(
      0,
      beta[0] +
        beta[1] * (t / n) +
        beta[2] * Math.sin(ang) +
        beta[3] * Math.cos(ang) +
        beta[4] * lag1 +
        beta[5] * lag12
    );
    extendedY.push(pred);
    // fabricate next month string for moy progression
    const [yy, mm] = lastMonth.split('-').map(Number);
    const nextMm = mm === 12 ? 1 : mm + 1;
    const nextYy = mm === 12 ? yy + 1 : yy;
    extendedMonths.push(`${nextYy}-${String(nextMm).padStart(2, '0')}`);
    out.push(pred);
  }
  return out;
}

/** Prophet-inspired: linear trend + Fourier yearly seasonality (k=1..3). */
function forecastProphetStyle(y: number[], horizon: number, season = 12): number[] {
  const n = y.length;
  if (n < season) return linearTrendFallback(y, horizon);

  const X: number[][] = [];
  for (let t = 0; t < n; t++) {
    const row = [1, t / n];
    for (let k = 1; k <= 3; k++) {
      const ang = (2 * Math.PI * k * t) / season;
      row.push(Math.sin(ang), Math.cos(ang));
    }
    X.push(row);
  }
  const beta = ols(X, y);
  if (!beta) return forecastSeasonalNaive(y, horizon, season);

  return Array.from({ length: horizon }, (_, i) => {
    const t = n + i;
    let pred = beta[0] + beta[1] * (t / n);
    for (let k = 1; k <= 3; k++) {
      const ang = (2 * Math.PI * k * t) / season;
      const bi = 2 + (k - 1) * 2;
      pred += beta[bi] * Math.sin(ang) + beta[bi + 1] * Math.cos(ang);
    }
    return Math.max(0, pred);
  });
}

function forecastHoltWintersCore(y: number[], horizon: number, seasonLength = 12): number[] {
  const n = y.length;
  if (n < seasonLength * 1.5) {
    if (n >= seasonLength) return forecastSeasonalNaive(y, horizon, seasonLength);
    return linearTrendFallback(y, horizon);
  }

  const alpha = 0.35;
  const beta = 0.1;
  const gamma = 0.25;

  const seasons = Math.floor(n / seasonLength);
  const seasonals = new Array(seasonLength).fill(0);
  const seasonAverages: number[] = [];
  for (let s = 0; s < seasons; s++) {
    let sum = 0;
    for (let i = 0; i < seasonLength; i++) sum += y[s * seasonLength + i];
    seasonAverages.push(sum / seasonLength);
  }

  for (let i = 0; i < seasonLength; i++) {
    let sum = 0;
    for (let s = 0; s < seasons; s++) {
      sum += y[s * seasonLength + i] - seasonAverages[s];
    }
    seasonals[i] = sum / seasons;
  }

  let level = seasonAverages[0] ?? y[0];
  let trend =
    seasons >= 2
      ? (seasonAverages[1] - seasonAverages[0]) / seasonLength
      : (y[Math.min(seasonLength, n - 1)] - y[0]) / Math.min(seasonLength, n - 1 || 1);

  for (let t = 0; t < n; t++) {
    const value = y[t];
    const sIdx = t % seasonLength;
    const lastLevel = level;
    const seasonal = seasonals[sIdx];
    level = alpha * (value - seasonal) + (1 - alpha) * (level + trend);
    trend = beta * (level - lastLevel) + (1 - beta) * trend;
    seasonals[sIdx] = gamma * (value - level) + (1 - gamma) * seasonal;
  }

  return Array.from({ length: horizon }, (_, i) => {
    const sIdx = (n + i) % seasonLength;
    return Math.max(0, level + (i + 1) * trend + seasonals[sIdx]);
  });
}

export function runForecastModel(
  model: ForecastModelId,
  history: SeriesPoint[],
  horizon = FORECAST_HORIZON_MONTHS_DEFAULT
): ModelForecastResult {
  const y = series(history);
  if (y.length === 0) {
    return { values: Array(horizon).fill(0), model, note: 'No history' };
  }

  switch (model) {
    case 'holt-winters': {
      const values = clampNonNeg(forecastHoltWintersCore(y, horizon));
      const usedFallback =
        y.length < 18
          ? y.length >= 12
            ? ('seasonal-naive' as ForecastModelId)
            : ('linear' as ForecastModelId)
          : undefined;
      return {
        values,
        model: 'holt-winters',
        fallbackFrom: usedFallback,
        note: usedFallback
          ? `Short history — Holt-Winters internally used ${usedFallback} components`
          : undefined,
      };
    }
    case 'seasonal-naive':
      return { values: clampNonNeg(forecastSeasonalNaive(y, horizon)), model };
    case 'linear':
      return { values: clampNonNeg(forecastLinear(y, horizon)), model };
    case 'polynomial':
      return { values: clampNonNeg(forecastPolynomial(y, horizon)), model };
    case 'arima':
      return { values: clampNonNeg(forecastArima(y, horizon)), model };
    case 'sarima':
      return {
        values: clampNonNeg(forecastSarima(y, horizon)),
        model,
        note: y.length < 16 ? 'Short history — SARIMA leans on seasonal naive' : undefined,
      };
    case 'regression-features':
      return {
        values: clampNonNeg(forecastRegressionFeatures(history, horizon)),
        model,
        note: 'Features: trend, month-of-year, lag-1, lag-12 (industry/type via slice)',
      };
    case 'prophet':
      return {
        values: clampNonNeg(forecastProphetStyle(y, horizon)),
        model,
        note: 'In-browser Prophet-style (trend + Fourier seasonality)',
      };
    default:
      return { values: clampNonNeg(forecastHoltWintersCore(y, horizon)), model: 'holt-winters' };
  }
}
