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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Lead, LeadStatus, ServiceType } from '@/lib/types';
import { useEffect } from 'react';

const leadSchema = z.object({
  companyName: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  status: z.enum(['Unqualified', 'Qualified', 'Pitch', 'Negotiation', 'Contract', 'Won', 'Lost']),
  services: z.array(z.string()).min(1, 'Select at least one service'),
  estimatedValue: z.coerce.number().min(0),
  notes: z.string().optional(),
  opportunityOwner: z.string().optional(),
  expectedSpends: z.coerce.number().min(0).optional(),
  retainerDetails: z.string().optional(),
  expectedGoLiveDate: z.string().optional(),
  pitchDate: z.string().optional(),
  teamAssigned: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

interface LeadDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: LeadFormValues) => Promise<void>;
  lead?: Lead | null;
}

const statusOptions: LeadStatus[] = ['Unqualified', 'Qualified', 'Pitch', 'Negotiation', 'Contract', 'Won', 'Lost'];
const serviceOptions: ServiceType[] = ['Performance', 'SEO', 'Affiliates', 'Branding', 'Marketplace', 'Creatives', 'Social'];

const emptyDefaults: LeadFormValues = {
  companyName: '',
  phone: '',
  status: 'Unqualified',
  services: [],
  estimatedValue: 0,
  notes: '',
  opportunityOwner: '',
  expectedSpends: 0,
  retainerDetails: '',
  expectedGoLiveDate: '',
  pitchDate: '',
  teamAssigned: '',
};

export function LeadDialog({ isOpen, onOpenChange, onSave, lead }: LeadDialogProps) {
  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: emptyDefaults,
  });

  useEffect(() => {
    if (isOpen) {
      if (lead) {
        form.reset({
          companyName: lead.companyName || '',
          phone: lead.phone || '',
          status: lead.status,
          services: lead.services || [],
          estimatedValue: lead.estimatedValue || 0,
          notes: lead.notes || '',
          opportunityOwner: lead.opportunityOwner || '',
          expectedSpends: lead.expectedSpends || 0,
          retainerDetails: lead.retainerDetails || '',
          expectedGoLiveDate: lead.expectedGoLiveDate || '',
          pitchDate: lead.pitchDate || '',
          teamAssigned: lead.teamAssigned || '',
        });
      } else {
        form.reset(emptyDefaults);
      }
    }
  }, [isOpen, lead, form]);

  const onSubmit = async (data: LeadFormValues) => {
    await onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-3xl font-black uppercase tracking-tighter">
            {lead ? 'Edit Lead' : 'Register New Lead'}
          </DialogTitle>
          <DialogDescription className="text-foreground/60 font-bold uppercase text-[10px] tracking-widest">
            {lead ? 'Update acquisition details for active prospect.' : 'Initiate discovery process for potential partner.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8 rounded-none bg-foreground/[0.03] border border-foreground/5">
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Entity Name</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Sales Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-black"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="rounded-none glass ">
                        {statusOptions.map(opt => <SelectItem key={opt} value={opt} className="font-bold">{opt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="opportunityOwner" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Opportunity Owner</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="teamAssigned" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Team Assigned</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="estimatedValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Estimated Value (INR)</FormLabel>
                    <FormControl><Input type="number" className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-mono font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="expectedSpends" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Expected Spends (INR)</FormLabel>
                    <FormControl><Input type="number" className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-mono font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pitchDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Pitch Date</FormLabel>
                    <FormControl><Input type="date" className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="expectedGoLiveDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Expected Go Live Date</FormLabel>
                    <FormControl><Input type="date" className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Phone Number</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="retainerDetails" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Retainer Details</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
            </div>

            <div className="space-y-4">
                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60 px-2">Service Portfolio Selection</FormLabel>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {serviceOptions.map((service) => (
                    <FormField
                      key={service}
                      control={form.control}
                      name="services"
                      render={({ field }) => {
                        return (
                          <FormItem
                            key={service}
                            className="flex flex-row items-center space-x-3 space-y-0 rounded-none bg-foreground/[0.03] p-3 border border-transparent hover:border-primary/20 transition-all cursor-pointer"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(service)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...field.value, service])
                                    : field.onChange(
                                        field.value?.filter(
                                          (value) => value !== service
                                        )
                                      )
                                }}
                              />
                            </FormControl>
                            <FormLabel className="text-[10px] font-black uppercase cursor-pointer">
                              {service}
                            </FormLabel>
                          </FormItem>
                        )
                      }}
                    />
                  ))}
                </div>
                <FormMessage />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Strategic Intelligence Notes</FormLabel>
                <FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none min-h-[120px] shadow-inner p-6 text-sm font-medium leading-relaxed resize-none" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter className="pt-6 border-t border-foreground/5">
                <Button type="button" variant="ghost" className="rounded-none h-12 px-6 font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="rounded-none h-12 px-10 font-black shadow-primary/20 uppercase tracking-widest text-[10px]">
                  Save Lead
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
