'use client';

import React, { useMemo, useState } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  format,
  isToday,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';
import { ArrowUpRight, Warning, Lightning, UsersThree, CalendarBlank, X } from '@phosphor-icons/react';
import { ActionItem, ActionPriority, ActionStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

type PulseStatKey = 'open' | 'overdue' | 'today' | 'week' | 'critical' | 'completed';

const priorityRank: Record<ActionPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const statusInk: Record<ActionStatus, string> = {
  'Work-In Progress': 'bg-brand',
  'On-Hold': 'bg-warning',
  Observation: 'bg-secondary',
  Overdue: 'bg-destructive',
  Completed: 'bg-success',
};

const STAT_FOCUS_COPY: Record<PulseStatKey, { title: string; subtitle: string }> = {
  open: { title: 'All open work', subtitle: 'Every active task in the current view.' },
  overdue: { title: 'Past due', subtitle: 'Open tasks that missed their date.' },
  today: { title: 'Must land today', subtitle: 'Open tasks due before end of day.' },
  week: { title: 'Next 7 days', subtitle: 'Open tasks landing this week.' },
  critical: { title: 'Priority pressure', subtitle: 'High and critical open tasks.' },
  completed: { title: 'Closed work', subtitle: 'Completed tasks in the current view.' },
};

function parseDue(dueDate?: string) {
  if (!dueDate) return null;
  try {
    const d = parseISO(dueDate);
    return isValid(d) ? startOfDay(d) : null;
  } catch {
    return null;
  }
}

function formatDue(dueDate?: string) {
  const d = parseDue(dueDate);
  if (!d) return 'No date';
  if (isToday(d)) return 'Today';
  return format(d, 'dd MMM');
}

type PulseBucket = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done';

function bucketFor(item: ActionItem, today: Date): PulseBucket {
  if (item.status === 'Completed') return 'done';
  const due = parseDue(item.dueDate);
  if (!due) return 'undated';
  const delta = differenceInCalendarDays(due, today);
  if (delta < 0 || item.status === 'Overdue') return 'overdue';
  if (delta === 0) return 'today';
  if (delta <= 7) return 'week';
  return 'later';
}

function matchesPulseFilter(item: ActionItem, filter: PulseStatKey, today: Date): boolean {
  if (filter === 'completed') return item.status === 'Completed';
  if (item.status === 'Completed') return false;
  if (filter === 'open') return true;
  if (filter === 'critical') return item.priority === 'Critical' || item.priority === 'High';
  return bucketFor(item, today) === filter;
}

function sortFocusItems(a: ActionItem, b: ActionItem, today: Date) {
  const ba = bucketFor(a, today);
  const bb = bucketFor(b, today);
  const bucketRank = { overdue: 0, today: 1, week: 2, later: 3, undated: 4, done: 5 };
  const br = bucketRank[ba] - bucketRank[bb];
  if (br !== 0) return br;
  const pr = priorityRank[a.priority] - priorityRank[b.priority];
  if (pr !== 0) return pr;
  return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
}

export function ActionPulseView({
  items,
  onOpen,
}: {
  items: ActionItem[];
  onOpen: (item: ActionItem) => void;
}) {
  const today = startOfDay(new Date());
  const [activeStat, setActiveStat] = useState<PulseStatKey | null>(null);

  const openItems = useMemo(
    () => items.filter((i) => i.status !== 'Completed'),
    [items]
  );

  const stats = useMemo(() => {
    const overdue = openItems.filter((i) => bucketFor(i, today) === 'overdue').length;
    const todayCount = openItems.filter((i) => bucketFor(i, today) === 'today').length;
    const week = openItems.filter((i) => bucketFor(i, today) === 'week').length;
    const done = items.filter((i) => i.status === 'Completed').length;
    const critical = openItems.filter((i) => i.priority === 'Critical' || i.priority === 'High').length;
    const total = items.length || 1;
    const completion = Math.round((done / total) * 100);
    return { overdue, todayCount, week, done, critical, open: openItems.length, completion };
  }, [items, openItems, today]);

  const runwayDays = useMemo(() => {
    // Past 3 days → today → next 11 days
    return Array.from({ length: 15 }, (_, i) => addDays(today, i - 3));
  }, [today]);

  const runwayTasks = useMemo(() => {
    const source =
      activeStat && activeStat !== 'completed'
        ? openItems.filter((item) => matchesPulseFilter(item, activeStat, today))
        : openItems;
    return source
      .map((item) => {
        const due = parseDue(item.dueDate);
        if (!due) return null;
        const dayIndex = differenceInCalendarDays(due, runwayDays[0]);
        if (dayIndex < 0 || dayIndex >= runwayDays.length) return null;
        return { item, dayIndex, due };
      })
      .filter(Boolean)
      .sort((a, b) => priorityRank[a!.item.priority] - priorityRank[b!.item.priority]) as Array<{
      item: ActionItem;
      dayIndex: number;
      due: Date;
    }>;
  }, [openItems, runwayDays, activeStat, today]);

  const ownerLoad = useMemo(() => {
    const map = new Map<string, { name: string; open: number; overdue: number; critical: number }>();
    openItems.forEach((item) => {
      const name = (item.assignedTo || 'Unassigned').trim() || 'Unassigned';
      const row = map.get(name) || { name, open: 0, overdue: 0, critical: 0 };
      row.open += 1;
      if (bucketFor(item, today) === 'overdue') row.overdue += 1;
      if (item.priority === 'Critical' || item.priority === 'High') row.critical += 1;
      map.set(name, row);
    });
    return Array.from(map.values())
      .sort((a, b) => b.open - a.open || b.overdue - a.overdue)
      .slice(0, 8);
  }, [openItems, today]);

  const maxOwner = Math.max(...ownerLoad.map((o) => o.open), 1);

  const sectionHeat = useMemo(() => {
    const sections = ['CLIENT ENGAGEMENT', 'SALES', 'OPERATIONS', 'AGENCY INSIGHTS', 'HR', 'MANAGEMENT'];
    return sections.map((section) => {
      const rows = openItems.filter((i) => i.section === section);
      const overdue = rows.filter((i) => bucketFor(i, today) === 'overdue').length;
      return { section, open: rows.length, overdue };
    }).filter((s) => s.open > 0);
  }, [openItems, today]);

  const focusQueue = useMemo(() => {
    const source = activeStat
      ? items.filter((item) => matchesPulseFilter(item, activeStat, today))
      : openItems;
    const sorted = [...source].sort((a, b) => sortFocusItems(a, b, today));
    return activeStat ? sorted : sorted.slice(0, 12);
  }, [items, openItems, today, activeStat]);

  const focusCopy = activeStat
    ? STAT_FOCUS_COPY[activeStat]
    : {
        title: 'What needs attention',
        subtitle: 'Sorted by urgency, then priority. Click any row to edit.',
      };

  const toggleStat = (key: PulseStatKey) => {
    setActiveStat((prev) => (prev === key ? null : key));
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Signal strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-ink border border-ink overflow-hidden">
        <PulseStat
          label="Open"
          value={stats.open}
          hint="Active tasks"
          active={activeStat === 'open'}
          onClick={() => toggleStat('open')}
        />
        <PulseStat
          label="Overdue"
          value={stats.overdue}
          hint="Past due"
          tone="destructive"
          active={activeStat === 'overdue'}
          onClick={() => toggleStat('overdue')}
        />
        <PulseStat
          label="Due today"
          value={stats.todayCount}
          hint="Must land today"
          tone="warning"
          active={activeStat === 'today'}
          onClick={() => toggleStat('today')}
        />
        <PulseStat
          label="This week"
          value={stats.week}
          hint="Next 7 days"
          active={activeStat === 'week'}
          onClick={() => toggleStat('week')}
        />
        <PulseStat
          label="High / critical"
          value={stats.critical}
          hint="Priority pressure"
          tone="brand"
          active={activeStat === 'critical'}
          onClick={() => toggleStat('critical')}
        />
        <PulseStat
          label="Completed"
          value={`${stats.completion}%`}
          hint={`${stats.done} closed`}
          tone="success"
          active={activeStat === 'completed'}
          onClick={() => toggleStat('completed')}
        />
      </div>

      {/* Due runway */}
      <section className="bg-white border border-ink overflow-hidden">
        <div className="px-6 md:px-8 py-6 border-b border-ink/10 flex flex-wrap items-end justify-between gap-4 bg-[linear-gradient(135deg,hsl(var(--cream))_0%,#fff_55%)]">
          <div className="space-y-1">
            <p className="terminal-overline flex items-center gap-2">
              <CalendarBlank className="h-3.5 w-3.5" weight="bold" />
              Due runway
            </p>
            <h3 className="text-2xl md:text-3xl font-black tracking-tighter uppercase">
              Where work lands in time
            </h3>
            <p className="text-[11px] text-secondary max-w-xl">
              {activeStat && activeStat !== 'completed'
                ? `Showing ${STAT_FOCUS_COPY[activeStat].title.toLowerCase()} on the runway.`
                : 'Open tasks plotted by completion date — past due sits left of today; the next two weeks stretch right.'}
            </p>
          </div>
          <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-secondary">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-destructive" /> Overdue</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-brand" /> On track</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-warning" /> On hold</span>
          </div>
        </div>

        <div className="p-4 md:p-6 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid gap-px bg-ink/10" style={{ gridTemplateColumns: `repeat(${runwayDays.length}, minmax(0, 1fr))` }}>
              {runwayDays.map((day) => {
                const isNow = isToday(day);
                const past = day < today;
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'bg-white px-1.5 py-2 text-center border-b border-ink/10',
                      isNow && 'bg-brand text-white',
                      past && !isNow && 'bg-destructive/[0.04]'
                    )}
                  >
                    <p className={cn('text-[8px] font-black uppercase tracking-widest', isNow ? 'text-white/70' : 'text-secondary')}>
                      {format(day, 'EEE')}
                    </p>
                    <p className={cn('text-[11px] font-black font-mono', isNow && 'text-white')}>
                      {format(day, 'dd')}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="relative mt-3 h-[220px] border border-ink/10 bg-[linear-gradient(180deg,transparent_0%,hsl(var(--cream)/0.55)_100%)]">
              {/* Today spine */}
              <div
                className="absolute top-0 bottom-0 w-px bg-brand z-10"
                style={{ left: `${((3 + 0.5) / runwayDays.length) * 100}%` }}
              />
              {runwayTasks.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-secondary/60">
                    No dated open tasks in this window
                  </p>
                </div>
              ) : (
                runwayTasks.map(({ item, dayIndex }, idx) => {
                  const left = ((dayIndex + 0.08) / runwayDays.length) * 100;
                  const width = (0.84 / runwayDays.length) * 100;
                  const top = 12 + (idx % 6) * 32;
                  const overdue = bucketFor(item, today) === 'overdue';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item)}
                      title={`${item.taskName} · ${formatDue(item.dueDate)}`}
                      className={cn(
                        'absolute z-20 h-7 px-2 truncate text-left text-[9px] font-black uppercase tracking-wide text-white transition-transform hover:-translate-y-0.5 hover:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        overdue ? 'bg-destructive' : statusInk[item.status] || 'bg-brand',
                        'animate-in fade-in zoom-in-95 duration-300'
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        top,
                        animationDelay: `${Math.min(idx, 8) * 40}ms`,
                      }}
                    >
                      {item.taskName}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-px bg-ink border border-ink">
        {/* Focus queue */}
        <section className="xl:col-span-7 bg-white">
          <div className="px-6 md:px-8 py-6 border-b border-ink/10 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="terminal-overline flex items-center gap-2">
                <Lightning className="h-3.5 w-3.5" weight="fill" />
                Focus queue
                {activeStat && (
                  <span className="text-brand">· {activeStat.replace('critical', 'high / critical')}</span>
                )}
              </p>
              <h3 className="text-2xl font-black tracking-tighter uppercase">{focusCopy.title}</h3>
              <p className="text-[11px] text-secondary">{focusCopy.subtitle}</p>
            </div>
            {activeStat && (
              <button
                type="button"
                onClick={() => setActiveStat(null)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-ink/15 text-[9px] font-black uppercase tracking-widest text-secondary hover:border-ink hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" weight="bold" />
                Clear
              </button>
            )}
          </div>
          <div className="divide-y divide-ink/10">
            {focusQueue.length === 0 ? (
              <p className="p-10 text-center text-[10px] font-black uppercase tracking-widest text-secondary/60">
                {activeStat ? 'No tasks match this filter' : 'All clear — no open tasks in view'}
              </p>
            ) : (
              focusQueue.map((item, idx) => {
                const bucket = bucketFor(item, today);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpen(item)}
                    className="w-full text-left px-6 md:px-8 py-4 flex items-start gap-4 hover:bg-cream/70 transition-colors group focus-visible:outline-none focus-visible:bg-cream"
                  >
                    <span className="font-mono text-[10px] font-black text-secondary/50 w-6 pt-1">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0', statusInk[item.status])} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-foreground truncate group-hover:text-brand transition-colors">
                          {item.taskName}
                        </p>
                        {bucket === 'overdue' && (
                          <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-destructive">
                            <Warning className="h-3 w-3" weight="fill" /> Overdue
                          </span>
                        )}
                        {bucket === 'today' && (
                          <span className="text-[8px] font-black uppercase tracking-widest text-warning">Due today</span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-secondary truncate">
                        {item.assignedTo || 'Unassigned'}
                        {item.clientName ? ` · ${item.clientName}` : ''}
                        {item.section ? ` · ${item.section}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className={cn('text-[10px] font-black uppercase tracking-widest', bucket === 'overdue' ? 'text-destructive' : 'text-secondary')}>
                        {formatDue(item.dueDate)}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-secondary/70">{item.priority}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-secondary/30 group-hover:text-brand transition-colors shrink-0 mt-1" weight="bold" />
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Owner load + sections */}
        <section className="xl:col-span-5 bg-white flex flex-col">
          <div className="px-6 md:px-8 py-6 border-b border-ink/10 space-y-1">
            <p className="terminal-overline flex items-center gap-2">
              <UsersThree className="h-3.5 w-3.5" weight="bold" />
              Owner load
            </p>
            <h3 className="text-2xl font-black tracking-tighter uppercase">Who is carrying it</h3>
          </div>
          <div className="p-6 md:p-8 space-y-5 flex-1">
            {ownerLoad.length === 0 ? (
              <p className="text-[10px] font-black uppercase tracking-widest text-secondary/60">No open owners</p>
            ) : (
              ownerLoad.map((owner) => (
                <div key={owner.name} className="space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-widest truncate">{owner.name}</p>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-secondary">
                        {owner.overdue > 0 ? `${owner.overdue} overdue` : 'On pace'}
                        {owner.critical > 0 ? ` · ${owner.critical} high` : ''}
                      </p>
                    </div>
                    <p className="font-mono text-sm font-black">{owner.open}</p>
                  </div>
                  <div className="h-3 bg-foreground/[0.04] overflow-hidden">
                    <div
                      className={cn('h-full transition-all duration-700', owner.overdue > 0 ? 'bg-destructive' : 'bg-brand')}
                      style={{ width: `${(owner.open / maxOwner) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {sectionHeat.length > 0 && (
            <div className="border-t border-ink/10 px-6 md:px-8 py-6 space-y-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary">Section pressure</p>
              <div className="flex flex-wrap gap-2">
                {sectionHeat.map((s) => (
                  <div
                    key={s.section}
                    className={cn(
                      'px-3 py-2 border text-[9px] font-black uppercase tracking-widest',
                      s.overdue > 0 ? 'border-destructive/40 bg-destructive/[0.04] text-destructive' : 'border-ink/15 text-foreground'
                    )}
                  >
                    {s.section.replace('CLIENT ENGAGEMENT', 'ENGAGEMENT')} · {s.open}
                    {s.overdue > 0 ? ` · ${s.overdue} late` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PulseStat({
  label,
  value,
  hint,
  tone = 'ink',
  active = false,
  onClick,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: 'ink' | 'destructive' | 'warning' | 'success' | 'brand';
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'bg-white p-5 md:p-6 space-y-2 min-h-[110px] text-left w-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        'hover:bg-cream/80',
        active && 'bg-cream ring-2 ring-inset ring-brand'
      )}
    >
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary">{label}</p>
      <p
        className={cn(
          'text-3xl md:text-4xl font-black font-headline tracking-tighter',
          tone === 'destructive' && 'text-destructive',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
          tone === 'brand' && 'text-brand'
        )}
      >
        {value}
      </p>
      <p className="text-[9px] font-bold uppercase tracking-widest text-secondary/70">{hint}</p>
    </button>
  );
}
