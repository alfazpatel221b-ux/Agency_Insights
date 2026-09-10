'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  PlusCircle,
  Search,
  MoreHorizontal,
  Trash,
  Loader2,
  Briefcase,
  User,
  Tag,
  AlertTriangle,
  Clock,
  ArrowRight,
  GripVertical,
  MessageSquareText,
} from 'lucide-react';
import { format, parseISO, isValid, isPast, isToday } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCollection, useFirestore } from '@/firebase';
import { ActionItem, ActionStatus, ActionPriority } from '@/lib/types';
import { deleteActionItem, saveActionItem } from '@/lib/firestore-actions';
import { canonicalizeActionStatus, resolveActionStatus } from '@/lib/normalize';
import { useToast } from '@/hooks/use-toast';
import { PageHeader } from '@/components/page-header';
import { AddActionItemDialog } from './add-action-item-dialog';
import { ActionPulseView } from './action-pulse';
import { cn, openDialogFromMenu } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const KANBAN_COLUMNS: ActionStatus[] = [
  'Work-In Progress',
  'On-Hold',
  'Observation',
  'Overdue',
  'Completed',
];

/** Prefer the column under the pointer (critical for empty Completed drops). */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCorners(args);
};

const columnAccent: Record<ActionStatus, string> = {
  'Work-In Progress': 'border-t-brand',
  'On-Hold': 'border-t-warning',
  Observation: 'border-t-secondary',
  Overdue: 'border-t-destructive',
  Completed: 'border-t-success',
};

const priorityColors: Record<ActionPriority, string> = {
  Low: 'bg-success',
  Medium: 'bg-primary',
  High: 'bg-warning',
  Critical: 'bg-destructive',
};

const priorityRank: Record<ActionPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function sortBoardItems(a: ActionItem, b: ActionItem) {
  const pDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
  if (pDiff !== 0) return pDiff;
  return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
}

function formatDueLabel(dueDate?: string) {
  if (!dueDate) return 'No deadline';
  try {
    const d = parseISO(dueDate);
    if (!isValid(d)) return dueDate;
    return format(d, 'dd MMM yyyy');
  } catch {
    return dueDate;
  }
}

function dueTone(dueDate?: string, status?: ActionStatus) {
  if (!dueDate || status === 'Completed') return 'text-secondary';
  if (status === 'Overdue') return 'text-destructive';
  try {
    const d = parseISO(dueDate);
    if (!isValid(d)) return 'text-secondary';
    if (isPast(d) && !isToday(d)) return 'text-destructive';
    if (isToday(d)) return 'text-warning';
  } catch {
    /* ignore */
  }
  return 'text-secondary';
}

export default function ActionItemsPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { data: actions, loading } = useCollection<ActionItem>('actionItems');

  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'pulse' | 'kanban'>('pulse');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, ActionStatus>>({});
  const overdueSyncRef = useRef<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Persist Overdue when completion/due date has passed (non-completed items).
  useEffect(() => {
    if (!actions?.length) return;

    const stale = actions.filter((item) => {
      const effective = resolveActionStatus(item.status, item.dueDate);
      const stored = canonicalizeActionStatus(item.status);
      return effective === 'Overdue' && stored !== 'Overdue' && !overdueSyncRef.current.has(item.id);
    });

    if (stale.length === 0) return;

    stale.forEach((item) => overdueSyncRef.current.add(item.id));

    (async () => {
      for (const item of stale) {
        try {
          await saveActionItem(firestore, { ...item, status: 'Overdue' }, item.id);
        } catch (error) {
          overdueSyncRef.current.delete(item.id);
          console.error('Failed to auto-mark overdue', item.id, error);
        }
      }
    })();
  }, [actions, firestore]);

  const filteredActions = useMemo(() => {
    if (!actions) return [];
    return actions
      .filter((a) => {
        const q = search.toLowerCase();
        const matchesSearch =
          (a.taskName || '').toLowerCase().includes(q) ||
          (a.assignedTo || '').toLowerCase().includes(q) ||
          (a.clientName || '').toLowerCase().includes(q);
        const matchesSection = sectionFilter === 'all' || a.section === sectionFilter;
        return matchesSearch && matchesSection;
      })
      .map((a) => {
        const effective = optimisticStatus[a.id]
          ? optimisticStatus[a.id]
          : resolveActionStatus(a.status, a.dueDate);
        return { ...a, status: effective };
      });
  }, [actions, search, sectionFilter, optimisticStatus]);

  const columns = useMemo(() => {
    const map: Record<ActionStatus, ActionItem[]> = {
      'Work-In Progress': [],
      'On-Hold': [],
      Observation: [],
      Overdue: [],
      Completed: [],
    };
    filteredActions.forEach((item) => {
      const status = KANBAN_COLUMNS.includes(item.status) ? item.status : 'Work-In Progress';
      map[status].push(item);
    });
    KANBAN_COLUMNS.forEach((status) => map[status].sort(sortBoardItems));
    return map;
  }, [filteredActions]);

  const activeItem = useMemo(
    () => filteredActions.find((a) => a.id === activeId) || null,
    [filteredActions, activeId]
  );

  const findStatusForId = (id: string): ActionStatus | null => {
    if (KANBAN_COLUMNS.includes(id as ActionStatus)) return id as ActionStatus;
    const item = filteredActions.find((a) => a.id === id);
    return item?.status && KANBAN_COLUMNS.includes(item.status) ? item.status : null;
  };

  const moveItem = async (itemId: string, nextStatus: ActionStatus) => {
    const item = (actions || []).find((a) => a.id === itemId);
    if (!item) return;

    let statusToSave = nextStatus;
    // Leaving Overdue while still past due snaps back unless marked Completed,
    // Observation (open-ended), or On-Hold.
    if (
      nextStatus !== 'Completed' &&
      nextStatus !== 'On-Hold' &&
      nextStatus !== 'Observation' &&
      resolveActionStatus(nextStatus, item.dueDate) === 'Overdue'
    ) {
      statusToSave = 'Overdue';
    }

    // Compare to persisted Firestore status — dragOver may already have set optimistic
    // to nextStatus, which previously caused an early return and skipped the save
    // (card looked Completed, then vanished on refresh / optimistic clear).
    const persisted = canonicalizeActionStatus(item.status);
    if (persisted === statusToSave) {
      setOptimisticStatus((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
      return;
    }

    setOptimisticStatus((prev) => ({ ...prev, [itemId]: statusToSave }));
    try {
      await saveActionItem(firestore, { ...item, status: statusToSave }, item.id);
      overdueSyncRef.current.delete(itemId);
      toast({
        title: 'Status updated',
        description:
          statusToSave === nextStatus
            ? `${item.taskName} → ${statusToSave}`
            : `${item.taskName} is past due → Overdue`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not update status',
        description: error.message,
      });
    } finally {
      setOptimisticStatus((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeStatus = findStatusForId(String(active.id));
    const overStatus = findStatusForId(String(over.id));
    if (!activeStatus || !overStatus || activeStatus === overStatus) return;
    setOptimisticStatus((prev) => ({ ...prev, [String(active.id)]: overStatus }));
  };

  const clearOptimisticFor = (itemId: string) => {
    setOptimisticStatus((prev) => {
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const itemId = String(active.id);
    setActiveId(null);

    // Prefer drop target; if empty-column collision misses, use last dragOver column
    let nextStatus = over ? findStatusForId(String(over.id)) : null;
    if (!nextStatus) {
      nextStatus = optimisticStatus[itemId] || null;
    }

    if (!nextStatus) {
      clearOptimisticFor(itemId);
      return;
    }

    await moveItem(itemId, nextStatus);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOptimisticStatus({});
  };

  return (
    <div className="flex flex-1 flex-col gap-6 animate-in fade-in duration-700 min-w-0">
      <PageHeader
        title="ACTION ITEMS"
        description={
          viewMode === 'pulse'
            ? 'Action Pulse — runway, owner load, and focus queue for WoW deliverables.'
            : 'Kanban — drag cards across status columns. Past-due tasks move to Overdue automatically (except Observation).'
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 border border-ink/15 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('pulse')}
              className={cn(
                'px-4 text-[10px] font-black uppercase tracking-widest transition-colors',
                viewMode === 'pulse' ? 'bg-brand text-white' : 'text-secondary hover:text-foreground'
              )}
            >
              Pulse
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={cn(
                'px-4 text-[10px] font-black uppercase tracking-widest transition-colors',
                viewMode === 'kanban' ? 'bg-brand text-white' : 'text-secondary hover:text-foreground'
              )}
            >
              Kanban
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tasks, owners..."
              className="pl-9 w-[220px] rounded-none glass h-10 text-xs shadow-lg"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 bg-foreground/5 rounded-none p-1 px-4 border border-foreground/10 h-10">
            <Tag className="h-3 w-3 text-secondary" />
            <select
              className="bg-transparent border-none text-[10px] font-black uppercase outline-none focus:ring-0 cursor-pointer"
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
            >
              <option value="all">All Sections</option>
              {['CLIENT ENGAGEMENT', 'SALES', 'OPERATIONS', 'AGENCY INSIGHTS', 'HR', 'MANAGEMENT'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <Button
            size="sm"
            className="h-10 rounded-none gap-2 shadow-primary/20 font-bold px-6"
            onClick={() => {
              setSelectedAction(null);
              setIsDialogOpen(true);
            }}
          >
            <PlusCircle className="h-4 w-4" />
            NEW ACTION
          </Button>
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-32">
          <Loader2 className="animate-spin h-10 w-10 text-primary/40" />
        </div>
      ) : viewMode === 'pulse' ? (
        <ActionPulseView
          items={filteredActions}
          onOpen={(action) => {
            setSelectedAction(action);
            setIsDialogOpen(true);
          }}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-4 min-h-[70vh] pb-4 pr-2">
              {KANBAN_COLUMNS.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  items={columns[status]}
                  onEdit={(action) => {
                    setSelectedAction(action);
                    setIsDialogOpen(true);
                  }}
                  onDelete={(id) => setDeletingId(id)}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          <DragOverlay>
            {activeItem ? <ActionCard item={activeItem} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <AddActionItemDialog
        isOpen={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setSelectedAction(null);
        }}
        action={selectedAction}
      />

      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent className="rounded-none glass">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 text-destructive mb-2">
              <AlertTriangle className="h-8 w-8" />
              <AlertDialogTitle className="font-headline text-3xl font-black uppercase tracking-tighter">
                Delete Action Item?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-foreground/70 font-bold uppercase text-[10px] tracking-widest leading-relaxed">
              This will permanently delete the task and its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-8">
            <AlertDialogCancel className="rounded-none h-12 px-6 font-bold uppercase text-[10px] tracking-widest">
              CANCEL
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 rounded-none h-12 px-8 font-black uppercase text-[10px] tracking-widest"
              onClick={async () => {
                if (deletingId) {
                  await deleteActionItem(firestore, deletingId);
                  toast({ title: 'Task deleted' });
                  setDeletingId(null);
                }
              }}
            >
              CONFIRM DELETE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KanbanColumn({
  status,
  items,
  onEdit,
  onDelete,
}: {
  status: ActionStatus;
  items: ActionItem[];
  onEdit: (action: ActionItem) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  });

  return (
    <div
      className={cn(
        'w-[300px] xl:w-[320px] shrink-0 flex flex-col bg-foreground/[0.02] border border-ink/10 border-t-4',
        columnAccent[status],
        isOver && 'bg-brand/[0.04] border-brand/30'
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-ink/10">
        <h3 className="text-[11px] font-black uppercase tracking-[0.12em] truncate">{status}</h3>
        <Badge variant="outline" className="rounded-none text-[10px] font-black h-6 px-2 border-ink/15">
          {items.length}
        </Badge>
      </div>

      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 p-3 space-y-3 min-h-[240px]">
          {items.length === 0 ? (
            <div className="h-28 border border-dashed border-ink/15 flex items-center justify-center px-4 pointer-events-none">
              <p className="text-[9px] font-black uppercase tracking-widest text-secondary/50 text-center">
                Drop tasks here
              </p>
            </div>
          ) : (
            items.map((item) => (
              <SortableActionCard
                key={item.id}
                item={item}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableActionCard({
  item,
  onEdit,
  onDelete,
}: {
  item: ActionItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { status: item.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-40')}>
      <ActionCard
        item={item}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function ActionCard({
  item,
  onEdit,
  onDelete,
  dragHandleProps,
  overlay,
}: {
  item: ActionItem;
  onEdit?: () => void;
  onDelete?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  overlay?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-white border border-ink/15 p-4 space-y-3 text-left whitespace-normal',
        overlay && 'shadow-xl border-brand/40 rotate-1 scale-[1.02]',
        item.status === 'Overdue' && 'border-destructive/30'
      )}
    >
      <div className="flex items-start gap-2">
        {!overlay && (
          <button
            type="button"
            className="mt-0.5 h-6 w-6 flex items-center justify-center text-secondary/50 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
            aria-label="Drag task"
            {...dragHandleProps}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={onEdit}
          disabled={!onEdit}
        >
          <p className="text-sm font-black text-foreground leading-snug line-clamp-2">{item.taskName}</p>
        </button>
        {!overlay && onEdit && onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none shrink-0">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-none glass p-2 min-w-[150px]">
              <DropdownMenuItem
                className="rounded-none text-[10px] font-black uppercase tracking-widest gap-2"
                onSelect={openDialogFromMenu(onEdit)}
              >
                <ArrowRight className="h-3 w-3" /> Edit Task
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-none text-[10px] font-black uppercase tracking-widest text-destructive gap-2 focus:bg-destructive/10 focus:text-destructive"
                onSelect={openDialogFromMenu(onDelete)}
              >
                <Trash className="h-3 w-3" /> Delete Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <Briefcase className="h-3 w-3 opacity-40 shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-widest text-secondary truncate">
          {item.clientName || 'Global / Agency Insights'}
        </span>
      </div>

      {(() => {
        const history = item.commentHistory || [];
        const latest =
          history.length > 0
            ? [...history].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              )[0]
            : item.comment
              ? {
                  text: item.comment,
                  createdAt: item.updatedAt || item.createdAt,
                }
              : null;
        if (!latest?.text) return null;
        let dateLabel = '';
        try {
          const d = parseISO(latest.createdAt);
          if (isValid(d)) dateLabel = format(d, 'dd MMM yyyy');
        } catch {
          /* ignore */
        }
        const count = history.length > 0 ? history.length : item.comment ? 1 : 0;
        return (
          <div className="rounded-none border border-ink/10 bg-foreground/[0.02] px-2.5 py-2 space-y-1">
            <div className="flex items-center gap-1.5 text-secondary">
              <MessageSquareText className="h-3 w-3 shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-widest">
                {dateLabel || 'Comment'}
              </span>
              {count > 1 && (
                <span className="ml-auto text-[9px] font-mono font-bold">{count} notes</span>
              )}
            </div>
            <p className="text-[11px] font-medium leading-snug text-foreground/80 line-clamp-2">
              {latest.text}
            </p>
          </div>
        );
      })()}

      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className="rounded-none text-[8px] font-black h-5 px-1.5 border-ink/10 uppercase truncate max-w-[60%]"
          title={item.section}
        >
          {item.section}
        </Badge>
        <div
          className={cn('h-3 w-3 shrink-0', priorityColors[item.priority] || 'bg-secondary')}
          title={`Priority: ${item.priority}`}
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-ink/5">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="h-3 w-3 text-secondary shrink-0" />
          <span className="text-[10px] font-bold truncate">{item.assignedTo || 'Unassigned'}</span>
        </div>
        <div className={cn('flex items-center gap-1 shrink-0', dueTone(item.dueDate, item.status))}>
          <Clock className="h-3 w-3" />
          <span className="text-[9px] font-black uppercase tracking-wide">{formatDueLabel(item.dueDate)}</span>
        </div>
      </div>
    </div>
  );
}
