
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
import { ActionItem, ActionSection, ActionStatus, ActionPriority, Client, KpiData, ActionCommentEntry, UserProfile } from '@/lib/types';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useFirestore, useCollection } from '@/firebase';
import { AssigneePicker } from '@/components/assignee-picker';
import { buildAssigneeOptions, extraAssigneeNamesFromActions } from '@/lib/assignee-options';
import {
  saveActionItem,
  buildActionCommentHistory,
  deleteActionComment,
  normalizeActionCommentHistory,
} from '@/lib/firestore-actions';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MessageSquareText, Trash2 } from 'lucide-react';
import { resolveActionStatus } from '@/lib/normalize';
import { format, parseISO, isValid } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, releaseRadixPointerLock } from '@/lib/utils';

const actionSchema = z.object({
  taskName: z.string().min(1, 'Task name is required'),
  description: z.string().optional(),
  assignedTo: z.string().min(1, 'Assignee is required'),
  section: z.enum(["CLIENT ENGAGEMENT", "SALES", "OPERATIONS", "AGENCY INSIGHTS", "HR", "MANAGEMENT"]),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  comment: z.string().optional(),
  status: z.enum(["Work-In Progress", "Completed", "Overdue", "On-Hold", "Observation"]),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  dueDate: z.string().optional(),
});

type ActionFormValues = z.infer<typeof actionSchema>;

interface AddActionItemDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  clientName?: string;
  action?: ActionItem | null;
}

const sections: ActionSection[] = ["CLIENT ENGAGEMENT", "SALES", "OPERATIONS", "AGENCY INSIGHTS", "HR", "MANAGEMENT"];
const statuses: ActionStatus[] = ["Work-In Progress", "On-Hold", "Observation", "Overdue", "Completed"];
const priorities: ActionPriority[] = ["Low", "Medium", "High", "Critical"];

function formatCommentDate(iso: string): string {
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return iso;
    return format(d, 'dd MMM yyyy · HH:mm');
  } catch {
    return iso;
  }
}

/** Resolve display history: stored history, or legacy single comment. */
function resolveCommentHistory(action?: ActionItem | null): ActionCommentEntry[] {
  if (!action) return [];
  const history = action.commentHistory || [];
  if (history.length > 0) {
    return [...history].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  const legacy = (action.comment || '').trim();
  if (!legacy) return [];
  return [
    {
      id: `legacy-${action.id}`,
      text: legacy,
      createdAt: action.updatedAt || action.createdAt || new Date().toISOString(),
    },
  ];
}

export function AddActionItemDialog({ isOpen, onOpenChange, clientId, clientName, action }: AddActionItemDialogProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [localHistory, setLocalHistory] = useState<ActionCommentEntry[]>([]);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [isDeletingComment, setIsDeletingComment] = useState(false);
  
  const { data: explicitClients } = useCollection<Client>('clients');
  const { data: kpiRecords } = useCollection<KpiData>('kpis');
  const { data: registryUsers, loading: usersLoading } = useCollection<UserProfile>('users');
  const { data: existingActions } = useCollection<ActionItem>('actionItems');

  const assigneeOptions = useMemo(
    () =>
      buildAssigneeOptions(registryUsers, [
        ...extraAssigneeNamesFromActions(existingActions),
        action?.assignedTo,
      ]),
    [registryUsers, existingActions, action?.assignedTo]
  );

  const discoveredClients = useMemo(() => {
    const uniqueList: { uniqueId: string, name: string }[] = [];
    const seenIds = new Set<string>();
    
    if (explicitClients) {
      explicitClients.forEach(c => {
        if (c.uniqueId && !seenIds.has(c.uniqueId)) {
          uniqueList.push({ uniqueId: c.uniqueId, name: c.name });
          seenIds.add(c.uniqueId);
        }
      });
    }
    
    if (kpiRecords) {
      kpiRecords.forEach(k => {
        if (k.clientId && !seenIds.has(k.clientId)) {
          uniqueList.push({ uniqueId: k.clientId, name: k.clientName });
          seenIds.add(k.clientId);
        }
      });
    }
    return uniqueList.sort((a, b) => a.name.localeCompare(b.name));
  }, [explicitClients, kpiRecords]);

  const pastComments = useMemo(
    () =>
      [...localHistory].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [localHistory]
  );

  const form = useForm<ActionFormValues>({
    resolver: zodResolver(actionSchema),
    defaultValues: {
      taskName: '',
      description: '',
      assignedTo: '',
      section: 'OPERATIONS',
      clientId: clientId || '',
      clientName: clientName || '',
      comment: '',
      status: 'Work-In Progress',
      priority: 'Medium',
      dueDate: '',
    }
  });

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setIsSaving(false);
      setDeletingCommentId(null);
      setIsDeletingComment(false);
      releaseRadixPointerLock();
    }
    onOpenChange(open);
  }, [onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    if (action) {
      setLocalHistory(resolveCommentHistory(action));
      form.reset({
        taskName: action.taskName,
        description: action.description || '',
        assignedTo: action.assignedTo,
        section: action.section,
        clientId: action.clientId || '',
        clientName: action.clientName || '',
        // Leave empty so edits add a new dated comment instead of rewriting history
        comment: '',
        status: resolveActionStatus(action.status, action.dueDate),
        priority: action.priority,
        dueDate: action.dueDate || '',
      });
    } else {
      setLocalHistory([]);
      form.reset({
        taskName: '',
        description: '',
        assignedTo: '',
        section: 'OPERATIONS',
        clientId: clientId || '',
        clientName: clientName || '',
        comment: '',
        status: 'Work-In Progress',
        priority: 'Medium',
        dueDate: '',
      });
    }
  }, [isOpen, action?.id, clientId, clientName, form]);

  // Keep local history in sync when Firestore refreshes the open action
  useEffect(() => {
    if (!isOpen || !action) return;
    setLocalHistory(resolveCommentHistory(action));
  }, [isOpen, action?.commentHistory, action?.comment, action?.updatedAt]);

  const cancelDeleteComment = useCallback(() => {
    if (isDeletingComment) return;
    setDeletingCommentId(null);
    releaseRadixPointerLock();
  }, [isDeletingComment]);

  const confirmDeleteComment = async () => {
    if (!action || !deletingCommentId) return;
    setIsDeletingComment(true);
    try {
      const base: ActionItem = {
        ...action,
        commentHistory: normalizeActionCommentHistory({
          ...action,
          commentHistory: [...localHistory].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          ),
        }),
      };
      const { commentHistory } = await deleteActionComment(
        firestore,
        base,
        deletingCommentId
      );
      setLocalHistory(
        [...commentHistory].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
      toast({ title: 'Comment deleted' });
      setDeletingCommentId(null);
      releaseRadixPointerLock();
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: e.message,
      });
    } finally {
      setIsDeletingComment(false);
    }
  };

  const onSubmit = async (data: ActionFormValues) => {
    setIsSaving(true);
    try {
      let finalClientName = data.clientName;
      if (data.clientId && !data.clientName) {
          const found = discoveredClients?.find(c => c.uniqueId === data.clientId);
          if (found) finalClientName = found.name;
      }

      const status = resolveActionStatus(data.status, data.dueDate);
      const chronologicalHistory = [...localHistory].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const existingForHistory = action
        ? {
            ...action,
            commentHistory: chronologicalHistory,
            comment: chronologicalHistory[chronologicalHistory.length - 1]?.text || '',
          }
        : action;
      const { comment, commentHistory } = buildActionCommentHistory(
        existingForHistory,
        data.comment
      );

      await saveActionItem(
        firestore,
        {
          ...data,
          status,
          clientName: finalClientName,
          comment,
          commentHistory,
          createdAt: action?.createdAt,
        },
        action?.id
      );
      toast({ title: action ? "Task updated" : "Task created" });
      handleOpenChange(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Save failed", description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-none glass">
        <DialogHeader>
          <DialogTitle className="font-headline text-3xl font-black uppercase tracking-tighter">
            {action ? 'Update Action Item' : 'New Action Item'}
          </DialogTitle>
          <DialogDescription className="text-foreground/60 font-bold uppercase text-[10px] tracking-widest">
            Define deliverables and assign accountability for the WBR WoW cycle.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8 rounded-none bg-foreground/[0.03] border border-foreground/5">
                <FormField control={form.control} name="taskName" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Task Name</FormLabel>
                    <FormControl><Input className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold" placeholder="Define clear deliverable..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="assignedTo" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Assigned To</FormLabel>
                    <FormControl>
                      <AssigneePicker
                        options={assigneeOptions}
                        value={field.value}
                        onChange={field.onChange}
                        loading={usersLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="section" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Section / Domain</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-black"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="rounded-none glass ">
                        {sections.map(s => <SelectItem key={s} value={s} className="font-bold text-[10px]">{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={form.control} name="clientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Client Context (Optional)</FormLabel>
                    <Select 
                      onValueChange={(val) => {
                        const actualVal = val === "none" ? "" : val;
                        field.onChange(actualVal);
                        if (actualVal) {
                          const c = discoveredClients?.find(x => x.uniqueId === actualVal);
                          if (c) form.setValue('clientName', c.name);
                        } else {
                          form.setValue('clientName', '');
                        }
                      }} 
                      value={field.value || "none"}
                    >
                      <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold"><SelectValue placeholder="No Client" /></SelectTrigger></FormControl>
                      <SelectContent className="rounded-none glass ">
                        <SelectItem value="none" className="font-bold text-[10px]">GLOBAL / NO CLIENT</SelectItem>
                        {discoveredClients?.map(c => <SelectItem key={c.uniqueId} value={c.uniqueId} className="font-bold text-[10px]">{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Due Date</FormLabel>
                    <FormControl><Input type="date" className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-mono font-bold" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-black"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="rounded-none glass ">
                        {statuses.map(s => <SelectItem key={s} value={s} className="font-bold text-[10px]">{s.toUpperCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60">Criticality</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-black"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="rounded-none glass ">
                        {priorities.map(p => <SelectItem key={p} value={p} className="font-bold text-[10px]">{p.toUpperCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
            </div>

            <div className="space-y-4">
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60 px-2">Task Details</FormLabel>
                  <FormControl><Textarea className="rounded-none bg-foreground/[0.03] border-none min-h-[100px] shadow-inner p-6 text-sm font-medium leading-relaxed resize-none" placeholder="Deep dive context..." {...field} /></FormControl>
                </FormItem>
              )} />

              <FormField control={form.control} name="comment" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[10px] font-black uppercase tracking-widest opacity-60 px-2">
                    {action ? 'Add New Comment' : 'Comments / Intelligence'}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      className="rounded-none bg-foreground/[0.03] border-none min-h-[100px] shadow-inner p-6 text-sm font-medium leading-relaxed resize-none"
                      placeholder={action ? 'Write a new update… (saved with today’s date)' : 'Latest update...'}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )} />

              {action && (
                <div className="rounded-none border border-foreground/10 bg-foreground/[0.02]">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/5">
                    <MessageSquareText className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-secondary">
                      Comment History
                    </span>
                    <span className="ml-auto text-[10px] font-mono font-bold text-secondary">
                      {pastComments.length}
                    </span>
                  </div>
                  {pastComments.length === 0 ? (
                    <p className="px-4 py-6 text-xs text-secondary italic">No past comments yet.</p>
                  ) : (
                    <ScrollArea className="max-h-[220px]">
                      <ul className="divide-y divide-foreground/5">
                        {pastComments.map((entry, idx) => {
                          const isConfirming = deletingCommentId === entry.id;
                          return (
                          <li
                            key={entry.id}
                            className={cn(
                              'px-4 py-3 space-y-1.5 group',
                              idx === 0 && 'bg-primary/[0.03]',
                              isConfirming && 'bg-destructive/5 ring-1 ring-inset ring-destructive/30'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-primary font-mono">
                                {formatCommentDate(entry.createdAt)}
                              </span>
                              <div className="flex items-center gap-2">
                                {idx === 0 && !isConfirming && (
                                  <span className="text-[9px] font-black uppercase tracking-widest text-secondary">
                                    Latest
                                  </span>
                                )}
                                {!isConfirming ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-none text-secondary hover:text-destructive hover:bg-destructive/10 opacity-70 group-hover:opacity-100"
                                    aria-label="Delete comment"
                                    title="Delete comment"
                                    onClick={() => setDeletingCommentId(entry.id)}
                                    disabled={isDeletingComment || isSaving || !!deletingCommentId}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap text-foreground/90 pr-8">
                              {entry.text}
                            </p>
                            {isConfirming ? (
                              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-destructive/20">
                                <p className="text-[10px] font-black uppercase tracking-widest text-destructive">
                                  Delete this comment permanently?
                                </p>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-9 rounded-none px-4 font-bold uppercase text-[10px] tracking-widest"
                                    onClick={cancelDeleteComment}
                                    disabled={isDeletingComment}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    className="h-9 rounded-none px-4 font-black uppercase text-[10px] tracking-widest"
                                    onClick={() => void confirmDeleteComment()}
                                    disabled={isDeletingComment}
                                  >
                                    {isDeletingComment ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                                    ) : null}
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </li>
                          );
                        })}
                      </ul>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="pt-6 border-t border-foreground/5">
                <Button type="button" variant="ghost" className="rounded-none h-12 px-6 font-bold" onClick={() => handleOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="rounded-none h-12 px-10 font-black shadow-primary/20 uppercase tracking-widest text-[10px]" disabled={isSaving || isDeletingComment}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Task
                </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

