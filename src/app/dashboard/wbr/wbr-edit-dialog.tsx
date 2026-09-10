'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Client, WbrEntry, UserProfile, RagStatus } from '@/lib/types';
import { useEffect, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { ShieldCheck, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface WbrEditDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Partial<WbrEntry>) => Promise<void>;
  client: Client;
  entry?: WbrEntry | null;
  userRole?: string;
  isAdmin: boolean;
  isWindowOpen: boolean;
  wbrDate: string;
}

export function WbrEditDialog({ isOpen, onOpenChange, onSave, client, entry, isAdmin, isWindowOpen, wbrDate }: WbrEditDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<WbrFormValues>({
    resolver: zodResolver(wbrSchema),
    defaultValues: {
      cluster: client.cluster || '',
      clusterLead: client.clusterLead || '',
      emcsm: client.emcsm || '',
      clientPartner: client.clientPartner || '',
      contractStatus: entry?.contractStatus || 'Valid',
      financeIssues: entry?.financeIssues || '',
      engagementRag: entry?.engagementRag || 'Green',
      performanceRag: entry?.performanceRag || 'Green',
      organicOpportunities: entry?.organicOpportunities || '',
      crossSellOpportunities: entry?.crossSellOpportunities || '',
      performanceSummary: entry?.performanceSummary || '',
      summary: entry?.summary || '',
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        cluster: client.cluster || '',
        clusterLead: client.clusterLead || '',
        emcsm: client.emcsm || '',
        clientPartner: client.clientPartner || '',
        contractStatus: entry?.contractStatus || 'Valid',
        financeIssues: entry?.financeIssues || '',
        engagementRag: entry?.engagementRag || 'Green',
        performanceRag: entry?.performanceRag || 'Green',
        organicOpportunities: entry?.organicOpportunities || '',
        crossSellOpportunities: entry?.crossSellOpportunities || '',
        performanceSummary: entry?.performanceSummary || '',
        summary: entry?.summary || '',
      });
    }
  }, [isOpen, client, entry, form]);

  const onSubmit = async (values: WbrFormValues) => {
    setIsSaving(true);
    try {
      await onSave({
        ...values,
        clientId: client.uniqueId,
        wbrDate: wbrDate,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const REVIEW_FIELDS = ['contractStatus', 'financeIssues', 'engagementRag', 'organicOpportunities', 'crossSellOpportunities', 'performanceRag', 'performanceSummary', 'summary'];

  const canEditField = (fieldName: string) => {
    if (isAdmin) return true;
    if (!isWindowOpen) return false;
    return REVIEW_FIELDS.includes(fieldName);
  };

  const renderFieldInfo = (_fieldName: string) => {
    if (isAdmin) return <ShieldCheck className="h-3 w-3 text-primary" />;
    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">{client.uniqueId}</span>
              <DialogTitle className="text-3xl font-black font-headline tracking-tighter">{client.name}</DialogTitle>
              <DialogDescription className="text-sm font-bold opacity-60">Review Cycle: {wbrDate}</DialogDescription>
            </div>
            {!isWindowOpen && !isAdmin && (
              <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1.5 rounded-none border border-destructive/20">
                <Info className="h-4 w-4" />
                <span className="text-[10px] font-black uppercase">Lock Active</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pt-4">
            
            {/* ADMIN SECTION */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                   <h4 className="text-[10px] font-black uppercase tracking-widest text-secondary">Account Configuration (Admin Only)</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-none bg-foreground/[0.03] border border-foreground/5">
                    {['cluster', 'clusterLead', 'emcsm', 'clientPartner'].map((f) => (
                      <FormField
                        key={f}
                        control={form.control}
                        name={f as any}
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between mb-1">
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">
                                  {f === 'emcsm' ? 'EM / CSM' : f.replace(/([A-Z])/g, ' $1')}
                                </FormLabel>
                                {renderFieldInfo(f)}
                            </div>
                            <FormControl>
                              <Input className="rounded-none bg-background/50 border-none h-10" {...field} disabled={!canEditField(f)} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                </div>
            </div>

            {/* CSM SECTION */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                   <h4 className="text-[10px] font-black uppercase tracking-widest text-secondary">EM / CSM Updates</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-none bg-foreground/[0.03] border border-foreground/5">
                    <FormField
                      control={form.control}
                      name="contractStatus"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between mb-1">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Contract Status</FormLabel>
                            {renderFieldInfo('contractStatus')}
                          </div>
                          <Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('contractStatus')}>
                            <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent className="rounded-none glass ">
                              <SelectItem value="Valid">Valid</SelectItem>
                              <SelectItem value="Expired">Expired</SelectItem>
                              <SelectItem value="Negotiation">Negotiation</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="engagementRag"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between mb-1">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Engagement RAG</FormLabel>
                            {renderFieldInfo('engagementRag')}
                          </div>
                          <Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('engagementRag')}>
                            <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent className="rounded-none glass ">
                              <SelectItem value="Green" className="text-success">Green</SelectItem>
                              <SelectItem value="Amber" className="text-warning">Amber</SelectItem>
                              <SelectItem value="Red" className="text-destructive">Red</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <div className="md:col-span-2">
                        <FormField
                        control={form.control}
                        name="financeIssues"
                        render={({ field }) => (
                            <FormItem>
                            <div className="flex items-center justify-between mb-1">
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Finance / Billing Issues</FormLabel>
                                {renderFieldInfo('financeIssues')}
                            </div>
                            <FormControl><Textarea className="rounded-none bg-background/50 border-none min-h-[60px]" placeholder="Add billing context..." {...field} disabled={!canEditField('financeIssues')} /></FormControl>
                            </FormItem>
                        )}
                        />
                    </div>
                    <FormField
                      control={form.control}
                      name="organicOpportunities"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between mb-1">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Organic Opportunities</FormLabel>
                            {renderFieldInfo('organicOpportunities')}
                          </div>
                          <FormControl><Textarea className="rounded-none bg-background/50 border-none" placeholder="Growth leads..." {...field} disabled={!canEditField('organicOpportunities')} /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="crossSellOpportunities"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between mb-1">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Cross Sell Opportunities</FormLabel>
                            {renderFieldInfo('crossSellOpportunities')}
                          </div>
                          <FormControl><Textarea className="rounded-none bg-background/50 border-none" placeholder="Service expansion..." {...field} disabled={!canEditField('crossSellOpportunities')} /></FormControl>
                        </FormItem>
                      )}
                    />
                </div>
            </div>

            {/* OPS / LEAD SECTION */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                   <h4 className="text-[10px] font-black uppercase tracking-widest text-secondary">Cluster Lead / Ops Review</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-none bg-foreground/[0.03] border border-foreground/5">
                    <FormField
                      control={form.control}
                      name="performanceRag"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between mb-1">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Performance RAG (Risk)</FormLabel>
                            {renderFieldInfo('performanceRag')}
                          </div>
                          <Select onValueChange={field.onChange} value={field.value} disabled={!canEditField('performanceRag')}>
                            <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent className="rounded-none glass ">
                              <SelectItem value="Green" className="text-success">Green</SelectItem>
                              <SelectItem value="Amber" className="text-warning">Amber</SelectItem>
                              <SelectItem value="Red" className="text-destructive">Red</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <div className="md:col-span-2">
                        <FormField
                        control={form.control}
                        name="performanceSummary"
                        render={({ field }) => (
                            <FormItem>
                            <div className="flex items-center justify-between mb-1">
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Performance Summary</FormLabel>
                                {renderFieldInfo('performanceSummary')}
                            </div>
                            <FormControl><Textarea className="rounded-none bg-background/50 border-none min-h-[80px]" placeholder="Performance summary for the week..." {...field} disabled={!canEditField('performanceSummary')} /></FormControl>
                            </FormItem>
                        )}
                        />
                    </div>
                    <div className="md:col-span-2">
                        <FormField
                        control={form.control}
                        name="summary"
                        render={({ field }) => (
                            <FormItem>
                            <div className="flex items-center justify-between mb-1">
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Executive Summary &amp; challenges</FormLabel>
                                {renderFieldInfo('summary')}
                            </div>
                            <FormControl><Textarea className="rounded-none bg-background/50 border-none min-h-[100px]" placeholder="Strategic summary for the week..." {...field} disabled={!canEditField('summary')} /></FormControl>
                            </FormItem>
                        )}
                        />
                    </div>
                </div>
            </div>

            <DialogFooter className="pt-6 border-t border-foreground/5">
              <Button type="button" variant="ghost" className="rounded-none h-12 px-6 font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button 
                type="submit" 
                className="rounded-none h-12 px-10 font-black shadow-primary/20" 
                disabled={isSaving || (!isWindowOpen && !isAdmin)}
              >
                {isSaving ? <Loader2 className="animate-spin h-4 w-4" /> : 'Save WBR Entry'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function Loader2({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("animate-spin", className)}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
}