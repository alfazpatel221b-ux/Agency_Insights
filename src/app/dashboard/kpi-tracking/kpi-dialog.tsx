
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
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiData, KpiWeeklyData, Client, Kpi, Channel } from '@/lib/types';
import { canonicalizeChannel } from '@/lib/normalize';
import { useEffect, useMemo } from 'react';
import { Separator } from '@/components/ui/separator';

const kpiSchema = z.object({
  uploadRecordId: z.string().optional(),
  clientId: z.string().min(1, 'Client ID is required'),
  clientName: z.string().min(1, 'Client name is required'),
  cluster: z.string().min(1, 'Cluster is required'),
  lob: z.string().min(1, 'LOB is required'),
  cduLead: z.string().min(1, 'CDU Lead is required'),
  emCsm: z.string().min(1, 'EM/CSM is required'),
  channel: z.string().min(1, 'Channel is required'),
  kpi: z.string().min(1, 'KPI is required'),
  kpiType: z.enum(['PRIMARY', 'NON-PRIMARY']),
  currency: z.string().optional(),
  w1_target: z.coerce.number().min(0, 'Target must be a positive number'),
  w1_achieved: z.coerce.number().min(0, 'Achieved must be a positive number'),
  w1_comment: z.string().optional(),
  w2_target: z.coerce.number().min(0, 'Target must be a positive number'),
  w2_achieved: z.coerce.number().min(0, 'Achieved must be a positive number'),
  w2_comment: z.string().optional(),
  w3_target: z.coerce.number().min(0, 'Target must be a positive number'),
  w3_achieved: z.coerce.number().min(0, 'Achieved must be a positive number'),
  w3_comment: z.string().optional(),
  w4_target: z.coerce.number().min(0, 'Target must be a positive number'),
  w4_achieved: z.coerce.number().min(0, 'Achieved must be a positive number'),
  w4_comment: z.string().optional(),
  w5_target: z.coerce.number().min(0, 'Target must be a positive number'),
  w5_achieved: z.coerce.number().min(0, 'Achieved must be a positive number'),
  w5_comment: z.string().optional(),
});

export type KpiFormValues = z.infer<typeof kpiSchema>;

interface WeekDate {
    num: number;
    start: Date;
    end: Date;
    range: string;
}

interface KpiDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: KpiFormValues) => void;
  kpi?: KpiData;
  weeklyData?: KpiWeeklyData[];
  currentMonth: string;
  weekDates: WeekDate[];
  clients: Client[];
  kpis: Kpi[];
  channels: Channel[];
}

export function KpiDialog({ isOpen, onOpenChange, onSave, kpi, weeklyData, currentMonth, weekDates, clients, kpis, channels }: KpiDialogProps) {
  const channelOptions = useMemo(() => {
    const byName = new Map<string, Channel>();
    channels.forEach(c => {
      const name = canonicalizeChannel(c.name);
      if (!byName.has(name)) byName.set(name, { ...c, name });
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  const form = useForm<KpiFormValues>({
    resolver: zodResolver(kpiSchema),
    defaultValues: {
      uploadRecordId: '',
      clientId: '',
      clientName: '',
      cluster: '',
      lob: '',
      cduLead: '',
      emCsm: '',
      channel: '',
      kpi: '',
      kpiType: 'PRIMARY',
      currency: 'INR',
      w1_target: 0,
      w1_achieved: 0,
      w1_comment: '',
      w2_target: 0,
      w2_achieved: 0,
      w2_comment: '',
      w3_target: 0,
      w3_achieved: 0,
      w3_comment: '',
      w4_target: 0,
      w4_achieved: 0,
      w4_comment: '',
      w5_target: 0,
      w5_achieved: 0,
      w5_comment: '',
    }
  });

  useEffect(() => {
    if (isOpen) {
        if (kpi && weeklyData) {
            const getWeekData = (week: number) => weeklyData.find(d => d.weekOfMonth === week);
            form.reset({
                uploadRecordId: kpi.uploadRecordId || kpi.id,
                clientId: kpi.clientId || '',
                clientName: kpi.clientName,
                cluster: kpi.cluster || '',
                lob: kpi.lob || '',
                cduLead: kpi.cduLead || '',
                emCsm: kpi.emCsm || '',
                channel: canonicalizeChannel(kpi.channel),
                kpi: kpi.kpi,
                kpiType: kpi.kpiType,
                currency: kpi.currency || 'INR',
                w1_target: getWeekData(1)?.target ?? 0,
                w1_achieved: getWeekData(1)?.achieved ?? 0,
                w1_comment: getWeekData(1)?.comment ?? '',
                w2_target: getWeekData(2)?.target ?? 0,
                w2_achieved: getWeekData(2)?.achieved ?? 0,
                w2_comment: getWeekData(2)?.comment ?? '',
                w3_target: getWeekData(3)?.target ?? 0,
                w3_achieved: getWeekData(3)?.achieved ?? 0,
                w3_comment: getWeekData(3)?.comment ?? '',
                w4_target: getWeekData(4)?.target ?? 0,
                w4_achieved: getWeekData(4)?.achieved ?? 0,
                w4_comment: getWeekData(4)?.comment ?? '',
                w5_target: getWeekData(5)?.target ?? 0,
                w5_achieved: getWeekData(5)?.achieved ?? 0,
                w5_comment: getWeekData(5)?.comment ?? '',
            });
        } else {
             form.reset({
                uploadRecordId: '',
                clientId: '',
                clientName: '',
                cluster: '',
                lob: '',
                cduLead: '',
                emCsm: '',
                channel: '',
                kpi: '',
                kpiType: 'PRIMARY',
                currency: 'INR',
                w1_target: 0,
                w1_achieved: 0,
                w1_comment: '',
                w2_target: 0,
                w2_achieved: 0,
                w2_comment: '',
                w3_target: 0,
                w3_achieved: 0,
                w3_comment: '',
                w4_target: 0,
                w4_achieved: 0,
                w4_comment: '',
                w5_target: 0,
                w5_achieved: 0,
                w5_comment: '',
            });
        }
    }
  }, [kpi, weeklyData, form, isOpen]);

  const onSubmit = (data: KpiFormValues) => {
    onSave(data);
  };

  const handleClientSelect = (clientName: string) => {
    const client = clients.find(c => c.name === clientName);
    if (client) {
      form.setValue('clientId', client.uniqueId);
      form.setValue('cluster', client.cluster || '');
      form.setValue('lob', client.subEntity || '');
      form.setValue('cduLead', client.clusterLead || '');
      form.setValue('emCsm', client.emcsm || '');
    }
    form.setValue('clientName', clientName);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">{kpi ? 'Edit KPI Record' : 'Add KPI Record'}</DialogTitle>
          <DialogDescription className="text-foreground/70">
            {kpi ? "Make changes to the KPI record and its weekly breakdown." : `Add a new KPI record for ${currentMonth}.`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                control={form.control}
                name="uploadRecordId"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Record ID (Optional)</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="Auto-generated if blank" {...field} disabled={!!kpi} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Client</FormLabel>
                    <Select onValueChange={handleClientSelect} value={field.value} disabled={!!kpi}>
                        <FormControl>
                        <SelectTrigger className="rounded-none bg-foreground/5 border-none">
                            <SelectValue placeholder="Select a client" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-none glass ">
                        {clients.map(client => (
                            <SelectItem key={client.id} value={client.name}>{client.name}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Client ID</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="Unique ID" {...field} disabled={!!kpi} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="cluster"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Cluster</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="e.g. Cluster Alpha" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="lob"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">LOB (Sub-Entity)</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="e.g. Retail" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                 <FormField
                control={form.control}
                name="cduLead"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">CDU Lead</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="Lead name" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                 <FormField
                control={form.control}
                name="emCsm"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">EM / CSM</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="Manager name" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="channel"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Channel</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!kpi}>
                        <FormControl>
                        <SelectTrigger className="rounded-none bg-foreground/5 border-none">
                            <SelectValue placeholder="Select a channel" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-none glass ">
                        {channelOptions.map(c => (
                            <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
                />
                <FormField
                control={form.control}
                name="kpi"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">KPI</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!kpi}>
                        <FormControl>
                        <SelectTrigger className="rounded-none bg-foreground/5 border-none">
                            <SelectValue placeholder="Select a KPI" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-none glass ">
                        {kpis.map(k => (
                            <SelectItem key={k.id} value={k.name}>{k.name}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
                />

                <FormField
                control={form.control}
                name="kpiType"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">KPI Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                        <SelectTrigger className="rounded-none bg-foreground/5 border-none">
                            <SelectValue placeholder="Select a KPI type" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-none glass ">
                        <SelectItem value="PRIMARY">PRIMARY</SelectItem>
                        <SelectItem value="NON-PRIMARY">NON-PRIMARY</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
                />

                <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Currency</FormLabel>
                    <FormControl>
                        <Input className="rounded-none bg-foreground/5 border-none h-10" placeholder="e.g. INR" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
                />
            </div>
            
            <Separator className="my-6 bg-foreground/5" />
            <h4 className="text-xs font-black uppercase tracking-widest text-foreground/60">Weekly Breakdown ({currentMonth})</h4>

            <div className="space-y-4">
                {weekDates.map(week => {
                    const weekNum = week.num;
                    const weekLabel = `Week ${week.num} (${week.range})`;
                    return (
                        <div key={weekNum} className="space-y-4 rounded-none bg-foreground/5 p-4 border border-white/10 shadow-sm">
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-primary">{weekLabel}</FormLabel>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <FormField
                                    control={form.control}
                                    name={`w${weekNum}_target` as any}
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel className="text-[9px] font-bold uppercase text-foreground/60">Target</FormLabel>
                                        <FormControl>
                                            <Input className="rounded-lg bg-background/50 border-none h-8 text-xs font-mono" type="number" placeholder="0" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name={`w${weekNum}_achieved` as any}
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel className="text-[9px] font-bold uppercase text-foreground/60">Achieved</FormLabel>
                                        <FormControl>
                                            <Input className="rounded-lg bg-background/50 border-none h-8 text-xs font-mono" type="number" placeholder="0" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="md:col-span-1">
                                    <FormField
                                        control={form.control}
                                        name={`w${weekNum}_comment` as any}
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel className="text-[9px] font-bold uppercase text-foreground/60">Comment</FormLabel>
                                            <FormControl>
                                                <Input className="rounded-lg bg-background/50 border-none h-8 text-[10px]" placeholder="Add context..." {...field} />
                                            </FormControl>
                                            <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            
            <DialogFooter className="pt-8">
                <Button type="button" variant="ghost" className="rounded-none h-12 px-6 font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="rounded-none h-12 px-8 font-black shadow-lg shadow-primary/20">Save Records</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
