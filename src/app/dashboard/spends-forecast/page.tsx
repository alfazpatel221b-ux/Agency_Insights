'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Loader2, Info } from 'lucide-react';

import { useCollection } from '@/firebase';
import { MonthlySpend } from '@/lib/types';
import {
  buildSpendForecast,
  formatMonthLabel,
  FORECAST_MODEL_OPTIONS,
  type ForecastModelId,
  type SpendForecastResult,
  modelDescription,
} from '@/lib/spend-forecast';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type DimensionFilter = 'overall' | 'industry' | 'type' | 'team';

const formatCurrency = (val: number) => {
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (absVal >= 10000000) return `₹${sign}${(absVal / 10000000).toFixed(2)}Cr`;
  if (absVal >= 100000) return `₹${sign}${(absVal / 100000).toFixed(2)}L`;
  return `₹${sign}${absVal.toLocaleString('en-IN')}`;
};

const formatChartAxis = (val: number) => {
  if (val == null || Number.isNaN(val)) return '';
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (absVal >= 10000000) return `${sign}${(absVal / 10000000).toFixed(1)}Cr`;
  if (absVal >= 100000) return `${sign}${(absVal / 100000).toFixed(1)}L`;
  if (absVal >= 1000) return `${sign}${(absVal / 1000).toFixed(0)}K`;
  return `${sign}${absVal.toFixed(0)}`;
};

const TONE_BORDER: Record<string, string> = {
  primary: 'border-t-primary',
  success: 'border-t-[hsl(var(--success))]',
  warning: 'border-t-amber-500',
  destructive: 'border-t-destructive',
  muted: 'border-t-foreground/30',
};

const TONE_TEXT: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-[hsl(var(--success))]',
  warning: 'text-amber-600',
  destructive: 'text-destructive',
  muted: 'text-secondary',
};

function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SpendsForecastPage() {
  const [mounted, setMounted] = useState(false);
  const [dimension, setDimension] = useState<DimensionFilter>('overall');
  const [dimensionValue, setDimensionValue] = useState<string>('all');
  const [forecastModel, setForecastModel] = useState<ForecastModelId>('holt-winters');

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: rawMonthlyData, loading } = useCollection<MonthlySpend>('monthlySpends');

  const filterOptions = useMemo(() => {
    if (!rawMonthlyData) return { industries: [], types: [], teams: [] };
    return {
      industries: Array.from(new Set(rawMonthlyData.map((d) => d.industry).filter(Boolean))).sort(),
      types: Array.from(new Set(rawMonthlyData.map((d) => d.type).filter(Boolean))).sort(),
      teams: Array.from(new Set(rawMonthlyData.map((d) => d.team).filter(Boolean))).sort(),
    };
  }, [rawMonthlyData]);

  useEffect(() => {
    setDimensionValue('all');
  }, [dimension]);

  const result: SpendForecastResult | null = useMemo(() => {
    if (!rawMonthlyData || !mounted) return null;
    const filter =
      dimension === 'overall' || dimensionValue === 'all'
        ? undefined
        : (row: MonthlySpend) => {
            if (dimension === 'industry') return row.industry === dimensionValue;
            if (dimension === 'type') return row.type === dimensionValue;
            if (dimension === 'team') return row.team === dimensionValue;
            return true;
          };
    return buildSpendForecast(rawMonthlyData, { filter, model: forecastModel });
  }, [rawMonthlyData, mounted, dimension, dimensionValue, forecastModel]);

  const chartData = useMemo(() => {
    if (!result) return [];
    const hist = result.history.slice(-18);
    return [
      ...hist.map((h) => ({
        label: h.label,
        month: h.month,
        actual: h.actual,
        forecast: null as number | null,
      })),
      ...result.forecast.map((f) => ({
        label: f.label,
        month: f.month,
        actual: null as number | null,
        forecast: f.forecast,
      })),
    ];
  }, [result]);

  const dimensionChoices =
    dimension === 'industry'
      ? filterOptions.industries
      : dimension === 'type'
        ? filterOptions.types
        : dimension === 'team'
          ? filterOptions.teams
          : [];

  const exportMom = () => {
    if (!result) return;
    downloadCsv(
      `spends-forecast-${result.model}-${result.latestDataMonth || 'export'}.csv`,
      result.momComparison.map((r) => ({
        Month: r.month,
        Label: r.label,
        Kind: r.kind === 'actual' ? 'Actual' : 'Forecast',
        'Spend (INR)': Math.round(r.spend),
        Model: result.modelLabel,
      }))
    );
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading spends history for forecast…
      </div>
    );
  }

  const activeOption = FORECAST_MODEL_OPTIONS.find((o) => o.id === forecastModel);

  return (
    <div className="flex flex-col gap-6 min-w-0 pb-10">
      <PageHeader
        title="Spends Forecast"
        description="Pure MoM spend forecasting — switch models to compare methods. No churn adjustment; numbers come only from the selected model and historical spends."
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-white/40 dark:bg-white/5 rounded-none p-1 border border-white/20">
            <span className="text-[10px] font-black uppercase tracking-widest pl-2 opacity-50">Model</span>
            <Select
              value={forecastModel}
              onValueChange={(v) => setForecastModel(v as ForecastModelId)}
            >
              <SelectTrigger className="h-8 w-[200px] rounded-none text-[10px] font-black uppercase tracking-widest focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none max-h-80">
                {FORECAST_MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id} className="text-[10px] font-bold">
                    {opt.shortLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 bg-white/40 dark:bg-white/5 rounded-none p-1 border border-white/20">
            <span className="text-[10px] font-black uppercase tracking-widest pl-2 opacity-50">Slice</span>
            <Select
              value={dimension}
              onValueChange={(v) => setDimension(v as DimensionFilter)}
            >
              <SelectTrigger className="h-8 w-32 rounded-none text-[10px] font-black uppercase tracking-widest focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectItem value="overall" className="text-[10px] font-bold">Overall</SelectItem>
                <SelectItem value="industry" className="text-[10px] font-bold">Industry</SelectItem>
                <SelectItem value="type" className="text-[10px] font-bold">Type</SelectItem>
                <SelectItem value="team" className="text-[10px] font-bold">Team</SelectItem>
              </SelectContent>
            </Select>
            {dimension !== 'overall' && (
              <Select value={dimensionValue} onValueChange={setDimensionValue}>
                <SelectTrigger className="h-8 w-40 rounded-none text-[10px] font-black uppercase tracking-widest focus:ring-0">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent className="rounded-none max-h-64">
                  <SelectItem value="all" className="text-[10px] font-bold">All</SelectItem>
                  {dimensionChoices.map((v) => (
                    <SelectItem key={v} value={v} className="text-[10px] font-bold">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-none text-[10px] font-black uppercase tracking-widest"
            onClick={exportMom}
            disabled={!result?.momComparison.length}
          >
            <Download className="h-3 w-3 mr-1" /> Forecast CSV
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {FORECAST_MODEL_OPTIONS.map((opt) => {
          const active = forecastModel === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setForecastModel(opt.id)}
              className={cn(
                'h-8 px-3 text-[10px] font-black uppercase tracking-widest border transition-colors',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white/40 dark:bg-white/5 border-foreground/15 text-foreground hover:border-primary/50'
              )}
              title={opt.description}
            >
              {opt.shortLabel}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-none border border-foreground/15 bg-white/50 dark:bg-white/5 px-3 py-2 text-xs text-secondary">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <p>
          <span className="font-semibold text-foreground">{result?.modelLabel || activeOption?.label}:</span>{' '}
          {modelDescription(forecastModel)}
          {result?.modelNote ? ` (${result.modelNote})` : ''}
          {result?.latestDataMonth
            ? ` · History through ${formatMonthLabel(result.latestDataMonth)} (${result.history.length} months)`
            : ' · No monthly spends found'}
          .
        </p>
      </div>

      {/* Model-specific widgets — titles/values change with the selected engine */}
      <div
        key={forecastModel}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 min-w-0"
      >
        {(result?.widgets || []).map((w) => (
          <Card
            key={`${forecastModel}-${w.id}`}
            className={cn(
              'glass-card min-w-0 overflow-hidden border-t-4',
              TONE_BORDER[w.tone] || TONE_BORDER.primary
            )}
          >
            <CardHeader className="pb-2">
              <CardDescription
                className={cn(
                  'text-[10px] font-black uppercase tracking-widest',
                  TONE_TEXT[w.tone] || TONE_TEXT.primary
                )}
              >
                {w.title}
              </CardDescription>
              <CardTitle className="text-xl md:text-2xl font-black font-headline break-all leading-[1.1]">
                {w.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-secondary leading-snug">
              {w.subtitle}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-black uppercase tracking-widest">
            MoM Actual vs {activeOption?.shortLabel || 'Forecast'}
          </CardTitle>
          <CardDescription className="text-xs">
            Bars = historical actuals · Line = {result?.modelLabel} forecast (pure model output)
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[380px] min-w-0 pt-2">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No monthly spend data available to forecast.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--foreground) / 0.12)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fontWeight: 700 }}
                  interval="preserveStartEnd"
                />
                <YAxis tickFormatter={formatChartAxis} tick={{ fontSize: 10 }} width={56} />
                <Tooltip
                  contentStyle={{ borderRadius: 0, border: '1px solid #000', fontSize: 12 }}
                  formatter={(val: number, name: string) => [formatCurrency(val), name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                <Bar
                  dataKey="actual"
                  name="Actual"
                  fill="hsl(223 100% 33%)"
                  maxBarSize={28}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name={`${activeOption?.shortLabel || 'Forecast'}`}
                  stroke="hsl(163 100% 32%)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card min-w-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-black uppercase tracking-widest">
            12-Month Forecast · {activeOption?.shortLabel}
          </CardTitle>
          <CardDescription className="text-xs">
            Pure {result?.modelLabel} projection — no churn overlay
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase">Month</TableHead>
                <TableHead className="text-[10px] font-black uppercase">Kind</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-right">Spend</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-right">Share of F/C year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(result?.forecast || []).map((f) => (
                <TableRow key={f.month} className="bg-primary/[0.03]">
                  <TableCell className="font-mono text-xs font-bold">{f.label}</TableCell>
                  <TableCell className="text-[10px] font-black uppercase tracking-wider text-secondary">
                    Forecast
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">
                    {formatCurrency(f.forecast)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-secondary">
                    {result && result.yearTotal > 0
                      ? `${((f.forecast / result.yearTotal) * 100).toFixed(1)}%`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {result?.forecast.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">
                    No forecast rows
                  </TableCell>
                </TableRow>
              )}
              {result && result.forecast.length > 0 && (
                <TableRow>
                  <TableCell className="font-black text-xs uppercase" colSpan={2}>
                    Horizon total
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-black">
                    {formatCurrency(result.yearTotal)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">100%</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
