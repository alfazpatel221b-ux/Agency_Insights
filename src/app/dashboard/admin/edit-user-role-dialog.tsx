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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { UserProfile } from '@/lib/types';
import { useEffect } from 'react';

const roleSchema = z.object({
  role: z.enum(['Admin', 'Cluster Lead', 'EM/CSM', 'Client Partner']),
  permissions: z.array(z.string()).min(1, 'Select at least one page permission'),
});

export type UserSettingsFormValues = z.infer<typeof roleSchema>;

interface EditUserRoleDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: UserSettingsFormValues, userId: string) => void;
  user?: UserProfile;
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

export function EditUserRoleDialog({ isOpen, onOpenChange, onSave, user }: EditUserRoleDialogProps) {
  const form = useForm<UserSettingsFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      role: 'Client Partner',
      permissions: ['snapshot', 'wbr', 'actions'],
    }
  });

  useEffect(() => {
    if (isOpen && user) {
        form.reset({
            role: user.role as any,
            permissions: user.permissions || ['snapshot', 'wbr', 'actions'],
        });
    }
  }, [user, form, isOpen]);

  const onSubmit = (data: UserSettingsFormValues) => {
    if (user) {
      onSave(data, user.id);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">Manage Access</DialogTitle>
          <DialogDescription>
            Configure role and page visibility for {user?.displayName || user?.email}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">System Role</FormLabel>
                   <Select onValueChange={field.onChange} value={field.value}>
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
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Page Visibility</FormLabel>
                    <FormDescription className="text-[10px]">
                      Select exactly which pages this user can view.
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
            
            <DialogFooter className="pt-4">
                <Button type="button" variant="ghost" className="rounded-none" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="rounded-none font-bold px-6">Save Changes</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
