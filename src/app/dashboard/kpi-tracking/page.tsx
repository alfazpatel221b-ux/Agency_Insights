'use client';

import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  MoreHorizontal, 
  PlusCircle, 
  Upload, 
  Check,
  Loader2,
  MessageSquare,
  Save,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Download,
  Fingerprint,
  FileSpreadsheet,
  Database
} from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KpiData, KpiWeeklyData, Client, Kpi, Channel, RagStatus } from '@/lib/types';
import { canonicalizeChannel } from '@/lib/normalize';
import {
  getEffectiveWeeklyTarget,
  getMonthlyStatus,
  getWeeklyStatus,
  parseKpiDirection,
  ragStatusTextClass,
} from '@/lib/kpi-rag';
import { KpiDialog } from './kpi-dialog';
import { format, parse, isValid, startOfMonth, endOfMonth, startOfWeek, addDays, eachMonthOfInterval } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { useCollection, useFirestore } from '@/firebase';
import { saveKpiData, bulkSaveKpiData, updateWeeklyComment } from '@/lib/firestore-actions';
import { useToast } from '@/hooks/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, openDialogFromMenu } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { where, getDocs, collection, query } from 'firebase/firestore';
import { Progress } from '@/components/ui/progress';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';

const ragVariantMap: { [key: string]: 'success' | 'warning' | 'destructive' | 'outline' } = {
    Green: 'success',
    Amber: 'warning',
    Red: 'destructive',
    'N/A': 'outline',
};

function SearchableFilterContent({ placeholder, options, selected, onToggle }: { placeholder: string, options: string[], selected: string[], onToggle: (val: string) => void }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => options.filter(o => o?.toString().toLowerCase().includes(search.toLowerCase())), [options, search]);
  return (
    <>
      <div className="p-2 border-b border-foreground/5 mb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input 
            placeholder={placeholder} 
            className="pl-8 h-9 rounded-none text-xs bg-foreground/5 border-none focus-visible:ring-1 focus-visible:ring-primary/30" 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
          />
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {filtered.length > 0 ? filtered.map(option => (
          <div key={option} className="flex items-center gap-2 p-2 rounded-none hover:bg-foreground/5 cursor-pointer text-xs font-bold" onClick={() => onToggle(option)}>
            <div className={cn("h-4 w-4 border rounded-md flex items-center justify-center transition-colors", selected.includes(option) ? "bg-primary border-primary text-white" : "border-foreground/20")}>
              {selected.includes(option) && <Check className="h-3 w-3" />}
            </div>
            {option}
          </div>
        )) : <div className="p-4 text-center text-[10px] text-muted-foreground italic">No results found</div>}
      </div>
    </>
  );
}

function KpiTrackingContent() {
  const searchParams = useSearchParams();
  const searchQueryFromUrl = searchParams.get('q') || '';
  const pathFilter = (searchParams.get('path') || '').toLowerCase(); // on | off | none
  const primaryOnly = searchParams.get('primary') === '1';
  const monthFromUrl = searchParams.get('month');
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      const from = parse(monthFromUrl, 'yyyy-MM', new Date());
      if (isValid(from)) return { from: startOfMonth(from), to: endOfMonth(from) };
    }
    return {
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date())
    };
  });

  const [mounted, setMounted] = useState(false);
  const [shouldFetch, setShouldFetch] = useState(() => Boolean(monthFromUrl || pathFilter || primaryOnly));

  useEffect(() => {
    setMounted(true);
  }, []);

  const monthsInRange = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    return eachMonthOfInterval({ start: dateRange.from, end: dateRange.to });
  }, [dateRange]);

  const kpiConstraints = useMemo(() => {
    if (!shouldFetch || !dateRange?.from || !dateRange?.to) return [null];
    return [
      where('month', '>=', format(dateRange.from, 'yyyy-MM')),
      where('month', '<=', format(dateRange.to, 'yyyy-MM'))
    ];
  }, [dateRange, shouldFetch]);

  const { data: kpiData, loading: kpiLoading } = useCollection<KpiData>('kpis', kpiConstraints);
  const [weeklyData, setWeeklyData] = useState<KpiWeeklyData[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedKpiId, setSelectedKpiId] = useState<string | undefined>(undefined);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'ascending' | 'descending' }>({ key: 'clientName', direction: 'ascending' });

  const { data: clients } = useCollection<Client>('clients');
  const { data: kpiDefinitions } = useCollection<Kpi>('kpiDefinitions');
  const { data: channels } = useCollection<Channel>('channels');
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [selectedLobs, setSelectedLobs] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const weekDates = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return [];
    const weeks = [];
    let curr = startOfWeek(dateRange.from, { weekStartsOn: 1 });
    const end = dateRange.to;
    while (curr <= end) {
      const weekStart = curr;
      const weekEnd = addDays(curr, 6);
      const thursday = addDays(curr, 3);
      const monthKey = format(thursday, 'yyyy-MM');
      let weekNum = 1;
      let check = new Date(thursday);
      while (true) {
        check = new Date(check.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (format(check, 'yyyy-MM') === monthKey) weekNum++;
        else break;
      }
      weeks.push({
        id: `${monthKey}-${weekNum}`,
        monthKey,
        num: weekNum,
        range: `${format(weekStart, 'dd MMM')} - ${format(weekEnd, 'dd MMM')}`,
      });
      curr = addDays(curr, 7);
    }
    return weeks;
  }, [dateRange]);

  const kpiIdsKey = useMemo(() => kpiData?.map(k => k.id).sort().join(',') || "", [kpiData]);

  useEffect(() => {
    if (!shouldFetch || !kpiData || kpiData.length === 0) {
      setWeeklyData([]);
      setWeeklyLoading(false);
      return;
    }
    const fetchWeekly = async () => {
      setWeeklyLoading(true);
      try {
        const allWeekly: KpiWeeklyData[] = [];
        const kpiIds = kpiData.map(k => k.id);
        for (let i = 0; i < kpiIds.length; i += 30) {
          const chunk = kpiIds.slice(i, i + 30);
          const q = query(collection(firestore, 'kpiWeeklyData'), where('kpiDataId', 'in', chunk));
          const snap = await getDocs(q);
          snap.forEach(doc => { allWeekly.push({ id: doc.id, ...doc.data() } as KpiWeeklyData); });
        }
        setWeeklyData(allWeekly);
      } catch (err) { 
        console.error("Weekly data fetch failed:", err); 
      } finally { 
        setWeeklyLoading(false); 
      }
    };
    fetchWeekly();
  }, [kpiIdsKey, firestore, shouldFetch, kpiData]);

  const weeklyMap = useMemo(() => {
    const map = new Map<string, KpiWeeklyData[]>();
    weeklyData.forEach(wd => {
      const existing = map.get(wd.kpiDataId) || [];
      existing.push(wd);
      map.set(wd.kpiDataId, existing);
    });
    return map;
  }, [weeklyData]);

  const selectedKpi = useMemo(() => 
    kpiData?.find(k => k.id === selectedKpiId), 
    [kpiData, selectedKpiId]
  );

  const selectedWeeklyData = useMemo(() => 
    weeklyData?.filter(w => w.kpiDataId === selectedKpiId), 
    [weeklyData, selectedKpiId]
  );

  const groupedDisplayData = useMemo(() => {
    if (!kpiData || !mounted) return [];
    const groups: Record<string, any> = {};
    kpiData.forEach(item => {
      const channel = canonicalizeChannel(item.channel);
      const key = `${item.clientName}-${item.kpi}-${channel}`;
      if (!groups[key]) {
        groups[key] = {
          id: item.id,
          uploadRecordId: item.uploadRecordId || item.id,
          clientName: item.clientName,
          kpi: item.kpi,
          kpiType: item.kpiType || 'PRIMARY',
          channel,
          lob: item.lob,
          direction: parseKpiDirection(item.direction, item.kpi),
          type: item.type,
          monthData: {} as Record<string, KpiData>
        };
      }
      groups[key].monthData[item.month] = { ...item, channel };
    });

    return Object.values(groups).map(group => {
      const rangeWeekly: (KpiWeeklyData & { weekId: string; monthKey: string })[] = [];
      const weeksPerMonth: Record<string, number> = {};
      weekDates.forEach(w => {
        weeksPerMonth[w.monthKey] = (weeksPerMonth[w.monthKey] || 0) + 1;
      });
      weekDates.forEach(w => {
        const kpi = group.monthData[w.monthKey];
        if (kpi) {
          const kpiWeeks = weeklyMap.get(kpi.id) || [];
          const wd = kpiWeeks.find(d => d.weekOfMonth === w.num);
          if (wd) rangeWeekly.push({ ...wd, weekId: w.id, monthKey: w.monthKey });
        }
      });
      const latestMonthRecord = Object.values(group.monthData).sort((a: any, b: any) => b.month.localeCompare(a.month))[0] as KpiData | undefined;
      const direction = parseKpiDirection(latestMonthRecord?.direction ?? group.direction, group.kpi);
      // RAG column = MTD status (latest month achieved vs monthly target, Direction-aware)
      const mtdStatus: RagStatus = latestMonthRecord
        ? getMonthlyStatus(
            latestMonthRecord.achievedMonthTillYesterday,
            latestMonthRecord.targetMonth,
            direction
          )
        : 'N/A';
      return {
        ...group,
        direction,
        kpiType: latestMonthRecord?.kpiType || group.kpiType || 'PRIMARY',
        pacingStatus: mtdStatus,
        rangeWeekly,
        latestId: latestMonthRecord?.id,
        weeksPerMonth,
      };
    });
  }, [kpiData, weeklyMap, mounted, weekDates]);

  const filteredData = useMemo(() => {
    let filtered = [...groupedDisplayData];
    if (searchQueryFromUrl) {
      const q = searchQueryFromUrl.toLowerCase();
      filtered = filtered.filter(item =>
        item.clientName.toLowerCase().includes(q) ||
        item.kpi.toLowerCase().includes(q) ||
        item.channel?.toLowerCase().includes(q)
      );
    }
    if (selectedClients.length > 0) filtered = filtered.filter(item => selectedClients.includes(item.clientName));
    if (selectedLobs.length > 0) filtered = filtered.filter(item => selectedLobs.includes(item.lob));
    if (selectedChannels.length > 0) filtered = filtered.filter(item => selectedChannels.includes(item.channel));
    if (primaryOnly) {
      filtered = filtered.filter((item) => {
        const latest = Object.values(item.monthData || {}).sort((a: any, b: any) =>
          String(b.month).localeCompare(String(a.month))
        )[0] as KpiData | undefined;
        return ((latest?.kpiType || item.kpiType || 'PRIMARY') as string).toUpperCase() === 'PRIMARY';
      });
    }
    if (pathFilter === 'on' || pathFilter === 'off' || pathFilter === 'none') {
      filtered = filtered.filter((item) => {
        const status = (item.pacingStatus || 'N/A') as RagStatus;
        if (pathFilter === 'on') return status === 'Green';
        if (pathFilter === 'off') return status === 'Red';
        return status === 'N/A';
      });
    }
    return filtered;
  }, [groupedDisplayData, searchQueryFromUrl, selectedClients, selectedLobs, selectedChannels, primaryOnly, pathFilter]);

  // Interdependent filter option lists: each dimension is constrained by the others.
  const filterOptions = useMemo(() => {
    const forClients = groupedDisplayData.filter(item => {
      const lobMatch = selectedLobs.length === 0 || selectedLobs.includes(item.lob);
      const channelMatch = selectedChannels.length === 0 || selectedChannels.includes(item.channel);
      return lobMatch && channelMatch;
    });
    const forLobs = groupedDisplayData.filter(item => {
      const clientMatch = selectedClients.length === 0 || selectedClients.includes(item.clientName);
      const channelMatch = selectedChannels.length === 0 || selectedChannels.includes(item.channel);
      return clientMatch && channelMatch;
    });
    const forChannels = groupedDisplayData.filter(item => {
      const clientMatch = selectedClients.length === 0 || selectedClients.includes(item.clientName);
      const lobMatch = selectedLobs.length === 0 || selectedLobs.includes(item.lob);
      return clientMatch && lobMatch;
    });
    return {
      clients: Array.from(new Set(forClients.map(d => d.clientName).filter(Boolean))).sort(),
      lobs: Array.from(new Set(forLobs.map(d => d.lob).filter(Boolean))).sort(),
      channels: Array.from(new Set(forChannels.map(d => d.channel).filter(Boolean))).sort(),
    };
  }, [groupedDisplayData, selectedClients, selectedLobs, selectedChannels]);

  // Drop selections that are no longer valid given interdependent options.
  useEffect(() => {
    setSelectedClients(prev => {
      const next = prev.filter(c => filterOptions.clients.includes(c));
      return next.length === prev.length ? prev : next;
    });
    setSelectedLobs(prev => {
      const next = prev.filter(l => filterOptions.lobs.includes(l));
      return next.length === prev.length ? prev : next;
    });
    setSelectedChannels(prev => {
      const next = prev.filter(c => filterOptions.channels.includes(c));
      return next.length === prev.length ? prev : next;
    });
  }, [filterOptions]);

  const clearAllFilters = () => {
    setSelectedClients([]);
    setSelectedLobs([]);
    setSelectedChannels([]);
  };
  const isAnyFilterActive = selectedClients.length > 0 || selectedLobs.length > 0 || selectedChannels.length > 0;

  const sortedDisplayData = useMemo(() => {
    const items = [...filteredData];
    if (sortConfig.key) { items.sort((a, b) => { const aVal = (a[sortConfig.key as keyof any] || '').toString(); const bVal = (b[sortConfig.key as keyof any] || '').toString(); return sortConfig.direction === 'ascending' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal); }); }
    return items;
  }, [filteredData, sortConfig]);

  const handleSort = (key: string) => { setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'ascending' ? 'descending' : 'ascending' })); };
  const SortIcon = ({ columnKey }: { columnKey: string }) => { if (sortConfig.key !== columnKey) return <ArrowUpDown className="ml-2 h-3.5 w-3.5 opacity-30" />; return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-3.5 w-3.5 text-primary" /> : <ArrowDown className="ml-2 h-3.5 w-3.5 text-primary" />; };

  const handleDownloadTemplate = () => {
    const headers = [
      'Record ID', 'Month', 'Client ID', 'Client Name', 'Cluster', 'LOB', 'CDU Lead', 'EM/CSM', 
      'Channel', 'KPI', 'KPI Type', 'Direction', 'Currency', 'Monthly Target', 'Monthly Achieved',
      'W1 Achieved', 'W1 Comment', 'W2 Achieved', 'W2 Comment', 'W3 Achieved', 'W3 Comment', 
      'W4 Achieved', 'W4 Comment', 'W5 Achieved', 'W5 Comment'
    ];
    const csvContent = headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aztec_kpi_tracker_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('KPI Records');
    const headers = [
      { header: 'Record ID', key: 'uploadRecordId', width: 25 },
      { header: 'Month', key: 'month', width: 15 },
      { header: 'Client ID', key: 'clientId', width: 15 },
      { header: 'Client Name', key: 'clientName', width: 25 },
      { header: 'Cluster', key: 'cluster', width: 15 },
      { header: 'LOB', key: 'lob', width: 15 },
      { header: 'CDU Lead', key: 'cduLead', width: 15 },
      { header: 'EM/CSM', key: 'emCsm', width: 15 },
      { header: 'Channel', key: 'channel', width: 15 },
      { header: 'KPI', key: 'kpi', width: 15 },
      { header: 'KPI Type', key: 'kpiType', width: 14 },
      { header: 'Direction', key: 'direction', width: 10 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Monthly Target', key: 'targetMonth', width: 15 },
      { header: 'Monthly Achieved', key: 'achievedMonthTillYesterday', width: 15 },
      { header: 'W1 Achieved', key: 'w1_achieved', width: 15 },
      { header: 'W1 Comment', key: 'w1_comment', width: 20 },
      { header: 'W2 Achieved', key: 'w2_achieved', width: 15 },
      { header: 'W2 Comment', key: 'w2_comment', width: 20 },
      { header: 'W3 Achieved', key: 'w3_achieved', width: 15 },
      { header: 'W3 Comment', key: 'w3_comment', width: 20 },
      { header: 'W4 Achieved', key: 'w4_achieved', width: 15 },
      { header: 'W4 Comment', key: 'w4_comment', width: 20 },
      { header: 'W5 Achieved', key: 'w5_achieved', width: 15 },
      { header: 'W5 Comment', key: 'w5_comment', width: 20 },
    ];
    worksheet.columns = headers;
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    sortedDisplayData.forEach(group => {
      Object.values(group.monthData).forEach((kpi: any) => {
        const kpiWeeks = weeklyMap.get(kpi.id) || [];
        const getW = (n: number) => kpiWeeks.find(w => w.weekOfMonth === n);
        worksheet.addRow({
          uploadRecordId: kpi.uploadRecordId || kpi.id,
          month: kpi.month,
          clientId: kpi.clientId,
          clientName: kpi.clientName,
          cluster: kpi.cluster,
          lob: kpi.lob,
          cduLead: kpi.cduLead,
          emCsm: kpi.emCsm,
          channel: kpi.channel,
          kpi: kpi.kpi,
          kpiType: kpi.kpiType || 'PRIMARY',
          direction: kpi.direction,
          currency: kpi.currency,
          targetMonth: kpi.targetMonth,
          achievedMonthTillYesterday: kpi.achievedMonthTillYesterday,
          w1_achieved: getW(1)?.achieved ?? 0,
          w1_comment: getW(1)?.comment || '',
          w2_achieved: getW(2)?.achieved ?? 0,
          w2_comment: getW(2)?.comment || '',
          w3_achieved: getW(3)?.achieved ?? 0,
          w3_comment: getW(3)?.comment || '',
          w4_achieved: getW(4)?.achieved ?? 0,
          w4_comment: getW(4)?.comment || '',
          w5_achieved: getW(5)?.achieved ?? 0,
          w5_comment: getW(5)?.comment || '',
        });
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Agency_KPI_Export_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast({ title: "Export Complete" });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true); setUploadProgress(0);
      Papa.parse(file, { header: true, skipEmptyLines: 'greedy', dynamicTyping: true, complete: async (r) => {
        try { const { processedCount } = await bulkSaveKpiData(firestore, r.data as any[], format(dateRange?.from || new Date(), 'yyyy-MM'), setUploadProgress); toast({ title: "Sync Complete", description: `${processedCount} records saved.` }); }
        catch (e: any) { toast({ variant: "destructive", title: "Sync Failed", description: e.message }); }
        finally { setIsUploading(false); setUploadProgress(0); if (fileInputRef.current) fileInputRef.current.value = ''; }
      }});
    }
  };

  if (!mounted) return <div className="flex flex-1 items-center justify-center p-10"><Loader2 className="animate-spin h-6 w-6 text-primary/40" /></div>;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="KPI TRACKER" description="Manage and monitor monthly KPI performance hierarchy.">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker date={dateRange} setDate={(d) => { setDateRange(d); setShouldFetch(false); }} />
          
          <Button 
            variant="default" 
            size="sm" 
            className="h-10 rounded-none gap-2 bg-brand hover:bg-ink font-black transition-all"
            onClick={() => setShouldFetch(true)}
            disabled={shouldFetch && kpiLoading}
          >
            {kpiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            FETCH RECORDS
          </Button>

          <input type="file" min="0" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".csv" />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-10 rounded-none gap-2 glass shadow-lg">
                <Upload className="h-4 w-4 text-primary" />Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-none glass p-2 ">
              <DropdownMenuItem className="rounded-none flex items-center gap-2" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4" />Download Template
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-none flex items-center gap-2" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <Upload className="h-4 w-4" />Upload CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-none flex items-center gap-2" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4" />Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" className="h-10 px-4 rounded-none gap-2 shadow-primary/20 font-bold" onClick={() => { setSelectedKpiId(undefined); setIsDialogOpen(true); }}>
            <PlusCircle className="h-4 w-4" />New Record
          </Button>
        </div>
      </PageHeader>

      {isUploading && ( <div className="space-y-3 glass-card p-6 mb-6"><div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-primary"><span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Syncing Performance Data...</span><span>{uploadProgress}%</span></div><Progress value={uploadProgress} className="h-2 rounded-full" /></div> )}

      {!shouldFetch ? (
        <div className="flex flex-col items-center justify-center p-12 md:p-16 border border-dashed border-ink/20 rounded-none bg-foreground/[0.02] text-center space-y-6">
          <div className="h-20 w-20 bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
            <Database className="h-10 w-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold uppercase tracking-tighter">No KPIs loaded</h3>
            <p className="text-sm text-secondary max-w-sm mx-auto">Select a date range, then click <strong>Fetch records</strong> to load the KPI registry.</p>
          </div>
          <Button 
            className="h-12 px-10 rounded-none bg-brand text-white font-bold uppercase tracking-[0.15em] text-xs brutalist-shadow active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
            onClick={() => setShouldFetch(true)}
          >
            Fetch records
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 rounded-none glass gap-2 px-4 shadow-sm", selectedClients.length > 0 && "bg-primary/10")}>
                  <Filter className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Clients{selectedClients.length > 0 && ` (${selectedClients.length})`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-2 rounded-none glass" align="start">
                <SearchableFilterContent
                  placeholder="Search clients..."
                  options={filterOptions.clients}
                  selected={selectedClients}
                  onToggle={(c) => setSelectedClients(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 rounded-none glass gap-2 px-4 shadow-sm", selectedLobs.length > 0 && "bg-primary/10")}>
                  <Filter className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    LOB{selectedLobs.length > 0 && ` (${selectedLobs.length})`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-2 rounded-none glass" align="start">
                <SearchableFilterContent
                  placeholder="Search LOB..."
                  options={filterOptions.lobs}
                  selected={selectedLobs}
                  onToggle={(l) => setSelectedLobs(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 rounded-none glass gap-2 px-4 shadow-sm", selectedChannels.length > 0 && "bg-primary/10")}>
                  <Filter className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Channel{selectedChannels.length > 0 && ` (${selectedChannels.length})`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-2 rounded-none glass" align="start">
                <SearchableFilterContent
                  placeholder="Search channels..."
                  options={filterOptions.channels}
                  selected={selectedChannels}
                  onToggle={(c) => setSelectedChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                />
              </PopoverContent>
            </Popover>
            {isAnyFilterActive && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-[10px] font-black uppercase tracking-widest text-destructive">
                Clear All
              </Button>
            )}
          </div>

          <div className="rounded-none glass overflow-x-auto ">
            <Table>
              <TableHeader><TableRow className="border-none hover:bg-transparent">
                <TableHead className="px-8 py-8 text-[11px] font-black uppercase min-w-[200px] cursor-pointer text-foreground" onClick={() => handleSort('clientName')}>CLIENT <SortIcon columnKey="clientName" /></TableHead>
                <TableHead className="px-2 py-8 text-[11px] font-black uppercase min-w-[120px] cursor-pointer text-foreground" onClick={() => handleSort('lob')}>LOB <SortIcon columnKey="lob" /></TableHead>
                <TableHead className="px-2 py-8 text-[11px] font-black uppercase min-w-[120px] cursor-pointer text-foreground" onClick={() => handleSort('channel')}>CHANNEL <SortIcon columnKey="channel" /></TableHead>
                <TableHead className="px-2 py-8 text-[11px] font-black uppercase min-w-[150px] cursor-pointer text-foreground" onClick={() => handleSort('kpi')}>KPI <SortIcon columnKey="kpi" /></TableHead>
                <TableHead className="px-2 py-8 text-[11px] font-black uppercase min-w-[110px] cursor-pointer text-foreground" onClick={() => handleSort('kpiType')}>KPI Type <SortIcon columnKey="kpiType" /></TableHead>
                
                {monthsInRange.map((monthDate, idx) => {
                  const monthName = format(monthDate, 'MMM').toUpperCase();
                  return (
                    <React.Fragment key={monthName}>
                      <TableHead className={cn("text-center px-4 text-[10px] font-black uppercase text-primary min-w-[110px] leading-tight", idx % 2 === 0 ? "bg-primary/5" : "bg-primary/10")}>TGT ({monthName})</TableHead>
                      <TableHead className={cn("text-center px-4 text-[10px] font-black uppercase text-primary border-r border-foreground/5 min-w-[110px] leading-tight", idx % 2 === 0 ? "bg-primary/5" : "bg-primary/10")}>ACH ({monthName})</TableHead>
                    </React.Fragment>
                  );
                })}
                <TableHead className="text-center px-4 text-[11px] font-black uppercase bg-muted/60 min-w-[100px] leading-tight border-l border-ink/5">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-ink tracking-widest">MTD Status</span>
                    <span className="text-[10px] font-semibold text-secondary normal-case tracking-normal">vs monthly tgt</span>
                  </div>
                </TableHead>
                {weekDates.map((w) => (
                  <TableHead
                    key={`header-${w.id}`}
                    className="text-center px-2 py-4 bg-muted/60 border-l border-ink/5 min-w-[120px]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[12px] font-black uppercase tracking-widest text-ink">
                        W{w.num}
                      </span>
                      <span className="text-[10px] font-semibold text-secondary whitespace-nowrap tracking-normal normal-case">
                        {w.range}
                      </span>
                    </div>
                  </TableHead>
                ))}
                <TableHead className="w-10 px-4 bg-primary/[0.03]"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                  {kpiLoading || weeklyLoading ? ( <TableRow><TableCell colSpan={60} className="text-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" /></TableCell></TableRow> ) : sortedDisplayData.length === 0 ? (
                    <TableRow><TableCell colSpan={60} className="text-center py-20 text-muted-foreground italic font-medium">No performance records found for this period.</TableCell></TableRow>
                  ) : sortedDisplayData.map(group => {
                      const statusVal = group.pacingStatus as keyof typeof ragVariantMap;
                      return (
                          <TableRow key={group.id} className="border-b border-foreground/5 hover:bg-foreground/[0.02]">
                              <TableCell className="px-8 py-6">
                                <span className="text-xs font-black text-foreground/80 truncate max-w-[180px]">{group.clientName}</span>
                              </TableCell>
                              <TableCell className="px-2 py-6"><Badge variant="outline" className="text-[9px] font-black uppercase border-foreground/10 bg-foreground/[0.02]">{group.lob}</Badge></TableCell>
                              <TableCell className="text-[11px] font-black px-2 uppercase">{group.channel}</TableCell>
                              <TableCell className="px-2 py-6"><span className="font-black text-[11px] text-primary">{group.kpi}</span></TableCell>
                              <TableCell className="px-2 py-6">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[8px] font-black uppercase tracking-widest h-5 px-1.5",
                                    (group.kpiType || 'PRIMARY') === 'PRIMARY'
                                      ? "border-brand/30 bg-brand/5 text-brand"
                                      : "border-foreground/10 bg-foreground/[0.03] text-secondary"
                                  )}
                                >
                                  {group.kpiType || 'PRIMARY'}
                                </Badge>
                              </TableCell>
                              
                              {monthsInRange.map((monthDate, idx) => {
                                const monthKey = format(monthDate, 'yyyy-MM');
                                const data = group.monthData[monthKey];
                                const monthlyStatus = data
                                  ? getMonthlyStatus(data.achievedMonthTillYesterday, data.targetMonth, group.direction)
                                  : 'N/A';
                                const monthlyColor = ragStatusTextClass(monthlyStatus);
                                return (
                                  <React.Fragment key={monthKey}>
                                    <TableCell className={cn("text-center text-[11px] font-mono font-black px-4", idx % 2 === 0 ? "bg-primary/[0.01]" : "bg-primary/[0.03]")}>{data ? data.targetMonth.toLocaleString() : '—'}</TableCell>
                                    <TableCell className={cn("text-center text-[11px] font-mono font-black px-4 border-r border-foreground/5", idx % 2 === 0 ? "bg-primary/[0.01]" : "bg-primary/[0.03]", monthlyColor)}>{data ? data.achievedMonthTillYesterday.toLocaleString() : '—'}</TableCell>
                                  </React.Fragment>
                                );
                              })}
                              <TableCell className="text-center px-4"><Badge variant={ragVariantMap[statusVal]} className="text-[9px] font-black uppercase">{group.pacingStatus}</Badge></TableCell>
                              {weekDates.map((w) => {
                                  const wd = group.rangeWeekly.find((d: any) => d.weekId === w.id);
                                  if (!wd) return <TableCell key={`cell-${group.id}-${w.id}`} className="text-center text-secondary/70">—</TableCell>;
                                  const wdIdx = group.rangeWeekly.findIndex((d: any) => d.weekId === w.id);
                                  const prevWd = wdIdx > 0 ? group.rangeWeekly[wdIdx - 1] : null;
                                  const monthRecord = group.monthData[w.monthKey];
                                  const weeklyPacingTarget = getEffectiveWeeklyTarget({
                                    kpiName: group.kpi,
                                    direction: group.direction,
                                    monthlyTarget: monthRecord?.targetMonth ?? null,
                                    weekTarget: wd.target,
                                    weeksInMonth: group.weeksPerMonth?.[w.monthKey] || weekDates.filter((x) => x.monthKey === w.monthKey).length || 4,
                                  });
                                  const weeklyStatus = getWeeklyStatus(
                                    wd.achieved,
                                    weeklyPacingTarget,
                                    prevWd ? prevWd.achieved : null,
                                    group.direction
                                  );
                                  const weeklyColor = ragStatusTextClass(weeklyStatus) || 'text-secondary';
                                  return (
                                      <TableCell key={`cell-${group.id}-${w.id}`} className="text-center p-1"><TooltipProvider><Tooltip><TooltipTrigger asChild><div className="flex items-center justify-center gap-1.5 group"><span className={cn("font-black text-[11px]", weeklyColor)}>{wd.achieved.toLocaleString()}</span><QuickCommentPopover weekData={wd} /></div></TooltipTrigger><TooltipContent className="rounded-none glass p-3 max-w-[220px]"><div className="space-y-1">{wd.comment && <div className="text-xs font-medium leading-relaxed">{wd.comment}</div>}{weeklyPacingTarget != null && <div className="text-[10px] font-mono text-secondary">Week target: {Math.round(weeklyPacingTarget).toLocaleString()}</div>}</div></TooltipContent></Tooltip></TooltipProvider></TableCell>
                                  );
                              })}
                              <TableCell className="px-4 text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="rounded-none glass p-2"><DropdownMenuItem className="rounded-lg text-xs font-bold" onSelect={openDialogFromMenu(() => { setSelectedKpiId(group.latestId); setIsDialogOpen(true); })}>Edit Latest Month</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                          </TableRow>
                      );
                  })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <KpiDialog isOpen={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) setSelectedKpiId(null);
      }} onSave={async (data) => {
        const { clientId, clientName, cluster, lob, cduLead, emCsm, channel, kpi, kpiType, currency, ...rest } = data;
        const weeklyT = [rest.w1_target, rest.w2_target, rest.w3_target, rest.w4_target, rest.w5_target];
        const weeklyA = [rest.w1_achieved, rest.w2_achieved, rest.w3_achieved, rest.w4_achieved, rest.w5_achieved];
        const weeklyC = [rest.w1_comment, rest.w2_comment, rest.w3_comment, rest.w4_comment, rest.w5_comment];
        await saveKpiData(firestore, { 
          month: format(dateRange?.to || new Date(), 'yyyy-MM'), 
          clientId: clientId || 'N/A', clientName, cluster: cluster || 'Unassigned', lob: lob || 'N/A', cduLead: cduLead || 'N/A', emCsm: emCsm || 'N/A', channel, kpi, kpiType, currency: currency || 'INR', 
          targetMonth: weeklyT.reduce((a, b) => a + b, 0), achievedMonthTillYesterday: weeklyA.reduce((a, b) => a + b, 0), targetMonthTillYesterday: 0, type: 'Performance' 
        }, weeklyT.map((t, i) => ({ weekOfMonth: i + 1, target: t, achieved: weeklyA[i], comment: weeklyC[i] || "" })), selectedKpiId);
        setIsDialogOpen(false);
      }} kpi={selectedKpi} weeklyData={selectedWeeklyData} currentMonth={format(dateRange?.to || new Date(), "MMMM yyyy")} weekDates={weekDates.filter(w => w.monthKey === format(dateRange?.to || new Date(), 'yyyy-MM')) as any} clients={clients || []} kpis={kpiDefinitions || []} channels={channels || []} />
    </div>
  );
}

export default function KpiTrackingPage() {
  return ( <Suspense fallback={<div className="flex items-center justify-center py-10"><Loader2 className="animate-spin h-6 w-6 text-primary/40" /></div>}><KpiTrackingContent /></Suspense> );
}

export function QuickCommentPopover({ weekData }: { weekData: KpiWeeklyData }) {
    const firestore = useFirestore();
    const [comment, setComment] = useState(weekData.comment || "");
    const [isSaving, setIsSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const { toast } = useToast();
    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild><button className={cn("h-4 w-4 flex items-center justify-center rounded-full transition-all outline-none", weekData.comment ? "bg-primary/20 text-primary" : "text-muted-foreground/40 text-secondary hover:opacity-100 hover:text-primary")} onClick={(e) => e.stopPropagation()}><MessageSquare className="h-2.5 w-2.5" /></button></PopoverTrigger>
            <PopoverContent className="w-[260px] p-4 rounded-none glass space-y-3" align="center" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">Add Comment (W{weekData.weekOfMonth})</span>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Provide context..." className="min-h-[80px] rounded-none bg-foreground/5 border-none text-xs" />
                <div className="flex justify-end pt-1"><Button size="sm" className="h-8 rounded-lg font-bold text-[10px]" onClick={async () => { setIsSaving(true); await updateWeeklyComment(firestore, weekData.id, comment); toast({ title: "Comment saved" }); setIsSaving(false); setIsOpen(false); }} disabled={isSaving}>{isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save</Button></div>
            </PopoverContent>
        </Popover>
    );
}
