'use client';

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  MagnifyingGlass,
  ChartLineUp,
  Target,
  Coins,
  PresentationChart,
  ClipboardText,
  ShieldCheck,
  ArrowRight,
  Briefcase,
  ListChecks,
  ChartLine
} from "@phosphor-icons/react";
import { useMemo, useState, useEffect, useCallback } from "react";

const items = [
  { label: "Snapshot", href: "/dashboard/business-snapshot", group: "Navigate", icon: ChartLineUp },
  { label: "Sales Tracker", href: "/dashboard/sales-tracker", group: "Navigate", icon: Briefcase },
  { label: "KPI Tracker", href: "/dashboard/kpi-tracking", group: "Navigate", icon: Target },
  { label: "Spend Planner", href: "/dashboard/spends", group: "Navigate", icon: Coins },
  { label: "Spends Dashboard", href: "/dashboard/spends-dashboard", group: "Navigate", icon: PresentationChart },
  { label: "Spends Forecast", href: "/dashboard/spends-forecast", group: "Navigate", icon: ChartLine },
  { label: "Weekly Business Review", href: "/dashboard/wbr", group: "Navigate", icon: ClipboardText },
  { label: "Action Items", href: "/dashboard/actions", group: "Navigate", icon: ListChecks },
  { label: "Administration", href: "/dashboard/admin", group: "Navigate", icon: ShieldCheck },
  { label: "Export current view (CSV)", href: "/dashboard/business-snapshot", group: "Actions", icon: ArrowRight, hint: "Download" },
  { label: "Invite team member", href: "/dashboard/admin", group: "Actions", icon: ArrowRight, hint: "New" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((i) => i.label.toLowerCase().includes(query));
  }, [q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q]);

  const selectItem = useCallback((href: string) => {
    router.push(href);
    onOpenChange(false);
  }, [router, onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
        return;
      }
      if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        selectItem(filtered[activeIndex].href);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIndex, onOpenChange, selectItem]);

  const groups = filtered.reduce((acc, it) => {
    (acc[it.group] ??= []).push(it);
    return acc;
  }, {} as Record<string, typeof items>);

  let flatIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="command-palette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[110] flex items-start justify-center pt-[12vh] px-4"
          onClick={() => onOpenChange(false)}
        >
          <div className="absolute inset-0 bg-ink/60" />
          <motion.div
            initial={{ y: -10, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.65, 0.3, 1] }}
            className="relative w-full max-w-2xl bg-ink border border-white/15 text-white"
            style={{ boxShadow: "12px 12px 0px 0px rgba(0,47,167,1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 h-14 border-b border-white/10">
              <MagnifyingGlass size={18} className="text-white/50" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search pages and actions…"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/40 text-sm"
                data-testid="command-palette-input"
              />
              <kbd className="text-[10px] font-mono text-white/50 border border-white/20 px-1.5 py-0.5">
                ESC
              </kbd>
            </div>
            <div className="max-h-[420px] overflow-y-auto py-2 custom-scrollbar">
              {Object.entries(groups).map(([group, list]) => (
                <div key={group} className="mb-2">
                  <div className="px-5 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/50 font-semibold">
                    {group}
                  </div>
                  {list.map((i) => {
                    const Icon = i.icon;
                    flatIndex += 1;
                    const index = flatIndex;
                    const isActive = index === activeIndex;
                    return (
                      <button
                        key={i.href + i.label}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectItem(i.href)}
                        className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors group text-left ${
 isActive ? "bg-brand text-white" : "hover:bg-white/5"
 }`}
                      >
                        <Icon size={16} className={isActive ? "text-white" : "text-white/60"} />
                        <span className="flex-1">{i.label}</span>
                        {i.hint && (
                          <span className={`text-[10px] uppercase tracking-widest ${isActive ? "text-white/70" : "text-white/40"}`}>
                            {i.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-5 py-8 text-center text-white/50 text-sm">
                  No results. Try another keyword.
                </div>
              )}
            </div>
            <div className="border-t border-white/10 px-5 py-2.5 flex items-center gap-4 text-[10px] uppercase tracking-widest text-white/40 font-mono">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
              <span>Esc Close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
