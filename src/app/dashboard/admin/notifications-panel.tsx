'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CircleNotch,
  EnvelopeSimple,
  Lightning,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { doc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDoc, useFirestore, useUser, useFirebaseApp } from '@/firebase';
import {
  DEFAULT_EMAIL_AUTOMATIONS,
  EMAIL_AUTOMATION_META,
  EMAIL_AUTOMATIONS_DOC,
  EmailAutomationKey,
  EmailAutomationSettings,
} from '@/lib/email-automations';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const AUTOMATION_KEYS = Object.keys(EMAIL_AUTOMATION_META) as EmailAutomationKey[];

export function NotificationsPanel() {
  const firestore = useFirestore();
  const app = useFirebaseApp();
  const { toast } = useToast();
  const { user } = useUser();
  const { data: remoteSettings, loading: settingsLoading } = useDoc<EmailAutomationSettings>(
    EMAIL_AUTOMATIONS_DOC
  );

  const [draft, setDraft] = useState<EmailAutomationSettings>(DEFAULT_EMAIL_AUTOMATIONS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (settingsLoading) return;
    setDraft({
      ...DEFAULT_EMAIL_AUTOMATIONS,
      ...(remoteSettings || {}),
      enabled: {
        ...DEFAULT_EMAIL_AUTOMATIONS.enabled,
        ...(remoteSettings?.enabled || {}),
      },
    });
    setHydrated(true);
  }, [remoteSettings, settingsLoading]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    const baseline = {
      ...DEFAULT_EMAIL_AUTOMATIONS,
      ...(remoteSettings || {}),
      enabled: {
        ...DEFAULT_EMAIL_AUTOMATIONS.enabled,
        ...(remoteSettings?.enabled || {}),
      },
    };
    return (
      JSON.stringify(baseline.enabled) !== JSON.stringify(draft.enabled) ||
      (baseline.teamsWebhookUrl || '') !== (draft.teamsWebhookUrl || '')
    );
  }, [draft.enabled, draft.teamsWebhookUrl, hydrated, remoteSettings]);

  const toggle = (key: EmailAutomationKey, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      enabled: { ...prev.enabled, [key]: value },
    }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload: EmailAutomationSettings = {
        fromEmail: draft.fromEmail || DEFAULT_EMAIL_AUTOMATIONS.fromEmail,
        fromName: draft.fromName || DEFAULT_EMAIL_AUTOMATIONS.fromName,
        appBaseUrl: draft.appBaseUrl || DEFAULT_EMAIL_AUTOMATIONS.appBaseUrl,
        teamsWebhookUrl: (draft.teamsWebhookUrl || '').trim(),
        enabled: draft.enabled,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
      };
      await setDoc(doc(firestore, 'settings', 'emailAutomations'), payload, { merge: true });
      toast({
        title: 'Notifications saved',
        description: 'Email, in-app, and Teams toggles are live for Cloud Functions.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error?.message || 'Could not update notification settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTesting(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const sendTest = httpsCallable(functions, 'sendTestAlertEmail');
      const result = await sendTest({ to: user?.email });
      const data = result.data as { sent?: boolean; from?: string; to?: string; skipped?: string };
      toast({
        title: data.sent ? 'Test email sent' : 'Test email skipped',
        description: data.sent
          ? `Sent from ${data.from} to ${data.to}. Check inbox/spam and the header bell.`
          : data.skipped || 'No message was sent.',
      });
    } catch (error: any) {
      const detail =
        error?.details ||
        error?.message ||
        'Deploy email functions and configure Microsoft Graph (see functions/README.md).';
      toast({
        variant: 'destructive',
        title: 'Test email failed',
        description: typeof detail === 'string' ? detail : String(detail),
      });
    } finally {
      setTesting(false);
    }
  };

  if (settingsLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 gap-4">
        <CircleNotch className="h-8 w-8 animate-spin text-primary/40" />
        <span className="text-xs font-black uppercase tracking-widest text-secondary">
          Loading notifications…
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="outline"
          className="rounded-none h-11 px-5 font-black uppercase tracking-widest text-[10px] gap-2"
          onClick={handleTestEmail}
          disabled={testing}
        >
          {testing ? <CircleNotch className="h-4 w-4 animate-spin" /> : <PaperPlaneTilt className="h-4 w-4" />}
          {testing ? 'Sending…' : 'Send test email'}
        </Button>
        <Button
          className="rounded-none h-11 px-5 font-black uppercase tracking-widest text-[10px] gap-2"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Lightning className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <section className="border border-ink bg-white">
          <div className="border-b border-ink px-6 py-4 flex items-center gap-2">
            <EnvelopeSimple className="h-5 w-5 text-brand" weight="fill" />
            <h2 className="font-headline text-lg font-black uppercase tracking-tighter">
              Email &amp; team alerts
            </h2>
          </div>
          <ul className="divide-y divide-ink/10">
            {AUTOMATION_KEYS.map((key) => {
              const meta = EMAIL_AUTOMATION_META[key];
              const enabled = draft.enabled[key] !== false;
              return (
                <li
                  key={key}
                  className="px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-black uppercase tracking-wide">{meta.title}</h3>
                      <span
                        className={cn(
                          'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border',
                          enabled
                            ? 'border-success/40 text-success bg-success/5'
                            : 'border-ink/20 text-secondary bg-cream'
                        )}
                      >
                        {enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <p className="text-sm text-secondary leading-relaxed">{meta.description}</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-secondary/80">
                      To: {meta.recipients}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggle(key, v)}
                    aria-label={`Toggle ${meta.title}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="space-y-6">
          <div className="border border-ink bg-cream p-6 space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest">Sender</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[10px] font-black uppercase tracking-widest text-secondary">
                  From
                </dt>
                <dd className="font-mono text-xs mt-1 break-all">
                  {draft.fromName} &lt;{draft.fromEmail}&gt;
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-widest text-secondary">
                  App links
                </dt>
                <dd className="font-mono text-xs mt-1 break-all">{draft.appBaseUrl}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-secondary leading-relaxed">
              Outbound mail uses <strong>Microsoft Graph</strong> so Okta login is not required.
              IT provides Tenant ID, Client ID, and Client Secret. See{' '}
              <code className="font-mono">functions/README.md</code>.
            </p>
          </div>

          <div className="border border-ink bg-white p-6 space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest">Microsoft Teams</h3>
            <p className="text-[11px] text-secondary leading-relaxed">
              Optional incoming webhook / Power Automate workflow URL. Operational alerts (not
              password-reset links) are posted to the team channel.
            </p>
            <div className="space-y-2">
              <Label htmlFor="teams-webhook" className="text-[10px] font-black uppercase tracking-widest text-secondary">
                Webhook URL
              </Label>
              <Input
                id="teams-webhook"
                type="url"
                placeholder="https://..."
                value={draft.teamsWebhookUrl || ''}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, teamsWebhookUrl: e.target.value }))
                }
                className="h-11 rounded-none"
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
