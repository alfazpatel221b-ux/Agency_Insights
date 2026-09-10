'use client';

import React, { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { 
  PlusCircle, 
  MoreHorizontal, 
  Search, 
  Loader2,
  Calendar as CalendarIcon,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
  Factory,
  Tag,
  Filter,
  Fingerprint,
  Database
} from 'lucide-react';
import { canonicalizeChannel } from '@/lib/normalize';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCollection, useFirestore } from '@/firebase';
import { MonthlySpend, WeeklySpend } from '@/lib/types';
import { 
  saveMonthlySpend, 
  saveWeeklySpend, 
  deleteMonthlySpend, 
  deleteWeeklySpend,
  bulkSaveMonthlySpends,
  bulkSaveWeeklySpends,
} from '@/lib/firestore-actions';
import { useToast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { format, startOfMonth, endOfMonth, isValid, parse, subYears } from 'date-fns';
import { where, getDocs, collection, query } from 'firebase/firestore';
import { cn, openDialogFromMenu } from '@/lib/utils';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';

const monthlySpendSchema = z.object({
  uploadRecordId: z.string().optional(),
  clientId: z.string().min(1, 'Required'),
  brandName: z.string().min(1, 'Required'),
  industry: z.string().min(1, 'Required'),
  type: z.string().min(1, 'Required'),
  subEntity: z.string().min(1, 'Required'),
  channelVendor: z.string().min(1, 'Required'),
  creditLine: z.string().min(1, 'Required'),
  currency: z.string().min(1, 'Required'),
  team: z.string().min(1, 'Required'),
  month: z.string().min(1, 'Required'),
  actualSpendsInr: z.coerce.number().min(0),
});

const weeklySpendSchema = z.object({
  uploadRecordId: z.string().optional(),
  clientId: z.string().min(1, 'Required'),
  brandName: z.string().min(1, 'Required'),
  industry: z.string().min(1, 'Required'),
  type: z.string().min(1, 'Required'),
  subEntity: z.string().min(1, 'Required'),
  channelVendor: z.string().min(1, 'Required'),
  creditLine: z.string().min(1, 'Required'),
  currency: z.string().min(1, 'Required'),
  team: z.string().min(1, 'Required'),
  week: z.string().min(1, 'Required'),
  spendsInr: z.coerce.number().min(0),
});

function SpendsContent() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('monthly');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [mounted, setMounted] = useState(false);
  const [shouldFetch, setShouldFetch] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfMonth(subYears(new Date(), 1)),
    to: endOfMonth(new Date())
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const monthlyConstraints = useMemo(() => {
    if (!shouldFetch || !dateRange?.from || !dateRange?.to) return [null];
    return [
      where('month', '>=', format(dateRange.from, 'yyyy-MM')),
      where('month', '<=', format(dateRange.to, 'yyyy-MM'))
    ];
  }, [dateRange, shouldFetch]);

  const { data: monthlySpends, loading: monthlyLoading } = useCollection<MonthlySpend>('monthlySpends', monthlyConstraints);
  const [weeklySpends, setWeeklySpends] = useState<WeeklySpend[] | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  useEffect(() => {
    if (!shouldFetch || !dateRange?.from || !dateRange?.to) {
      setWeeklySpends(null);
      setWeeklyLoading(false);
      return;
    }

    const fetchWeekly = async () => {
      setWeeklyLoading(true);
      try {
        const startStr = format(dateRange.from!, 'yyyy-MM');
        const endStr = format(dateRange.to!, 'yyyy-MM');
        
        const q = query(
          collection(firestore, 'weeklySpends'),
          where('month', '>=', startStr),
          where('month', '<=', endStr)
        );
        const snap = await getDocs(q);
        
        const results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        setWeeklySpends(results);
      } catch (err) {
        console.error("Weekly spends fetch failed:", err);
      } finally {
        setWeeklyLoading(false);
      }
    };

    fetchWeekly();
  }, [dateRange, firestore, shouldFetch]);

  const [isMonthlyDialogOpen, setIsMonthlyDialogOpen] = useState(false);
  const [isWeeklyDialogOpen, setIsWeeklyDialogOpen] = useState(false);
  const [editingMonthly, setEditingMonthly] = useState<MonthlySpend | null>(null);
  const [editingWeekly, setEditingWeekly] = useState<WeeklySpend | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredMonthly = useMemo(() => {
    if (!monthlySpends) return [];
    const q = searchQuery.toLowerCase();
    return monthlySpends.filter(s => {
      const channel = canonicalizeChannel(s.channelVendor).toLowerCase();
      return (
        s.brandName.toLowerCase().includes(q) ||
        channel.includes(q) ||
        s.channelVendor.toLowerCase().includes(q) ||
        s.clientId?.toLowerCase().includes(q) ||
        s.uploadRecordId?.toLowerCase().includes(q) ||
        s.industry?.toLowerCase().includes(q) ||
        s.type?.toLowerCase().includes(q)
      );
    });
  }, [monthlySpends, searchQuery]);

  const filteredWeekly = useMemo(() => {
    if (!weeklySpends || !dateRange?.from || !dateRange?.to) return [];
    
    return weeklySpends.filter(s => {
      const q = searchQuery.toLowerCase();
      const isInRange = s.month && s.month >= format(dateRange.from!, 'yyyy-MM') && s.month <= format(dateRange.to!, 'yyyy-MM');
      if (!isInRange) return false;
      const channel = canonicalizeChannel(s.channelVendor).toLowerCase();

      return (
        s.brandName.toLowerCase().includes(q) ||
        channel.includes(q) ||
        s.channelVendor.toLowerCase().includes(q) ||
        s.clientId?.toLowerCase().includes(q) ||
        s.uploadRecordId?.toLowerCase().includes(q) ||
        s.industry?.toLowerCase().includes(q) ||
        s.type?.toLowerCase().includes(q)
      );
    });
  }, [weeklySpends, searchQuery, dateRange]);

  const handleSaveMonthly = async (values: z.infer<typeof monthlySpendSchema>) => {
    await saveMonthlySpend(firestore, values, editingMonthly?.id || values.uploadRecordId);
    toast({ title: editingMonthly ? 'Record updated' : 'Record saved' });
    setIsMonthlyDialogOpen(false);
    setEditingMonthly(null);
  };

  const handleSaveWeekly = async (values: z.infer<typeof weeklySpendSchema>) => {
    await saveWeeklySpend(firestore, values, editingWeekly?.id || values.uploadRecordId);
    toast({ title: editingWeekly ? 'Record updated' : 'Record saved' });
    setIsWeeklyDialogOpen(false);
    setEditingWeekly(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsUploading(true);
      setUploadProgress(0);
      Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy',
        dynamicTyping: true,
        complete: async (results) => {
          try {
            let processedCount = 0;
            if (activeTab === 'monthly') {
              processedCount = await bulkSaveMonthlySpends(firestore, results.data, setUploadProgress);
            } else {
              processedCount = await bulkSaveWeeklySpends(firestore, results.data, setUploadProgress);
            }
            toast({ title: "Upload Successful", description: `${processedCount} records saved to Agency Insights database.` });
          } catch (error: any) {
            toast({ variant: "destructive", title: "Upload Failed", description: error.message });
          } finally {
            setIsUploading(false);
            setUploadProgress(0);
          }
        }
      });
    }
    if (event.target) event.target.value = '';
  };

  const downloadTemplate = () => {
    const monthlyHeaders = "Record ID,Client ID,Brand Name,Industry,Type,Sub Entity,Channel,Credit Line,Currency,Team,Month,Actual SPENDS";
    const weeklyHeaders = "Record ID,Client ID,Brand Name,Industry,Type,Sub Entity,Channel,Credit Line,Currency,Team,Week,SPENDS";
    const csv = activeTab === 'monthly' ? monthlyHeaders : weeklyHeaders;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeTab}_spends_template.csv`;
    a.click();
  };

  const handleExportExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${activeTab === 'monthly' ? 'Monthly' : 'Weekly'} SPENDS`);

    const headers = [
      { header: 'Record ID', key: 'uploadRecordId', width: 25 },
      { header: 'Client ID', key: 'clientId', width: 15 },
      { header: 'Brand Name', key: 'brandName', width: 25 },
      { header: 'Industry', key: 'industry', width: 20 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Sub Entity', key: 'subEntity', width: 20 },
      { header: 'Vendor', key: 'channelVendor', width: 20 },
      { header: 'Credit Line', key: 'creditLine', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Team', key: 'team', width: 15 },
      { header: activeTab === 'monthly' ? 'Month' : 'Week', key: 'period', width: 15 },
      { header: 'Amount (INR)', key: 'amount', width: 18 },
    ];

    worksheet.columns = headers;
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

    const dataToExport = activeTab === 'monthly' ? filteredMonthly : filteredWeekly;

    dataToExport.forEach((item: any) => {
      worksheet.addRow({
        uploadRecordId: item.uploadRecordId || item.id,
        clientId: item.clientId,
        brandName: item.brandName,
        industry: item.industry,
        type: item.type,
        subEntity: item.subEntity,
        channelVendor: canonicalizeChannel(item.channelVendor),
        creditLine: item.creditLine,
        currency: item.currency,
        team: item.team,
        period: activeTab === 'monthly' ? item.month : item.week,
        amount: activeTab === 'monthly' ? item.actualSpendsInr : item.spendsInr,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const timestamp = format(new Date(), 'yyyyMMdd');
    saveAs(new Blob([buffer]), `${activeTab}_spends_${timestamp}.xlsx`);
  };

  if (!mounted) return <div className="flex flex-1 items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary/40" /></div>;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="SPENDS Update" description="Full-fidelity capital deployment updates.">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker date={dateRange} setDate={(d) => { setDateRange(d); setShouldFetch(false); }} />

          <Button 
            variant="default" 
            size="sm" 
            className="h-10 rounded-none gap-2 bg-brand hover:bg-ink font-black transition-all"
            onClick={() => setShouldFetch(true)}
            disabled={shouldFetch && (monthlyLoading || weeklyLoading)}
          >
            {monthlyLoading || weeklyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Fetch records
          </Button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input 
              placeholder="Search Brand/ID..." 
              className="pl-9 w-[180px] rounded-none glass h-10 text-xs shadow-lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".csv" />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-10 rounded-none gap-2 glass shadow-lg">
                <Upload className="h-4 w-4 text-primary" />Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-none glass p-2 ">
              <DropdownMenuItem className="rounded-none flex items-center gap-2" onClick={downloadTemplate}>
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

          <Button 
            size="sm" 
            className="h-10 rounded-none gap-2 shadow-primary/20 font-bold"
            onClick={() => activeTab === 'monthly' ? setIsMonthlyDialogOpen(true) : setIsWeeklyDialogOpen(true)}
          >
            <PlusCircle className="h-4 w-4" />
            New Record
          </Button>
        </div>
      </PageHeader>

      {isUploading && (
        <div className="space-y-3 glass-card p-6 mb-6">
          <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-primary">
            <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Processing Strategic Data...</span>
            <span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2 rounded-full" />
        </div>
      )}

      {!shouldFetch ? (
        <div className="flex flex-col items-center justify-center p-12 md:p-16 border border-dashed border-ink/20 rounded-none bg-foreground/[0.02] text-center space-y-6">
          <div className="h-20 w-20 bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
            <Database className="h-10 w-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold uppercase tracking-tighter">No spends loaded</h3>
            <p className="text-sm text-secondary max-w-sm mx-auto">Select a date range, then click <strong>Fetch records</strong> to load spend data.</p>
          </div>
          <Button 
            className="h-12 px-10 rounded-none bg-brand text-white font-bold uppercase tracking-[0.15em] text-xs brutalist-shadow active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
            onClick={() => setShouldFetch(true)}
          >
            Fetch records
          </Button>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="rounded-none glass p-1 mb-6">
            <TabsTrigger 
              value="monthly" 
              className="rounded-none px-6 font-bold flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-300"
            >
              <CalendarIcon className="h-4 w-4" /> Monthly SPENDS
              {monthlySpends && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px] bg-foreground/10 text-inherit border-none">{filteredMonthly.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger 
              value="weekly" 
              className="rounded-none px-6 font-bold flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-300"
            >
              <Layers className="h-4 w-4" /> Weekly SPENDS
              {weeklySpends && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px] bg-foreground/10 text-inherit border-none">{filteredWeekly.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monthly" className="animate-in fade-in slide-in-from-bottom-2 focus-visible:outline-none">
            <div className="rounded-none glass overflow-hidden ">
              <Table>
                <TableHeader className="bg-foreground/[0.02]">
                  <TableRow className="border-b border-foreground/5 hover:bg-transparent">
                    <TableHead className="px-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">ID & Brand</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Record ID</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Industry & Type</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Vendor & Month</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Team</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Actual (INR)</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-20"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary" /></TableCell></TableRow>
                  ) : filteredMonthly.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic text-sm">No monthly records found for this period.</TableCell></TableRow>
                  ) : filteredMonthly.map((spend) => (
                    <TableRow key={spend.id} className="border-b border-foreground/5 hover:bg-foreground/[0.02]">
                      <TableCell className="px-6 py-4">
                        <div className="text-[9px] font-mono font-bold text-primary/60 mb-0.5">{spend.clientId}</div>
                        <div className="text-xs font-black text-foreground/80">{spend.brandName}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/60">
                           <Fingerprint className="h-3 w-3" /> {spend.uploadRecordId || spend.id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-foreground/70">
                            <Factory className="h-3 w-3 text-secondary" /> {spend.industry}
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-tighter text-secondary">
                            <Tag className="h-3 w-3" /> {spend.type}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] font-black">{canonicalizeChannel(spend.channelVendor)}</div>
                        <div className="text-[9px] font-mono font-bold opacity-60">{spend.month}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-[9px] font-medium text-muted-foreground">{spend.team}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-[11px] text-primary">{spend.actualSpendsInr.toLocaleString()}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-none glass ">
                            <DropdownMenuItem className="rounded-lg text-xs font-bold" onSelect={openDialogFromMenu(() => { setEditingMonthly(spend); setIsMonthlyDialogOpen(true); })}>Edit Record</DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg text-xs font-bold text-destructive" onSelect={openDialogFromMenu(() => setDeletingId(spend.id))}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="weekly" className="animate-in fade-in slide-in-from-bottom-2 focus-visible:outline-none">
            <div className="rounded-none glass overflow-hidden ">
              <Table>
                <TableHeader className="bg-foreground/[0.02]">
                  <TableRow className="border-b border-foreground/5 hover:bg-transparent">
                    <TableHead className="px-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">ID & Brand</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Record ID</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Industry & Type</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Vendor & Week</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Team</TableHead>
                    <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">SPENDS (INR)</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-20"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary" /></TableCell></TableRow>
                  ) : filteredWeekly.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-20 text-muted-foreground italic text-sm">No weekly records found for this period.</TableCell></TableRow>
                  ) : filteredWeekly.map((spend) => (
                    <TableRow key={spend.id} className="border-b border-foreground/5 hover:bg-foreground/[0.02]">
                      <TableCell className="px-6 py-4">
                        <div className="text-[9px] font-mono font-bold text-primary/60 mb-0.5">{spend.clientId}</div>
                        <div className="text-xs font-black text-foreground/80">{spend.brandName}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/60">
                           <Fingerprint className="h-3 w-3" /> {spend.uploadRecordId || spend.id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-foreground/70">
                            <Factory className="h-3 w-3 text-secondary" /> {spend.industry}
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-tighter text-secondary">
                            <Tag className="h-3 w-3" /> {spend.type}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] font-black">{canonicalizeChannel(spend.channelVendor)}</div>
                        <Badge variant="outline" className="text-[9px] h-4 rounded-sm px-1 font-bold">{spend.week}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-[9px] font-medium text-muted-foreground">{spend.team}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-[11px] text-success">{spend.spendsInr.toLocaleString()}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-none glass ">
                            <DropdownMenuItem className="rounded-lg text-xs font-bold" onSelect={openDialogFromMenu(() => { setEditingWeekly(spend); setIsWeeklyDialogOpen(true); })}>Edit Record</DropdownMenuItem>
                            <DropdownMenuItem className="rounded-lg text-xs font-bold text-destructive" onSelect={openDialogFromMenu(() => setDeletingId(spend.id))}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <SpendFormDialog 
        isOpen={isMonthlyDialogOpen} 
        onOpenChange={(o) => { setIsMonthlyDialogOpen(o); if(!o) setEditingMonthly(null); }}
        onSave={handleSaveMonthly}
        editingData={editingMonthly}
        type="monthly"
      />

      <SpendFormDialog 
        isOpen={isWeeklyDialogOpen} 
        onOpenChange={(o) => { setIsWeeklyDialogOpen(o); if(!o) setEditingWeekly(null); }}
        onSave={handleSaveWeekly}
        editingData={editingWeekly}
        type="weekly"
      />

      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent className="rounded-none glass ">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-headline text-2xl">Delete Record?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/70 font-medium">This action is permanent and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-6">
            <AlertDialogCancel className="rounded-none h-12 px-6 font-bold">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 rounded-none h-12 px-8 font-black" onClick={async () => {
              if (deletingId) {
                if (activeTab === 'monthly') await deleteMonthlySpend(firestore, deletingId);
                else await deleteWeeklySpend(firestore, deletingId);
                toast({ title: 'Record deleted' });
                setDeletingId(null);
              }
            }}>Confirm Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function SpendsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary/40" /></div>}>
      <SpendsContent />
    </Suspense>
  );
}

function SpendFormDialog({ 
  isOpen, 
  onOpenChange, 
  onSave, 
  editingData, 
  type 
}: { 
  isOpen: boolean; 
  onOpenChange: (o: boolean) => void; 
  onSave: (v: any) => Promise<void>; 
  editingData: any;
  type: 'monthly' | 'weekly';
}) {
  const schema = type === 'monthly' ? monthlySpendSchema : weeklySpendSchema;
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: editingData || {
      uploadRecordId: '', clientId: '', brandName: '', industry: '', type: '', subEntity: '',
      channelVendor: '', creditLine: '', currency: 'INR', team: '',
      ...(type === 'monthly' ? { month: '', actualSpendsInr: 0 } : { week: '', spendsInr: 0 })
    }
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset(editingData || {
        uploadRecordId: '', clientId: '', brandName: '', industry: '', type: '', subEntity: '',
        channelVendor: '', creditLine: '', currency: 'INR', team: '',
        ...(type === 'monthly' ? { month: '', actualSpendsInr: 0 } : { week: '', spendsInr: 0 })
      });
    }
  }, [editingData, isOpen, form, type]);

  const fields = [
    { name: 'uploadRecordId', label: 'Record ID (Optional)', disabled: !!editingData },
    { name: 'clientId', label: 'Client ID' },
    { name: 'brandName', label: 'Brand Name' },
    { name: 'industry', label: 'Industry' },
    { name: 'type', label: 'Type' },
    { name: 'subEntity', label: 'Sub Entity' },
    { name: 'channelVendor', label: 'Channel / Vendor' },
    { name: 'creditLine', label: 'Credit Line' },
    { name: 'currency', label: 'Currency' },
    { name: 'team', label: 'Team' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">{editingData ? 'Edit' : 'Add New'} {type === 'monthly' ? 'Monthly' : 'Weekly'} SPENDS</DialogTitle>
          <DialogDescription className="text-foreground/70">Fill in the spending details accurately. Provide a Record ID to update an existing entry.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map(f => (
                <FormField key={f.name} control={form.control} name={f.name as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">{f.label}</FormLabel>
                    <FormControl><Input className="rounded-none bg-foreground/5 border-none h-10 shadow-inner" {...field} disabled={f.disabled} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              {type === 'monthly' ? (
                <>
                  <FormField control={form.control} name="month" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Month (YYYY-MM)</FormLabel>
                      <FormControl><Input className="rounded-none bg-foreground/5 border-none h-10 shadow-inner" placeholder="2024-03" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="actualSpendsInr" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Actual SPENDS (INR)</FormLabel>
                      <FormControl><Input type="number" className="rounded-none bg-foreground/5 border-none h-10 font-mono shadow-inner" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              ) : (
                <>
                  <FormField control={form.control} name="week" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Week</FormLabel>
                      <FormControl><Input className="rounded-none bg-foreground/5 border-none h-10 shadow-inner" placeholder="e.g. 07-01-2024" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="spendsInr" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">SPENDS (INR)</FormLabel>
                      <FormControl><Input type="number" className="rounded-none bg-foreground/5 border-none h-10 font-mono shadow-inner" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}
            </div>
            <DialogFooter className="pt-8">
              <Button type="button" variant="ghost" className="rounded-none h-12 px-6 font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="rounded-none h-12 px-10 font-black shadow-lg shadow-primary/20">Save Record</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}