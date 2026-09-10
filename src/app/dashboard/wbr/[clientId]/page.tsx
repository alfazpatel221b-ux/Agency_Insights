
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  ArrowLeft, 
  Loader2, 
  ShieldCheck, 
  Save,
  Lock,
  History,
  Calendar as CalendarIcon,
  Plus,
  Minus,
  TrendingUp,
  Filter,
  CheckCircle2,
  Clock,
  PlusCircle,
  MoreHorizontal,
  Target,
  Activity,
  ChevronDown,
  LayoutDashboard
} from 'lucide-react';
import { 
  format, 
  startOfWeek, 
  addDays, 
  isAfter, 
  isBefore, 
  endOfDay, 
  startOfDay, 
  parse,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
  subMonths,
  subWeeks,
  isValid
} from 'date-fns';
import { query, collection, where, getDocs, getDoc, doc, limit, type Firestore } from 'firebase/firestore';

import { useFirestore, useUser, useDoc, useCollection } from '@/firebase';
import { Client, WbrEntry, UserProfile, KpiData, KpiWeeklyData, MonthlySpend, WeeklySpend, RagStatus, ActionItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { saveWbrEntry, deleteActionItem } from '@/lib/firestore-actions';
import { canonicalizeChannel, resolveActionStatus } from '@/lib/normalize';
import {
  getEffectiveWeeklyTarget,
  getMonthlyStatus,
  getWeeklyStatus,
  parseKpiDirection,
  ragStatusTextClass,
} from '@/lib/kpi-rag';
import { cn, openDialogFromMenu } from '@/lib/utils';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { AddActionItemDialog } from '../../actions/add-action-item-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const wbrSchema = z.object({
  cluster: z.string().optional(),
  clusterLead: z.string().optional(),
  emcsm: z.string().optional(),
  clientPartner: z.string().optional(),
  contractStatus: z.enum(['Valid', 'Expired', 'Negotiation']),
  financeIssues: z.string().optional(),
  engagementRag: z.enum(['Green', 'Amber', 'Red']),
  performanceRag: z.enum(['Green', 'Amber', 'Red']),
  organicOpportunities: z.string().optional(),
  crossSellOpportunities: z.string().optional(),
  performanceSummary: z.string().optional(),
  summary: z.string().optional(),
});

type WbrFormValues = z.infer<typeof wbrSchema>;

async function fetchClientMonthRange<T extends { month?: string }>(
  db: Firestore,
  collectionName: string,
  clientId: string,
  startMonth: string,
  endMonth: string,
): Promise<(T & { id: string })[]> {
  try {
    const snap = await getDocs(query(
      collection(db, collectionName),
      where('clientId', '==', clientId),
      where('month', '>=', startMonth),
      where('month', '<=', endMonth),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as T & { id: string }));
  } catch {
    const snap = await getDocs(query(
      collection(db, collectionName),
      where('clientId', '==', clientId),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as object) } as T & { id: string }))
      .filter((row) => !!row.month && row.month >= startMonth && row.month <= endMonth);
  }
}

function wbrEntryId(clientId: string, wbrDate: string) {
  return `wbr_${clientId}_${wbrDate}`.replace(/[^a-zA-Z0-9]/g, '_');
}

export default function WbrEditPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { user } = useUser();
  const { data: userProfile } = useDoc<UserProfile>(user ? `users/${user.uid}` : null);

  const clientId = params.clientId as string;
  const actualClientId = clientId.startsWith('discovered_') ? clientId.replace('discovered_', '') : clientId;
  const wbrDate = searchParams.get('date') || format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd');

  const [isLoading, setIsLoading] = useState(true);
  const [isMetricsLoading, setIsMetricsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [clientInfo, setClientInfo] = useState<Partial<Client> | null>(null);
  const [entry, setEntry] = useState<WbrEntry | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null);
  const actionsConstraints = useMemo(() => [where('clientId', '==', actualClientId), limit(50)], [actualClientId]);
  const { data: clientActions } = useCollection<ActionItem>('actionItems', actionsConstraints);

  const [monthlyDateRange, setMonthlyDateRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonth(subMonths(new Date(), 5)),
    to: endOfMonth(new Date()),
  }));
  const [weeklyDateRange, setWeeklyDateRange] = useState<DateRange | undefined>(() => ({
    from: subWeeks(new Date(), 4),
    to: new Date(),
  }));

  // MONTHLY FILTERS
  const [selectedLobFilter, setSelectedLobFilter] = useState<string>('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [selectedKpiFilter, setSelectedKpiFilter] = useState<string>('all');

  // WEEKLY FILTERS
  const [selectedWeeklyLobFilter, setSelectedWeeklyLobFilter] = useState<string>('all');
  const [selectedWeeklyChannelFilter, setSelectedWeeklyChannelFilter] = useState<string>('all');
  const [selectedWeeklyKpiFilter, setSelectedWeeklyKpiFilter] = useState<string>('all');

  const [isSpendsExpanded, setIsSpendsExpanded] = useState(false);
  const [isWeeklySpendsExpanded, setIsWeeklySpendsExpanded] = useState(false);
  
  const [kpis, setKpis] = useState<KpiData[]>([]);
  const [weeklyKpis, setWeeklyKpis] = useState<KpiWeeklyData[]>([]);
  const [monthlySpends, setMonthlySpends] = useState<MonthlySpend[]>([]);
  const [weeklySpends, setWeeklySpends] = useState<WeeklySpend[]>([]);

  const form = useForm<WbrFormValues>({
    resolver: zodResolver(wbrSchema),
    defaultValues: {
      cluster: '',
      clusterLead: '',
      emcsm: '',
      clientPartner: '',
      contractStatus: 'Valid',
      engagementRag: 'Green',
      performanceRag: 'Green',
      financeIssues: '',
      organicOpportunities: '',
      crossSellOpportunities: '',
      performanceSummary: '',
      summary: '',
    }
  });

  useEffect(() => {
    if (!actualClientId) return;
    let cancelled = false;

    const fetchCore = async () => {
      setIsLoading(true);
      try {
        const wbrId = wbrEntryId(actualClientId, wbrDate);
        const [clientSnap, wbrDirect] = await Promise.all([
          getDocs(query(collection(firestore, 'clients'), where('uniqueId', '==', actualClientId), limit(1))),
          getDoc(doc(firestore, 'wbrEntries', wbrId)),
        ]);

        let cData: Partial<Client> | null = null;
        if (!clientSnap.empty) {
          cData = clientSnap.docs[0].data() as Client;
        } else {
          const kpiRefSnap = await getDocs(query(
            collection(firestore, 'kpis'),
            where('clientId', '==', actualClientId),
            limit(1)
          ));
          if (!kpiRefSnap.empty) {
            const d = kpiRefSnap.docs[0].data() as KpiData;
            cData = {
              name: d.clientName,
              uniqueId: d.clientId,
              cluster: d.cluster || 'Unassigned',
              clusterLead: d.cduLead || 'No Lead',
              emcsm: d.emCsm || 'No Manager',
            };
          }
        }
        if (cancelled) return;
        setClientInfo(cData);

        let existingEntry: WbrEntry | null = null;
        if (wbrDirect.exists()) {
          existingEntry = { id: wbrDirect.id, ...wbrDirect.data() } as WbrEntry;
        } else {
          const byDate = await getDocs(query(
            collection(firestore, 'wbrEntries'),
            where('clientId', '==', actualClientId),
            where('wbrDate', '==', wbrDate),
            limit(1)
          ));
          if (!byDate.empty) {
            existingEntry = { id: byDate.docs[0].id, ...byDate.docs[0].data() } as WbrEntry;
          }
        }
        if (cancelled) return;
        setEntry(existingEntry);

        if (existingEntry) {
          form.reset({
            cluster: existingEntry.cluster || cData?.cluster || '',
            clusterLead: existingEntry.clusterLead || cData?.clusterLead || '',
            emcsm: existingEntry.emcsm || cData?.emcsm || '',
            clientPartner: existingEntry.clientPartner || '',
            contractStatus: existingEntry.contractStatus || 'Valid',
            engagementRag: existingEntry.engagementRag || 'Green',
            performanceRag: existingEntry.performanceRag || 'Green',
            financeIssues: existingEntry.financeIssues || '',
            organicOpportunities: existingEntry.organicOpportunities || '',
            crossSellOpportunities: existingEntry.crossSellOpportunities || '',
            performanceSummary: existingEntry.performanceSummary || '',
            summary: existingEntry.summary || '',
          });
        } else {
          form.reset({
            cluster: cData?.cluster || '',
            clusterLead: cData?.clusterLead || '',
            emcsm: cData?.emcsm || '',
            clientPartner: cData?.clientPartner || '',
            contractStatus: 'Valid',
            engagementRag: 'Green',
            performanceRag: 'Green',
            financeIssues: '',
            organicOpportunities: '',
            crossSellOpportunities: '',
            performanceSummary: '',
            summary: '',
          });
        }
      } catch (err) {
        console.error('WBR core load failed:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchCore();
    return () => {
      cancelled = true;
    };
  }, [actualClientId, wbrDate, firestore, form]);

  useEffect(() => {
    if (!actualClientId || !monthlyDateRange?.from || !monthlyDateRange?.to || !weeklyDateRange?.from || !weeklyDateRange?.to) return;
    let cancelled = false;

    const fetchMetrics = async () => {
      setIsMetricsLoading(true);
      try {
        const monthlyStartStr = format(monthlyDateRange.from!, 'yyyy-MM');
        const monthlyEndStr = format(monthlyDateRange.to!, 'yyyy-MM');
        const weeklyStartStr = format(weeklyDateRange.from!, 'yyyy-MM');
        const weeklyEndStr = format(weeklyDateRange.to!, 'yyyy-MM');
        const fetchStartStr = monthlyStartStr < weeklyStartStr ? monthlyStartStr : weeklyStartStr;
        const fetchEndStr = monthlyEndStr > weeklyEndStr ? monthlyEndStr : weeklyEndStr;

        const [kpiList, monthSpends, weekSpends] = await Promise.all([
          fetchClientMonthRange<KpiData>(firestore, 'kpis', actualClientId, fetchStartStr, fetchEndStr),
          fetchClientMonthRange<MonthlySpend>(firestore, 'monthlySpends', actualClientId, fetchStartStr, fetchEndStr),
          fetchClientMonthRange<WeeklySpend>(firestore, 'weeklySpends', actualClientId, fetchStartStr, fetchEndStr),
        ]);
        if (cancelled) return;

        setKpis(kpiList);
        setMonthlySpends(monthSpends);
        setWeeklySpends(weekSpends);

        if (kpiList.length > 0) {
          const kpiIds = kpiList.map((k) => k.id);
          const chunks: string[][] = [];
          for (let i = 0; i < kpiIds.length; i += 30) chunks.push(kpiIds.slice(i, i + 30));
          const weeklyParts = await Promise.all(chunks.map((chunk) =>
            getDocs(query(collection(firestore, 'kpiWeeklyData'), where('kpiDataId', 'in', chunk)))
          ));
          if (cancelled) return;
          const weeklyKpiList: KpiWeeklyData[] = [];
          weeklyParts.forEach((snap) => {
            snap.forEach((d) => weeklyKpiList.push({ id: d.id, ...d.data() } as KpiWeeklyData));
          });
          setWeeklyKpis(weeklyKpiList);
        } else {
          setWeeklyKpis([]);
        }
      } catch (err) {
        console.error('WBR metrics load failed:', err);
      } finally {
        if (!cancelled) setIsMetricsLoading(false);
      }
    };

    fetchMetrics();
    return () => {
      cancelled = true;
    };
  }, [actualClientId, firestore, monthlyDateRange, weeklyDateRange]);

  const isAdmin = userProfile?.role === 'Admin';

  const isWindowOpen = useMemo(() => {
    if (!isClient) return false;
    const today = new Date();
    const parsedDate = parse(wbrDate, 'yyyy-MM-dd', new Date());
    const monday = startOfWeek(parsedDate, { weekStartsOn: 1 });
    const windowStart = startOfDay(monday);
    const windowEnd = endOfDay(addDays(monday, 1));
    return isAfter(today, windowStart) && isBefore(today, windowEnd);
  }, [wbrDate, isClient]);

  const REVIEW_FIELDS = ['contractStatus', 'financeIssues', 'engagementRag', 'organicOpportunities', 'crossSellOpportunities', 'performanceRag', 'performanceSummary', 'summary'];

  const canEditField = (fieldName: string) => {
    if (isAdmin) return true;
    if (!isWindowOpen) return false;
    return REVIEW_FIELDS.includes(fieldName);
  };

  const renderFieldInfo = () => {
    if (isAdmin) return <ShieldCheck className="h-3.5 w-3.5 text-primary" />;
    return null;
  };

  const onSubmit = async (values: WbrFormValues) => {
    setIsSaving(true);
    try {
      await saveWbrEntry(firestore, { ...values, clientId: actualClientId, wbrDate });
      toast({ title: "Review session synchronized" });
      router.push('/dashboard/wbr');
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Sync failed", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const monthsInRange = useMemo(() => {
    if (!monthlyDateRange?.from || !monthlyDateRange?.to) return [];
    return eachMonthOfInterval({ start: monthlyDateRange.from, end: monthlyDateRange.to });
  }, [monthlyDateRange]);

  const lobs = useMemo(() => {
    const set = new Set<string>();
    kpis.forEach(k => { if (k.lob) set.add(k.lob); });
    return Array.from(set).sort();
  }, [kpis]);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    kpis.forEach(k => { if (k.channel) set.add(canonicalizeChannel(k.channel)); });
    monthlySpends.forEach(s => { if (s.channelVendor) set.add(canonicalizeChannel(s.channelVendor)); });
    weeklySpends.forEach(s => { if (s.channelVendor) set.add(canonicalizeChannel(s.channelVendor)); });
    return Array.from(set).sort();
  }, [kpis, monthlySpends, weeklySpends]);

  const kpiOptions = useMemo(() => {
    const set = new Set<string>();
    kpis.forEach(k => { if (k.kpi) set.add(k.kpi); });
    return Array.from(set).sort();
  }, [kpis]);

  // MONTHLY GRID DATA
  const filteredKpis = useMemo(() => {
    return kpis.filter(k => {
      const lobMatch = selectedLobFilter === 'all' || k.lob === selectedLobFilter;
      const channelMatch = selectedChannelFilter === 'all' || canonicalizeChannel(k.channel) === selectedChannelFilter;
      const kpiMatch = selectedKpiFilter === 'all' || k.kpi === selectedKpiFilter;
      return lobMatch && channelMatch && kpiMatch;
    });
  }, [kpis, selectedLobFilter, selectedChannelFilter, selectedKpiFilter]);

  const groupedKpis = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredKpis.forEach(k => {
      const channel = canonicalizeChannel(k.channel);
      const key = `${channel}-${k.kpi}-${k.lob}`;
      if (!groups[key]) {
        groups[key] = {
          channel,
          kpi: k.kpi,
          kpiType: k.kpiType || 'PRIMARY',
          lob: k.lob,
          direction: parseKpiDirection(k.direction, k.kpi),
          months: {} as Record<string, KpiData>
        };
      }
      groups[key].months[k.month] = k;
      if (k.kpiType) groups[key].kpiType = k.kpiType;
    });
    return Object.values(groups).map((group: any) => {
      const latestMonth = Object.keys(group.months).sort().pop();
      const latest = latestMonth ? group.months[latestMonth] : undefined;
      return {
        ...group,
        direction: parseKpiDirection(latest?.direction ?? group.direction, group.kpi),
      };
    });
  }, [filteredKpis]);

  const processedMonthlySpends = useMemo(() => {
    const data: Record<string, Record<string, number>> = {};
    // LOB is not applied to spends — spends have no reliable LOB granularity
    monthlySpends.filter(s => {
      const channelMatch = selectedChannelFilter === 'all' || canonicalizeChannel(s.channelVendor) === selectedChannelFilter;
      return channelMatch;
    }).forEach(s => {
      const channel = canonicalizeChannel(s.channelVendor);
      const amount = Number(s.actualSpendsInr) || 0;
      if (!data[s.month]) data[s.month] = {};
      data[s.month][channel] = (data[s.month][channel] || 0) + amount;
      data[s.month]['Total'] = (data[s.month]['Total'] || 0) + amount;
    });
    return data;
  }, [monthlySpends, selectedChannelFilter]);

  const expandedChannels = useMemo(() => {
    const set = new Set<string>();
    monthlySpends.filter(s => {
      const channelMatch = selectedChannelFilter === 'all' || canonicalizeChannel(s.channelVendor) === selectedChannelFilter;
      return channelMatch;
    }).forEach(s => {
      if (s.channelVendor) set.add(canonicalizeChannel(s.channelVendor));
    });
    return Array.from(set).sort();
  }, [monthlySpends, selectedChannelFilter]);

  // WEEKLY GRID DATA
  const weeksInRange = useMemo(() => {
    if (!weeklyDateRange?.from || !weeklyDateRange?.to) return [];
    const weeks = [];
    let curr = startOfWeek(weeklyDateRange.from, { weekStartsOn: 1 });
    while (curr <= weeklyDateRange.to) {
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
        date: curr,
        label: `${format(curr, 'dd MMM')} - ${format(addDays(curr, 6), 'dd MMM')}`,
        key: `${monthKey}-W${weekNum}`
      });
      curr = addDays(curr, 7);
    }
    return weeks;
  }, [weeklyDateRange]);

  const filteredWeeklyKpisForGrid = useMemo(() => {
    return kpis.filter(k => {
      const lobMatch = selectedWeeklyLobFilter === 'all' || k.lob === selectedWeeklyLobFilter;
      const channelMatch = selectedWeeklyChannelFilter === 'all' || canonicalizeChannel(k.channel) === selectedWeeklyChannelFilter;
      const kpiMatch = selectedWeeklyKpiFilter === 'all' || k.kpi === selectedWeeklyKpiFilter;
      return lobMatch && channelMatch && kpiMatch;
    });
  }, [kpis, selectedWeeklyLobFilter, selectedWeeklyChannelFilter, selectedWeeklyKpiFilter]);

  const groupedWeeklyKpis = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredWeeklyKpisForGrid.forEach(k => {
      const channel = canonicalizeChannel(k.channel);
      const key = `${channel}-${k.kpi}-${k.lob}`;
      if (!groups[key]) {
        groups[key] = {
          channel,
          kpi: k.kpi,
          kpiType: k.kpiType || 'PRIMARY',
          lob: k.lob,
          direction: parseKpiDirection(k.direction, k.kpi),
          months: {} as Record<string, KpiData>
        };
      }
      groups[key].months[k.month] = k;
      if (k.kpiType) groups[key].kpiType = k.kpiType;
    });
    return Object.values(groups).map((group: any) => {
      const latestMonth = Object.keys(group.months).sort().pop();
      const latest = latestMonth ? group.months[latestMonth] : undefined;
      return {
        ...group,
        direction: parseKpiDirection(latest?.direction ?? group.direction, group.kpi),
      };
    });
  }, [filteredWeeklyKpisForGrid]);

  const processedWeeklySpends = useMemo(() => {
    const data: Record<string, Record<string, number>> = {};
    // LOB is not applied to spends — spends have no reliable LOB granularity
    weeklySpends.filter(s => {
      const channelMatch = selectedWeeklyChannelFilter === 'all' || canonicalizeChannel(s.channelVendor) === selectedWeeklyChannelFilter;
      return channelMatch;
    }).forEach(s => {
      const channel = canonicalizeChannel(s.channelVendor);
      const amount = Number(s.spendsInr) || 0;
      const d = parse(s.week, 'dd-MM-yyyy', new Date());
      if (isValid(d)) {
          const monday = startOfWeek(d, { weekStartsOn: 1 });
          const thursday = addDays(monday, 3);
          const monthKey = format(thursday, 'yyyy-MM');
          
          let weekNum = 1;
          let check = new Date(thursday);
          while (true) {
            check = new Date(check.getTime() - 7 * 24 * 60 * 60 * 1000);
            if (format(check, 'yyyy-MM') === monthKey) weekNum++;
            else break;
          }
          const weekKey = `${monthKey}-W${weekNum}`;

          if (!data[weekKey]) data[weekKey] = {};
          data[weekKey][channel] = (data[weekKey][channel] || 0) + amount;
          data[weekKey]['Total'] = (data[weekKey]['Total'] || 0) + amount;
      }
    });
    return data;
  }, [weeklySpends, selectedWeeklyChannelFilter]);

  const expandedWeeklyChannels = useMemo(() => {
    const set = new Set<string>();
    weeklySpends.filter(s => {
      const channelMatch = selectedWeeklyChannelFilter === 'all' || canonicalizeChannel(s.channelVendor) === selectedWeeklyChannelFilter;
      return channelMatch;
    }).forEach(s => {
      if (s.channelVendor) set.add(canonicalizeChannel(s.channelVendor));
    });
    return Array.from(set).sort();
  }, [weeklySpends, selectedWeeklyChannelFilter]);

  const getWeeklyColor = (
    achieved: unknown,
    weeklyPacingTarget: number | null,
    prevAchieved: unknown,
    direction: 'ASC' | 'DESC' = 'ASC'
  ) => {
    const status = getWeeklyStatus(achieved, weeklyPacingTarget, prevAchieved, direction);
    return ragStatusTextClass(status) || 'text-foreground/80';
  };

  if (isLoading || !isClient) return (
    <div className="flex flex-1 flex-col items-center justify-center p-20 gap-4">
      <Loader2 className="animate-spin h-12 w-12 text-primary" />
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary">Loading client data…</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10 pb-20 pt-4 px-4">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-none glass shadow-lg" onClick={() => router.push('/dashboard/wbr')}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">{actualClientId}</span>
            <h2 className="text-4xl font-black font-headline tracking-tighter uppercase">{clientInfo?.name || 'Review Workspace'}</h2>
            <div className="flex items-center gap-2">
                <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">REVIEW CYCLE: {wbrDate}</p>
            </div>
          </div>
        </div>

        {!isWindowOpen && !isAdmin && (
          <div className="flex items-center gap-3 bg-destructive/10 text-destructive px-6 h-14 rounded-none border border-destructive/20 shadow-destructive/10 animate-in slide-in-from-right-4">
            <Lock className="h-5 w-5" />
            <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest">Historical Lock Active</span>
                <span className="text-[9px] font-bold opacity-60">Viewing archived intelligence.</span>
            </div>
          </div>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-14 animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          <section className="space-y-6">
            <div className="flex items-center gap-3 px-1">
                <div className="h-6 w-1 bg-primary rounded-full" />
                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">ACCOUNT CONFIGURATION (ADMIN ONLY)</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 p-10 rounded-none glass relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5"><ShieldCheck className="h-32 w-32" /></div>
                <FormField control={form.control} name="cluster" render={({ field }) => (
                    <FormItem className="space-y-2">
                    <div className="flex items-center justify-between"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">STRATEGIC CLUSTER</FormLabel>{renderFieldInfo('cluster')}</div>
                    <FormControl><Input className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-bold" {...field} disabled={!isAdmin} /></FormControl>
                    </FormItem>
                )} />
                <FormField control={form.control} name="clusterLead" render={({ field }) => (
                    <FormItem className="space-y-2">
                    <div className="flex items-center justify-between"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">CLUSTER LEAD</FormLabel>{renderFieldInfo('clusterLead')}</div>
                    <FormControl><Input className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-bold" {...field} disabled={!isAdmin} /></FormControl>
                    </FormItem>
                )} />
                <FormField control={form.control} name="emcsm" render={({ field }) => (
                    <FormItem className="space-y-2">
                    <div className="flex items-center justify-between"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">EM / CSM MANAGER</FormLabel>{renderFieldInfo('emcsm')}</div>
                    <FormControl><Input className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-bold" {...field} disabled={!isAdmin} /></FormControl>
                    </FormItem>
                )} />
                <FormField control={form.control} name="clientPartner" render={({ field }) => (
                    <FormItem className="space-y-2">
                    <div className="flex items-center justify-between"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">CLIENT PARTNER</FormLabel>{renderFieldInfo('clientPartner')}</div>
                    <FormControl><Input className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-bold" {...field} disabled={!isAdmin} /></FormControl>
                    </FormItem>
                )} />
            </div>
          </section>

          {/* MONTHLY PERFORMANCE SECTION */}
          <section className="space-y-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
               <div className="flex items-center gap-3">
                  <LayoutDashboard className="h-5 w-5 text-primary" />
                  <h3 className="text-xl font-black uppercase tracking-tight">Monthly Strategic Pulse</h3>
                  {isMetricsLoading && <Loader2 className="h-4 w-4 animate-spin text-primary/60" />}
               </div>
               <div className="flex items-center gap-3 flex-wrap">
                  <DateRangePicker date={monthlyDateRange} setDate={setMonthlyDateRange} />
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedLobFilter} onValueChange={setSelectedLobFilter}><SelectTrigger className="h-8 min-w-[80px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="LOB" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL LOB</SelectItem>{lobs.map(lob => <SelectItem key={lob} value={lob} className="text-[10px] font-bold uppercase">{lob}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedChannelFilter} onValueChange={setSelectedChannelFilter}><SelectTrigger className="h-8 min-w-[120px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="CHANNEL" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL CHANNELS</SelectItem>{channelOptions.map(channel => <SelectItem key={channel} value={channel} className="text-[10px] font-bold uppercase">{channel}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedKpiFilter} onValueChange={setSelectedKpiFilter}><SelectTrigger className="h-8 min-w-[100px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="KPI" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL KPIs</SelectItem>{kpiOptions.map(kpi => <SelectItem key={kpi} value={kpi} className="text-[10px] font-bold uppercase">{kpi}</SelectItem>)}</SelectContent></Select>
                  </div>
               </div>
            </div>

            <div className="rounded-none glass overflow-hidden h-fit">
              <ScrollArea className="w-full">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-foreground/[0.04]">
                      <th className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-8 text-left text-[11px] font-black uppercase tracking-widest border-r border-foreground/5 min-w-[280px]">METRIC ARCHIVE</th>
                      {monthsInRange.map(m => (
                        <th key={format(m, 'MMM-yy')} className="px-6 py-8 text-center text-[11px] font-black uppercase tracking-widest border-r border-foreground/5 min-w-[140px] bg-primary/[0.02]">{format(m, 'MMM-yy')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {/* MONTHLY SPENDS ROW */}
                    <tr className="group hover:bg-foreground/[0.01] transition-colors">
                      <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-6 flex items-center gap-4 border-r border-foreground/5">
                        <button 
                          type="button" 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsSpendsExpanded(!isSpendsExpanded); }} 
                          className="h-8 w-8 rounded-none bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-white transition-all outline-none shadow-sm"
                        >
                          {isSpendsExpanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </button>
                        <div className="flex flex-col">
                            <span className="text-xs font-black uppercase tracking-tight">Spends Pulse</span>
                            <span className="text-[9px] font-bold text-secondary uppercase tracking-widest">Total Spends</span>
                        </div>
                      </td>
                      {monthsInRange.map(m => { 
                        const monthKey = format(m, 'yyyy-MM'); 
                        const spend = processedMonthlySpends[monthKey]?.Total || 0; 
                        return (<td key={monthKey} className="px-6 py-6 text-center font-mono font-black text-sm text-primary">{spend > 0 ? `₹${spend.toLocaleString()}` : '—'}</td>); 
                      })}
                    </tr>
                    {isSpendsExpanded && expandedChannels.map(channel => (
                      <tr key={channel} className="bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
                        <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-16 py-4 text-[10px] font-black text-foreground/50 border-r border-foreground/5 uppercase tracking-widest">{channel}</td>
                        {monthsInRange.map(m => { 
                          const monthKey = format(m, 'yyyy-MM'); 
                          const spend = processedMonthlySpends[monthKey]?.[channel] || 0; 
                          return (<td key={monthKey} className="px-6 py-4 text-center font-mono text-[10px] opacity-60">{spend > 0 ? `₹${spend.toLocaleString()}` : '—'}</td>); 
                        })}
                      </tr>
                    ))}

                    {/* CONSOLIDATED KPI ROWS */}
                    {groupedKpis.map(group => (
                      <React.Fragment key={`${group.channel}-${group.kpi}-${group.lob}`}>
                        <tr className="hover:bg-foreground/[0.01] transition-colors border-t-2 border-foreground/10">
                          <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-6 border-r border-foreground/5">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                 <Target className="h-3 w-3 text-primary/40" />
                                 <span className="text-xs font-black uppercase text-primary/80">{group.channel}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-[10px] font-black uppercase tracking-tight">{group.kpi}</span>
                                <Badge variant="outline" className="text-[7px] font-black h-3.5 px-1 leading-none border-foreground/10 bg-foreground/5 uppercase">{group.lob}</Badge>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[7px] font-black h-3.5 px-1 leading-none uppercase tracking-widest",
                                    (group.kpiType || 'PRIMARY') === 'PRIMARY'
                                      ? "border-brand/30 bg-brand/5 text-brand"
                                      : "border-foreground/10 bg-foreground/5 text-secondary"
                                  )}
                                >
                                  {group.kpiType || 'PRIMARY'}
                                </Badge>
                              </div>
                            </div>
                          </td>
                          {monthsInRange.map(m => {
                            const monthKey = format(m, 'yyyy-MM');
                            const kpi = group.months[monthKey];
                            return (
                                <td key={monthKey} className="px-6 py-6 text-center">
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="text-[8px] font-black opacity-30 uppercase">TGT</span>
                                            <span className="font-mono font-bold text-[10px] text-primary/60">{kpi ? kpi.targetMonth.toLocaleString() : '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="text-[8px] font-black opacity-30 uppercase">ACH</span>
                                            <span className={cn(
                                              "font-mono font-black text-xs",
                                              kpi ? ragStatusTextClass(getMonthlyStatus(kpi.achievedMonthTillYesterday, kpi.targetMonth, group.direction)) : ""
                                            )}>
                                                {kpi ? kpi.achievedMonthTillYesterday.toLocaleString() : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          </section>

          {/* WEEKLY PULSE SECTION */}
          <section className="space-y-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
               <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-brand" />
                  <h3 className="text-xl font-black uppercase tracking-tight">Tactical Weekly Velocity</h3>
                  {isMetricsLoading && <Loader2 className="h-4 w-4 animate-spin text-primary/60" />}
               </div>
               <div className="flex items-center gap-3 flex-wrap">
                  <DateRangePicker date={weeklyDateRange} setDate={setWeeklyDateRange} />
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedWeeklyLobFilter} onValueChange={setSelectedWeeklyLobFilter}><SelectTrigger className="h-8 min-w-[80px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="LOB" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL LOB</SelectItem>{lobs.map(lob => <SelectItem key={lob} value={lob} className="text-[10px] font-bold uppercase">{lob}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedWeeklyChannelFilter} onValueChange={setSelectedWeeklyChannelFilter}><SelectTrigger className="h-8 min-w-[120px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="CHANNEL" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL CHANNELS</SelectItem>{channelOptions.map(channel => <SelectItem key={channel} value={channel} className="text-[10px] font-bold uppercase">{channel}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/5 h-10">
                    <Filter className="h-3 w-3 text-secondary" />
                    <Select value={selectedWeeklyKpiFilter} onValueChange={setSelectedWeeklyKpiFilter}><SelectTrigger className="h-8 min-w-[100px] border-none bg-transparent shadow-none text-[10px] font-black uppercase p-0 focus:ring-0"><SelectValue placeholder="KPI" /></SelectTrigger><SelectContent className="rounded-none glass "><SelectItem value="all" className="text-[10px] font-bold">ALL KPIs</SelectItem>{kpiOptions.map(kpi => <SelectItem key={kpi} value={kpi} className="text-[10px] font-bold uppercase">{kpi}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="h-px w-8 bg-foreground/10 hidden md:block" />
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-secondary">Operational Risk (P-RAG)</span>
                    <Badge className={cn("text-[10px] font-black uppercase h-8 px-4 rounded-none shadow-lg", form.getValues('performanceRag') === 'Green' ? 'bg-success text-success-foreground' : form.getValues('performanceRag') === 'Amber' ? 'bg-warning text-warning-foreground' : 'bg-destructive text-destructive-foreground')}>
                      {form.getValues('performanceRag') || 'N/A'}
                    </Badge>
                  </div>
               </div>
            </div>

            <div className="rounded-none glass overflow-hidden h-fit">
              <ScrollArea className="w-full">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-brand/[0.04]">
                      <th className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-8 text-left text-[11px] font-black uppercase tracking-widest border-r border-foreground/5 min-w-[280px]">WEEKLY METRIC</th>
                      {weeksInRange.map(w => (
                        <th key={w.key} className="px-4 py-6 text-center border-r border-foreground/5 min-w-[130px]">
                           <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-black uppercase tracking-widest text-secondary">WEEK</span>
                              <span className="text-[11px] font-black uppercase">{w.label}</span>
                           </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {/* WEEKLY SPENDS ROW */}
                    <tr className="group hover:bg-foreground/[0.01] transition-colors">
                      <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-6 flex items-center gap-4 border-r border-foreground/5">
                        <button 
                          type="button" 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsWeeklySpendsExpanded(!isWeeklySpendsExpanded); }} 
                          className="h-8 w-8 rounded-none bg-brand/10 text-brand flex items-center justify-center hover:bg-brand hover:text-white transition-all outline-none shadow-sm"
                        >
                          {isWeeklySpendsExpanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </button>
                        <div className="flex flex-col">
                            <span className="text-xs font-black uppercase tracking-tight">Weekly Spends</span>
                            <span className="text-[9px] font-bold text-secondary uppercase tracking-widest">Temporal Depletion</span>
                        </div>
                      </td>
                      {weeksInRange.map(w => {
                        const spend = processedWeeklySpends[w.key]?.Total || 0;
                        return (<td key={w.key} className="px-6 py-6 text-center font-mono font-black text-sm text-brand">{spend > 0 ? `₹${spend.toLocaleString()}` : '—'}</td>);
                      })}
                    </tr>
                    {isWeeklySpendsExpanded && expandedWeeklyChannels.map(channel => (
                      <tr key={`weekly-expand-${channel}`} className="bg-brand/[0.02] hover:bg-brand/[0.04] transition-colors">
                        <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-16 py-4 text-[10px] font-black text-brand/50 border-r border-foreground/5 uppercase tracking-widest">{channel}</td>
                        {weeksInRange.map(w => { 
                          const spend = processedWeeklySpends[w.key]?.[channel] || 0; 
                          return (<td key={w.key} className="px-6 py-4 text-center font-mono text-[10px] opacity-60">{spend > 0 ? `₹${spend.toLocaleString()}` : '—'}</td>); 
                        })}
                      </tr>
                    ))}

                    {/* WEEKLY KPI ROWS */}
                    {groupedWeeklyKpis.map(group => (
                      <tr key={`weekly-${group.channel}-${group.kpi}-${group.lob}`} className="hover:bg-foreground/[0.01] transition-colors border-t border-foreground/5">
                        <td className="sticky left-0 z-20 bg-background/95 backdrop-blur-md px-8 py-6 border-r border-foreground/5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase text-foreground/70">{group.channel} Achieved</span>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-[8px] font-bold text-secondary uppercase tracking-tighter">{group.kpi} • {group.lob}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[7px] font-black h-3.5 px-1 leading-none uppercase tracking-widest",
                                  (group.kpiType || 'PRIMARY') === 'PRIMARY'
                                    ? "border-brand/30 bg-brand/5 text-brand"
                                    : "border-foreground/10 bg-foreground/5 text-secondary"
                                )}
                              >
                                {group.kpiType || 'PRIMARY'}
                              </Badge>
                            </div>
                          </div>
                        </td>
                        {weeksInRange.map((w, idx) => { 
                          const monthKey = w.key.split('-W')[0];
                          const weekNum = parseInt(w.key.split('-W')[1]);
                          const parentKpi = group.months[monthKey];
                          if (!parentKpi) return <td key={w.key} className="px-6 py-6 text-center font-mono text-[11px] opacity-10">—</td>;
                          
                          const weekData = weeklyKpis.find(wd => wd.kpiDataId === parentKpi.id && wd.weekOfMonth === weekNum); 
                          
                          // WOW COLOR LOGIC
                          let prevAchieved = null;
                          if (idx > 0) {
                             const prevW = weeksInRange[idx-1];
                             const prevMonthKey = prevW.key.split('-W')[0];
                             const prevWeekNum = parseInt(prevW.key.split('-W')[1]);
                             const prevParentKpi = group.months[prevMonthKey];
                             if (prevParentKpi) {
                               const prevWeekData = weeklyKpis.find(wd => wd.kpiDataId === prevParentKpi.id && wd.weekOfMonth === prevWeekNum);
                               if (prevWeekData) prevAchieved = prevWeekData.achieved;
                             }
                          }

                          const weeksInMonth = weeksInRange.filter((x) => x.key.startsWith(`${monthKey}-`)).length || 4;
                          const weeklyPacingTarget = getEffectiveWeeklyTarget({
                            kpiName: group.kpi,
                            direction: group.direction,
                            monthlyTarget: parentKpi.targetMonth,
                            weekTarget: weekData?.target,
                            weeksInMonth,
                          });
                          const colorClass = weekData
                            ? getWeeklyColor(weekData.achieved, weeklyPacingTarget, prevAchieved, group.direction)
                            : 'text-foreground/80';

                          return (
                            <td key={w.key} className="px-6 py-6 text-center">
                              <span className={cn("font-mono font-black text-sm", colorClass)}>
                                {weekData ? weekData.achieved.toLocaleString() : '—'}
                              </span>
                            </td>
                          ); 
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 px-1"><div className="h-6 w-1 bg-primary/40 rounded-full" /><h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60">ENGAGEMENT REVIEW (CSM CONTEXT)</h4></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-10 rounded-none glass ">
                <FormField control={form.control} name="contractStatus" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">CONTRACT STATUS</FormLabel>{renderFieldInfo('contractStatus')}</div><Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('contractStatus')}><FormControl><SelectTrigger className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-bold"><SelectValue /></SelectTrigger></FormControl><SelectContent className="rounded-none glass "><SelectItem value="Valid" className="font-bold">Valid</SelectItem><SelectItem value="Expired" className="text-destructive font-black">Expired</SelectItem><SelectItem value="Negotiation" className="text-warning font-black">Negotiation</SelectItem></SelectContent></Select></FormItem>)} />
                <FormField control={form.control} name="engagementRag" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">ENGAGEMENT RAG</FormLabel>{renderFieldInfo('engagementRag')}</div><Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('engagementRag')}><FormControl><SelectTrigger className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-black"><SelectValue /></SelectTrigger></FormControl><SelectContent className="rounded-none glass "><SelectItem value="Green" className="text-success font-black">GREEN</SelectItem><SelectItem value="Amber" className="text-warning font-black">AMBER</SelectItem><SelectItem value="Red" className="text-destructive font-black">RED</SelectItem></SelectContent></Select></FormItem>)} />
                <div className="md:col-span-2"><FormField control={form.control} name="financeIssues" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">CSM Comments</FormLabel>{renderFieldInfo('financeIssues')}</div><FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none min-h-[120px] shadow-inner p-6 text-sm font-medium leading-relaxed resize-none" {...field} disabled={!canEditField('financeIssues')} /></FormControl></FormItem>)} /></div>
                <FormField control={form.control} name="organicOpportunities" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Billing Update</FormLabel>{renderFieldInfo('organicOpportunities')}</div><FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none h-32 shadow-inner p-5 text-sm font-medium leading-relaxed resize-none" {...field} disabled={!canEditField('organicOpportunities')} /></FormControl></FormItem>)} />
                <FormField control={form.control} name="crossSellOpportunities" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Cross Sell Opportunities</FormLabel>{renderFieldInfo('crossSellOpportunities')}</div><FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none h-32 shadow-inner p-5 text-sm font-medium leading-relaxed resize-none" {...field} disabled={!canEditField('crossSellOpportunities')} /></FormControl></FormItem>)} />
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3 px-1"><div className="h-6 w-1 bg-primary/40 rounded-full" /><h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60">OPERATIONAL REVIEW (LEAD CONTEXT)</h4></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-10 rounded-none glass ">
                <FormField control={form.control} name="performanceRag" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">PERFORMANCE RAG (RISK)</FormLabel>{renderFieldInfo('performanceRag')}</div><Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('performanceRag')}><FormControl><SelectTrigger className="rounded-none bg-foreground/[0.03] border-none h-14 shadow-inner px-5 font-black"><SelectValue /></SelectTrigger></FormControl><SelectContent className="rounded-none glass "><SelectItem value="Green" className="text-success font-black">GREEN</SelectItem><SelectItem value="Amber" className="text-warning font-black">AMBER</SelectItem><SelectItem value="Red" className="text-destructive font-black">RED</SelectItem></SelectContent></Select></FormItem>)} />
                <div className="md:col-span-2"><FormField control={form.control} name="performanceSummary" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Performance Summary</FormLabel>{renderFieldInfo('performanceSummary')}</div><FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none min-h-[120px] shadow-inner p-6 text-sm font-medium leading-relaxed resize-none" {...field} disabled={!canEditField('performanceSummary')} /></FormControl></FormItem>)} /></div>
                <div className="md:col-span-2"><FormField control={form.control} name="summary" render={({ field }) => (<FormItem><div className="flex items-center justify-between mb-1"><FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Executive Summary &amp; challenges</FormLabel>{renderFieldInfo('summary')}</div><FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none min-h-[160px] shadow-inner p-8 text-sm font-medium leading-relaxed resize-none font-mono" {...field} disabled={!canEditField('summary')} /></FormControl></FormItem>)} /></div>
            </div>
          </section>

          <section className="space-y-6">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 px-1">
                   <div className="h-6 w-1 bg-brand rounded-full" />
                   <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand">CLIENT ACTION LOG</h4>
                </div>
                <Button type="button" size="sm" className="rounded-none gap-2 font-black text-[10px] uppercase shadow-lg shadow-brand/20" onClick={() => { setSelectedAction(null); setIsActionDialogOpen(true); }}>
                  <PlusCircle className="h-4 w-4" /> INITIATE TASK
                </Button>
             </div>
             <div className="rounded-none glass overflow-hidden">
                <Table>
                  <TableHeader className="bg-foreground/[0.02]"><TableRow className="border-b border-foreground/5">
                      <TableHead className="px-8 py-6 text-[9px] font-black uppercase tracking-widest text-secondary">Task & Owner</TableHead>
                      <TableHead className="text-[9px] font-black uppercase tracking-widest text-secondary">Section</TableHead>
                      <TableHead className="text-[9px] font-black uppercase tracking-widest text-secondary">Status</TableHead>
                      <TableHead className="text-[9px] font-black uppercase tracking-widest text-secondary">Intelligence</TableHead>
                      <TableHead className="w-10"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {!clientActions || clientActions.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-20 text-[10px] font-black uppercase tracking-widest text-secondary/70 italic">No action items discussed for this entity.</TableCell></TableRow>
                    ) : clientActions.map((action) => (
                      <TableRow key={action.id} className="border-b border-foreground/5 hover:bg-foreground/[0.01]">
                        <TableCell className="px-8 py-4"><div className="flex flex-col"><span className="text-xs font-black text-foreground/80">{action.taskName}</span><span className="text-[9px] font-bold text-secondary uppercase">{action.assignedTo}</span></div></TableCell>
                        <TableCell><Badge variant="outline" className="text-[8px] font-black h-4 px-1.5 leading-none border-foreground/10 uppercase">{action.section}</Badge></TableCell>
                        <TableCell>{(() => {
                          const status = resolveActionStatus(action.status, action.dueDate);
                          return (
                            <Badge className={cn(
                              "text-[8px] font-black uppercase h-5 px-2 rounded-none flex items-center gap-1 w-fit",
                              status === 'Completed' ? 'bg-success text-success-foreground'
                                : status === 'Overdue' ? 'bg-destructive/10 text-destructive'
                                : status === 'On-Hold' ? 'bg-warning/15 text-warning'
                                : status === 'Observation' ? 'bg-secondary/15 text-secondary'
                                : 'bg-primary/10 text-primary'
                            )}>
                              {status}
                            </Badge>
                          );
                        })()}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-[10px] font-medium opacity-60">{action.comment || action.description}</TableCell>
                        <TableCell className="px-4"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-none"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="rounded-none glass p-2 min-w-[140px]"><DropdownMenuItem className="rounded-lg text-[9px] font-black uppercase tracking-widest gap-2" onSelect={openDialogFromMenu(() => { setSelectedAction(action); setIsActionDialogOpen(true); })}>Update Protocol</DropdownMenuItem><DropdownMenuItem className="rounded-lg text-[9px] font-black uppercase tracking-widest text-destructive gap-2 focus:bg-destructive/10 focus:text-destructive" onClick={() => deleteActionItem(firestore, action.id)}>Purge Task</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
             </div>
          </section>

          <div className="flex items-center justify-between gap-6 pt-10 border-t border-foreground/5"><div className="flex items-center gap-4"><Button type="button" variant="outline" className="h-14 px-8 rounded-none glass font-bold text-muted-foreground shadow-lg" onClick={() => router.push('/dashboard/wbr')}>Discard Changes</Button><Button type="button" variant="ghost" className="h-14 px-6 rounded-none font-bold gap-2 text-secondary hover:opacity-100"><History className="h-4 w-4" /> Changelog</Button></div><Button type="submit" className="h-16 px-16 rounded-none font-black text-sm uppercase tracking-widest shadow-primary/30 gap-3" disabled={isSaving || (!isWindowOpen && !isAdmin)}>{isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}{isSaving ? 'Preserving Record...' : 'Synchronize Review'}</Button></div>
          {!isWindowOpen && !isAdmin && (<div className="text-center p-8 bg-foreground/5 rounded-none border border-dashed border-foreground/10 max-w-2xl mx-auto space-y-2"><Lock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" /><p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Historical Record Integrity Protected</p><p className="text-xs font-medium opacity-50"> This record is permanently archived.</p></div>)}
        </form>
      </Form>
      <AddActionItemDialog isOpen={isActionDialogOpen} onOpenChange={(open) => { setIsActionDialogOpen(open); if (!open) setSelectedAction(null); }} clientId={actualClientId} clientName={clientInfo?.name} action={selectedAction} />
    </div>
  );
}
