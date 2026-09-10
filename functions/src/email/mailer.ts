import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {
  EmailAutomationKey,
  EmailAutomationSettings,
  graphCredentialsConfigured,
  MS_GRAPH_CLIENT_ID,
  MS_GRAPH_CLIENT_SECRET,
  MS_GRAPH_SENDER,
  MS_GRAPH_TENANT_ID,
} from "./config";
import {EmailContent} from "./templates";

export interface SendAlertOptions {
  to: string | string[];
  content: EmailContent;
  settings: EmailAutomationSettings;
  /** Dedup key — skip send if this mailLog doc already exists. */
  dedupeKey: string;
  meta?: Record<string, unknown>;
  /** In-app / Teams type. Omit to skip in-app + Teams (e.g. password reset). */
  notificationType?: EmailAutomationKey | "test";
  notificationHref?: string;
  /** Never post password-reset links to Teams. */
  notifyTeams?: boolean;
}

function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

let cachedToken: {value: string; expiresAtMs: number} | null = null;

async function getGraphAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) {
    return cachedToken.value;
  }

  const tenant = MS_GRAPH_TENANT_ID.value()?.trim();
  const clientId = MS_GRAPH_CLIENT_ID.value()?.trim();
  const clientSecret = MS_GRAPH_CLIENT_SECRET.value()?.trim();
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials are not configured");
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Graph token failed: ${json.error || res.status} ${json.error_description || ""}`.trim()
    );
  }

  const expiresInSec = Number(json.expires_in || 3600);
  cachedToken = {
    value: json.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };
  return json.access_token;
}

async function graphSendMail(params: {
  sender: string;
  fromName: string;
  recipients: string[];
  content: EmailContent;
}): Promise<void> {
  const token = await getGraphAccessToken();
  const sender = encodeURIComponent(params.sender);
  const url = `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`;

  const payload = {
    message: {
      subject: params.content.subject,
      body: {
        contentType: "HTML",
        content: params.content.html || params.content.text,
      },
      toRecipients: params.recipients.map((address) => ({
        emailAddress: {address},
      })),
      from: {
        emailAddress: {
          address: params.sender,
          name: params.fromName,
        },
      },
      replyTo: [
        {
          emailAddress: {
            address: params.sender,
            name: params.fromName,
          },
        },
      ],
    },
    saveToSentItems: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

async function resolveUserIdsByEmail(emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (emails.length === 0) return map;
  const snap = await getFirestore().collection("users").get();
  const wanted = new Set(emails);
  snap.forEach((doc) => {
    const email = String(doc.data().email || "")
      .trim()
      .toLowerCase();
    if (email && wanted.has(email)) {
      map.set(email, doc.id);
    }
  });
  return map;
}

export async function writeInAppNotifications(params: {
  emails: string[];
  type: EmailAutomationKey | "test";
  title: string;
  body: string;
  href?: string;
}): Promise<void> {
  const db = getFirestore();
  const ids = await resolveUserIdsByEmail(params.emails);
  const writes = params.emails.map((email) => {
    const userId = ids.get(email);
    if (!userId) return Promise.resolve();
    return db.collection("notifications").add({
      userId,
      email,
      type: params.type,
      title: params.title,
      body: params.body,
      href: params.href || "",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await Promise.all(writes);
}

async function postTeamsWebhook(settings: EmailAutomationSettings, content: EmailContent): Promise<void> {
  const url = settings.teamsWebhookUrl?.trim();
  if (!url || !/^https:\/\//i.test(url)) return;

  const payload = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: "C8102E",
    summary: content.subject,
    title: content.subject,
    text: content.text.replace(/\n/g, "<br/>"),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn("Teams webhook failed", {status: res.status, body: (await res.text()).slice(0, 200)});
    }
  } catch (err) {
    logger.warn("Teams webhook error", {err});
  }
}

export async function sendAlertEmail(options: SendAlertOptions): Promise<{
  sent: boolean;
  skipped?: string;
}> {
  const recipients = normalizeRecipients(options.to);
  if (recipients.length === 0) {
    return {sent: false, skipped: "no-recipients"};
  }

  if (!graphCredentialsConfigured()) {
    logger.error("Microsoft Graph credentials missing — cannot send alert email", {
      dedupeKey: options.dedupeKey,
    });
    return {sent: false, skipped: "graph-not-configured"};
  }

  const db = getFirestore();
  const logRef = db.collection("mailLog").doc(options.dedupeKey);
  const existing = await logRef.get();
  if (existing.exists && existing.data()?.status === "sent") {
    return {sent: false, skipped: "already-sent"};
  }

  await logRef.set(
    {
      status: "sending",
      to: recipients,
      subject: options.content.subject,
      from: options.settings.fromEmail,
      provider: "microsoft-graph",
      attemptedAt: FieldValue.serverTimestamp(),
      meta: options.meta || {},
    },
    {merge: true}
  );

  const sender =
    MS_GRAPH_SENDER.value()?.trim() ||
    options.settings.fromEmail ||
    "alerts@example.com";

  try {
    await graphSendMail({
      sender,
      fromName: options.settings.fromName || "AGENCY INSIGHTS Alerts",
      recipients,
      content: options.content,
    });

    await logRef.set(
      {
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
      },
      {merge: true}
    );

    if (options.notificationType) {
      try {
        await writeInAppNotifications({
          emails: recipients,
          type: options.notificationType,
          title: options.content.subject.replace(/^\[AGENCY INSIGHTS\]\s*/i, ""),
          body: options.content.text.split("\n").filter(Boolean).slice(1, 4).join(" "),
          href: options.notificationHref,
        });
      } catch (err) {
        logger.warn("In-app notification write failed", {err, dedupeKey: options.dedupeKey});
      }
    }

    if (options.notifyTeams !== false && options.notificationType && options.notificationType !== "passwordReset") {
      await postTeamsWebhook(options.settings, options.content);
    }

    logger.info("Alert email sent via Microsoft Graph", {
      dedupeKey: options.dedupeKey,
      to: recipients,
      from: sender,
    });

    return {sent: true};
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logRef.set(
      {
        status: "failed",
        error: message.slice(0, 500),
        failedAt: FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
    logger.error("Alert email failed", {
      dedupeKey: options.dedupeKey,
      message,
    });
    throw err;
  }
}

/** Resolve assignee free-text (name or email) to a user email. */
export async function resolveUserEmail(assignee: string | undefined | null): Promise<{
  email: string | null;
  displayName: string;
}> {
  const raw = (assignee || "").trim();
  if (!raw) return {email: null, displayName: ""};

  if (raw.includes("@")) {
    return {email: raw.toLowerCase(), displayName: raw.split("@")[0] || raw};
  }

  const db = getFirestore();
  const snap = await db.collection("users").get();
  const needle = raw.toLowerCase();
  for (const doc of snap.docs) {
    const data = doc.data();
    const displayName = String(data.displayName || "").trim();
    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    if (displayName.toLowerCase() === needle && email) {
      return {email, displayName: displayName || email};
    }
  }

  return {email: null, displayName: raw};
}

export async function listAdminEmails(): Promise<string[]> {
  const snap = await getFirestore().collection("users").where("role", "==", "Admin").get();
  const emails: string[] = [];
  snap.forEach((doc) => {
    const email = String(doc.data().email || "")
      .trim()
      .toLowerCase();
    if (email) emails.push(email);
  });
  return [...new Set(emails)];
}

export async function findUserByEmail(email: string): Promise<{
  uid: string;
  email: string;
  displayName: string;
  role?: string;
} | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const snap = await getFirestore().collection("users").get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const found = String(data.email || "")
      .trim()
      .toLowerCase();
    if (found === needle) {
      return {
        uid: doc.id,
        email: found,
        displayName: String(data.displayName || found),
        role: data.role ? String(data.role) : undefined,
      };
    }
  }
  return null;
}
