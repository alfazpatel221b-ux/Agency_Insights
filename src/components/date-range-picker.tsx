'use client';

import * as React from 'react';
import { Calendar as CalendarIcon, Check } from 'lucide-react';
import {
  format,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface DateRangePickerProps {
  className?: string;
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
}

function buildPresets(today: Date) {
  return [
    {
      label: 'Last week',
      range: {
        from: startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }),
        to: endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }),
      },
    },
    {
      label: 'This + last week',
      range: {
        from: startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }),
        to: endOfWeek(today, { weekStartsOn: 1 }),
      },
    },
    {
      label: 'Last month',
      range: {
        from: startOfMonth(subMonths(today, 1)),
        to: endOfMonth(subMonths(today, 1)),
      },
    },
    {
      label: 'Last 30d',
      range: { from: subDays(today, 30), to: today },
    },
    {
      label: 'Last 90d',
      range: { from: subDays(today, 90), to: today },
    },
    {
      label: '6 months',
      range: { from: subMonths(today, 6), to: today },
    },
    {
      label: '1 year',
      range: { from: subYears(today, 1), to: today },
    },
    {
      label: '2 years',
      range: { from: subYears(today, 2), to: today },
    },
  ];
}

export function DateRangePicker({
  className,
  date,
  setDate,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<Date>(date?.from ?? new Date());

  // Stable calendar day — avoids rebuilding preset Date objects every render
  const today = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const presets = React.useMemo(() => buildPresets(today), [today]);

  React.useEffect(() => {
    if (open && date?.from) setMonth(date.from);
  }, [open, date?.from]);

  const applyPreset = (range: DateRange) => {
    setDate(range);
    if (range.from) setMonth(range.from);
    setOpen(false);
  };

  return (
    <div className={cn('grid gap-2 min-w-0', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              'w-full sm:w-auto min-w-0 sm:min-w-[200px] max-w-full justify-start text-left font-black text-[10px] uppercase tracking-widest rounded-none glass h-9',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">
              {date?.from ? (
                date.to ? (
                  <>
                    {format(date.from, 'LLL dd, y')} – {format(date.to, 'LLL dd, y')}
                  </>
                ) : (
                  format(date.from, 'LLL dd, y')
                )
              ) : (
                <span>Select Date Range</span>
              )}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto max-w-[min(320px,calc(100vw-1.5rem))] p-0 rounded-none border-ink z-[80]"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          avoidCollisions
        >
          {/* Mount calendar only while open — avoids lag on every page load */}
          {open && (
            <div className="flex flex-col">
              <div className="flex flex-wrap gap-1 p-2 border-b border-foreground/10 bg-foreground/[0.02]">
                {presets.map((preset) => {
                  const isActive =
                    !!date?.from &&
                    !!date?.to &&
                    date.from.getTime() === preset.range.from.getTime() &&
                    date.to.getTime() === preset.range.to.getTime();

                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset.range)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-wider border transition-colors',
                        isActive
                          ? 'bg-primary text-white border-primary'
                          : 'bg-background/80 border-foreground/10 text-foreground/70 hover:border-primary/40'
                      )}
                    >
                      {preset.label}
                      {isActive && <Check className="h-2.5 w-2.5" />}
                    </button>
                  );
                })}
              </div>
              <div className="p-2">
                <Calendar
                  mode="range"
                  month={month}
                  onMonthChange={setMonth}
                  selected={date}
                  onSelect={setDate}
                  numberOfMonths={1}
                  fixedWeeks
                />
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
