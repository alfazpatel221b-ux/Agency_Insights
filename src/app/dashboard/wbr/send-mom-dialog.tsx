'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Mail, FileText, FileDown, Copy, Send } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFirestore } from '@/firebase';
import {
  assembleMomReport,
  buildMomHtml,
  copyMomHtml,
  downloadMomHtml,
  downloadMomEml,
  exportMomPdf,
  momPlainText,
  PUBLIC_APP_ORIGIN,
  type MomReportData,
} from '@/lib/mom-report';

export function SendMomDialog({
  open,
  onOpenChange,
  wbrDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wbrDate: Date;
}) {
  const firestore = useFirestore();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'html' | 'pdf' | 'copy' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MomReportData | null>(null);
  const [html, setHtml] = useState('');
  const [to, setTo] = useState('');

  const wbrKey = format(wbrDate, 'yyyy-MM-dd');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setHtml('');

    assembleMomReport(firestore, wbrDate)
      .then((report) => {
        if (cancelled) return;
        setData(report);
        setHtml(buildMomHtml(report));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to assemble MoM.';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, firestore, wbrKey]);

  const subject = useMemo(
    () => `Weekly Business Review : ${format(wbrDate, 'do MMM yyyy')}-MoM`,
    [wbrDate]
  );

  const run = async (kind: 'html' | 'pdf' | 'copy' | 'send', fn: () => Promise<void> | void) => {
    if (!html || !data) return;
    setBusy(kind);
    try {
      await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed.';
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden grid-rows-[auto_1fr_auto] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ink pr-12">
          <DialogTitle className="uppercase tracking-tight">Send meeting MoM</DialogTitle>
          <DialogDescription>
            Formatted HTML for the {format(wbrDate, 'dd MMM yyyy')} weekly review. Pulse charts are HTML tables — nothing is hosted as an image. Dashboard links always point to {PUBLIC_APP_ORIGIN}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-[240px_1fr] min-h-0">
          <div className="border-b md:border-b-0 md:border-r border-ink p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mom-to" className="text-[10px] font-black uppercase tracking-widest text-secondary">
                Outlook recipients (optional)
              </Label>
              <Input
                id="mom-to"
                placeholder="name@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-11"
              />
            </div>
            {data && (
              <div className="space-y-2 text-[11px] font-medium text-secondary">
                <p>{data.riskClients.length} Amber/Red accounts</p>
                <p>{data.closedActions.length} actions closed this cycle</p>
                <p>{data.updatedActions.length} actions updated this cycle</p>
                <p>Pulse week {data.pulse.weeklyDate || '—'}</p>
              </div>
            )}
          </div>

          <div className="min-h-0 bg-cream/40">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24">
                <Loader2 className="h-8 w-8 animate-spin text-brand" />
                <span className="text-[10px] font-black uppercase tracking-widest text-secondary">
                  Assembling MoM…
                </span>
              </div>
            ) : error ? (
              <div className="p-8 text-sm text-destructive">{error}</div>
            ) : (
              <ScrollArea className="h-[52vh]">
                <iframe
                  title="Weekly MoM preview"
                  className="w-full min-h-[52vh] bg-white border-0"
                  sandbox=""
                  srcDoc={html}
                />
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-ink gap-2 sm:justify-between flex-wrap">
          <p className="text-[10px] uppercase tracking-widest text-secondary font-bold mr-auto">
            Open the .eml in Outlook to send the formatted pack
          </p>
          <Button
            variant="outline"
            disabled={!html || !!busy}
            onClick={() =>
              run('copy', async () => {
                await copyMomHtml(html, momPlainText(data!));
                toast.success('HTML copied — paste into the Outlook message body');
              })
            }
          >
            {busy === 'copy' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
            Copy HTML
          </Button>
          <Button
            variant="outline"
            disabled={!html || !!busy}
            onClick={() =>
              run('html', () => {
                downloadMomHtml(html, data!.wbrDate);
                toast.success('HTML downloaded');
              })
            }
          >
            {busy === 'html' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            Download HTML
          </Button>
          <Button
            variant="outline"
            disabled={!html || !!busy}
            onClick={() =>
              run('pdf', async () => {
                await exportMomPdf(html, data!.wbrDate);
                toast.success('PDF downloaded');
              })
            }
          >
            {busy === 'pdf' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Download PDF
          </Button>
          <Button
            className="bg-brand text-white hover:bg-ink"
            disabled={!html || !!busy}
            onClick={() =>
              run('send', () => {
                downloadMomEml(html, data!.wbrDate, subject, to);
                toast.success('Outlook draft downloaded — open the .eml file to send');
              })
            }
          >
            {busy === 'send' ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send via Outlook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SendMomButton({ wbrDate }: { wbrDate: Date }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className="h-14 px-6 rounded-3xl bg-brand text-white hover:bg-ink gap-2 font-bold shadow-lg"
        onClick={() => setOpen(true)}
      >
        <Mail className="h-5 w-5" />
        Send MoM
      </Button>
      <SendMomDialog open={open} onOpenChange={setOpen} wbrDate={wbrDate} />
    </>
  );
}
