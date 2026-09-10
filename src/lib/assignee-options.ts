import type { ActionItem, UserProfile } from '@/lib/types';

export type AssigneeOption = {
  /** Stored on the action as assignedTo (display name). */
  name: string;
  email: string;
  status?: UserProfile['status'];
};

function personLabel(user: UserProfile): string {
  return (user.displayName || '').trim() || (user.email || '').trim();
}

/**
 * Full assignee directory for task create/edit.
 * Includes every registry profile with a name or email (Invite sent, registered, pending).
 * Also keeps historical assignedTo names that are not in the registry.
 */
export function buildAssigneeOptions(
  users: UserProfile[] | null | undefined,
  extraNames: Array<string | undefined | null> = []
): AssigneeOption[] {
  const byName = new Map<string, AssigneeOption>();

  const add = (name: string, email = '', status?: UserProfile['status']) => {
    const label = name.trim();
    if (!label) return;
    const key = label.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { name: label, email: email.trim().toLowerCase(), status });
      return;
    }
    if (!existing.email && email) existing.email = email.trim().toLowerCase();
    if (!existing.status && status) existing.status = status;
  };

  (users || []).forEach((user) => {
    const name = personLabel(user);
    if (!name) return;
    add(name, user.email || '', user.status);
  });

  extraNames.forEach((raw) => {
    const name = (raw || '').trim();
    if (!name) return;
    add(name);
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extraAssigneeNamesFromActions(
  actions: ActionItem[] | null | undefined
): string[] {
  if (!actions) return [];
  const names: string[] = [];
  actions.forEach((item) => {
    const raw = (item.assignedTo || '').trim();
    if (!raw) return;
    raw.split(/[,;&/]+/).forEach((part) => {
      const name = part.trim();
      if (name) names.push(name);
    });
  });
  return names;
}
