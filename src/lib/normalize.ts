/**
 * Channel name canonicalization — collapses casing/alias variants
 * (e.g. LinkedIN / linkedin / Linked In → LinkedIn) across KPI + Spends data.
 */

import type { ActionStatus } from './types';

const CHANNEL_ALIASES: Record<string, string> = {
  // Meta / Facebook
  meta: 'Meta',
  'meta ads': 'Meta',
  metaads: 'Meta',
  facebook: 'Meta',
  'facebook ads': 'Meta',
  fb: 'Meta',
  'fb ads': 'Meta',
  'meta platforms': 'Meta',

  // LinkedIn
  linkedin: 'LinkedIn',
  'linked in': 'LinkedIn',
  'linked-in': 'LinkedIn',
  'linkedin ads': 'LinkedIn',
  linkedinads: 'LinkedIn',
  li: 'LinkedIn',

  // Google
  google: 'Google',
  'google ads': 'Google',
  googleads: 'Google',
  adwords: 'Google',
  'google adwords': 'Google',
  'google search': 'Google',
  'google demand gen': 'Google',
  'demand gen': 'Google',
  dv360: 'DV360',
  'display video 360': 'DV360',

  // YouTube
  youtube: 'YouTube',
  'you tube': 'YouTube',
  'youtube ads': 'YouTube',

  // TikTok
  tiktok: 'TikTok',
  'tik tok': 'TikTok',
  'tiktok ads': 'TikTok',

  // Snapchat
  snapchat: 'Snapchat',
  snap: 'Snapchat',
  'snap ads': 'Snapchat',

  // X / Twitter
  x: 'X',
  twitter: 'X',
  'twitter ads': 'X',
  'x ads': 'X',

  // Bing / Microsoft
  bing: 'Bing',
  'bing ads': 'Bing',
  'microsoft ads': 'Bing',
  microsoft: 'Bing',

  // Apple
  'apple search ads': 'Apple Search Ads',
  asa: 'Apple Search Ads',
  apple: 'Apple Search Ads',
  'apple ads': 'Apple Search Ads',

  // Common media buckets
  display: 'Display',
  programmatic: 'Programmatic',
  affiliates: 'Affiliates',
  affiliate: 'Affiliates',
  branding: 'Branding',
  brand: 'Branding',
  marketplace: 'Marketplace',
  marketplaces: 'Marketplace',
  organic: 'Organic',
  seo: 'SEO',
  email: 'Email',
  sms: 'SMS',
  crm: 'CRM',
  others: 'Others',
  other: 'Others',
  na: 'N/A',
  'n/a': 'N/A',
  'n.a.': 'N/A',
};

function channelKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_/\\|]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word; // keep acronyms if already upper
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Canonical display name for a channel / channelVendor string. */
export function canonicalizeChannel(raw: string | null | undefined): string {
  if (raw == null) return 'N/A';
  const trimmed = raw.toString().trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'N/A';

  const key = channelKey(trimmed);
  if (CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];

  // Soft match: strip trailing "ads"
  const withoutAds = key.replace(/\s+ads$/, '').trim();
  if (withoutAds !== key && CHANNEL_ALIASES[withoutAds]) {
    return CHANNEL_ALIASES[withoutAds];
  }

  return titleCaseWords(trimmed);
}

export const ACTION_STATUSES = [
  'Work-In Progress',
  'On-Hold',
  'Observation',
  'Overdue',
  'Completed',
] as const;

/** Map legacy + alias labels onto the current ActionStatus set. */
export function canonicalizeActionStatus(raw: string | null | undefined): ActionStatus {
  if (!raw) return 'Work-In Progress';
  const key = raw.toString().toLowerCase().replace(/[_/\\|]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (key === 'completed' || key === 'done' || key === 'complete') return 'Completed';
  if (key === 'overdue' || key === 'late') return 'Overdue';
  if (
    key === 'observation' ||
    key === 'observe' ||
    key === 'monitoring' ||
    key === 'watch'
  ) {
    return 'Observation';
  }
  if (
    key === 'on-hold' ||
    key === 'on hold' ||
    key === 'hold' ||
    key === 'blocked' ||
    key === 'paused'
  ) {
    return 'On-Hold';
  }
  if (
    key === 'work-in progress' ||
    key === 'work in progress' ||
    key === 'in progress' ||
    key === 'wip' ||
    key === 'pending' ||
    key === 'todo' ||
    key === 'open'
  ) {
    return 'Work-In Progress';
  }

  return 'Work-In Progress';
}

/** True when due/completion date is before today (calendar day). */
export function isActionPastDue(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  const raw = dueDate.toString().trim();
  if (!raw) return false;

  // Prefer ISO / yyyy-MM-dd; fall back to Date parse
  let d = new Date(raw);
  if (Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    d = new Date(`${raw.slice(0, 10)}T00:00:00`);
  }
  if (Number.isNaN(d.getTime())) return false;

  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return dueDay < todayDay;
}

/**
 * Effective board status: non-completed, non-observation items past their
 * completion date become Overdue automatically. Observation stays put.
 */
export function resolveActionStatus(
  status: string | null | undefined,
  dueDate?: string | null
): ActionStatus {
  const base = canonicalizeActionStatus(status);
  if (base === 'Completed' || base === 'Observation') return base;
  if (isActionPastDue(dueDate)) return 'Overdue';
  return base;
}
