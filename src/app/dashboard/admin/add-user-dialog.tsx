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
  FormDescription
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useEffect, useState } from 'react';

const inviteSchema = z.object({
  displayName: z.string().min(1, 'Full name is required'),
  email: z.string().email('Please enter a valid official email address'),
  role: z.enum(['Admin', 'Cluster Lead', 'EM/CSM', 'Client Partner']),
  permissions: z.array(z.string()).min(1, 'Select at least one page permission'),
});

export type UserFormValues = z.infer<typeof inviteSchema>;

interface AddUserDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: UserFormValues) => Promise<void>;
}

const userRoles = ['Admin', 'Cluster Lead', 'EM/CSM', 'Client Partner'];

const pageOptions = [
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'sales', label: 'Sales Tracker' },
  { id: 'tracker', label: 'KPI Tracker' },
  { id: 'spends', label: 'Spends Update' },
  { id: 'dashboard', label: 'Spends Dashboard' },
  { id: 'forecast', label: 'Spends Forecast' },
  { id: 'wbr', label: 'Weekly Review' },
  { id: 'actions', label: 'Action Items' },
  { id: 'admin', label: 'Administration' },
];

export function AddUserDialog({ isOpen, onOpenChange, onSave }: AddUserDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  
  const form = useForm<UserFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      displayName: '',
      email: '',
      role: 'Client Partner',
      permissions: ['snapshot', 'wbr', 'actions'],
    }
  });

  useEffect(() => {
    if (isOpen) {
        form.reset();
        setIsSaving(false);
    }
  }, [form, isOpen]);

  const onSubmit = async (data: UserFormValues) => {
    setIsSaving(true);
    try {
      await onSave(data);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">Invite New User</DialogTitle>
          <DialogDescription>
            Configure user profile and system access rights.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Full Name</FormLabel>
                   <FormControl>
                      <Input className="rounded-none bg-foreground/5 border-none" placeholder="e.g. John Doe" {...field} disabled={isSaving} />
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Official Email ID</FormLabel>
                   <FormControl>
                      <Input 
                        className="rounded-none bg-foreground/5 border-none" 
                        type="email" 
                        placeholder="john.doe@example.com" 
                        {...field} 
                        disabled={isSaving} 
                      />
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Initial Role</FormLabel>
                   <Select onValueChange={field.onChange} value={field.value} disabled={isSaving}>
                    <FormControl>
                      <SelectTrigger className="rounded-none bg-foreground/5 border-none">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="rounded-none glass ">
                      {userRoles.map(role => (
                        <SelectItem key={role} value={role}>{role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="permissions"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Module Access</FormLabel>
                    <FormDescription className="text-[10px]">
                      Select all pages this user should be authorized to view.
                    </FormDescription>
                  </div>
                  <div className="space-y-2">
                    {pageOptions.map((item) => (
                      <FormField
                        key={item.id}
                        control={form.control}
                        name="permissions"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={item.id}
                              className="flex flex-row items-start space-x-3 space-y-0 rounded-none bg-foreground/5 p-3"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, item.id])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== item.id
                                          )
                                        )
                                  }}
                                  disabled={isSaving}
                                />
                              </FormControl>
                              <FormLabel className="text-xs font-bold cursor-pointer">
                                {item.label}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter className="pt-6">
                <Button type="button" variant="ghost" className="rounded-none" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
                <Button type="submit" className="rounded-none font-bold px-6" disabled={isSaving}>
                  {isSaving ? 'Sending Invite...' : 'Send Invite'}
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
