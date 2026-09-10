export type EmailAutomationKey =
  | 'taskOverdue'
  | 'taskAssigned'
  | 'accessGranted'
  | 'accessRequested'
  | 'passwordReset'
  | 'userInvited';

export interface EmailAutomationSettings {
  fromEmail: string;
  fromName: string;
  appBaseUrl: string;
  teamsWebhookUrl?: string;
  enabled: Record<EmailAutomationKey, boolean>;
  updatedAt?: string;
  updatedBy?: string;
}

export const EMAIL_AUTOMATIONS_DOC = 'settings/emailAutomations';

export const DEFAULT_EMAIL_AUTOMATIONS: EmailAutomationSettings = {
  fromEmail: 'alerts@example.com',
  fromName: 'AGENCY INSIGHTS Alerts',
  appBaseUrl: 'https://agency-insights-demo.example.com',
  teamsWebhookUrl: '',
  enabled: {
    taskOverdue: true,
    taskAssigned: true,
    accessGranted: true,
    accessRequested: true,
    passwordReset: true,
    userInvited: true,
  },
};

export const EMAIL_AUTOMATION_META: Record<
  EmailAutomationKey,
  { title: string; description: string; recipients: string }
> = {
  taskOverdue: {
    title: 'Action item overdue',
    description: 'When an action item becomes Overdue, or is still past due on the daily sweep.',
    recipients: 'Assignee (email + in-app)',
  },
  taskAssigned: {
    title: 'Action item assigned',
    description: 'When a new action item is created or the assignee changes.',
    recipients: 'Assignee (email + in-app)',
  },
  accessGranted: {
    title: 'Access granted',
    description: 'When an admin approves a Pending registration.',
    recipients: 'Approved user (email + in-app)',
  },
  accessRequested: {
    title: 'Access requested',
    description: 'When someone registers and waits for approval.',
    recipients: 'All Admin users (email + in-app)',
  },
  passwordReset: {
    title: 'Forgot password',
    description: 'When a user requests a password reset from the sign-in page. Branded link is sent from the shared mailbox (not Firebase no-reply).',
    recipients: 'That user (email only)',
  },
  userInvited: {
    title: 'User invited',
    description: 'When an admin invites a teammate. Includes a set-password link from the shared mailbox.',
    recipients: 'Invited user (email)',
  },
};

export interface TeamNotification {
  id: string;
  userId: string;
  email?: string;
  type: EmailAutomationKey | 'test';
  title: string;
  body: string;
  href?: string;
  read: boolean;
  createdAt?: { seconds: number; nanoseconds: number } | string;
}
