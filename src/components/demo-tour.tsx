'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, PlayCircle, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

type TourStep = {
  target?: string;
  eyebrow: string;
  title: string;
  body: string;
  tip?: string;
};

const TOUR_KEY = 'agency-insights-demo-tour-v1';

const steps: TourStep[] = [
  {
    eyebrow: 'WELCOME TO THE DEMO',
    title: 'This is your Agency Insights walkthrough.',
    body: 'Take a quick guided tour of the control center. We will show you what each major workspace is designed to help an agency team understand and act on.',
    tip: 'Everything you see in this environment is synthetic demonstration data.',
  },
  {
    target: '[data-testid="sidebar-nav-dashboard"]',
    eyebrow: '01 · BUSINESS SNAPSHOT',
    title: 'Start here: the executive command view.',
    body: 'Snapshot brings the portfolio together in one tactical view — business health, KPI movement, spend momentum, client signals and the items that need attention.',
  },
  {
    target: '[data-testid="sidebar-nav-sales"]',
    eyebrow: '02 · SALES TRACKER',
    title: 'See the pipeline before it becomes revenue.',
    body: 'Track opportunities, stages, estimated value, expected spends, owners and go-live dates so the commercial pipeline can be connected to operational capacity.',
  },
  {
    target: '[data-testid="sidebar-nav-kpis"]',
    eyebrow: '03 · KPI TRACKER',
    title: 'Move from targets to performance.',
    body: 'Review KPI targets against achievement and weekly pacing. The idea is to spot gaps early rather than discover them at the end of the month.',
  },
  {
    target: '[data-testid="sidebar-nav-spends"]',
    eyebrow: '04 · SPENDS UPDATE',
    title: 'Control the underlying spend data.',
    body: 'This workspace is built around spend uploads and operational updates that feed the analytical views downstream.',
  },
  {
    target: '[data-testid="sidebar-nav-spends-dashboard"]',
    eyebrow: '05 · SPENDS DASHBOARD',
    title: 'Turn spend records into business signals.',
    body: 'Explore WoW, MoM and QoQ movement, dimensions, filters, movers and comparisons instead of looking at a flat spend report.',
  },
  {
    target: '[data-testid="sidebar-nav-spends-forecast"]',
    eyebrow: '06 · SPENDS FORECAST',
    title: 'Look forward, not only backward.',
    body: 'Compare forecasting approaches against historical spend and inspect the projected horizon by business dimension.',
  },
  {
    target: '[data-testid="sidebar-nav-wbr"]',
    eyebrow: '07 · WEEKLY REVIEW',
    title: 'Connect numbers with the client conversation.',
    body: 'Weekly reviews turn performance signals into structured client-level discussion, RAG status, summaries and follow-up.',
  },
  {
    target: '[data-testid="sidebar-nav-actions"]',
    eyebrow: '08 · ACTION ITEMS',
    title: 'Make sure insights become action.',
    body: 'Track owners, priorities, due dates and status so the review cycle does not end with a presentation.',
  },
  {
    target: '[data-testid="sidebar-nav-admin"]',
    eyebrow: '09 · ADMINISTRATION',
    title: 'The control layer behind the experience.',
    body: 'Manage the configuration that supports the operating model — users, channels and KPI definitions.',
  },
  {
    target: '[data-testid="topbar-command-btn"]',
    eyebrow: '10 · COMMAND PALETTE',
    title: 'Search the control center quickly.',
    body: 'Use the command/search control to jump into clients, KPIs and weeks without manually navigating through every section.',
    tip: 'Keyboard shortcut: Ctrl + K on Windows or ⌘ + K on Mac.',
  },
  {
    target: '[data-testid="topbar-user-btn"]',
    eyebrow: '11 · YOUR DEMO PROFILE',
    title: 'This environment is intentionally frictionless.',
    body: 'Your login creates an anonymous demo session and a synthetic Admin profile. No real customer account or corporate credentials are required.',
  },
  {
    eyebrow: 'YOU ARE READY',
    title: 'Explore it like a real operating console.',
    body: 'Click through the workspaces, change filters, inspect charts and follow the data from spend → performance → review → action.',
    tip: 'Important: all records, clients, people, numbers and activity in this demo are synthetic and must not be treated as real business data.',
  },
];

function getRect(selector?: string) {
  if (!selector || typeof document === 'undefined') return null;
  const el = document.querySelector(selector);
  return el?.getBoundingClientRect() || null;
}

export function DemoTour({ forceOpen = false, onForceClose }: { forceOpen?: boolean; onForceClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const close = useCallback((remember = true) => {
    if (remember) window.localStorage.setItem(TOUR_KEY, 'completed');
    setOpen(false);
    onForceClose?.();
  }, [onForceClose]);

  const start = useCallback(() => {
    setStepIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (forceOpen) {
      start();
      return;
    }
    const completed = window.localStorage.getItem(TOUR_KEY);
    if (!completed) {
      const timer = window.setTimeout(() => setOpen(true), 700);
      return () => window.clearTimeout(timer);
    }
  }, [forceOpen, start]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const next = getRect(current.target);
      setRect(next);
      if (next) {
        const el = document.querySelector(current.target!);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    };
    update();
    const timer = window.setTimeout(update, 350);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, current]);

  const position = useMemo(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.right + 18), window.innerWidth - width - 16);
    const top = Math.min(Math.max(16, rect.top), window.innerHeight - 300);
    return { top, left, width };
  }, [rect]);

  if (!open) return null;

  const next = () => {
    if (isLast) close();
    else setStepIndex((i) => i + 1);
  };

  const back = () => setStepIndex((i) => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Agency Insights demo tour">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      {rect && (
        <div
          className="fixed z-[201] rounded-none pointer-events-none border-2 border-brand bg-transparent transition-all duration-300"
          style={{
            top: rect.top - 5,
            left: rect.left - 5,
            width: rect.width + 10,
            height: rect.height + 10,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.08)',
          }}
        />
      )}

      <div
        className="fixed z-[202] bg-surface border border-ink shadow-2xl p-5 md:p-6 max-w-[calc(100vw-32px)] transition-all duration-300"
        style={position}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand">{current.eyebrow}</p>
            <p className="mt-1 text-[10px] font-mono text-secondary">{stepIndex + 1} / {steps.length}</p>
          </div>
          <button
            type="button"
            onClick={() => close()}
            aria-label="Close demo tour"
            className="w-7 h-7 flex items-center justify-center border border-hairline text-secondary hover:border-ink hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <h2 className="mt-5 text-xl md:text-2xl font-black tracking-tight font-headline">{current.title}</h2>
        <p className="mt-3 text-sm leading-6 text-secondary">{current.body}</p>

        {current.tip && (
          <div className="mt-4 border-l-2 border-brand bg-brand/5 px-3 py-2.5">
            <p className="text-[11px] leading-5 text-ink">
              <span className="font-black uppercase tracking-wider">Good to know: </span>
              {current.tip}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => close()}
            className="text-[10px] font-black uppercase tracking-widest text-secondary hover:text-ink"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button type="button" variant="outline" size="sm" onClick={back} className="rounded-none h-9">
                <ArrowLeft size={13} className="mr-1.5" /> Back
              </Button>
            )}
            <Button type="button" size="sm" onClick={next} className="rounded-none h-9 font-bold">
              {isLast ? <><Check size={13} className="mr-1.5" /> Start exploring</> : <>Next <ArrowRight size={13} className="ml-1.5" /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoTourLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-2.5 py-2 text-xs text-secondary hover:text-ink hover:bg-cream transition-colors"
      >
        <PlayCircle size={14} />
        <span>Replay demo tour</span>
      </button>
      <DemoTour forceOpen={open} onForceClose={() => setOpen(false)} />
    </>
  );
}
