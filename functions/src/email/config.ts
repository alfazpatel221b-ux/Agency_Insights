import {getFirestore} from "firebase-admin/firestore";
import {defineSecret, defineString} from "firebase-functions/params";

/** Entra ID (Azure AD) tenant ID for Microsoft Graph client-credentials. */
export const MS_GRAPH_TENANT_ID = defineString("MS_GRAPH_TENANT_ID", {
  default: "",
  description: "Entra tenant ID (Directory ID) for Graph mail send",
});

/** App registration application (client) ID. */
export const MS_GRAPH_CLIENT_ID = defineString("MS_GRAPH_CLIENT_ID", {
  default: "",
  description: "Entra app registration client ID",
});

/** App registration client secret. */
export const MS_GRAPH_CLIENT_SECRET = defineSecret("MS_GRAPH_CLIENT_SECRET");

/** Mailbox UPN to send as (must allow Mail.Send via the app). */
export const MS_GRAPH_SENDER = defineString("MS_GRAPH_SENDER", {
  default: "alerts@example.com",
  description: "Office 365 mailbox that appears in the From field",
});

export const EMAIL_FROM_NAME = defineString("EMAIL_FROM_NAME", {
  default: "AGENCY INSIGHTS Alerts",
  description: "Display name on outbound alert emails",
});

export const APP_BASE_URL = defineString("APP_BASE_URL", {
  default: "https://agency-insights-demo.example.com",
  description: "Public app URL used in email CTAs",
});

export type EmailAutomationKey =
  | "taskOverdue"
  | "taskAssigned"
  | "accessGranted"
  | "accessRequested"
  | "passwordReset"
  | "userInvited";

export interface EmailAutomationSettings {
  fromEmail: string;
  fromName: string;
  appBaseUrl: string;
  teamsWebhookUrl: string;
  enabled: Record<EmailAutomationKey, boolean>;
}

export const DEFAULT_EMAIL_AUTOMATIONS: EmailAutomationSettings = {
  fromEmail: "alerts@example.com",
  fromName: "AGENCY INSIGHTS Alerts",
  appBaseUrl: "https://agency-insights-demo.example.com",
  teamsWebhookUrl: "",
  enabled: {
    taskOverdue: true,
    taskAssigned: true,
    accessGranted: true,
    accessRequested: true,
    passwordReset: true,
    userInvited: true,
  },
};

export const EMAIL_SETTINGS_PATH = "settings/emailAutomations";

/** Merge Firestore settings with env defaults. */
export async function loadEmailAutomationSettings(): Promise<EmailAutomationSettings> {
  const defaults: EmailAutomationSettings = {
    ...DEFAULT_EMAIL_AUTOMATIONS,
    fromEmail: MS_GRAPH_SENDER.value()?.trim() || DEFAULT_EMAIL_AUTOMATIONS.fromEmail,
    fromName: EMAIL_FROM_NAME.value()?.trim() || DEFAULT_EMAIL_AUTOMATIONS.fromName,
    appBaseUrl: (APP_BASE_URL.value()?.trim() || DEFAULT_EMAIL_AUTOMATIONS.appBaseUrl).replace(
      /\/$/,
      ""
    ),
    enabled: {...DEFAULT_EMAIL_AUTOMATIONS.enabled},
  };

  try {
    const snap = await getFirestore().doc(EMAIL_SETTINGS_PATH).get();
    if (!snap.exists) return defaults;
    const data = snap.data() || {};
    const enabled = {
      ...defaults.enabled,
      ...(typeof data.enabled === "object" && data.enabled ? data.enabled : {}),
    } as Record<EmailAutomationKey, boolean>;
    return {
      fromEmail: String(data.fromEmail || defaults.fromEmail).trim() || defaults.fromEmail,
      fromName: String(data.fromName || defaults.fromName).trim() || defaults.fromName,
      appBaseUrl:
        String(data.appBaseUrl || defaults.appBaseUrl)
          .trim()
          .replace(/\/$/, "") || defaults.appBaseUrl,
      teamsWebhookUrl: String(data.teamsWebhookUrl || "").trim(),
      enabled,
    };
  } catch {
    return defaults;
  }
}

export function isAutomationEnabled(
  settings: EmailAutomationSettings,
  key: EmailAutomationKey
): boolean {
  return settings.enabled?.[key] !== false;
}

export function graphCredentialsConfigured(): boolean {
  return Boolean(
    MS_GRAPH_TENANT_ID.value()?.trim() &&
      MS_GRAPH_CLIENT_ID.value()?.trim() &&
      MS_GRAPH_CLIENT_SECRET.value()?.trim()
  );
}
