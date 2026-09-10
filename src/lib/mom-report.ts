'use client';

import {
  endOfDay,
  format,
  isValid,
  parse,
  parseISO,
  startOfDay,
  subMonths,
  subWeeks,
} from 'date-fns';
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { saveAs } from 'file-saver';
import type {
  ActionItem,
  ActionStatus,
  Client,
  KpiData,
  PerformanceShift,
  RagStatus,
  WeeklySpend,
  WbrEntry,
} from '@/lib/types';
import { resolveActionStatus } from '@/lib/normalize';
import { clientPathFromPrimaryKpis, selectPrimaryKpisForPath } from '@/lib/kpi-rag';
import {
  aggregateBrandSpendBreakdown,
  aggregateSpendByWeekStart,
  buildWowSpendsTrend,
  dominantImpactSpendType,
  formatLatestWeekDateLabel,
  formatWeekStartLabel,
  resolveWowWeekPair,
  toSpendNumber,
  type WowSpendTrendPoint,
} from '@/lib/spend-week';

/** Same large-account exclusion as Snapshot 12-Week Momentum. */
export const MOM_EXCLUDE_CLIENT_IDS = new Set(['CLID0081', 'CLID0084']);

/** Public Control Center URL used in MoM hyperlinks (never localhost). */
export const PUBLIC_APP_ORIGIN = 'https://agency-insights-demo.example.com';

export function resolveMomOrigin(candidate?: string | null): string {
  const fallback = PUBLIC_APP_ORIGIN;
  const raw = (candidate || '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return fallback;
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

const PAGE = 400;
const ACTION_BOARD_STATUSES: ActionStatus[] = [
  'Work-In Progress',
  'On-Hold',
  'Observation',
  'Overdue',
  'Completed',
];

const ACTION_COLORS: Record<ActionStatus, string> = {
  'Work-In Progress': '#002FA7',
  'On-Hold': '#F59E0B',
  Observation: '#525252',
  Overdue: '#FF3B30',
  Completed: '#00A675',
};

export type MomPulseShift = PerformanceShift;

export type MomHealthSummary = {
  onPath: number;
  offPath: number;
  noSignal: number;
  pGreen: number;
  pAmber: number;
  pRed: number;
  eGreen: number;
  eAmber: number;
  eRed: number;
  kpiMonth: string;
};

export type MomRiskClient = {
  clientId: string;
  clientName: string;
  cluster: string;
  emcsm: string;
  performanceRag: RagStatus;
  engagementRag: RagStatus;
  csmComments: string;
  performanceSummary: string;
  executiveSummary: string;
};

export type MomActionNote = {
  id: string;
  taskName: string;
  clientName: string;
  assignedTo: string;
  status: ActionStatus;
  updatedAt: string;
  comment: string;
};

export type MomReportData = {
  wbrDate: string;
  wbrDateLabel: string;
  origin: string;
  pulse: {
    weeklyDate: string;
    weeklyTotal: number;
    prevWeeklyTotal: number;
    gainers: MomPulseShift[];
    losers: MomPulseShift[];
  };
  wowInclusive: WowSpendTrendPoint[];
  wowExclusive: WowSpendTrendPoint[];
  health: MomHealthSummary;
  riskClients: MomRiskClient[];
  actionBoard: { status: ActionStatus; count: number }[];
  closedActions: MomActionNote[];
  updatedActions: MomActionNote[];
};

function looksLikeClientId(value?: string | null, cid?: string) {
  if (!value?.trim()) return true;
  const v = value.trim();
  if (cid && v === cid) return true;
  return /^CLID\d+$/i.test(v);
}

function normalizeClid(clientId?: string | null): string | null {
  const id = (clientId || '').trim();
  return id || null;
}

export function formatInrCompact(val: number) {
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (absVal >= 10000000) return `₹${sign}${(absVal / 10000000).toFixed(2)}Cr`;
  if (absVal >= 100000) return `₹${sign}${(absVal / 100000).toFixed(2)}L`;
  return `₹${sign}${absVal.toLocaleString('en-IN')}`;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT_STACK = "'DM Sans','Segoe UI',Calibri,'Helvetica Neue',Arial,sans-serif";
const FONT_STYLE = `font-family:${FONT_STACK};`;

const SKIP_NOTE = /^(n\/?a|na|none|nil|null|-|—|–|\.|tbd|todo|same as last week|no comments?|not captured.*)$/i;

/** Split messy WBR notes into short, comparable bullets. */
export function notesToBullets(text: string, limit = 4): string[] {
  const raw = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[•●■►▪◦‣∙]/g, '\n')
    .replace(/\n[-–—*]\s+/g, '\n')
    .replace(/(?:^|\n)\s*(?:\d+[.)]|[A-Za-z][.)])\s+/g, '\n')
    .replace(/\s+[;|]\s+/g, '\n')
    .trim();
  if (!raw) return [];

  const chunks: string[] = [];
  for (const line of raw.split(/\n+/)) {
    const piece = line.replace(/\s+/g, ' ').trim();
    if (!piece) continue;
    if (piece.length <= 180) {
      chunks.push(piece);
      continue;
    }
    const sentences: string[] = [];
    let buf = '';
    for (const part of piece.split(/([.!?]\s+)/)) {
      buf += part;
      if (/[.!?]\s+$/.test(part) && buf.trim()) {
        sentences.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) sentences.push(buf.trim());
    if (sentences.length > 1) chunks.push(...sentences);
    else chunks.push(piece);
  }

  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const chunk of chunks) {
    let item = chunk.replace(/^[-–—*•]+\s*/, '').replace(/\s+/g, ' ').trim();
    item = item.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    if (!item || SKIP_NOTE.test(item)) continue;
    if (item.length < 3) continue;
    item = item.charAt(0).toUpperCase() + item.slice(1);
    if (!/[.!?]$/.test(item) && item.length > 40) item = `${item}.`;
    const key = item.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(item);
    if (bullets.length >= limit) break;
  }
  return bullets;
}

function bulletListHtml(items: string[]): string {
  if (!items.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${FONT_STYLE}">
    ${items
      .map(
        (item) => `<tr>
      <td valign="top" width="16" style="width:16px;padding:3px 0 3px 0;color:#002FA7;font-size:15px;line-height:1.45;${FONT_STYLE}">•</td>
      <td valign="top" style="padding:3px 0;font-size:13.5px;line-height:1.5;color:#1f2937;${FONT_STYLE}">${esc(item)}</td>
    </tr>`
      )
      .join('')}
  </table>`;
}

function labeledBullets(label: string, items: string[]): string {
  if (!items.length) return '';
  return `<div style="margin-top:12px;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;${FONT_STYLE}">${esc(label)}</div>
    ${bulletListHtml(items)}
  </div>`;
}

function unifiedRiskBody(client: MomRiskClient): string {
  const performance = notesToBullets(client.performanceSummary, 4);
  const account = notesToBullets(client.csmComments, 4);
  const challenges = notesToBullets(client.executiveSummary, 4);
  const body = [
    labeledBullets('Performance', performance),
    labeledBullets('Account & engagement', account),
    labeledBullets('Challenges & outlook', challenges),
  ].join('');
  if (body.trim()) return body;
  return `<p style="font-size:13px;color:#6b7280;margin:12px 0 0;${FONT_STYLE}">No usable notes this cycle.</p>`;
}

function parseWhen(raw?: string | null): Date | null {
  if (!raw) return null;
  try {
    const iso = parseISO(raw);
    if (isValid(iso)) return iso;
  } catch {
    /* fall through */
  }
  const d = new Date(raw);
  return isValid(d) ? d : null;
}

function inWindow(raw: string | undefined, from: Date, to: Date) {
  const d = parseWhen(raw);
  if (!d) return false;
  return d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
}

function isLargeSyntheticClient(row: Pick<WeeklySpend, 'clientId' | 'brandName'>) {
  const id = (row.clientId || '').trim().toUpperCase();
  if (MOM_EXCLUDE_CLIENT_IDS.has(id)) return true;
  const brand = (row.brandName || '').toLowerCase();
  return brand.includes('orion retail') || /\bola\b/.test(brand);
}

function mapDocs<T>(snap: { docs: QueryDocumentSnapshot<DocumentData>[] }): (T & { id: string })[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as T & { id: string }));
}

async function fetchCollection<T>(
  db: Firestore,
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<(T & { id: string })[]> {
  const ref = collection(db, collectionName);
  const snap = await getDocs(constraints.length ? query(ref, ...constraints) : ref);
  return mapDocs<T>(snap);
}

async function fetchPagedById<T>(
  db: Firestore,
  collectionName: string,
  extra: QueryConstraint[] = []
): Promise<(T & { id: string })[]> {
  const results: (T & { id: string })[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    const constraints: QueryConstraint[] = [
      ...extra,
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PAGE),
    ];
    const snap = await getDocs(query(collection(db, collectionName), ...constraints));
    if (snap.empty) break;
    results.push(...mapDocs<T>(snap));
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return results;
}

async function fetchKpisForMonth(db: Firestore, month: string): Promise<KpiData[]> {
  try {
    return await fetchPagedById<KpiData>(db, 'kpis', [where('month', '==', month)]);
  } catch {
    const all = await fetchCollection<KpiData>(db, 'kpis', [where('month', '==', month)]);
    return all;
  }
}

async function resolveHealthKpiMonth(db: Firestore, fallbackMonth: string): Promise<string> {
  const calendarMonth = format(new Date(), 'yyyy-MM');
  try {
    const calSnap = await getDocs(query(collection(db, 'kpis'), where('month', '==', calendarMonth), limit(1)));
    if (!calSnap.empty) return calendarMonth;
    const latestSnap = await getDocs(query(collection(db, 'kpis'), orderBy('month', 'desc'), limit(1)));
    const latestMonth = latestSnap.docs[0]?.data()?.month as string | undefined;
    if (latestMonth && /^\d{4}-\d{2}$/.test(latestMonth)) return latestMonth;
  } catch {
    /* use fallback */
  }
  return fallbackMonth;
}

function calcShifts(
  curr: ReturnType<typeof aggregateBrandSpendBreakdown>,
  prev: ReturnType<typeof aggregateBrandSpendBreakdown>
) {
  const all = Array.from(new Set([...Object.keys(curr.spendMap), ...Object.keys(prev.spendMap)]));
  const diffs = all.map((brand) => {
    const c = curr.spendMap[brand] || 0;
    const p = prev.spendMap[brand] || 0;
    const diff = c - p;
    const type = dominantImpactSpendType(curr.typeSpendMap[brand], prev.typeSpendMap[brand], diff);
    const team = curr.teamByType[brand]?.[type] || prev.teamByType[brand]?.[type] || 'N/A';
    return {
      brand,
      type,
      team,
      amount: diff,
      variance: p > 0 ? (diff / p) * 100 : c > 0 ? 100 : 0,
      direction: diff >= 0 ? 'increase' : 'decrease',
    } as PerformanceShift;
  });
  return {
    gainers: diffs
      .filter((x) => (x.amount || 0) > 0)
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 3),
    losers: diffs
      .filter((x) => (x.amount || 0) < 0)
      .sort((a, b) => (a.amount || 0) - (b.amount || 0))
      .slice(0, 3),
  };
}

function noteFromAction(a: ActionItem & { id: string }): MomActionNote {
  return {
    id: a.id,
    taskName: a.taskName || 'Untitled task',
    clientName: a.clientName || a.clientId || '—',
    assignedTo: a.assignedTo || 'Unassigned',
    status: resolveActionStatus(a.status, a.dueDate),
    updatedAt: a.updatedAt || a.createdAt || '',
    comment: a.comment || a.description || '',
  };
}

export async function assembleMomReport(
  db: Firestore,
  wbrDate: Date,
  _origin?: string
): Promise<MomReportData> {
  const wbrDateKey = format(wbrDate, 'yyyy-MM-dd');
  const wbrDateLabel = format(wbrDate, 'dd MMM yyyy');
  const weeklyFrom = format(subMonths(wbrDate, 4), 'yyyy-MM');
  const weeklyTo = format(wbrDate, 'yyyy-MM');
  const windowFrom = startOfDay(subWeeks(wbrDate, 1));
  const windowTo = endOfDay(wbrDate);
  const fallbackKpiMonth = format(wbrDate, 'yyyy-MM');

  let weeklySpends: WeeklySpend[] = [];
  try {
    weeklySpends = await fetchCollection<WeeklySpend>(db, 'weeklySpends', [
      where('month', '>=', weeklyFrom),
      where('month', '<=', weeklyTo),
    ]);
  } catch {
    weeklySpends = await fetchCollection<WeeklySpend>(db, 'weeklySpends');
  }

  const [clients, wbrEntries, actionItems] = await Promise.all([
    fetchCollection<Client>(db, 'clients').catch(() => [] as (Client & { id: string })[]),
    (async () => {
      try {
        return await fetchCollection<WbrEntry>(db, 'wbrEntries', [where('wbrDate', '==', wbrDateKey)]);
      } catch {
        const all = await fetchCollection<WbrEntry>(db, 'wbrEntries');
        return all.filter((e) => e.wbrDate === wbrDateKey);
      }
    })(),
    fetchPagedById<ActionItem>(db, 'actionItems').catch(() =>
      fetchCollection<ActionItem>(db, 'actionItems').catch(() => [] as (ActionItem & { id: string })[])
    ),
  ]);

  const { keys: weekStartKeys, rowsByKey } = aggregateSpendByWeekStart(weeklySpends);
  const { currentKey, previousKey } = resolveWowWeekPair(weekStartKeys);
  const currWData = aggregateBrandSpendBreakdown(rowsByKey[currentKey] || []);
  const prevWData = aggregateBrandSpendBreakdown(rowsByKey[previousKey] || []);
  const wShifts = calcShifts(currWData, prevWData);
  const weeklyDateLabel =
    formatLatestWeekDateLabel(rowsByKey[currentKey], 'dd-MM-yyyy') ||
    (currentKey ? formatWeekStartLabel(currentKey, 'dd-MM-yyyy') : wbrDateLabel);

  const exclusiveRows = weeklySpends.filter((row) => !isLargeSyntheticClient(row));

  const nameById: Record<string, string> = {};
  const clusterById: Record<string, string> = {};
  const csmById: Record<string, string> = {};
  clients.forEach((c) => {
    const clid = normalizeClid(c.uniqueId);
    if (!clid) return;
    if (c.name && !looksLikeClientId(c.name, clid)) nameById[clid] = c.name;
    if (c.cluster) clusterById[clid] = c.cluster;
    if (c.emcsm) csmById[clid] = c.emcsm;
  });

  const kpiMonth = await resolveHealthKpiMonth(db, fallbackKpiMonth);
  const kpiRows = await fetchKpisForMonth(db, kpiMonth).catch(() => [] as KpiData[]);

  const kpisByClient = new Map<string, KpiData[]>();
  kpiRows.forEach((kpi) => {
    const clid = normalizeClid(kpi.clientId);
    if (!clid) return;
    if (kpi.clientName && !looksLikeClientId(kpi.clientName, clid)) nameById[clid] = kpi.clientName;
    if (kpi.cluster) clusterById[clid] = kpi.cluster;
    const list = kpisByClient.get(clid) || [];
    list.push(kpi);
    kpisByClient.set(clid, list);
  });

  let onPath = 0;
  let offPath = 0;
  let noSignal = 0;
  kpisByClient.forEach((clientKpis) => {
    if (!selectPrimaryKpisForPath(clientKpis).length) return;
    const rolled = clientPathFromPrimaryKpis(clientKpis);
    if (rolled.path === 'on-path') onPath += 1;
    else if (rolled.path === 'off-path') offPath += 1;
    else noSignal += 1;
  });

  const rag = { pGreen: 0, pAmber: 0, pRed: 0, eGreen: 0, eAmber: 0, eRed: 0 };
  const riskClients: MomRiskClient[] = [];
  const seenRisk = new Set<string>();

  wbrEntries.forEach((w) => {
    const clid = normalizeClid(w.clientId) || w.clientId;
    const p = String(w.performanceRag || '').trim() as RagStatus;
    const e = String(w.engagementRag || '').trim() as RagStatus;
    if (p === 'Green') rag.pGreen += 1;
    else if (p === 'Amber') rag.pAmber += 1;
    else if (p === 'Red') rag.pRed += 1;
    if (e === 'Green') rag.eGreen += 1;
    else if (e === 'Amber') rag.eAmber += 1;
    else if (e === 'Red') rag.eRed += 1;

    const isRisk = p === 'Amber' || p === 'Red' || e === 'Amber' || e === 'Red';
    if (!isRisk || seenRisk.has(clid)) return;
    seenRisk.add(clid);
    riskClients.push({
      clientId: clid,
      clientName: nameById[clid] || w.clientName || clid,
      cluster: clusterById[clid] || w.cluster || 'Unassigned',
      emcsm: csmById[clid] || w.emcsm || '—',
      performanceRag: (p || 'N/A') as RagStatus,
      engagementRag: (e || 'N/A') as RagStatus,
      csmComments: (w.financeIssues || '').trim(),
      performanceSummary: (w.performanceSummary || '').trim(),
      executiveSummary: (w.summary || '').trim(),
    });
  });

  riskClients.sort((a, b) => {
    const rank = (r: RagStatus) => (r === 'Red' ? 0 : r === 'Amber' ? 1 : 2);
    const ra = Math.min(rank(a.performanceRag), rank(a.engagementRag));
    const rb = Math.min(rank(b.performanceRag), rank(b.engagementRag));
    if (ra !== rb) return ra - rb;
    return a.clientName.localeCompare(b.clientName);
  });

  const statusCounts: Record<ActionStatus, number> = {
    'Work-In Progress': 0,
    'On-Hold': 0,
    Observation: 0,
    Overdue: 0,
    Completed: 0,
  };
  actionItems.forEach((a) => {
    const status = resolveActionStatus(a.status, a.dueDate);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const closedActions = actionItems
    .filter((a) => {
      const status = resolveActionStatus(a.status, a.dueDate);
      return status === 'Completed' && inWindow(a.updatedAt || a.createdAt, windowFrom, windowTo);
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(noteFromAction);

  const closedIds = new Set(closedActions.map((a) => a.id));
  const updatedActions = actionItems
    .filter((a) => {
      if (closedIds.has(a.id)) return false;
      if (inWindow(a.updatedAt, windowFrom, windowTo)) return true;
      return (a.commentHistory || []).some((c) => inWindow(c.createdAt, windowFrom, windowTo));
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(noteFromAction);

  return {
    wbrDate: wbrDateKey,
    wbrDateLabel,
    origin: PUBLIC_APP_ORIGIN,
    pulse: {
      weeklyDate: weeklyDateLabel,
      weeklyTotal: Object.values(currWData.spendMap).reduce((s, n) => s + n, 0),
      prevWeeklyTotal: Object.values(prevWData.spendMap).reduce((s, n) => s + n, 0),
      gainers: wShifts.gainers,
      losers: wShifts.losers,
    },
    wowInclusive: buildWowSpendsTrend(weeklySpends, 12),
    wowExclusive: buildWowSpendsTrend(exclusiveRows, 12),
    health: {
      onPath,
      offPath,
      noSignal,
      ...rag,
      kpiMonth,
    },
    riskClients,
    actionBoard: ACTION_BOARD_STATUSES.map((status) => ({ status, count: statusCounts[status] || 0 })),
    closedActions,
    updatedActions,
  };
}

function ragColor(rag: RagStatus) {
  if (rag === 'Green') return '#00A675';
  if (rag === 'Amber') return '#F59E0B';
  if (rag === 'Red') return '#FF3B30';
  return '#6b7280';
}

function ragBadge(rag: RagStatus) {
  return `<span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fff;background:${ragColor(rag)};">${esc(rag)}</span>`;
}

function shiftRows(items: MomPulseShift[], positive: boolean) {
  if (!items.length) {
    return `<tr><td colspan="2" style="padding:6px 0;font-size:12px;color:#9ca3af;font-style:italic;">No significant ${positive ? 'gains' : 'losses'}</td></tr>`;
  }
  return items
    .map((item) => {
      const amt = item.amount || 0;
      const color = positive ? '#00A675' : '#FF3B30';
      const prefix = positive && amt > 0 ? '+' : '';
      return `<tr>
        <td style="padding:8px 8px 8px 0;vertical-align:top;">
          <div style="font-size:13px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;color:#111;">${esc(item.brand)}</div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${esc(item.type)}</div>
        </td>
        <td style="padding:8px 0;vertical-align:top;text-align:right;white-space:nowrap;color:${color};font-size:12px;font-weight:800;">
          ${prefix}${esc(formatInrCompact(amt))}
          <span style="color:${color};opacity:0.65;font-size:10px;"> (${esc(item.variance.toFixed(1))}%)</span>
        </td>
      </tr>`;
    })
    .join('');
}

function barChartHtml(points: WowSpendTrendPoint[], color: string) {
  if (!points.length) {
    return `<p style="font-size:12px;color:#9ca3af;font-style:italic;">No weekly spend data for this series.</p>`;
  }
  const max = Math.max(...points.map((p) => p.spend), 1);
  const cols = points
    .map((p) => {
      const h = Math.max(4, Math.round((p.spend / max) * 120));
      return `<td valign="bottom" align="center" style="padding:0 3px;width:${Math.floor(100 / points.length)}%;">
        <div style="font-size:9px;font-weight:700;color:#111;margin-bottom:4px;">${esc(formatInrCompact(p.spend))}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td height="${h}" bgcolor="${color}" style="height:${h}px;background:${color};font-size:0;line-height:0;">&nbsp;</td>
        </tr></table>
        <div style="font-size:9px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;padding-top:6px;">${esc(p.week)}</div>
      </td>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>`;
}

function stackedRagBar(green: number, amber: number, red: number) {
  const total = Math.max(green + amber + red, 1);
  const g = Math.round((green / total) * 100);
  const a = Math.round((amber / total) * 100);
  const r = Math.max(0, 100 - g - a);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:12px;"><tr>
    <td width="${g}%" bgcolor="#00A675" style="background:#00A675;height:12px;font-size:0;">&nbsp;</td>
    <td width="${a}%" bgcolor="#F59E0B" style="background:#F59E0B;height:12px;font-size:0;">&nbsp;</td>
    <td width="${r}%" bgcolor="#FF3B30" style="background:#FF3B30;height:12px;font-size:0;">&nbsp;</td>
  </tr></table>`;
}

function actionBar(count: number, max: number, color: string) {
  const pct = max > 0 && count > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="${pct}%" bgcolor="${color}" style="background:${color};height:8px;font-size:0;">&nbsp;</td>
    <td width="${100 - pct}%" bgcolor="#F3F4F6" style="background:#F3F4F6;height:8px;font-size:0;">&nbsp;</td>
  </tr></table>`;
}

function actionListHtml(items: MomActionNote[], empty: string) {
  if (!items.length) {
    return `<p style="font-size:13.5px;color:#6b7280;${FONT_STYLE}">${esc(empty)}</p>`;
  }
  return items
    .slice(0, 20)
    .map((item) => {
      const when = parseWhen(item.updatedAt);
      const whenLabel = when ? format(when, 'dd MMM yyyy') : '—';
      const notes = notesToBullets(item.comment, 3);
      return `<tr>
        <td style="border-bottom:1px solid #ececec;padding:12px 8px 12px 0;vertical-align:top;${FONT_STYLE}">
          <div style="font-size:14px;font-weight:600;color:#111;${FONT_STYLE}">${esc(item.taskName)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:3px;${FONT_STYLE}">${esc(item.clientName)} · ${esc(item.assignedTo)} · ${esc(item.status)}</div>
          ${notes.length ? `<div style="margin-top:8px;">${bulletListHtml(notes)}</div>` : ''}
        </td>
        <td style="border-bottom:1px solid #ececec;padding:12px 0;vertical-align:top;text-align:right;white-space:nowrap;font-size:12px;color:#6b7280;${FONT_STYLE}">${esc(whenLabel)}</td>
      </tr>`;
    })
    .join('');
}

export function buildMomHtml(data: MomReportData): string {
  const { pulse, health, origin } = data;
  const wowDelta = pulse.weeklyTotal - pulse.prevWeeklyTotal;
  const wowPct = pulse.prevWeeklyTotal > 0 ? (wowDelta / pulse.prevWeeklyTotal) * 100 : 0;
  const wowColor = wowDelta < 0 ? '#FF3B30' : '#00A675';
  const wowArrow = wowDelta < 0 ? '↓' : wowDelta > 0 ? '↑' : '→';
  const kpiMonthLabel = (() => {
    try {
      const d = parse(health.kpiMonth, 'yyyy-MM', new Date());
      return isValid(d) ? format(d, 'MMM yyyy').toUpperCase() : health.kpiMonth;
    } catch {
      return health.kpiMonth;
    }
  })();

  const snapshotHref = `${origin}/dashboard/business-snapshot`;
  const healthHref = snapshotHref;
  const actionsHref = `${origin}/dashboard/actions`;
  const wbrHref = `${origin}/dashboard/wbr?date=${encodeURIComponent(data.wbrDate)}`;
  const kpiOn = `${origin}/dashboard/kpi-tracking?primary=1&path=on&month=${encodeURIComponent(health.kpiMonth)}`;
  const kpiOff = `${origin}/dashboard/kpi-tracking?primary=1&path=off&month=${encodeURIComponent(health.kpiMonth)}`;
  const kpiNone = `${origin}/dashboard/kpi-tracking?primary=1&path=none&month=${encodeURIComponent(health.kpiMonth)}`;
  const perfGreen = `${wbrHref}&perfRag=Green`;
  const perfAmber = `${wbrHref}&perfRag=Amber`;
  const perfRed = `${wbrHref}&perfRag=Red`;
  const engGreen = `${wbrHref}&engagementRag=Green`;
  const engAmber = `${wbrHref}&engagementRag=Amber`;
  const engRed = `${wbrHref}&engagementRag=Red`;

  const redCount = data.riskClients.filter((c) => c.performanceRag === 'Red' || c.engagementRag === 'Red').length;
  const amberCount = data.riskClients.length - redCount;
  const maxAction = Math.max(...data.actionBoard.map((s) => s.count), 1);

  const riskBlocks = data.riskClients.length
    ? data.riskClients
        .map((c) => {
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;border:1px solid #e5e7eb;background:#fff;${FONT_STYLE}">
            <tr>
              <td style="padding:16px 18px;${FONT_STYLE}">
                <table role="presentation" width="100%" style="${FONT_STYLE}"><tr>
                  <td>
                    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:600;${FONT_STYLE}">${esc(c.cluster)} · ${esc(c.emcsm)}</div>
                    <div style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#111;margin-top:4px;${FONT_STYLE}">${esc(c.clientName)}</div>
                  </td>
                  <td align="right" style="white-space:nowrap;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:6px;${FONT_STYLE}">P ${ragBadge(c.performanceRag)} &nbsp; E ${ragBadge(c.engagementRag)}</div>
                  </td>
                </tr></table>
                ${unifiedRiskBody(c)}
              </td>
            </tr>
          </table>`;
        })
        .join('')
    : `<p style="font-size:13.5px;color:#6b7280;${FONT_STYLE}">No Amber or Red clients on Performance or Engagement for this WBR cycle.</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AGENCY INSIGHTS Weekly MoM · ${esc(data.wbrDateLabel)}</title>
  <!-- Charts and bars are HTML tables (no hosted images). Dashboard links use ${esc(PUBLIC_APP_ORIGIN)}. -->
  <style>
    body, table, td, a, p, div, h1, h2, h3, span {
      font-family: ${FONT_STACK};
    }
    h1, h2 { font-weight: 700; letter-spacing: -0.03em; }
  </style>
</head>
<body style="margin:0;padding:0;background:#F4F4F0;color:#111;${FONT_STYLE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F0;${FONT_STYLE}">
    <tr><td align="center" style="padding:24px 12px;${FONT_STYLE}">
      <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:720px;max-width:720px;background:#F4F4F0;${FONT_STYLE}">
        <tr><td style="padding:8px 4px 20px;${FONT_STYLE}">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#002FA7;${FONT_STYLE}">AGENCY INSIGHTS Control Center · Weekly Review</div>
          <h1 style="margin:10px 0 6px;font-size:30px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">Weekly meeting MoM</h1>
          <div style="font-size:14px;color:#525252;${FONT_STYLE}">WBR cycle ${esc(data.wbrDateLabel)}</div>
        </td></tr>

        <tr><td style="padding:0 0 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;">
            <tr><td style="padding:22px 24px 8px;">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#002FA7;">WEEKLY PULSE (${esc(pulse.weeklyDate)})</div>
              <div style="font-size:36px;font-weight:900;letter-spacing:-0.05em;margin:8px 0 4px;">${esc(formatInrCompact(pulse.weeklyTotal))}</div>
              <div style="font-size:12px;font-weight:800;color:${wowColor};text-transform:uppercase;">
                ${wowArrow} ${esc(formatInrCompact(wowDelta))} · ${esc(Math.abs(wowPct).toFixed(1))}% WOW
              </div>
            </td></tr>
            <tr><td style="padding:8px 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:16px;">
                    <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#00A675;margin-bottom:8px;">↑ TOP 3 GAINERS</div>
                    <table role="presentation" width="100%">${shiftRows(pulse.gainers, true)}</table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:16px;border-left:1px solid #eee;">
                    <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#FF3B30;margin-bottom:8px;">↓ TOP 3 LOSERS</div>
                    <table role="presentation" width="100%">${shiftRows(pulse.losers, false)}</table>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;">
            <tr><td style="padding:22px 24px 10px;">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#525252;${FONT_STYLE}">Weekly spends pulse</div>
              <h2 style="margin:6px 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">Week on week spends trend</h2>
              <p style="margin:0 0 16px;font-size:13px;color:#525252;line-height:1.45;${FONT_STYLE}">Last 12 weeks of uploaded spends. Inclusive series keeps Nova Mobility &amp; Orion Retail; exclusive series removes them (same rule as Snapshot).</p>
              <div style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#002FA7;margin-bottom:8px;">Including Nova Mobility &amp; Orion Retail</div>
              ${barChartHtml(data.wowInclusive, '#D92218')}
              <div style="height:22px;"></div>
              <div style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#002FA7;margin-bottom:8px;">Excluding Nova Mobility &amp; Orion Retail</div>
              ${barChartHtml(data.wowExclusive, '#002FA7')}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;">
            <tr><td style="padding:22px 24px 8px;background:#F4F4F0;border-bottom:1px solid #111;">
              <table role="presentation" width="100%"><tr>
                <td>
                  <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#525252;${FONT_STYLE}">Portfolio Intelligence</div>
                  <h2 style="margin:6px 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">
                    <a href="${esc(healthHref)}" style="color:#111;text-decoration:none;${FONT_STYLE}">Client Health Board ↗</a>
                  </h2>
                  <p style="margin:0;font-size:13px;color:#525252;max-width:460px;line-height:1.45;${FONT_STYLE}">Designated Primary KPI MTD sets the path (same formula as KPI Tracker). Performance &amp; Engagement RAG reflect the current WBR week.</p>
                </td>
                <td align="right" valign="top" style="white-space:nowrap;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#525252;">
                  <div style="background:#fff;border:1px solid #e5e5e5;padding:6px 10px;margin-bottom:6px;">WBR CYCLE: ${esc(data.wbrDateLabel.toUpperCase())}</div>
                  <div style="background:#fff;border:1px solid #e5e5e5;padding:6px 10px;">KPI MONTH: ${esc(kpiMonthLabel)}</div>
                </td>
              </tr></table>
            </td></tr>
            <tr><td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #111;">
                <tr>
                  <td width="33%" valign="top" style="padding:20px;border-right:1px solid #111;">
                    <a href="${esc(kpiOn)}" style="text-decoration:none;color:#111;">
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#525252;">ON PATH ↗</div>
                      <div style="font-size:36px;font-weight:900;color:#00A675;margin:6px 0 2px;">${health.onPath}</div>
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;">CLIENTS</div>
                      <div style="font-size:10px;color:#6b7280;margin-top:8px;text-transform:uppercase;letter-spacing:0.06em;">UNIQUE CLIDS · PRIMARY KPI ON TARGET</div>
                    </a>
                  </td>
                  <td width="33%" valign="top" style="padding:20px;border-right:1px solid #111;">
                    <a href="${esc(kpiOff)}" style="text-decoration:none;color:#111;">
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#525252;">OFF PATH ↗</div>
                      <div style="font-size:36px;font-weight:900;color:#FF3B30;margin:6px 0 2px;">${health.offPath}</div>
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;">CLIENTS</div>
                      <div style="font-size:10px;color:#6b7280;margin-top:8px;text-transform:uppercase;letter-spacing:0.06em;">UNIQUE CLIDS · PRIMARY KPI BEHIND TARGET</div>
                    </a>
                  </td>
                  <td width="33%" valign="top" style="padding:20px;">
                    <a href="${esc(kpiNone)}" style="text-decoration:none;color:#111;">
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#525252;">NO SIGNAL ↗</div>
                      <div style="font-size:36px;font-weight:900;color:#525252;margin:6px 0 2px;">${health.noSignal}</div>
                      <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;">CLIENTS</div>
                      <div style="font-size:10px;color:#6b7280;margin-top:8px;text-transform:uppercase;letter-spacing:0.06em;">UNIQUE CLIDS · PRIMARY KPI MTD N/A</div>
                    </a>
                  </td>
                </tr>
              </table>
            </td></tr>
            <tr><td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" valign="top" style="padding:20px;border-right:1px solid #111;">
                    <a href="${esc(wbrHref)}" style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#525252;text-decoration:none;">PERFORMANCE RAG · THIS WEEK ↗</a>
                    <div style="margin:12px 0;">${stackedRagBar(health.pGreen, health.pAmber, health.pRed)}</div>
                    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                      <a href="${esc(perfGreen)}" style="color:#00A675;text-decoration:none;">${health.pGreen} GREEN</a>
                      &nbsp;&nbsp;
                      <a href="${esc(perfAmber)}" style="color:#F59E0B;text-decoration:none;">${health.pAmber} AMBER</a>
                      &nbsp;&nbsp;
                      <a href="${esc(perfRed)}" style="color:#FF3B30;text-decoration:none;">${health.pRed} RED</a>
                    </div>
                  </td>
                  <td width="50%" valign="top" style="padding:20px;">
                    <a href="${esc(wbrHref)}" style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#525252;text-decoration:none;">ENGAGEMENT RAG · THIS WEEK ↗</a>
                    <div style="margin:12px 0;">${stackedRagBar(health.eGreen, health.eAmber, health.eRed)}</div>
                    <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                      <a href="${esc(engGreen)}" style="color:#00A675;text-decoration:none;">${health.eGreen} GREEN</a>
                      &nbsp;&nbsp;
                      <a href="${esc(engAmber)}" style="color:#F59E0B;text-decoration:none;">${health.eAmber} AMBER</a>
                      &nbsp;&nbsp;
                      <a href="${esc(engRed)}" style="color:#FF3B30;text-decoration:none;">${health.eRed} RED</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;${FONT_STYLE}">
            <tr><td style="padding:22px 24px;${FONT_STYLE}">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#525252;${FONT_STYLE}">Risk review</div>
              <h2 style="margin:6px 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">Amber &amp; Red client summary</h2>
              <p style="font-size:14px;line-height:1.5;color:#374151;margin:0 0 16px;${FONT_STYLE}">
                ${data.riskClients.length
                  ? `${data.riskClients.length} account${data.riskClients.length === 1 ? '' : 's'} need attention this cycle (${redCount} Red, ${amberCount} Amber on Performance and/or Engagement). Notes are rewritten into a common bullet format from CSM comments, performance summary, and executive summary &amp; challenges.`
                  : 'No Amber or Red accounts on this WBR cycle.'}
              </p>
              ${riskBlocks}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;${FONT_STYLE}">
            <tr><td style="padding:22px 24px;${FONT_STYLE}">
              <table role="presentation" width="100%"><tr>
                <td>
                  <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;${FONT_STYLE}">Accountability Pulse</div>
                  <h2 style="margin:6px 0 0;font-size:22px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">
                    <a href="${esc(actionsHref)}" style="color:#111;text-decoration:none;${FONT_STYLE}">Action Board ↗</a>
                  </h2>
                </td>
              </tr></table>
              ${data.actionBoard
                .map((row) => {
                  const color = ACTION_COLORS[row.status];
                  const countColor = row.status === 'Overdue' && row.count > 0 ? '#FF3B30' : '#525252';
                  return `<table role="presentation" width="100%" style="margin-top:14px;${FONT_STYLE}"><tr>
                    <td style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;${FONT_STYLE}">${esc(row.status)}</td>
                    <td align="right" style="font-size:13px;font-weight:700;color:${countColor};${FONT_STYLE}">${row.count}</td>
                  </tr>
                  <tr><td colspan="2" style="padding-top:6px;">${actionBar(row.count, maxAction, color)}</td></tr>
                  </table>`;
                })
                .join('')}
              <table role="presentation" style="margin-top:18px;${FONT_STYLE}"><tr>
                ${data.actionBoard
                  .map(
                    (row) =>
                      `<td style="padding-right:14px;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;${FONT_STYLE}">
                        <span style="display:inline-block;width:8px;height:8px;background:${ACTION_COLORS[row.status]};margin-right:6px;"></span>${esc(row.status)}
                      </td>`
                  )
                  .join('')}
              </tr></table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #111;${FONT_STYLE}">
            <tr><td style="padding:22px 24px;${FONT_STYLE}">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#525252;${FONT_STYLE}">Action items since last cycle</div>
              <h2 style="margin:6px 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.03em;${FONT_STYLE}">Closed &amp; updated work</h2>
              <p style="font-size:13px;color:#525252;margin:0 0 16px;${FONT_STYLE}">Window: ${esc(format(startOfDay(subWeeks(parse(data.wbrDate, 'yyyy-MM-dd', new Date()), 1)), 'dd MMM'))} – ${esc(data.wbrDateLabel)}.</p>
              <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#00A675;margin-bottom:8px;${FONT_STYLE}">Closed this cycle (${data.closedActions.length})</div>
              <table role="presentation" width="100%">${actionListHtml(data.closedActions, 'No action items were marked completed in this window.')}</table>
              <div style="height:18px;"></div>
              <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#002FA7;margin-bottom:8px;${FONT_STYLE}">Updated this cycle (${data.updatedActions.length})</div>
              <table role="presentation" width="100%">${actionListHtml(data.updatedActions, 'No other action items were updated in this window.')}</table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 4px 0;font-size:11px;color:#9ca3af;">
          Generated from Weekly Review · <a href="${esc(wbrHref)}" style="color:#002FA7;">Open WBR board</a> · <a href="${esc(snapshotHref)}" style="color:#002FA7;">Open Snapshot</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function momPlainText(data: MomReportData): string {
  return [
    `AGENCY INSIGHTS Weekly MoM — ${data.wbrDateLabel}`,
    `Weekly Pulse (${data.pulse.weeklyDate}): ${formatInrCompact(data.pulse.weeklyTotal)}`,
    '',
    'This is a text fallback. Open the .eml file to send the formatted HTML MoM in Outlook.',
    '',
    `Snapshot: ${PUBLIC_APP_ORIGIN}/dashboard/business-snapshot`,
    `Action Board: ${PUBLIC_APP_ORIGIN}/dashboard/actions`,
    `WBR: ${PUBLIC_APP_ORIGIN}/dashboard/wbr?date=${data.wbrDate}`,
  ].join('\n');
}

function rfc2047Subject(subject: string) {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const bytes = new TextEncoder().encode(subject);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function buildMomEml(opts: { to?: string; subject: string; html: string }) {
  const to = (opts.to || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
  const lines = [
    'X-Unsent: 1',
    to ? `To: ${to}` : 'To: ',
    `Subject: ${rfc2047Subject(opts.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    opts.html.replace(/\r?\n/g, '\r\n'),
  ];
  return lines.join('\r\n');
}

export function downloadMomHtml(html: string, wbrDateKey: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `Agency_Weekly_MoM_${wbrDateKey}.html`);
}

export function downloadMomEml(html: string, wbrDateKey: string, subject: string, to = '') {
  const eml = buildMomEml({ to, subject, html });
  const blob = new Blob([eml], { type: 'message/rfc822;charset=utf-8' });
  saveAs(blob, `Agency_Weekly_MoM_${wbrDateKey}.eml`);
}

export async function copyMomHtml(html: string, plain: string) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plain);
}

export function openMomMailto(to: string, subject: string, body: string) {
  const recipients = to
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
  window.location.href = `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function exportMomPdf(html: string, wbrDateKey: string) {
  const { default: jsPDF } = await import('jspdf');
  const { default: html2canvas } = await import('html2canvas');

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = '800px';
  host.style.zIndex = '-1';
  host.style.pointerEvents = 'none';
  host.style.background = '#F4F4F0';
  const parsed = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  host.innerHTML = parsed ? parsed[1] : html;
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#F4F4F0',
      windowWidth: 800,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`Agency_Weekly_MoM_${wbrDateKey}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
