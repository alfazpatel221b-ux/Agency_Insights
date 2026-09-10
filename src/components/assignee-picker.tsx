'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { AssigneeOption } from '@/lib/assignee-options';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export function AssigneePicker({
  options,
  value,
  onChange,
  loading,
}: {
  options: AssigneeOption[];
  value: string;
  onChange: (name: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(q) ||
        opt.email.toLowerCase().includes(q)
    );
  }, [options, query]);

  const customName = query.trim();
  const customIsNew =
    customName.length > 0 &&
    !options.some((opt) => opt.name.toLowerCase() === customName.toLowerCase());

  const selectName = (name: string) => {
    onChange(name);
    setQuery('');
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Assigned to"
          className="w-full justify-between rounded-none bg-background/50 border-none h-12 shadow-inner px-4 font-bold hover:bg-background/80"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground font-medium')}>
            {value || (loading ? 'Loading people…' : 'Select a person…')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[60] w-[var(--radix-popover-trigger-width)] p-0 rounded-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-2 border-b border-foreground/10">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all people…"
            className="h-10 rounded-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customName) {
                e.preventDefault();
                selectName(customName);
              }
            }}
          />
        </div>
        <ScrollArea className="h-64">
          <ul className="py-1">
            {matches.map((opt) => {
              const selected = opt.name === value;
              return (
                <li key={`${opt.name}|${opt.email}`}>
                  <button
                    type="button"
                    className={cn(
                      'w-full text-left px-3 py-2 hover:bg-cream flex items-start gap-2',
                      selected && 'bg-primary/5'
                    )}
                    onClick={() => selectName(opt.name)}
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 mt-0.5 shrink-0',
                        selected ? 'opacity-100 text-primary' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-bold truncate">{opt.name}</span>
                      {opt.email ? (
                        <span className="block text-[10px] font-mono text-secondary truncate">
                          {opt.email}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
            {customIsNew ? (
              <li>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-cream text-xs font-bold"
                  onClick={() => selectName(customName)}
                >
                  Use “{customName}”
                </button>
              </li>
            ) : null}
            {matches.length === 0 && !customIsNew ? (
              <li className="px-3 py-6 text-center text-[10px] font-bold uppercase tracking-widest text-secondary">
                No matching people
              </li>
            ) : null}
          </ul>
        </ScrollArea>
        <p className="px-3 py-2 text-[10px] font-mono text-secondary border-t border-foreground/10">
          {options.length} {options.length === 1 ? 'person' : 'people'} in directory
        </p>
      </PopoverContent>
    </Popover>
  );
}
