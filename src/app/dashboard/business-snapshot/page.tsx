
'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { 
  ArrowsClockwise, 
  CircleNotch, 
  FileText, 
  ArrowUpRight, 
  ArrowDownRight, 
  ArrowUp, 
  ArrowDown, 
  Globe, 
  ChartBar, 
  Calendar, 
  CaretRight, 
  Target, 
  Briefcase, 
  ListChecks, 
  Warning, 
  Clock 
} from "@phosphor-icons/react";
import { format, parse, subMonths, isValid } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useDoc, useFirestore, useUser, useCollection } from '@/firebase';
import { BusinessSnapshot, UserProfile, PerformanceShift, MonthlySpend, WeeklySpend, KpiData, WbrEntry, ActionItem, ActionStatus, Client, Lead, RagStatus } from '@/lib/types';
import { canonicalizeChannel, resolveActionStatus } from '@/lib/normalize';
import { clientPathFromPrimaryKpis, kpiAttainmentPct, selectPrimaryKpisForPath, type ClientPath } from '@/lib/kpi-rag';
import { refreshBusinessSnapshot } from '@/lib/firestore-actions';
import {
  aggregateBrandSpendBreakdown,
  aggregateSpendByWeekStart,
  buildWowSpendsTrend,
  dominantImpactSpendType,
  formatLatestWeekDateLabel,
  formatWeekStartLabel,
  isLargeSyntheticClient,
  resolveWowWeekPair,
  toSpendNumber,
} from '@/lib/spend-week';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { where, query, collection, getDocs, orderBy, limit, startAfter, documentId, type Firestore, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { Separator } from '@/components/ui/separator';
import { exportToPdf } from '@/lib/pdf-export';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  BarChart, 
  Bar,
  Cell,
  LabelList
} from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';

/** CLID is the sole unique client key across KPI / Spends / WBR. */
function normalizeClid(clientId?: string | null): string | null {
  const id = (clientId || '').trim();
  return id || null;
}

function isMomentumExcludedClient(row: Pick<WeeklySpend, 'clientId' | 'brandName'>): boolean {
  return isLargeSyntheticClient(row);
}

const formatCurrency = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (absVal >= 10000000) return `₹${sign}${(absVal / 10000000).toFixed(2)}Cr`;
    if (absVal >= 100000) return `₹${sign}${(absVal / 100000).toFixed(2)}L`;
    return `₹${sign}${absVal.toLocaleString()}`;
};

const formatChartLabel = (val: number) => {
  if (val == null || Number.isNaN(val) || val === 0) return '';
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  // One decimal keeps labels short enough for dense 12-week charts
  if (absVal >= 10000000) return `${sign}${(absVal / 10000000).toFixed(1)}Cr`;
  if (absVal >= 100000) return `${sign}${(absVal / 100000).toFixed(1)}L`;
  if (absVal >= 1000) return `${sign}${(absVal / 1000).toFixed(0)}K`;
  return `${sign}${absVal.toFixed(0)}`;
};

/** Alternate above/below the line so neighboring labels don't collide. */
const MomentumSpendLabel = (props: {
  x?: number | string;
  y?: number | string;
  value?: number | string;
  index?: number;
}) => {
  const { x, y, value, index = 0 } = props;
  const numeric = typeof value === 'number' ? value : Number(value);
  const label = formatChartLabel(numeric);
  if (!label || x == null || y == null) return null;

  const cx = Number(x);
  const cy = Number(y);
  const placeAbove = index % 2 === 0;
  const dy = placeAbove ? -12 : 18;

  return (
    <text
      x={cx}
      y={cy + dy}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="hsl(var(--ink))"
      fontSize={9}
      fontWeight={700}
      fontFamily="var(--font-mono), IBM Plex Mono, monospace"
      style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
    >
      {label}
    </text>
  );
};

const CHART_PALETTE = [
  '#002FA7', // Brand Blue
  '#D92218', // Red
  '#00A675', // Green
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#8B5CF6', // Purple
];

/** Mirror Action Items Kanban columns on Snapshot Accountability Pulse. */
const ACTION_BOARD_STATUSES: ActionStatus[] = [
  'Work-In Progress',
  'On-Hold',
  'Observation',
  'Overdue',
  'Completed',
];

const actionBoardAccent: Record<ActionStatus, string> = {
  'Work-In Progress': 'bg-brand',
  'On-Hold': 'bg-warning',
  Observation: 'bg-secondary',
  Overdue: 'bg-destructive',
  Completed: 'bg-success',
};

interface ClientHealthRow {
  clientId: string;
  clientName: string;
  cluster: string;
  lead: string;
  kpiName: string;
  channel: string;
  achieved: number;
  target: number;
  direction: 'ASC' | 'DESC';
  currency?: string;
  pathStatus: RagStatus;
  path: ClientPath;
  performanceRag: RagStatus;
  engagementRag: RagStatus;
  attainment: number | null;
}

const PATH_RANK: Record<ClientPath, number> = { 'off-path': 0, 'no-signal': 1, 'on-path': 2 };

const KPI_PAGE_SIZE = 500;

/** Load every KPI row for a month (Firestore queries are capped; paginate past the first page). */
async function fetchAllKpisForMonth(db: Firestore, month: string): Promise<KpiData[]> {
  const results: KpiData[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    const constraints = [
      where('month', '==', month),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(KPI_PAGE_SIZE),
    ];
    const snap = await getDocs(query(collection(db, 'kpis'), ...constraints));
    if (snap.empty) break;
    for (const d of snap.docs) {
      results.push({ id: d.id, ...(d.data() as object) } as KpiData);
    }
    if (snap.size < KPI_PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return results;
}

/**
 * Path MTD month should follow KPI Tracker (current month when data exists),
 * not lag behind the latest spends month.
 */
async function resolveHealthKpiMonth(db: Firestore, spendsMonth: string): Promise<string> {
  const calendarMonth = format(new Date(), 'yyyy-MM');
  const calSnap = await getDocs(query(collection(db, 'kpis'), where('month', '==', calendarMonth), limit(1)));
  if (!calSnap.empty) return calendarMonth;

  const latestSnap = await getDocs(query(collection(db, 'kpis'), orderBy('month', 'desc'), limit(1)));
  const latestMonth = latestSnap.docs[0]?.data()?.month as string | undefined;
  if (latestMonth && /^\d{4}-\d{2}$/.test(latestMonth)) return latestMonth;

  return spendsMonth;
}

export default function BusinessSnapshotPage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const { data: userProfile } = useDoc<UserProfile>(user ? `users/${user.uid}` : null);
  
  const [mounted, setMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statsWindow, setStatsWindow] = useState<any[]>([]);
  const [monthlyWindow, setMonthlyWindow] = useState<any[]>([]);
  const snapshotRef = useRef<HTMLDivElement>(null);

  // INTELLIGENCE STATE
  const [newsFeed, setNewsFeed] = useState<any[]>([]);
  const [excludeMomentumLargeClients, setExcludeMomentumLargeClients] = useState(false);
  const [pipelineData, setPipelineData] = useState<any[]>([]);
  const [accountabilityPulse, setAccountabilityPulse] = useState<any[]>([]);
  const [clientHealth, setClientHealth] = useState<ClientHealthRow[]>([]);
  const [clientHealthLoading, setClientHealthLoading] = useState(false);
  const [healthCycleDate, setHealthCycleDate] = useState<string | null>(null);
  const [healthKpiMonth, setHealthKpiMonth] = useState<string | null>(null);
  const [wbrRagSummary, setWbrRagSummary] = useState({
    pGreen: 0,
    pAmber: 0,
    pRed: 0,
    eGreen: 0,
    eAmber: 0,
    eRed: 0,
  });

  useEffect(() => {
    setMounted(true);
    // 12-Week Momentum + latest-week pulse only need ~5 months of weekly rows,
    // not a two-year listener (that blocked first paint for tens of thousands of docs).
    const weeklyFrom = format(subMonths(new Date(), 4), 'yyyy-MM');
    const weeklyTo = format(new Date(), 'yyyy-MM');
    setStatsWindow([
      where('month', '>=', weeklyFrom),
      where('month', '<=', weeklyTo),
    ]);
    // Monthly: include prior-year YTD so Annual can compare same months YoY
    const ytdCompareStart = format(new Date(new Date().getFullYear() - 1, 0, 1), 'yyyy-MM');
    setMonthlyWindow([where('month', '>=', ytdCompareStart)]);
  }, []);

  const { data: monthlySpends, loading: mLoading } = useCollection<MonthlySpend>('monthlySpends', monthlyWindow);
  const { data: weeklySpends } = useCollection<WeeklySpend>('weeklySpends', statsWindow);

  const channelSpendPulse = useMemo(() => {
    const { keys, rowsByKey } = aggregateSpendByWeekStart(weeklySpends);
    const lastKey = [...keys].reverse().find((key) =>
      (rowsByKey[key] || []).some((row) => toSpendNumber(row.spendsInr) !== 0)
    );
    if (!lastKey) return { channels: [] as { name: string; value: number }[], label: null as string | null };
    const totals: Record<string, number> = {};
    (rowsByKey[lastKey] || []).forEach((row) => {
      const channel = canonicalizeChannel(row.channelVendor);
      totals[channel] = (totals[channel] || 0) + toSpendNumber(row.spendsInr);
    });
    const latestLabel = formatLatestWeekDateLabel(rowsByKey[lastKey], 'dd MMM yyyy');
    return {
      channels: Object.entries(totals)
        .map(([name, value]) => ({ name, value }))
        .filter((row) => row.value !== 0)
        .sort((a, b) => b.value - a.value),
      label: latestLabel ? `Week of ${latestLabel}` : null,
    };
  }, [weeklySpends]);
  const channelSpends = channelSpendPulse.channels;
  const channelSpendWeekLabel = channelSpendPulse.label;

  // 12-Week Momentum — same series as Spends Dashboard WoW, with optional large-client exclude
  const momentumData = useMemo(() => {
    const rows = excludeMomentumLargeClients
      ? (weeklySpends || []).filter((s) => !isMomentumExcludedClient(s))
      : weeklySpends;
    return buildWowSpendsTrend(rows, 12).map(({ week, spend }) => ({ week, spend }));
  }, [weeklySpends, excludeMomentumLargeClients]);

  useEffect(() => {
    if (!mounted) return;

    const fetchIntelligence = async () => {
      try {
        const looksLikeClientId = (value?: string | null, cid?: string) => {
          if (!value?.trim()) return true;
          const v = value.trim();
          if (cid && v === cid) return true;
          return /^CLID\d+$/i.test(v);
        };

        const [wbrSnap, actionsSnap, leadsSnap, clientSnap, kpiRefSnap] = await Promise.all([
          getDocs(query(collection(firestore, 'wbrEntries'), orderBy('wbrDate', 'desc'), limit(15))),
          getDocs(query(collection(firestore, 'actionItems'), orderBy('updatedAt', 'desc'), limit(100))),
          getDocs(query(collection(firestore, 'leads'), limit(100))),
          getDocs(collection(firestore, 'clients')),
          getDocs(query(
            collection(firestore, 'kpis'),
            where('month', '>=', format(subMonths(new Date(), 3), 'yyyy-MM')),
            limit(500)
          )),
        ]);

        const wbrs = wbrSnap.docs.map(d => d.data() as WbrEntry);
        const actions = actionsSnap.docs.map(d => d.data() as ActionItem);
        const leads = leadsSnap.docs.map(d => d.data() as Lead);

        const nameLookup: Record<string, string> = {};
        const rememberName = (cid?: string, name?: string) => {
          if (!cid || !name || looksLikeClientId(name, cid)) return;
          if (!nameLookup[cid] || looksLikeClientId(nameLookup[cid], cid)) {
            nameLookup[cid] = name;
          }
        };

        clientSnap.forEach(d => {
          const data = d.data() as Client;
          rememberName(data.uniqueId, data.name);
        });
        kpiRefSnap.forEach(d => {
          const data = d.data() as KpiData;
          rememberName(data.clientId, data.clientName);
        });

        const wbrClientIds = Array.from(new Set(wbrs.map(w => w.clientId).filter(Boolean)));
        const unresolvedIds = wbrClientIds.filter(cid => looksLikeClientId(nameLookup[cid], cid)).slice(0, 15);
        await Promise.all(unresolvedIds.map(async (cid) => {
          const byUniqueId = await getDocs(
            query(collection(firestore, 'clients'), where('uniqueId', '==', cid), limit(1))
          );
          if (!byUniqueId.empty) {
            rememberName(cid, (byUniqueId.docs[0].data() as Client).name);
            if (!looksLikeClientId(nameLookup[cid], cid)) return;
          }
          const byKpi = await getDocs(
            query(collection(firestore, 'kpis'), where('clientId', '==', cid), limit(1))
          );
          if (!byKpi.empty) {
            rememberName(cid, (byKpi.docs[0].data() as KpiData).clientName);
          }
        }));

        // 3. SALES PIPELINE (FUNNEL)
        const statusOrder = ['Qualified', 'Pitch', 'Negotiation', 'Contract', 'Won'];
        const leadCounts = leads.reduce((acc, l) => {
          acc[l.status] = (acc[l.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const maxLead = Math.max(...Object.values(leadCounts), 1);
        setPipelineData(statusOrder.map(status => ({
          status,
          name: status.toUpperCase(),
          value: leadCounts[status] || 0,
          percent: ((leadCounts[status] || 0) / maxLead) * 100
        })));

        // 4. ACCOUNTABILITY PULSE — Kanban status board counts
        const statusCounts: Record<ActionStatus, number> = {
          'Work-In Progress': 0,
          'On-Hold': 0,
          Observation: 0,
          Overdue: 0,
          Completed: 0,
        };
        actions.forEach((a) => {
          const status = resolveActionStatus(a.status, a.dueDate);
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        const totalActions = Object.values(statusCounts).reduce((sum, n) => sum + n, 0) || 1;
        setAccountabilityPulse(ACTION_BOARD_STATUSES.map((status) => ({
          status,
          count: statusCounts[status] || 0,
          percent: ((statusCounts[status] || 0) / totalActions) * 100,
        })));

        // 5. NEWS FEED (Utilizing resolved names)
        const pulseFeed: any[] = [];
        Array.from(new Set(wbrs.map(w => w.clientId))).forEach(cid => {
          const clientWbr = wbrs.find(w => w.clientId === cid);
          if (clientWbr) {
            const displayName =
              (!looksLikeClientId(nameLookup[cid], cid) && nameLookup[cid]) ||
              (!looksLikeClientId(clientWbr.clientName, cid) && clientWbr.clientName) ||
              cid;
            pulseFeed.push({
              client: `${displayName} • ${clientWbr.cluster || 'UNASSIGNED'}`,
              rag: clientWbr.performanceRag,
              week: (() => {
                try {
                  const d = parse(clientWbr.wbrDate, 'yyyy-MM-dd', new Date());
                  return isValid(d) ? format(d, 'dd MMM') : clientWbr.wbrDate;
                } catch {
                  return clientWbr.wbrDate;
                }
              })(),
              intelligence: clientWbr.summary || clientWbr.financeIssues || 'Monitoring operational stability.'
            });
          }
        });
        setNewsFeed(pulseFeed.slice(0, 10));

      } catch (err) {
        console.error("Snapshot Fetch Failure:", err);
      }
    };

    fetchIntelligence();
  }, [mounted, firestore]);

  const stats = useMemo(() => {
    if (!monthlySpends || !mounted) return null;
    const allMonths = Array.from(new Set(monthlySpends.map(d => d.month))).sort().reverse();
    let latestSpendMonth = '';
    for (const m of allMonths) {
      if (monthlySpends.filter(d => d.month === m).reduce((a, b) => a + toSpendNumber(b.actualSpendsInr), 0) > 0) {
        latestSpendMonth = m; break;
      }
    }
    if (!latestSpendMonth) return null;

    // Monthly (and YTD) follow the latest month that actually has spends.
    // Empty calendar months (e.g. August before the upload) must not show ₹0 / -100% MoM.
    const targetMonth = latestSpendMonth;

    const calcShifts = (curr: ReturnType<typeof aggregateBrandSpendBreakdown>, prev: ReturnType<typeof aggregateBrandSpendBreakdown>) => {
      const all = Array.from(new Set([...Object.keys(curr.spendMap), ...Object.keys(prev.spendMap)]));
      const diffs = all.map(brand => {
        const c = curr.spendMap[brand] || 0;
        const p = prev.spendMap[brand] || 0;
        const diff = c - p;
        const type = dominantImpactSpendType(curr.typeSpendMap[brand], prev.typeSpendMap[brand], diff);
        const team = curr.teamByType[brand]?.[type] || prev.teamByType[brand]?.[type] || 'N/A';
        return { brand, type, team, amount: diff, variance: p > 0 ? (diff / p) * 100 : (c > 0 ? 100 : 0), direction: diff >= 0 ? 'increase' : 'decrease' } as PerformanceShift;
      });
      return { gainers: diffs.filter(x => (x.amount || 0) > 0).sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 3), losers: diffs.filter(x => (x.amount || 0) < 0).sort((a, b) => (a.amount || 0) - (b.amount || 0)).slice(0, 3) };
    };

    const currMonthData = aggregateBrandSpendBreakdown(monthlySpends.filter(d => d.month === targetMonth));
    const prevMonthData = aggregateBrandSpendBreakdown(monthlySpends.filter(d => d.month === format(subMonths(parse(targetMonth, 'yyyy-MM', new Date()), 1), 'yyyy-MM')));
    const mShifts = calcShifts(currMonthData, prevMonthData);

    // WoW: match weeks by Monday week-start, not exact week label strings.
    // Uploads often store mid-week "as of" dates; format(subWeeks(lastLabel))
    // then misses the prior week even when data exists.
    const { keys: weekStartKeys, rowsByKey } = aggregateSpendByWeekStart(weeklySpends);
    const { currentKey: lastWeekStartKey, previousKey: prevWeekStartKey } =
      resolveWowWeekPair(weekStartKeys);

    const currWData = aggregateBrandSpendBreakdown(rowsByKey[lastWeekStartKey] || []);
    const prevWData = aggregateBrandSpendBreakdown(rowsByKey[prevWeekStartKey] || []);
    const wShifts = calcShifts(currWData, prevWData);
    const weeklyDateLabel =
      formatLatestWeekDateLabel(rowsByKey[lastWeekStartKey], 'dd-MM-yyyy') ||
      (lastWeekStartKey ? formatWeekStartLabel(lastWeekStartKey, 'dd-MM-yyyy') : '');

    const year = targetMonth.split('-')[0];
    const prevYear = String(Number(year) - 1);
    const throughMonth = parseInt(targetMonth.split('-')[1], 10); // e.g. 6 for June
    const isSamePeriodYtd = (monthKey: string, y: string) => {
      if (!monthKey.startsWith(`${y}-`)) return false;
      const m = parseInt(monthKey.split('-')[1], 10);
      return m >= 1 && m <= throughMonth;
    };
    // Compare YTD through the latest uploaded month vs the same months last year
    const ytdCurrRows = monthlySpends.filter(d => isSamePeriodYtd(d.month, year));
    const ytdPrevRows = monthlySpends.filter(d => isSamePeriodYtd(d.month, prevYear));
    const yearlyTotal = ytdCurrRows.reduce((a, b) => a + toSpendNumber(b.actualSpendsInr), 0);
    const prevYearlyTotal = ytdPrevRows.reduce((a, b) => a + toSpendNumber(b.actualSpendsInr), 0);
    const yShifts = calcShifts(aggregateBrandSpendBreakdown(ytdCurrRows), aggregateBrandSpendBreakdown(ytdPrevRows));
    const ytdThroughLabel = format(parse(targetMonth, 'yyyy-MM', new Date()), 'MMM');

    return {
      month: targetMonth,
      monthName: format(parse(targetMonth, 'yyyy-MM', new Date()), 'MMMM').toUpperCase(),
      monthlyTotal: Object.values(currMonthData.spendMap).reduce((a, b) => a + b, 0),
      prevMonthTotal: Object.values(prevMonthData.spendMap).reduce((a, b) => a + b, 0),
      mGainers: mShifts.gainers,
      mLosers: mShifts.losers,
      weeklyTotal: Object.values(currWData.spendMap).reduce((a, b) => a + b, 0),
      prevWeeklyTotal: Object.values(prevWData.spendMap).reduce((a, b) => a + b, 0),
      wGainers: wShifts.gainers,
      wLosers: wShifts.losers,
      weeklyDate: weeklyDateLabel,
      yearlyTotal,
      prevYearlyTotal,
      yGainers: yShifts.gainers,
      yLosers: yShifts.losers,
      ytdThroughLabel,
    };
  }, [monthlySpends, weeklySpends, mounted]);

  const { data: snapshotDoc } = useDoc<BusinessSnapshot>(stats ? `businessSnapshots/${stats.month}` : null);

  useEffect(() => {
    if (!mounted || !firestore || !stats?.month) return;

    const loadClientHealth = async () => {
      setClientHealthLoading(true);
      try {
        const looksLikeClientId = (value?: string | null, cid?: string) => {
          if (!value?.trim()) return true;
          const v = value.trim();
          if (cid && v === cid) return true;
          return /^CLID\d+$/i.test(v);
        };

        // Latest WBR cycle — prefer snapshot regenerate date, else discover from recent entries
        let cycleDate = snapshotDoc?.stats?.wbrCycleDate || '';
        if (!cycleDate) {
          const recentWbr = await getDocs(
            query(collection(firestore, 'wbrEntries'), orderBy('wbrDate', 'desc'), limit(50))
          );
          const dates = Array.from(new Set(recentWbr.docs.map((d) => d.data().wbrDate).filter(Boolean))).sort().reverse();
          cycleDate = dates[0] || '';
        }
        setHealthCycleDate(cycleDate || null);

        const kpiMonth = await resolveHealthKpiMonth(firestore, stats.month);
        setHealthKpiMonth(kpiMonth);

        const [kpiRows, clientSnap, wbrSnap] = await Promise.all([
          fetchAllKpisForMonth(firestore, kpiMonth),
          getDocs(collection(firestore, 'clients')),
          cycleDate
            ? getDocs(
                query(collection(firestore, 'wbrEntries'), where('wbrDate', '==', cycleDate), limit(500))
              )
            : Promise.resolve(null),
        ]);

        const nameById: Record<string, string> = {};
        const clusterById: Record<string, string> = {};
        const leadById: Record<string, string> = {};
        /** Same CLID universe as the WBR board (clients registry + KPI-tracked accounts). */
        const wbrBoardClids = new Set<string>();

        clientSnap.forEach((d) => {
          const c = d.data() as Client;
          const clid = normalizeClid(c.uniqueId);
          if (!clid) return;
          wbrBoardClids.add(clid);
          clusterById[clid] = c.cluster || 'Unassigned';
          leadById[clid] = c.clusterLead || '';
          if (c.name && !looksLikeClientId(c.name, clid)) {
            nameById[clid] = c.name;
          }
        });

        kpiRows.forEach((kpi) => {
          const clid = normalizeClid(kpi.clientId);
          if (clid) wbrBoardClids.add(clid);
        });

        // One WBR row per CLID for this cycle
        const wbrByClient = new Map<string, WbrEntry>();
        (wbrSnap?.docs || []).forEach((d) => {
          const w = { id: d.id, ...(d.data() as object) } as WbrEntry;
          const clid = normalizeClid(w.clientId);
          if (!clid) return;
          wbrBoardClids.add(clid);
          wbrByClient.set(clid, w);
          if (w.clientName && !looksLikeClientId(w.clientName, clid)) {
            nameById[clid] = w.clientName;
          }
          if (w.cluster) clusterById[clid] = w.cluster;
          if (w.clusterLead) leadById[clid] = w.clusterLead;
        });

        // RAG strips must match WBR click-through: unique board CLIDs with that RAG only
        const rag = { pGreen: 0, pAmber: 0, pRed: 0, eGreen: 0, eAmber: 0, eRed: 0 };
        wbrByClient.forEach((w, clid) => {
          if (!wbrBoardClids.has(clid)) return;
          const p = String(w.performanceRag || '').trim();
          const e = String(w.engagementRag || '').trim();
          if (p === 'Green') rag.pGreen += 1;
          else if (p === 'Amber') rag.pAmber += 1;
          else if (p === 'Red') rag.pRed += 1;
          if (e === 'Green') rag.eGreen += 1;
          else if (e === 'Amber') rag.eAmber += 1;
          else if (e === 'Red') rag.eRed += 1;
        });
        setWbrRagSummary(rag);

        // Group KPI rows by CLID — one path status per unique client
        const kpisByClient = new Map<string, KpiData[]>();
        kpiRows.forEach((kpi) => {
          const clid = normalizeClid(kpi.clientId);
          if (!clid) return;
          if (kpi.clientName && !looksLikeClientId(kpi.clientName, clid)) {
            nameById[clid] = kpi.clientName;
          }
          if (kpi.cluster) clusterById[clid] = kpi.cluster;
          if (kpi.cduLead) leadById[clid] = kpi.cduLead;
          const list = kpisByClient.get(clid) || [];
          list.push(kpi);
          kpisByClient.set(clid, list);
        });

        // Path tiles are Primary-KPI CLIDs only (WBR-only accounts must not inflate No Signal)
        const rows: ClientHealthRow[] = Array.from(kpisByClient.entries()).flatMap(([clientId, clientKpis]) => {
          if (!selectPrimaryKpisForPath(clientKpis).length) return [];

          const rolled = clientPathFromPrimaryKpis(clientKpis);
          const kpi = rolled.representative;
          const wbr = wbrByClient.get(clientId);
          const { achieved, target, direction, pathStatus, path } = rolled;

          return [{
            clientId,
            clientName: nameById[clientId] || wbr?.clientName || kpi?.clientName || clientId,
            cluster: clusterById[clientId] || wbr?.cluster || kpi?.cluster || 'Unassigned',
            lead: leadById[clientId] || wbr?.clusterLead || kpi?.cduLead || '—',
            kpiName: kpi?.kpi || 'No primary KPI',
            channel: kpi?.channel || '—',
            achieved,
            target,
            direction,
            currency: kpi?.currency,
            pathStatus,
            path,
            performanceRag: (wbr?.performanceRag || 'N/A') as RagStatus,
            engagementRag: (wbr?.engagementRag || 'N/A') as RagStatus,
            attainment: kpi ? kpiAttainmentPct(achieved, target, direction) : null,
          }];
        });

        rows.sort((a, b) => {
          const pathDiff = PATH_RANK[a.path] - PATH_RANK[b.path];
          if (pathDiff !== 0) return pathDiff;
          return a.clientName.localeCompare(b.clientName);
        });

        setClientHealth(rows);
      } catch (err) {
        console.error('Client health load failed:', err);
        setClientHealth([]);
        setWbrRagSummary({ pGreen: 0, pAmber: 0, pRed: 0, eGreen: 0, eAmber: 0, eRed: 0 });
        setHealthKpiMonth(null);
      } finally {
        setClientHealthLoading(false);
      }
    };

    loadClientHealth();
  }, [mounted, firestore, stats?.month, snapshotDoc?.stats?.wbrCycleDate]);

  const clientHealthSummary = useMemo(() => {
    const summary = {
      onPath: 0,
      offPath: 0,
      noSignal: 0,
      ...wbrRagSummary,
    };
    // One count per CLID
    const counted = new Set<string>();
    clientHealth.forEach((row) => {
      const clid = normalizeClid(row.clientId);
      if (!clid || counted.has(clid)) return;
      counted.add(clid);
      if (row.path === 'on-path') summary.onPath += 1;
      else if (row.path === 'off-path') summary.offPath += 1;
      else summary.noSignal += 1;
    });
    return summary;
  }, [clientHealth, wbrRagSummary]);

  const isAdmin = userProfile?.role === 'Admin' || userProfile?.role === 'Cluster Lead';

  const handleRefresh = async () => {
    if (!stats?.month) return;
    setIsRefreshing(true);
    try {
      await refreshBusinessSnapshot(firestore, stats.month);
      toast({ title: "Data Updated" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Refresh Error", description: e.message });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExportPdf = async () => {
    if (!snapshotRef.current) return;
    setIsRefreshing(true);
    try {
      await exportToPdf(snapshotRef.current, stats?.month || 'Snapshot');
      toast({ title: "Export Complete" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Export Failed", description: e.message });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (mLoading && !stats) return <div className="flex flex-1 items-center justify-center p-20"><CircleNotch className="h-8 w-8 animate-spin text-brand" /></div>;

  return (
    <div className="space-y-12 animate-in fade-in duration-700">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-ink pb-8">
        <div className="space-y-2">
          <div className="terminal-overline">Command Center</div>
          <h1 className="text-5xl lg:text-7xl font-black tracking-tighter uppercase">Snapshot</h1>
          <p className="text-[11px] font-mono text-secondary uppercase tracking-[0.2em]">Strategic Performance Review · {stats?.month || 'Initializing...'}</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button variant="outline" className="h-12 px-6 border-ink hover:bg-cream transition-colors font-bold uppercase text-[10px] tracking-widest" onClick={handleRefresh} disabled={isRefreshing}>
              <ArrowsClockwise className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
              REGENERATE
            </Button>
          )}
          <Button className="h-12 px-8 bg-brand text-white hover:bg-ink font-bold uppercase text-[10px] tracking-widest" onClick={handleExportPdf} disabled={isRefreshing}>
            {isRefreshing ? <CircleNotch className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            EXPORT PDF
          </Button>
        </div>
      </div>

      {!stats ? (
        <div className="p-12 md:p-16 border border-dashed border-ink flex flex-col items-center justify-center text-center space-y-6 bg-white">
          <ChartBar className="h-12 w-12 text-secondary/20" />
          <h3 className="text-xl font-bold uppercase tracking-tighter">No intelligence record found</h3>
        </div>
      ) : (
        <div ref={snapshotRef} id="snapshot-content" className="space-y-16">
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 bg-white border border-ink p-10 space-y-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-[0.3em] text-secondary">WEEKLY SPENDS PULSE</span>
                  <h2 className="text-3xl font-black tracking-tighter uppercase mt-1">12-Week Momentum</h2>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex items-center gap-6">
                    <div className="h-2 w-2 rounded-full bg-destructive" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-secondary">SPEND</span>
                  </div>
                  <div className="flex items-center gap-3 border border-ink/10 bg-cream/60 px-3 py-2">
                    <Switch
                      id="exclude-momentum-large-clients"
                      checked={excludeMomentumLargeClients}
                      onCheckedChange={setExcludeMomentumLargeClients}
                      className="rounded-none data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink/20"
                    />
                    <Label
                      htmlFor="exclude-momentum-large-clients"
                      className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-secondary leading-tight"
                    >
                      Exclude Orion Retail &amp; Nova Mobility
                    </Label>
                  </div>
                </div>
              </div>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={momentumData} margin={{ top: 24, right: 20, left: 4, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                    <XAxis
                      dataKey="week"
                      fontSize={10}
                      fontWeight="black"
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={8}
                    />
                    <YAxis fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 10000000).toFixed(1)}Cr`} />
                    <RechartsTooltip contentStyle={{ borderRadius: '0', border: '1px solid #000', boxShadow: '12px 12px 0px rgba(0,0,0,0.1)' }} formatter={(v: number) => [formatCurrency(v), 'Spend']} />
                    <Line type="monotone" dataKey="spend" stroke="hsl(var(--destructive))" strokeWidth={4} dot={{ r: 5, fill: 'hsl(var(--destructive))', strokeWidth: 0 }}>
                      <LabelList dataKey="spend" content={<MomentumSpendLabel />} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-ink flex flex-col h-[560px]">
              <div className="p-8 border-b border-ink flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-[0.3em] text-secondary">THIS WEEK · SNAPSHOTS</span>
                  <h2 className="text-2xl font-black tracking-tighter uppercase mt-1">Client Pulse</h2>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="divide-y divide-ink/5">
                  {newsFeed.length > 0 ? newsFeed.map((item, i) => (
                    <div key={i} className="p-8 space-y-4 hover:bg-cream transition-colors group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><div className={cn("h-2 w-2 rounded-full", item.rag === 'Green' ? 'bg-success' : item.rag === 'Amber' ? 'bg-warning' : 'bg-destructive')} /><span className="text-sm font-black uppercase tracking-tight truncate max-w-[160px]">{item.client}</span></div>
                        <span className="text-[10px] font-mono font-bold opacity-30">{item.week}</span>
                      </div>
                      <p className="text-[11px] leading-relaxed font-medium text-ink/70 italic line-clamp-3">{item.intelligence}</p>
                    </div>
                  )) : <div className="p-20 text-center text-[10px] font-black uppercase text-secondary/70 italic">No updates recorded.</div>}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* TACTICAL ANALYSIS GRID */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ink border border-ink ">
              {/* Card 1: Channel Performance (Horizontal Bar Chart) */}
              <div className="bg-white p-10 flex flex-col space-y-8 min-h-[500px]">
                  <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary">CHANNEL PERFORMANCE</p>
                      <h3 className="text-2xl font-black tracking-tighter uppercase">Depletion Pulse</h3>
                      <p className="text-[11px] font-medium text-secondary pt-1">
                        {channelSpendWeekLabel
                          ? `Spend by channel · ${channelSpendWeekLabel}`
                          : 'Spend by channel · latest available week'}
                      </p>
                  </div>
                  <div className="flex-1 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                          key={channelSpendWeekLabel || 'depletion-empty'}
                          data={channelSpends} 
                          layout="vertical"
                          margin={{ left: 8, right: 56 }}
                        >
                           <CartesianGrid strokeDasharray="3 3" horizontal={false} strokeOpacity={0.05} />
                           <XAxis type="number" hide />
                           <YAxis 
                             dataKey="name" 
                             type="category"
                             fontSize={10} 
                             fontWeight="black" 
                             axisLine={false} 
                             tickLine={false}
                             width={120}
                             interval={0}
                           />
                           <RechartsTooltip 
                             cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                             contentStyle={{ borderRadius: '0', border: '1px solid #000' }}
                             formatter={(v: number) => [formatCurrency(v), 'Spend']}
                           />
                           <Bar dataKey="value" radius={[0, 0, 0, 0]} barSize={24}>
                              {channelSpends.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                              <LabelList
                                dataKey="value"
                                position="right"
                                offset={8}
                                formatter={(v: number) => formatChartLabel(v)}
                                style={{
                                  fill: 'hsl(var(--ink))',
                                  fontSize: 9,
                                  fontWeight: 700,
                                  fontFamily: 'var(--font-mono), IBM Plex Mono, monospace',
                                }}
                              />
                           </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                  </div>
              </div>

              {/* Card 2: Conversion Funnel (Sales Pipeline) */}
              <div className="bg-white p-10 flex flex-col space-y-8 min-h-[500px]">
                  <Link
                    href="/dashboard/sales-tracker"
                    className="flex items-start justify-between gap-4 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset -m-2 p-2"
                  >
                      <div className="space-y-1">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary group-hover:text-brand transition-colors">SALES PIPELINE</p>
                          <h3 className="text-2xl font-black tracking-tighter uppercase">Discovery → Won</h3>
                      </div>
                      <ArrowUpRight className="h-5 w-5 text-secondary shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" weight="bold" />
                  </Link>
                  <div className="flex-1 space-y-6 pt-4">
                      {pipelineData.length > 0 ? pipelineData.map((stage) => (
                        <Link
                          key={stage.status || stage.name}
                          href={`/dashboard/sales-tracker?status=${encodeURIComponent(stage.status || stage.name)}`}
                          className="block space-y-2 group/stage rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                        >
                           <div className="flex items-center justify-between text-[10px] font-black uppercase">
                              <span className="tracking-widest group-hover/stage:text-brand transition-colors">{stage.name}</span>
                              <span className="text-secondary group-hover/stage:text-brand transition-colors">{stage.value} OPPORTUNITIES</span>
                           </div>
                           <div className="h-6 bg-foreground/[0.03] relative overflow-hidden group-hover/stage:bg-brand/[0.06] transition-colors">
                              <div className="absolute inset-0 bg-brand/10 group-hover/stage:bg-brand/20 transition-colors" style={{ width: `${stage.percent}%` }} />
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[9px] font-black text-secondary">
                                 {stage.percent.toFixed(1)}%
                              </div>
                           </div>
                        </Link>
                      )) : <p className="p-20 text-center text-[10px] font-black uppercase text-secondary/70 italic">No lead data available.</p>}
                  </div>
              </div>

              {/* Card 3: Accountability Pulse (Action Kanban Status) */}
              <Link
                href="/dashboard/actions"
                aria-label="Open Action Items Kanban Board"
                className="bg-white p-10 flex flex-col space-y-8 min-h-[500px] group cursor-pointer transition-colors hover:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              >
                  <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary">ACCOUNTABILITY PULSE</p>
                          <h3 className="text-2xl font-black tracking-tighter uppercase">Action Board</h3>
                      </div>
                      <ArrowUpRight className="h-5 w-5 text-secondary shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" weight="bold" />
                  </div>
                  <div className="flex-1 space-y-5 pt-2">
                      {accountabilityPulse.some((item: any) => item.count > 0) ? accountabilityPulse.map((item: any) => (
                        <div key={item.status} className="space-y-2">
                           <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase">
                              <span className="tracking-widest truncate">{item.status}</span>
                              <span className={cn(
                                "shrink-0 tabular-nums",
                                item.status === 'Overdue' && item.count > 0 ? "text-destructive" : "text-secondary"
                              )}>
                                {item.count}
                              </span>
                           </div>
                           <div className="h-2 bg-foreground/[0.04] overflow-hidden">
                              <div
                                className={cn("h-full transition-all", actionBoardAccent[item.status as ActionStatus] || 'bg-brand')}
                                style={{ width: `${Math.max(item.percent, item.count > 0 ? 4 : 0)}%` }}
                              />
                           </div>
                        </div>
                      )) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                          <CheckCircle2 className="h-10 w-10 text-success/20" weight="bold" />
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-30">No action items yet</p>
                        </div>
                      )}
                  </div>
                  <div className="pt-6 border-t border-foreground/5 grid grid-cols-2 gap-x-3 gap-y-2">
                     {ACTION_BOARD_STATUSES.map((status) => (
                       <div key={status} className="flex items-center gap-1.5 min-w-0">
                          <div className={cn("h-2 w-2 shrink-0", actionBoardAccent[status])} />
                          <span className="text-[8px] font-black uppercase text-secondary tracking-widest truncate">{status}</span>
                       </div>
                     ))}
                  </div>
              </Link>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3 px-1"><Globe className="h-5 w-5 text-brand" /><h2 className="text-sm font-black uppercase tracking-[0.2em] text-secondary">Spends Insights</h2></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ink border border-ink min-w-0">
                <SnapshotWidget
                  title={`ANNUAL SPENDS YTD (${stats.month.split('-')[0]} · JAN–${stats.ytdThroughLabel.toUpperCase()})`}
                  value={formatCurrency(stats.yearlyTotal)}
                  variance={stats.prevYearlyTotal > 0 ? ((stats.yearlyTotal - stats.prevYearlyTotal) / stats.prevYearlyTotal) * 100 : 0}
                  varianceAmount={stats.prevYearlyTotal > 0 ? stats.yearlyTotal - stats.prevYearlyTotal : undefined}
                  varianceLabel={stats.prevYearlyTotal > 0 ? "YTD YOY" : "YTD TOTAL"}
                  gainers={stats.yGainers}
                  losers={stats.yLosers}
                />
                <SnapshotWidget
                  title={`${stats.monthName} SPENDS`}
                  value={formatCurrency(stats.monthlyTotal)}
                  variance={stats.prevMonthTotal > 0 ? ((stats.monthlyTotal - stats.prevMonthTotal) / stats.prevMonthTotal) * 100 : 0}
                  varianceAmount={stats.monthlyTotal - stats.prevMonthTotal}
                  varianceLabel="MOM"
                  gainers={stats.mGainers}
                  losers={stats.mLosers}
                />
                <SnapshotWidget
                  title={`WEEKLY PULSE (${stats.weeklyDate})`}
                  value={formatCurrency(stats.weeklyTotal)}
                  variance={stats.prevWeeklyTotal > 0 ? ((stats.weeklyTotal - stats.prevWeeklyTotal) / stats.prevWeeklyTotal) * 100 : 0}
                  varianceAmount={stats.weeklyTotal - stats.prevWeeklyTotal}
                  varianceLabel="WOW"
                  gainers={stats.wGainers}
                  losers={stats.wLosers}
                />
            </div>
          </div>

          {/* Portfolio client health — Primary KPI path + weekly WBR RAGs */}
          <div className="bg-white border border-ink space-y-0 overflow-hidden">
            <div className="bg-cream px-8 py-8 md:px-10 border-b border-ink flex flex-wrap items-end justify-between gap-6">
              <div className="space-y-2 min-w-0">
                <p className="terminal-overline">Portfolio Intelligence</p>
                <h3 className="text-3xl md:text-4xl font-black tracking-tighter uppercase">Client Health Board</h3>
                <p className="text-[11px] font-medium text-secondary max-w-xl">
                  Designated Primary KPI MTD sets the path (same formula as KPI Tracker). Performance &amp; Engagement RAG reflect the current WBR week.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {clientHealthLoading && (
                  <div className="flex items-center gap-2 text-[9px] font-black text-secondary uppercase tracking-widest">
                    <CircleNotch className="h-3.5 w-3.5 animate-spin text-brand" />
                    Syncing…
                  </div>
                )}
                {healthCycleDate && (
                  <div className="flex items-center gap-2 text-[9px] font-black text-secondary uppercase tracking-widest bg-white px-3 py-1.5 border border-ink/10">
                    <Calendar className="h-3.5 w-3.5" />
                    WBR Cycle:{' '}
                    {(() => {
                      try {
                        const d = parse(healthCycleDate, 'yyyy-MM-dd', new Date());
                        return isValid(d) ? format(d, 'dd MMM yyyy') : healthCycleDate;
                      } catch {
                        return healthCycleDate;
                      }
                    })()}
                  </div>
                )}
                {healthKpiMonth && (
                  <div className="text-[9px] font-black text-secondary uppercase tracking-widest bg-white px-3 py-1.5 border border-ink/10">
                    KPI Month: {format(parse(healthKpiMonth, 'yyyy-MM', new Date()), 'MMM yyyy').toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-ink border-b border-ink">
              <PathSummaryTile
                label="On Path"
                hint="Unique CLIDs · Primary KPI on target"
                count={clientHealthSummary.onPath}
                tone="success"
                href={healthKpiMonth ? `/dashboard/kpi-tracking?primary=1&path=on&month=${healthKpiMonth}` : '/dashboard/kpi-tracking?primary=1&path=on'}
              />
              <PathSummaryTile
                label="Off Path"
                hint="Unique CLIDs · Primary KPI behind target"
                count={clientHealthSummary.offPath}
                tone="destructive"
                href={healthKpiMonth ? `/dashboard/kpi-tracking?primary=1&path=off&month=${healthKpiMonth}` : '/dashboard/kpi-tracking?primary=1&path=off'}
              />
              <PathSummaryTile
                label="No Signal"
                hint="Unique CLIDs · Primary KPI MTD N/A"
                count={clientHealthSummary.noSignal}
                tone="secondary"
                href={healthKpiMonth ? `/dashboard/kpi-tracking?primary=1&path=none&month=${healthKpiMonth}` : '/dashboard/kpi-tracking?primary=1&path=none'}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-ink">
              <RagSummaryStrip
                title="Performance RAG · This Week"
                green={clientHealthSummary.pGreen}
                amber={clientHealthSummary.pAmber}
                red={clientHealthSummary.pRed}
                baseHref={healthCycleDate ? `/dashboard/wbr?date=${healthCycleDate}` : '/dashboard/wbr'}
                ragParam="perfRag"
              />
              <RagSummaryStrip
                title="Engagement RAG · This Week"
                green={clientHealthSummary.eGreen}
                amber={clientHealthSummary.eAmber}
                red={clientHealthSummary.eRed}
                baseHref={healthCycleDate ? `/dashboard/wbr?date=${healthCycleDate}` : '/dashboard/wbr'}
                ragParam="engagementRag"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PathSummaryTile({
  label,
  hint,
  count,
  tone,
  href,
}: {
  label: string;
  hint: string;
  count: number;
  tone: 'success' | 'destructive' | 'secondary';
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white p-8 space-y-3 group transition-colors hover:bg-cream/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary">{label}</p>
        <ArrowUpRight className="h-4 w-4 text-secondary/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" weight="bold" />
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            'text-5xl font-black font-headline tracking-tighter',
            tone === 'success' && 'text-success',
            tone === 'destructive' && 'text-destructive',
            tone === 'secondary' && 'text-secondary'
          )}
        >
          {count}
        </p>
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary/60">clients</p>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-secondary/70">{hint}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-brand/70 opacity-0 group-hover:opacity-100 transition-opacity">
        Open KPI Tracker →
      </p>
    </Link>
  );
}

function RagSummaryStrip({
  title,
  green,
  amber,
  red,
  baseHref,
  ragParam,
}: {
  title: string;
  green: number;
  amber: number;
  red: number;
  baseHref: string;
  ragParam: 'perfRag' | 'engagementRag';
}) {
  const total = Math.max(green + amber + red, 1);
  const join = baseHref.includes('?') ? '&' : '?';
  return (
    <div className="bg-white p-6 md:p-8 space-y-4">
      <Link
        href={baseHref}
        className="flex items-center justify-between gap-3 group focus-visible:outline-none"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary group-hover:text-brand transition-colors">{title}</p>
        <ArrowUpRight className="h-4 w-4 text-secondary/40 group-hover:text-brand transition-colors" weight="bold" />
      </Link>
      <Link href={baseHref} className="flex h-3 w-full overflow-hidden bg-foreground/[0.04] hover:opacity-90 transition-opacity">
        <div className="bg-success h-full" style={{ width: `${(green / total) * 100}%` }} />
        <div className="bg-warning h-full" style={{ width: `${(amber / total) * 100}%` }} />
        <div className="bg-destructive h-full" style={{ width: `${(red / total) * 100}%` }} />
      </Link>
      <div className="flex flex-wrap gap-4 text-[10px] font-black uppercase tracking-widest">
        <Link href={`${baseHref}${join}${ragParam}=Green`} className="text-success hover:underline underline-offset-4">
          {green} Green
        </Link>
        <Link href={`${baseHref}${join}${ragParam}=Amber`} className="text-warning hover:underline underline-offset-4">
          {amber} Amber
        </Link>
        <Link href={`${baseHref}${join}${ragParam}=Red`} className="text-destructive hover:underline underline-offset-4">
          {red} Red
        </Link>
      </div>
    </div>
  );
}

function SnapshotWidget({
  title,
  value,
  variance,
  varianceAmount,
  varianceLabel,
  gainers,
  losers,
}: {
  title: string;
  value: string;
  variance: number;
  varianceAmount?: number;
  varianceLabel: string;
  gainers: PerformanceShift[];
  losers: PerformanceShift[];
}) {
  const isUp = variance > 0 || (varianceAmount != null && varianceAmount > 0);
  const isDown = variance < 0 || (varianceAmount != null && varianceAmount < 0);
  const amountPrefix = varianceAmount != null && varianceAmount > 0 ? '+' : '';

  return (
    <div className="bg-white p-5 md:p-6 xl:p-8 flex flex-col h-full min-w-0 overflow-hidden">
      <div className="space-y-3 mb-6 min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-brand leading-snug break-words">
          {title}
        </p>
        <div className="space-y-2 min-w-0">
            <div
              className="text-3xl md:text-4xl xl:text-[2.75rem] font-black font-headline tracking-tighter text-ink leading-[1.05] py-0.5 break-all"
              title={value}
            >
              {value}
            </div>
            <div className={cn(
              "flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-black uppercase relative z-10",
              isDown ? "text-destructive" : "text-success"
            )}>
              {isUp ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : isDown ? <ArrowDownRight className="h-3 w-3 shrink-0" /> : null}
              {varianceAmount != null && (
                <span className="break-all">{amountPrefix}{formatCurrency(varianceAmount)}</span>
              )}
              {varianceAmount != null && <span className="opacity-40">·</span>}
              <span>{Math.abs(variance).toFixed(1)}%</span>
              <span>{varianceLabel}</span>
            </div>
        </div>
      </div>
      <Separator className="bg-ink/5 mb-6" />
      <div className="flex-1 grid grid-cols-2 gap-4 min-w-0">
            <div className="space-y-3 min-w-0">
              <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-success">
                <ArrowUp className="h-3 w-3 shrink-0" /> TOP 3 GAINERS
              </span>
              <div className="space-y-4">
                {gainers && gainers.length > 0 ? gainers.map((g, i) => (
                  <div key={i} className="space-y-1 min-w-0">
                    <p className="text-[12px] font-black text-ink leading-tight truncate uppercase tracking-tight" title={g.brand}>{g.brand}</p>
                    <p className="text-[8px] font-bold text-secondary uppercase truncate" title={g.type}>{g.type}</p>
                    <p className="text-[10px] font-black leading-none flex items-center justify-between gap-1 text-success min-w-0">
                      <span className="truncate">+{formatCurrency(g.amount || 0)}</span>
                      <span className="opacity-60 text-[8px] shrink-0">({g.variance.toFixed(1)}%)</span>
                    </p>
                  </div>
                )) : <p className="text-[10px] font-bold text-secondary/20 italic">No significant gains</p>}
              </div>
            </div>
            <div className="space-y-3 min-w-0">
              <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-destructive">
                <ArrowDown className="h-3 w-3 shrink-0" /> TOP 3 LOSERS
              </span>
              <div className="space-y-4">
                {losers && losers.length > 0 ? losers.map((l, i) => (
                  <div key={i} className="space-y-1 min-w-0">
                    <p className="text-[12px] font-black text-ink leading-tight truncate uppercase tracking-tight" title={l.brand}>{l.brand}</p>
                    <p className="text-[8px] font-bold text-secondary uppercase truncate" title={l.type}>{l.type}</p>
                    <p className="text-[10px] font-black leading-none flex items-center justify-between gap-1 text-destructive min-w-0">
                      <span className="truncate">{formatCurrency(l.amount || 0)}</span>
                      <span className="opacity-60 text-[8px] shrink-0">({l.variance.toFixed(1)}%)</span>
                    </p>
                  </div>
                )) : <p className="text-[10px] font-bold text-secondary/20 italic">No significant losses</p>}
              </div>
            </div>
      </div>
    </div>
  );
}

function CheckCircle2({ className, weight }: { className?: string, weight?: "bold" | "fill" | "duotone" | "light" | "thin" | "regular" }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight === 'bold' ? "3" : "2"} strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>;
}
