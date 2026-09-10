'use client';

import React, { useMemo, useRef, useState, useEffect, Suspense } from 'react';
import { format } from 'date-fns';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  PlusCircle, 
  Search, 
  MoreHorizontal, 
  Trash, 
  Loader2,
  Briefcase,
  Target,
  Banknote,
  Filter,
  CheckCircle2,
  Clock,
  Ban,
  ArrowRight,
  Upload,
  Download,
  FileSpreadsheet,
  Settings2
} from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useCollection, useFirestore } from '@/firebase';
import { Lead, LeadStatus } from '@/lib/types';
import { saveLead, deleteLead, bulkSaveLeads } from '@/lib/firestore-actions';
import { useToast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/page-header';
import { LeadDialog } from './lead-dialog';
import { cn, openDialogFromMenu } from '@/lib/utils';
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

const statusVariants: Record<LeadStatus, { color: string, icon: any }> = {
  'Unqualified': { color: 'bg-muted text-muted-foreground', icon: Ban },
  'Qualified': { color: 'bg-primary/10 text-primary', icon: Target },
  'Pitch': { color: 'bg-warning/10 text-warning', icon: Clock },
  'Negotiation': { color: 'bg-warning/20 text-warning', icon: Briefcase },
  'Contract': { color: 'bg-success/20 text-success', icon: Banknote },
  'Won': { color: 'bg-success text-success-foreground', icon: CheckCircle2 },
  'Lost': { color: 'bg-destructive/10 text-destructive', icon: Ban },
};

const LEAD_CSV_HEADERS = [
  'Record ID',
  'Entity Name',
  'Opportunity Owner',
  'Team Assigned',
  'Phone',
  'Status',
  'Services',
  'Estimated Value',
  'Expected Spends',
  'Retainer Details',
  'Pitch Date',
  'Expected Go Live Date',
  'Notes',
];

const formatCurrency = (val: number) => {
    const absVal = Math.abs(val);
    if (absVal >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
    if (absVal >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
    return `₹${(val || 0).toLocaleString()}`;
};

const formatDisplayDate = (value?: string) => {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return format(d, 'dd MMM yyyy');
  } catch {
    return value;
  }
};

const LEAD_STAGES: LeadStatus[] = [
  'Unqualified',
  'Qualified',
  'Pitch',
  'Negotiation',
  'Contract',
  'Won',
  'Lost',
];

function parseStatusParam(raw: string | null): string {
  if (!raw) return 'all';
  const match = LEAD_STAGES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
  return match || 'all';
}

export default function SalesTrackerPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center p-20"><Loader2 className="animate-spin h-8 w-8 text-primary/40" /></div>}>
      <SalesTrackerContent />
    </Suspense>
  );
}

function SalesTrackerContent() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: leads, loading } = useCollection<Lead>('leads');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(() => parseStatusParam(searchParams.get('status')));
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    setStatusFilter(parseStatusParam(searchParams.get('status')));
  }, [searchParams]);

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') params.delete('status');
    else params.set('status', value);
    const qs = params.toString();
    router.replace(qs ? `/dashboard/sales-tracker?${qs}` : '/dashboard/sales-tracker');
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    return leads.filter(l => {
      const q = search.toLowerCase();
      const matchesSearch =
        (l.companyName || '').toLowerCase().includes(q) ||
        (l.opportunityOwner || '').toLowerCase().includes(q) ||
        (l.teamAssigned || '').toLowerCase().includes(q) ||
        (l.retainerDetails || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
      return matchesSearch && matchesStatus;
    }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [leads, search, statusFilter]);

  const handleSave = async (data: any) => {
    try {
      await saveLead(firestore, data, selectedLead?.id);
      toast({ title: selectedLead ? "Lead updated" : "New prospect registered" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Save failed", description: e.message });
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = LEAD_CSV_HEADERS.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aztec_sales_tracker_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Leads');
    worksheet.columns = [
      { header: 'Record ID', key: 'uploadRecordId', width: 24 },
      { header: 'Entity Name', key: 'companyName', width: 28 },
      { header: 'Opportunity Owner', key: 'opportunityOwner', width: 20 },
      { header: 'Team Assigned', key: 'teamAssigned', width: 18 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Services', key: 'services', width: 28 },
      { header: 'Estimated Value', key: 'estimatedValue', width: 16 },
      { header: 'Expected Spends', key: 'expectedSpends', width: 16 },
      { header: 'Retainer Details', key: 'retainerDetails', width: 28 },
      { header: 'Pitch Date', key: 'pitchDate', width: 14 },
      { header: 'Expected Go Live Date', key: 'expectedGoLiveDate', width: 18 },
      { header: 'Notes', key: 'notes', width: 36 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

    filteredLeads.forEach((lead) => {
      worksheet.addRow({
        uploadRecordId: lead.uploadRecordId || lead.id,
        companyName: lead.companyName,
        opportunityOwner: lead.opportunityOwner || '',
        teamAssigned: lead.teamAssigned || '',
        phone: lead.phone || '',
        status: lead.status,
        services: (lead.services || []).join('; '),
        estimatedValue: lead.estimatedValue || 0,
        expectedSpends: lead.expectedSpends || 0,
        retainerDetails: lead.retainerDetails || '',
        pitchDate: lead.pitchDate || '',
        expectedGoLiveDate: lead.expectedGoLiveDate || '',
        notes: lead.notes || '',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Agency_Sales_Tracker_Export_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast({ title: 'Export Complete', description: `${filteredLeads.length} leads exported.` });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadProgress(0);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: true,
      complete: async (r) => {
        try {
          const { processedCount } = await bulkSaveLeads(firestore, r.data as any[], setUploadProgress);
          toast({ title: 'Sync Complete', description: `${processedCount} leads saved.` });
        } catch (err: any) {
          toast({ variant: 'destructive', title: 'Sync Failed', description: err.message });
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-8 animate-in fade-in duration-700">
      <PageHeader title="SALES TRACKER" description="Lead intelligence and acquisition hierarchy.">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input 
              placeholder="Search prospects..." 
              className="pl-9 w-[220px] rounded-none glass h-10 text-xs shadow-lg"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 bg-white/40 dark:bg-white/5 rounded-none p-1 px-4 backdrop-blur-md shadow-inner border border-white/20 h-10">
             <Filter className="h-3 w-3 text-secondary" />
             <select 
               className="bg-transparent border-none text-[10px] font-black uppercase outline-none focus:ring-0 cursor-pointer"
               value={statusFilter}
               onChange={(e) => handleStatusFilterChange(e.target.value)}
             >
               <option value="all">All Stages</option>
               {LEAD_STAGES.map((stage) => (
                 <option key={stage} value={stage}>{stage}</option>
               ))}
             </select>
          </div>

          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".csv" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-10 rounded-none gap-2 glass shadow-lg" disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4 text-primary" />}
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-none glass p-2 min-w-[200px]">
              <DropdownMenuItem className="rounded-none flex items-center gap-2 text-[10px] font-black uppercase tracking-widest" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4" /> Download Template
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-none flex items-center gap-2 text-[10px] font-black uppercase tracking-widest" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <Upload className="h-4 w-4" /> Upload CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="rounded-none flex items-center gap-2 text-[10px] font-black uppercase tracking-widest" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4" /> Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            size="sm" 
            className="h-10 rounded-none gap-2 shadow-primary/20 font-bold px-6"
            onClick={() => { setSelectedLead(null); setIsDialogOpen(true); }}
          >
            <PlusCircle className="h-4 w-4" />
            REGISTER LEAD
          </Button>
        </div>
      </PageHeader>

      {isUploading && (
        <div className="space-y-2 px-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-secondary">Uploading leads… {uploadProgress}%</p>
          <Progress value={uploadProgress} className="h-2 rounded-none" />
        </div>
      )}

      <div className="rounded-none glass overflow-hidden ">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-foreground/[0.02]">
            <TableRow className="border-b border-foreground/5 hover:bg-transparent">
              <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Entity</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Opportunity Owner</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Team Assigned</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Service Portfolio</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Lead Stage</TableHead>
              <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Est. Value</TableHead>
              <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Expected Spends</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Retainer</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Pitch Date</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Go Live</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={11} className="text-center py-32"><Loader2 className="animate-spin h-10 w-10 mx-auto text-primary/40" /></TableCell></TableRow>
            ) : filteredLeads.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="text-center py-40 text-muted-foreground italic uppercase text-[10px] font-black tracking-widest text-secondary">No prospect records found in active registry.</TableCell></TableRow>
            ) : filteredLeads.map((lead) => {
              const StatusIcon = statusVariants[lead.status]?.icon || Ban;
              return (
                <TableRow key={lead.id} className="border-b border-foreground/5 hover:bg-foreground/[0.02] group transition-colors">
                  <TableCell className="px-8 py-6">
                    <span className="text-sm font-black text-foreground tracking-tight">{lead.companyName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[11px] font-bold uppercase tracking-tight">{lead.opportunityOwner || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-[11px] font-bold uppercase tracking-tight">{lead.teamAssigned || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {(lead.services || []).map(s => (
                        <Badge key={s} variant="outline" className="text-[8px] font-black h-4 px-1.5 leading-none border-foreground/10 bg-foreground/[0.02] uppercase">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[9px] font-black uppercase h-6 px-3 rounded-none flex items-center gap-1.5 w-fit", statusVariants[lead.status]?.color)}>
                      <StatusIcon className="h-3 w-3" />
                      {lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-black text-xs text-primary">
                    {formatCurrency(lead.estimatedValue || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-black text-xs">
                    {formatCurrency(lead.expectedSpends || 0)}
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    <span className="text-[10px] font-medium text-secondary line-clamp-2">{lead.retainerDetails || '—'}</span>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] font-bold whitespace-nowrap">
                    {formatDisplayDate(lead.pitchDate)}
                  </TableCell>
                  <TableCell className="font-mono text-[10px] font-bold whitespace-nowrap">
                    {formatDisplayDate(lead.expectedGoLiveDate)}
                  </TableCell>
                  <TableCell className="px-6">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-none glass p-2 min-w-[140px]">
                        <DropdownMenuItem className="rounded-lg text-[10px] font-black uppercase tracking-widest gap-2" onSelect={openDialogFromMenu(() => { setSelectedLead(lead); setIsDialogOpen(true); })}>
                          <ArrowRight className="h-3 w-3" /> Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuItem className="rounded-lg text-[10px] font-black uppercase tracking-widest text-destructive gap-2 focus:bg-destructive/10 focus:text-destructive" onSelect={openDialogFromMenu(() => setDeletingId(lead.id))}>
                          <Trash className="h-3 w-3" /> Delete Lead
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      </div>

      <LeadDialog 
        isOpen={isDialogOpen} 
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setSelectedLead(null);
        }}
        onSave={handleSave} 
        lead={selectedLead} 
      />

      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent className="rounded-none glass ">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-headline text-3xl font-black uppercase tracking-tighter">Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/70 font-bold uppercase text-[10px] tracking-widest leading-relaxed">
              This action will permanently purge lead details from the Agency Insights archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-8">
            <AlertDialogCancel className="rounded-none h-12 px-6 font-bold uppercase text-[10px] tracking-widest">Abort</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 rounded-none h-12 px-8 font-black uppercase text-[10px] tracking-widest" onClick={async () => {
              if (deletingId) {
                await deleteLead(firestore, deletingId);
                toast({ title: 'Lead deleted' });
                setDeletingId(null);
              }
            }}>Confirm Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
