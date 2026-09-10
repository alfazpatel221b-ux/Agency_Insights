
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  Loader2, 
  Target, 
  Banknote, 
  TrendingUp, 
  Activity, 
  CreditCard,
  ArrowLeft,
  CalendarDays,
  BarChart3
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, parse, isValid, isWithinInterval } from 'date-fns';
import { query, collection, where, getDocs, limit } from 'firebase/firestore';
import { 
  Bar, 
  BarChart, 
  CartesianGrid, 
  Legend, 
  Line, 
  LineChart, 
  ResponsiveContainer, 
  Tooltip, 
  XAxis, 
  YAxis 
} from 'recharts';

import { useFirestore } from '@/firebase';
import { KpiData, KpiWeeklyData, MonthlySpend, WeeklySpend, Client } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function ClientDeepDivePage() {
  const params = useParams();
  const router = useRouter();
  const firestore = useFirestore();
  const clientId = params.clientId as string;

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date())
  });
  const [activeChannel, setActiveChannel] = useState<string>('all');
  
  const [clientInfo, setClientInfo] = useState<Partial<Client> | null>(null);
  const [kpis, setKpis] = useState<KpiData[]>([]);
  const [weeklyKpis, setWeeklyKpis] = useState<KpiWeeklyData[]>([]);
  const [monthlySpends, setMonthlySpends] = useState<MonthlySpend[]>([]);
  const [weeklySpends, setWeeklySpends] = useState<WeeklySpend[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Discovery Logic: Find client context
        const clientRefQ = query(collection(firestore, 'clients'), where('uniqueId', '==', clientId));
        const clientSnap = await getDocs(clientRefQ);
        if (!clientSnap.empty) {
          setClientInfo(clientSnap.docs[0].data() as Client);
        } else {
          const kpiRefQ = query(collection(firestore, 'kpis'), where('clientId', '==', clientId), limit(1));
          const kpiRefSnap = await getDocs(kpiRefQ);
          if (!kpiRefSnap.empty) {
            const d = kpiRefSnap.docs[0].data();
            setClientInfo({ name: d.clientName, uniqueId: d.clientId, cluster: d.cluster, subEntity: d.lob });
          }
        }

        // Fetch Data Sets
        const kpiQ = query(collection(firestore, 'kpis'), where('clientId', '==', clientId));
        const kpiSnap = await getDocs(kpiQ);
        const kpiList = kpiSnap.docs.map(d => ({ id: d.id, ...d.data() } as KpiData));
        setKpis(kpiList);

        if (kpiList.length > 0) {
          const weeklyKpiList: KpiWeeklyData[] = [];
          const kpiIds = kpiList.map(k => k.id);
          for (let i = 0; i < kpiIds.length; i += 30) {
            const chunk = kpiIds.slice(i, i + 30);
            const wq = query(collection(firestore, 'kpiWeeklyData'), where('kpiDataId', 'in', chunk));
            const wSnap = await getDocs(wq);
            wSnap.forEach(d => weeklyKpiList.push({ id: d.id, ...d.data() } as KpiWeeklyData));
          }
          setWeeklyKpis(weeklyKpiList);
        }

        const mSpendsQ = query(collection(firestore, 'monthlySpends'), where('clientId', '==', clientId));
        const mSnap = await getDocs(mSpendsQ);
        setMonthlySpends(mSnap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlySpend)));

        const wSpendsQ = query(collection(firestore, 'weeklySpends'), where('clientId', '==', clientId));
        const wSnap = await getDocs(wSpendsQ);
        setWeeklySpends(wSnap.docs.map(d => ({ id: d.id, ...d.data() } as WeeklySpend)));

      } catch (err) {
        console.error("Deep Dive fetch failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [clientId, firestore]);

  const kpiChannels = Array.from(new Set(kpis.map(k => k.channel))).sort();

  const filteredKpis = useMemo(() => {
    return kpis.filter(k => {
      const channelMatch = activeChannel === 'all' || k.channel === activeChannel;
      if (!dateRange?.from || !dateRange?.to) return channelMatch;
      const kMonth = parse(k.month, 'yyyy-MM', new Date());
      return channelMatch && kMonth >= startOfMonth(dateRange.from) && kMonth <= endOfMonth(dateRange.to);
    });
  }, [kpis, activeChannel, dateRange]);

  const filteredWeeklyKpis = useMemo(() => {
    const kpiIds = filteredKpis.map(k => k.id);
    return weeklyKpis.filter(w => kpiIds.includes(w.kpiDataId));
  }, [weeklyKpis, filteredKpis]);

  const filteredMonthlySpends = useMemo(() => {
    return monthlySpends.filter(s => {
      const channelMatch = activeChannel === 'all' || s.channelVendor === activeChannel;
      if (!dateRange?.from || !dateRange?.to) return channelMatch;
      const sMonth = parse(s.month, 'yyyy-MM', new Date());
      return channelMatch && sMonth >= startOfMonth(dateRange.from) && sMonth <= endOfMonth(dateRange.to);
    });
  }, [monthlySpends, activeChannel, dateRange]);

  const filteredWeeklySpends = useMemo(() => {
    return weeklySpends.filter(s => {
      const channelMatch = activeChannel === 'all' || s.channelVendor === activeChannel;
      if (!dateRange?.from || !dateRange?.to) return channelMatch;
      const weekDate = parse(s.week, 'dd-MM-yyyy', new Date());
      if (!isValid(weekDate)) return false;
      return channelMatch && isWithinInterval(weekDate, { start: dateRange.from, end: dateRange.to });
    });
  }, [weeklySpends, activeChannel, dateRange]);

  const kpiTargetData = useMemo(() => {
    const groups: Record<string, { target: number, achieved: number }> = {};
    filteredKpis.forEach(k => {
      const monthKey = k.month;
      if (!groups[monthKey]) groups[monthKey] = { target: 0, achieved: 0 };
      groups[monthKey].target += (k.targetMonth || 0);
      groups[monthKey].achieved += (k.achievedMonthTillYesterday || 0);
    });
    return Object.entries(groups).map(([month, vals]) => ({
      sortKey: month,
      label: format(parse(month, 'yyyy-MM', new Date()), 'MMM yy').toUpperCase(),
      ...vals
    })).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [filteredKpis]);

  const kpiWowData = useMemo(() => {
    const groups: Record<string, number> = {};
    filteredWeeklyKpis.forEach(w => {
      const parentKpi = kpis.find(k => k.id === w.kpiDataId);
      const key = `${w.month || parentKpi?.month}-W${w.weekOfMonth}`;
      groups[key] = (groups[key] || 0) + (w.achieved || 0);
    });
    return Object.entries(groups).map(([week, value]) => ({ week, value }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [filteredWeeklyKpis, kpis]);

  const spendsMomData = useMemo(() => {
    const groups: Record<string, number> = {};
    filteredMonthlySpends.forEach(s => {
      groups[s.month] = (groups[s.month] || 0) + (s.actualSpendsInr || 0);
    });
    return Object.entries(groups).map(([month, spend]) => ({
      sortKey: month,
      label: format(parse(month, 'yyyy-MM', new Date()), 'MMM yy').toUpperCase(),
      spend
    })).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [filteredMonthlySpends]);

  const spendsWowData = useMemo(() => {
    const groups: Record<string, number> = {};
    filteredWeeklySpends.forEach(s => {
      groups[s.week] = (groups[s.week] || 0) + (s.spendsInr || 0);
    });
    return Object.entries(groups).map(([week, spend]) => ({
      week, spend,
      timestamp: parse(week, 'dd-MM-yyyy', new Date()).getTime()
    })).sort((a, b) => a.timestamp - b.timestamp);
  }, [filteredWeeklySpends]);

  if (isLoading) return <div className="flex flex-1 flex-col items-center justify-center p-20 gap-4"><Loader2 className="animate-spin h-12 w-12 text-primary" /><p className="text-[10px] font-black uppercase tracking-widest text-secondary">Synthesizing Strategic Pulse...</p></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-none glass" onClick={() => router.push('/dashboard/intelligence')}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">{clientId}</span>
            <h2 className="text-4xl font-black font-headline tracking-tighter">{clientInfo?.name || 'Client Deep Dive'}</h2>
            <p className="text-sm font-bold text-muted-foreground uppercase">{clientInfo?.subEntity} • {clientInfo?.cluster}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker date={dateRange} setDate={setDateRange} />
          <Select value={activeChannel} onValueChange={setActiveChannel}>
            <SelectTrigger className="h-10 w-48 rounded-none glass text-[10px] font-black uppercase shadow-lg">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent className="rounded-none glass ">
              <SelectItem value="all" className="text-[10px] font-bold">ALL CHANNELS</SelectItem>
              {kpiChannels.map(c => <SelectItem key={c} value={c} className="text-[10px] font-bold uppercase">{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-12 animate-in fade-in duration-700">
        {/* OPERATIONAL PULSE */}
        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
                <Target className="h-5 w-5 text-primary" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary/80">Operational Pulse (KPI Analysis)</h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <ChartCard title="Operational Success" description="Monthly Target vs. Achieved" icon={<TrendingUp className="h-4 w-4" />}>
                  {kpiTargetData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={kpiTargetData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                        <XAxis dataKey="label" fontSize={10} fontWeight="black" axisLine={false} tickLine={false} />
                        <YAxis fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />
                        <Legend iconType="circle" align="center" verticalAlign="bottom" wrapperStyle={{ fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', paddingTop: '20px' }} />
                        <Bar dataKey="target" name="TARGET" fill="hsl(var(--primary))" opacity={0.3} radius={[6, 6, 0, 0]} barSize={40} />
                        <Bar dataKey="achieved" name="ACHIEVED" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} barSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <NoDataPlaceholder />}
                </ChartCard>

                <ChartCard title="Performance TREND" description="WoW Achievement Progression" icon={<Activity className="h-4 w-4" />}>
                  {kpiWowData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={kpiWowData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                        <XAxis dataKey="week" fontSize={9} fontWeight="black" axisLine={false} tickLine={false} />
                        <YAxis fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} />
                        <Line type="monotone" dataKey="value" name="ACHIEVED" stroke="hsl(var(--primary))" strokeWidth={5} dot={{ r: 6, strokeWidth: 3, fill: 'white' }} activeDot={{ r: 8, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <NoDataPlaceholder />}
                </ChartCard>
            </div>
        </section>

        {/* FINANCIAL PULSE */}
        <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
                <Banknote className="h-5 w-5 text-accent" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-accent/80">Financial Pulse (Spends Analytics)</h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ChartCard title="Financial Spends" description="MoM Actual SPENDS (INR)" icon={<CreditCard className="h-4 w-4" />}>
                {spendsMomData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={spendsMomData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                    <XAxis dataKey="label" fontSize={10} fontWeight="black" axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                    <Tooltip 
                        formatter={(val: number) => [`₹${val.toLocaleString()}`, 'Spend']}
                        contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} 
                    />
                    <Bar dataKey="spend" name="MONTHLY SPEND" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} barSize={60} />
                    </BarChart>
                </ResponsiveContainer>
                ) : <NoDataPlaceholder />}
            </ChartCard>

            <ChartCard title="Capital Velocity" description="WoW Spending Pulse" icon={<TrendingUp className="h-4 w-4" />}>
                {spendsWowData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spendsWowData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.05} />
                    <XAxis dataKey="week" fontSize={9} fontWeight="black" axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} />
                    <Tooltip 
                        formatter={(val: number) => [`₹${val.toLocaleString()}`, 'Spend']}
                        contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }} 
                    />
                    <Line type="monotone" dataKey="spend" name="WEEKLY PULSE" stroke="hsl(var(--accent))" strokeWidth={5} dot={{ r: 6, strokeWidth: 3, fill: 'white' }} activeDot={{ r: 8, strokeWidth: 0 }} />
                    </LineChart>
                </ResponsiveContainer>
                ) : <NoDataPlaceholder />}
            </ChartCard>
            </div>
        </section>
      </div>
    </div>
  );
}

function ChartCard({ title, description, icon, children }: { title: string, description: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <Card className="glass-card overflow-hidden group hover: transition-all duration-500 min-h-[480px]">
      <CardHeader className="pb-2 pt-8 px-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-none bg-foreground/5 flex items-center justify-center text-primary/40 group-hover:bg-primary/10 group-hover:text-primary transition-all duration-500">
            {icon}
          </div>
          <div>
            <CardTitle className="text-xl font-black font-headline tracking-tight">{title}</CardTitle>
            <CardDescription className="text-[10px] font-black uppercase tracking-widest text-secondary">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="h-[400px] px-8 pb-8 relative">
        <TooltipProvider>{children}</TooltipProvider>
      </CardContent>
    </Card>
  );
}

function NoDataPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full space-y-3 text-secondary/70">
      <BarChart3 className="h-12 w-12" />
      <p className="text-[10px] font-black uppercase tracking-widest">No Strategic Data Found</p>
    </div>
  );
}
