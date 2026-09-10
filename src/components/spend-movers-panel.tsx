'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronsUpDown, Download, Filter, Search, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import { BrandPeriodMover } from '@/lib/spend-week';
import {
  COMPARE_GRAINS,
  type ClientCompareRow,
  type CompareProgressPoint,
  type SpendCompareGrain,
  type SpendPeriodOption,
} from '@/lib/spend-compare';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type SortKey = 'change' | 'pct';
type SortDir = 'asc' | 'desc';

function periodDeltaClass(current: number, previous: number | undefined, isFirst: boolean) {
  if (isFirst || previous == null) return 'text-ink';
  if (current === previous) return 'text-secondary';
  return current > previous ? 'text-success' : 'text-destructive';
}

function MultiSelectFilter({
  label,
  placeholder,
  options,
  selected,
  onToggle,
}: {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () => options.filter((o) => (o || '').toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );
  const active = selected.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`spend-compare-filter-${label.toLowerCase()}`}
          className={cn(
            'flex h-9 items-center gap-2 border px-3 text-[10px] font-black uppercase tracking-widest',
            active ? 'border-ink bg-ink text-cream' : 'border-ink/15 text-secondary hover:text-ink'
          )}
        >
          <Filter className="h-3 w-3" />
          {label}
          {active ? ` (${selected.length})` : ''}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] rounded-none p-2" align="start">
        <div className="mb-2 border-b border-foreground/5 p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              placeholder={placeholder}
              className="h-9 rounded-none border-none bg-foreground/5 pl-8 text-xs focus-visible:ring-1 focus-visible:ring-primary/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="custom-scrollbar max-h-[280px] space-y-1 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <div
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-none p-2 text-xs font-bold hover:bg-foreground/5"
                onClick={() => onToggle(option)}
              >
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-md border transition-colors',
                    selected.includes(option) ? 'border-primary bg-primary text-white' : 'border-foreground/20'
                  )}
                >
                  {selected.includes(option) && <Check className="h-3 w-3" />}
                </div>
                {option}
              </div>
            ))
          ) : (
            <div className="p-4 text-center text-[10px] italic text-muted-foreground">No results found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SpendMoversPanel({
  grain,
  onGrainChange,
  periodA,
  periodB,
  onPeriodAChange,
  onPeriodBChange,
  periodOptions,
  baselineLabel,
  compareLabel,
  baselineTotal,
  compareTotal,
  movers,
  clientRows,
  excludeLargeClients,
  onExcludeChange,
  selectedBrand,
  onSelectBrand,
  formatCurrency,
  onShortcut,
  progression,
  clientOptions,
  typeOptions,
  channelOptions,
  compareClients,
  compareTypes,
  compareChannels,
  onToggleCompareClient,
  onToggleCompareType,
  onToggleCompareChannel,
  onClearCompareFilters,
}: {
  grain: SpendCompareGrain;
  onGrainChange: (grain: SpendCompareGrain) => void;
  periodA: string;
  periodB: string;
  onPeriodAChange: (id: string) => void;
  onPeriodBChange: (id: string) => void;
  periodOptions: SpendPeriodOption[];
  baselineLabel: string;
  compareLabel: string;
  baselineTotal: number;
  compareTotal: number;
  movers: BrandPeriodMover[];
  clientRows?: ClientCompareRow[];
  excludeLargeClients: boolean;
  onExcludeChange: (next: boolean) => void;
  selectedBrand?: string | null;
  onSelectBrand: (brand: string) => void;
  formatCurrency: (val: number) => string;
  onShortcut: (kind: 'prior' | 'lastYear' | 'twoYears') => void;
  progression: CompareProgressPoint[];
  clientOptions: string[];
  typeOptions: string[];
  channelOptions: string[];
  compareClients: string[];
  compareTypes: string[];
  compareChannels: string[];
  onToggleCompareClient: (value: string) => void;
  onToggleCompareType: (value: string) => void;
  onToggleCompareChannel: (value: string) => void;
  onClearCompareFilters: () => void;
}) {
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<'all' | 'up' | 'down'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('change');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { toast } = useToast();

  const rows: ClientCompareRow[] = useMemo(() => {
    if (clientRows && clientRows.length > 0) return clientRows;
    return movers.map((row) => ({
      ...row,
      series: { [periodA]: row.previous, [periodB]: row.current },
    }));
  }, [clientRows, movers, periodA, periodB]);

  const periodCols = progression.length > 0 ? progression : [
    { id: periodA, label: baselineLabel || 'Baseline', spend: 0, isEndpoint: true },
    { id: periodB, label: compareLabel || 'Compare', spend: 0, isEndpoint: true },
  ].filter((p) => p.id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      if (side === 'up' && row.diff <= 0) return false;
      if (side === 'down' && row.diff >= 0) return false;
      if (!q) return true;
      return (
        row.brand.toLowerCase().includes(q) ||
        row.type.toLowerCase().includes(q) ||
        row.team.toLowerCase().includes(q)
      );
    });
    const mul = sortDir === 'desc' ? -1 : 1;
    next.sort((a, b) => {
      const primary = sortKey === 'pct' ? a.percentage - b.percentage : a.diff - b.diff;
      if (primary !== 0) return mul * primary;
      return Math.abs(b.diff) - Math.abs(a.diff);
    });
    return next;
  }, [rows, query, side, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  };

  const SortBtn = ({ column, label }: { column: SortKey; label: string }) => {
    const active = sortKey === column;
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="inline-flex items-center justify-end gap-1 w-full uppercase tracking-widest"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? (
          sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    );
  };
  const net = compareTotal - baselineTotal;
  const pct = baselineTotal > 0 ? (net / baselineTotal) * 100 : compareTotal > 0 ? 100 : 0;
  const scopeActive = compareClients.length > 0 || compareTypes.length > 0 || compareChannels.length > 0;
  const scopeBits = [
    compareTypes.length ? compareTypes.join(', ') : null,
    compareChannels.length ? compareChannels.join(', ') : null,
    compareClients.length ? `${compareClients.length} client${compareClients.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  const swap = () => {
    onPeriodAChange(periodB);
    onPeriodBChange(periodA);
  };

  const exportComparison = async () => {
    const filename = `Agency_Spend_Comparison_${periodA || 'baseline'}_vs_${periodB || 'compare'}.xlsx`;
    try {
      const { Workbook } = await import('exceljs');
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Spend comparison');
      const periodLabels = periodCols.map((period) => period.label);
      const selectedFilters = [
        `Grain: ${COMPARE_GRAINS.find((option) => option.value === grain)?.label || grain}`,
        `Baseline: ${baselineLabel || periodA || '—'}`,
        `Compare: ${compareLabel || periodB || '—'}`,
        `Client: ${compareClients.length ? compareClients.join(', ') : 'All'}`,
        `Type: ${compareTypes.length ? compareTypes.join(', ') : 'All'}`,
        `Channel: ${compareChannels.length ? compareChannels.join(', ') : 'All'}`,
        `Exclude Orion Retail & Nova Mobility: ${excludeLargeClients ? 'Yes' : 'No'}`,
        `View: ${side === 'all' ? 'All' : side === 'up' ? 'Gainers' : 'Losers'}`,
        `Search: ${query.trim() || 'None'}`,
      ];

    sheet.addRow(['AGENCY INSIGHTS · SPEND COMPARISON']);
    sheet.addRow(['Exported', new Date()]);
    selectedFilters.forEach((filter) => sheet.addRow([filter]));
    sheet.addRow([]);
    const headerRow = sheet.addRow([
      '#',
      'Client',
      'Type',
      ...periodLabels,
      'Change',
      'Change %',
    ]);

    const brandColumnIndex = 2;
    const typeColumnIndex = 3;
    const periodStartIndex = 4;
    const changeColumnIndex = periodStartIndex + periodCols.length;
    const percentageColumnIndex = changeColumnIndex + 1;
    const headerFill = '181818';
    const positiveFill = 'DDF4E8';
    const negativeFill = 'FDE2E2';
    const neutralFill = 'F3F0EA';
    const whiteFont = { color: { argb: 'FFFFFFFF' }, bold: true };

    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
      cell.font = { ...whiteFont, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    filtered.forEach((row, rowIndex) => {
      const values = periodCols.map((col) => row.series?.[col.id] || 0);
      const excelRow = sheet.addRow([
        rowIndex + 1,
        row.brand,
        row.type,
        ...values,
        row.diff,
        row.percentage / 100,
      ]);
      excelRow.getCell(brandColumnIndex).font = { bold: true };
      excelRow.getCell(typeColumnIndex).font = { color: { argb: '666666' } };
      periodCols.forEach((col, colIndex) => {
        const value = values[colIndex];
        const previous = colIndex > 0 ? values[colIndex - 1] : undefined;
        const cell = excelRow.getCell(periodStartIndex + colIndex);
        cell.numFmt = '₹#,##0;[Red]-₹#,##0;—';
        cell.alignment = { horizontal: 'right' };
        if (value === 0 || previous === undefined || value === previous) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: neutralFill } };
        } else if (value > previous) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: positiveFill } };
          cell.font = { color: { argb: '16834B' } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: negativeFill } };
          cell.font = { color: { argb: 'C62828' } };
        }
      });
      const changeCell = excelRow.getCell(changeColumnIndex);
      const percentageCell = excelRow.getCell(percentageColumnIndex);
      changeCell.numFmt = '₹#,##0;[Red]-₹#,##0;—';
      percentageCell.numFmt = '0.0%;[Red]-0.0%;—';
      const changeColor = row.diff > 0 ? '16834B' : row.diff < 0 ? 'C62828' : '666666';
      [changeCell, percentageCell].forEach((cell) => {
        cell.font = { bold: true, color: { argb: changeColor } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: row.diff > 0 ? positiveFill : row.diff < 0 ? negativeFill : neutralFill },
        };
        cell.alignment = { horizontal: 'right' };
      });
    });

    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: '181818' } };
    sheet.getCell('A2').numFmt = 'dd mmm yyyy hh:mm';
    sheet.getColumn(brandColumnIndex).width = 28;
    sheet.getColumn(typeColumnIndex).width = 18;
    for (let index = periodStartIndex; index <= percentageColumnIndex; index += 1) {
      sheet.getColumn(index).width = 16;
    }
    sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
    sheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: Math.max(headerRow.number, sheet.rowCount), column: percentageColumnIndex },
    };

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), filename);
      toast({
        title: 'Export complete',
        description: `${filename} downloaded successfully.`,
      });
    } catch (error) {
      console.error('Spend comparison export failed:', error);
      toast({
        title: 'Export failed',
        description: 'The comparison could not be exported. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="glass-card" data-testid="spend-movers-panel">
      <CardHeader className="gap-4 space-y-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-bold font-headline">Compare any two periods</CardTitle>
            <CardDescription className="text-xs uppercase font-black tracking-widest opacity-50 mt-1">
              One row per client. Type and channel slice spend (Performance, Marketplace, Meta…) without splitting the table.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 border border-ink/10 bg-cream/60 px-3 py-2">
            <Switch
              id="exclude-spends-large-clients"
              checked={excludeLargeClients}
              onCheckedChange={onExcludeChange}
              className="rounded-none data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink/20"
            />
            <Label
              htmlFor="exclude-spends-large-clients"
              className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-secondary leading-tight"
            >
              Exclude Orion Retail &amp; Nova Mobility
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="spend-compare-scopes">
          <MultiSelectFilter
            label="Client"
            placeholder="Search clients…"
            options={clientOptions}
            selected={compareClients}
            onToggle={onToggleCompareClient}
          />
          <MultiSelectFilter
            label="Type"
            placeholder="Search types…"
            options={typeOptions}
            selected={compareTypes}
            onToggle={onToggleCompareType}
          />
          <MultiSelectFilter
            label="Channel"
            placeholder="Search channels…"
            options={channelOptions}
            selected={compareChannels}
            onToggle={onToggleCompareChannel}
          />
          {scopeActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 rounded-none px-2 text-[10px] font-black uppercase tracking-widest text-destructive"
              onClick={onClearCompareFilters}
            >
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
        </div>
        {scopeActive && (
          <div className="text-[9px] font-black uppercase tracking-widest text-secondary">
            Scoped to {scopeBits.join(' · ')} — chart, totals, and table use this slice
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2" data-testid="spend-compare-controls">
          <div className="space-y-1">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">Grain</div>
            <Select value={grain} onValueChange={(v) => onGrainChange(v as SpendCompareGrain)}>
              <SelectTrigger className="h-9 w-[120px] rounded-none text-[10px] font-black uppercase tracking-widest">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {COMPARE_GRAINS.map((g) => (
                  <SelectItem key={g.value} value={g.value} className="text-[10px] font-bold uppercase">
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-[140px]">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">Baseline</div>
            <Select value={periodA} onValueChange={onPeriodAChange}>
              <SelectTrigger className="h-9 rounded-none text-[10px] font-black uppercase tracking-widest">
                <SelectValue placeholder="From" />
              </SelectTrigger>
              <SelectContent className="rounded-none max-h-72">
                {periodOptions.map((o) => (
                  <SelectItem key={`a-${o.id}`} value={o.id} className="text-[10px] font-bold uppercase">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={swap}
            title="Swap periods"
            aria-label="Swap periods"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <div className="space-y-1 min-w-[140px]">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">Compare</div>
            <Select value={periodB} onValueChange={onPeriodBChange}>
              <SelectTrigger className="h-9 rounded-none text-[10px] font-black uppercase tracking-widest">
                <SelectValue placeholder="To" />
              </SelectTrigger>
              <SelectContent className="rounded-none max-h-72">
                {periodOptions.map((o) => (
                  <SelectItem key={`b-${o.id}`} value={o.id} className="text-[10px] font-bold uppercase">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-9 border border-ink/15">
            <button
              type="button"
              onClick={() => onShortcut('prior')}
              className="px-3 text-[9px] font-black uppercase tracking-widest text-secondary hover:text-ink"
            >
              Prior
            </button>
            <button
              type="button"
              onClick={() => onShortcut('lastYear')}
              className="px-3 text-[9px] font-black uppercase tracking-widest text-secondary hover:text-ink border-l border-ink/15"
            >
              Last year
            </button>
            <button
              type="button"
              onClick={() => onShortcut('twoYears')}
              className="px-3 text-[9px] font-black uppercase tracking-widest text-secondary hover:text-ink border-l border-ink/15"
              data-testid="spend-compare-two-years"
            >
              2 years ago
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-none text-[10px] font-black uppercase tracking-widest"
            onClick={exportComparison}
            disabled={filtered.length === 0}
            title="Export displayed comparison"
          >
            <Download className="mr-2 h-3.5 w-3.5" />
            Export
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-ink/10 px-3 py-2">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">{baselineLabel || 'Baseline'}</div>
            <div className="font-headline text-xl font-black">{formatCurrency(baselineTotal)}</div>
          </div>
          <div className="border border-ink/10 px-3 py-2">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">{compareLabel || 'Compare'}</div>
            <div className="font-headline text-xl font-black">{formatCurrency(compareTotal)}</div>
          </div>
          <div className="border border-ink/10 px-3 py-2">
            <div className="text-[9px] font-black uppercase tracking-widest text-secondary">Change</div>
            <div className={cn('font-headline text-xl font-black', net >= 0 ? 'text-success' : 'text-destructive')}>
              {net >= 0 ? '+' : ''}
              {formatCurrency(net)}
              <span className="ml-2 text-sm font-mono">
                {pct > 0 ? '+' : ''}
                {pct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {progression.length > 1 && (
          <div className="border border-ink/10 p-3" data-testid="spend-compare-progression">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[9px] font-black uppercase tracking-widest text-secondary">
                {grain === 'week'
                  ? 'Weekly spends'
                  : grain === 'quarter'
                    ? 'Quarterly spends'
                    : grain === 'year'
                      ? 'Yearly spends'
                      : 'Monthly spends'}{' '}
                · {progression[0]?.label} → {progression[progression.length - 1]?.label}
              </div>
              <div className="text-[9px] font-black uppercase tracking-widest text-secondary">
                {progression.length}{' '}
                {grain === 'week' ? 'weeks' : grain === 'quarter' ? 'quarters' : grain === 'year' ? 'years' : 'months'}
              </div>
            </div>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={progression} margin={{ top: 18, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--foreground))" opacity={0.08} />
                  <XAxis
                    dataKey="label"
                    fontSize={9}
                    fontWeight={700}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    fontSize={9}
                    fontWeight={700}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tickFormatter={(v: number) => {
                      const abs = Math.abs(v);
                      if (abs >= 10000000) return `${(v / 10000000).toFixed(0)}Cr`;
                      if (abs >= 100000) return `${(v / 100000).toFixed(0)}L`;
                      return String(v);
                    }}
                  />
                  <RechartsTooltip
                    contentStyle={{ borderRadius: 0, border: '1px solid #000' }}
                    formatter={(val: number) => [formatCurrency(val), 'Spend']}
                    labelFormatter={(label) => String(label)}
                  />
                  <Line
                    type="monotone"
                    dataKey="spend"
                    stroke="hsl(var(--brand))"
                    strokeWidth={3}
                    dot={(props: { cx?: number; cy?: number; payload?: CompareProgressPoint; index?: number }) => {
                      const { cx, cy, payload, index } = props;
                      if (cx == null || cy == null) return <g key={index} />;
                      const endpoint = payload?.isEndpoint;
                      return (
                        <circle
                          key={payload?.id || index}
                          cx={cx}
                          cy={cy}
                          r={endpoint ? 5 : 3}
                          fill={endpoint ? 'hsl(var(--brand))' : 'white'}
                          stroke="hsl(var(--brand))"
                          strokeWidth={2}
                        />
                      );
                    }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 border border-ink/15">
            {([
              ['all', 'All'],
              ['up', 'Gainers'],
              ['down', 'Losers'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSide(id)}
                className={cn(
                  'px-3 text-[10px] font-black uppercase tracking-widest',
                  side === id ? 'bg-ink text-cream' : 'text-secondary hover:text-ink'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search client, type, team…"
              className="pl-8 h-9 rounded-none text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest text-secondary">
          <span>
            {filtered.length} client{filtered.length === 1 ? '' : 's'}
            {excludeLargeClients ? ' · excluding Orion Retail & Nova Mobility' : ''}
            {periodCols.length > 2 ? ` · ${periodCols.length} periods` : ''}
            {scopeActive ? ' · scoped' : ''}
            {selectedBrand ? ` · dashboard filtered to ${selectedBrand}` : ''}
          </span>
          <span className="normal-case tracking-normal font-bold opacity-70">
            Sorted by {sortKey === 'pct' ? 'change %' : 'change amount'} ({sortDir === 'desc' ? 'high → low' : 'low → high'})
          </span>
        </div>
        <div className="max-h-[70vh] overflow-auto border border-ink/10">
          <table className="w-full text-left" style={{ minWidth: Math.max(720, 280 + periodCols.length * 88) }}>
            <thead className="sticky top-0 z-20 bg-cream text-[9px] font-black uppercase tracking-widest text-secondary">
              <tr>
                <th className="px-3 py-2 w-10 sticky left-0 z-30 bg-cream">#</th>
                <th className="px-3 py-2 sticky left-10 z-30 bg-cream min-w-[140px]">Client</th>
                <th className="px-3 py-2">Type</th>
                {periodCols.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      'px-2 py-2 text-right whitespace-nowrap',
                      col.isEndpoint && 'text-ink'
                    )}
                    title={col.label}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right sticky right-[88px] z-30 bg-cream min-w-[112px]">
                  <SortBtn column="change" label="Change" />
                </th>
                <th className="px-3 py-2 text-right sticky right-0 z-30 bg-cream min-w-[88px]">
                  <SortBtn column="pct" label="%" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5 + periodCols.length} className="px-3 py-8 text-center text-xs italic text-secondary">
                    No clients match this comparison.
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => {
                  const up = row.diff > 0;
                  const active = selectedBrand === row.brand;
                  const rowBg = active ? 'bg-brand/10' : 'bg-card';
                  return (
                    <tr
                      key={row.brand}
                      onClick={() => onSelectBrand(row.brand)}
                      className={cn(
                        'cursor-pointer border-t border-ink/5 text-xs hover:bg-cream/70',
                        active && 'bg-brand/5'
                      )}
                    >
                      <td className={cn('px-3 py-2 font-mono text-[10px] text-secondary sticky left-0 z-10', rowBg)}>
                        {i + 1}
                      </td>
                      <td className={cn('px-3 py-2 sticky left-10 z-10', rowBg)}>
                        <div className="font-black truncate max-w-[180px]" title={row.brand}>
                          {row.brand}
                        </div>
                        <div className="text-[9px] uppercase tracking-widest text-secondary">{row.team}</div>
                      </td>
                      <td className="px-3 py-2 text-[10px] font-bold uppercase text-secondary">{row.type}</td>
                      {periodCols.map((col, colIdx) => {
                        const value = row.series?.[col.id] || 0;
                        const prevId = periodCols[colIdx - 1]?.id;
                        const prevVal = prevId ? row.series?.[prevId] || 0 : undefined;
                        return (
                          <td
                            key={col.id}
                            className={cn(
                              'px-2 py-2 text-right font-mono text-[11px] whitespace-nowrap',
                              col.isEndpoint && 'font-bold',
                              value === 0 ? 'text-secondary/50' : periodDeltaClass(value, prevVal, colIdx === 0)
                            )}
                          >
                            {value === 0 ? '—' : formatCurrency(value)}
                          </td>
                        );
                      })}
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono text-[11px] font-bold sticky right-[88px] z-10 whitespace-nowrap',
                          rowBg,
                          up ? 'text-success' : 'text-destructive'
                        )}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {up ? '+' : ''}
                          {formatCurrency(row.diff)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono text-[11px] sticky right-0 z-10 whitespace-nowrap',
                          rowBg,
                          up ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {row.percentage > 0 ? '+' : ''}
                        {row.percentage.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
