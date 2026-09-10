export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, bodyHtml: string, ctaUrl: string, ctaLabel = "Open Control Center"): string {
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(ctaUrl);
  const safeCta = escapeHtml(ctaLabel);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #111;">
        <tr>
          <td style="background:#111;color:#f4f4f1;padding:20px 24px;">
            <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.7;">AGENCY INSIGHTS Control Center</div>
            <div style="font-size:22px;font-weight:800;margin-top:6px;">${safeTitle}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;font-size:14px;line-height:1.55;">
            ${bodyHtml}
            <p style="margin:28px 0 0;">
              <a href="${safeUrl}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;padding:12px 18px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                ${safeCta}
              </a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e5e0;font-size:11px;color:#666;">
            Sent from alerts@example.com
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function taskOverdueEmail(params: {
  recipientName: string;
  taskName: string;
  dueDate?: string;
  section?: string;
  priority?: string;
  clientName?: string;
  appBaseUrl: string;
}): EmailContent {
  const name = params.recipientName || "there";
  const task = params.taskName || "Untitled task";
  const due = params.dueDate || "No due date";
  const subject = `[AGENCY INSIGHTS] Action item overdue: ${task}`;
  const text = [
    `Hi ${name},`,
    "",
    `The action item "${task}" is overdue.`,
    `Due date: ${due}`,
    params.section ? `Section: ${params.section}` : "",
    params.priority ? `Priority: ${params.priority}` : "",
    params.clientName ? `Client: ${params.clientName}` : "",
    "",
    `Open: ${params.appBaseUrl}/dashboard/actions`,
    "",
    "— AGENCY INSIGHTS Alerts",
  ]
    .filter(Boolean)
    .join("\n");

  const html = layout(
    "Action item overdue",
    `<p>Hi ${escapeHtml(name)},</p>
     <p>The action item <strong>${escapeHtml(task)}</strong> is overdue and needs attention.</p>
     <ul style="padding-left:18px;margin:16px 0;">
       <li><strong>Due date:</strong> ${escapeHtml(due)}</li>
       ${params.section ? `<li><strong>Section:</strong> ${escapeHtml(params.section)}</li>` : ""}
       ${params.priority ? `<li><strong>Priority:</strong> ${escapeHtml(params.priority)}</li>` : ""}
       ${params.clientName ? `<li><strong>Client:</strong> ${escapeHtml(params.clientName)}</li>` : ""}
     </ul>
     <p>Please update status or complete the task in Action Items.</p>`,
    `${params.appBaseUrl}/dashboard/actions`
  );

  return {subject, text, html};
}

export function taskAssignedEmail(params: {
  recipientName: string;
  taskName: string;
  dueDate?: string;
  section?: string;
  priority?: string;
  clientName?: string;
  appBaseUrl: string;
}): EmailContent {
  const name = params.recipientName || "there";
  const task = params.taskName || "Untitled task";
  const subject = `[AGENCY INSIGHTS] Action item assigned: ${task}`;
  const text = [
    `Hi ${name},`,
    "",
    `You have been assigned "${task}".`,
    params.dueDate ? `Due date: ${params.dueDate}` : "",
    params.section ? `Section: ${params.section}` : "",
    params.priority ? `Priority: ${params.priority}` : "",
    params.clientName ? `Client: ${params.clientName}` : "",
    "",
    `Open: ${params.appBaseUrl}/dashboard/actions`,
    "",
    "— AGENCY INSIGHTS Alerts",
  ]
    .filter(Boolean)
    .join("\n");

  const html = layout(
    "Action item assigned",
    `<p>Hi ${escapeHtml(name)},</p>
     <p>You have been assigned <strong>${escapeHtml(task)}</strong>.</p>
     <ul style="padding-left:18px;margin:16px 0;">
       ${params.dueDate ? `<li><strong>Due date:</strong> ${escapeHtml(params.dueDate)}</li>` : ""}
       ${params.section ? `<li><strong>Section:</strong> ${escapeHtml(params.section)}</li>` : ""}
       ${params.priority ? `<li><strong>Priority:</strong> ${escapeHtml(params.priority)}</li>` : ""}
       ${params.clientName ? `<li><strong>Client:</strong> ${escapeHtml(params.clientName)}</li>` : ""}
     </ul>`,
    `${params.appBaseUrl}/dashboard/actions`
  );

  return {subject, text, html};
}

export function accessGrantedEmail(params: {
  recipientName: string;
  role?: string;
  appBaseUrl: string;
}): EmailContent {
  const name = params.recipientName || "there";
  const subject = "[AGENCY INSIGHTS] Access granted";
  const text = [
    `Hi ${name},`,
    "",
    "Your access to AGENCY INSIGHTS Control Center has been approved.",
    params.role ? `Role: ${params.role}` : "",
    "",
    `Sign in: ${params.appBaseUrl}`,
    "",
    "— AGENCY INSIGHTS Alerts",
  ]
    .filter(Boolean)
    .join("\n");

  const html = layout(
    "Access granted",
    `<p>Hi ${escapeHtml(name)},</p>
     <p>Your access to <strong>AGENCY INSIGHTS Control Center</strong> has been approved.</p>
     ${params.role ? `<p><strong>Role:</strong> ${escapeHtml(params.role)}</p>` : ""}
     <p>You can sign in with your work email whenever you are ready.</p>`,
    params.appBaseUrl,
    "Sign in"
  );

  return {subject, text, html};
}

export function accessRequestedEmail(params: {
  requesterName: string;
  requesterEmail: string;
  appBaseUrl: string;
}): EmailContent {
  const subject = `[AGENCY INSIGHTS] Access requested: ${params.requesterEmail}`;
  const text = [
    "A new user requested access to AGENCY INSIGHTS Control Center.",
    "",
    `Name: ${params.requesterName || "—"}`,
    `Email: ${params.requesterEmail}`,
    "",
    `Review: ${params.appBaseUrl}/dashboard/admin`,
    "",
    "— AGENCY INSIGHTS Alerts",
  ].join("\n");

  const html = layout(
    "Access requested",
    `<p>A new user requested access to <strong>AGENCY INSIGHTS Control Center</strong>.</p>
     <ul style="padding-left:18px;margin:16px 0;">
       <li><strong>Name:</strong> ${escapeHtml(params.requesterName || "—")}</li>
       <li><strong>Email:</strong> ${escapeHtml(params.requesterEmail)}</li>
     </ul>
     <p>Approve or deny from Administration → Manage Access.</p>`,
    `${params.appBaseUrl}/dashboard/admin`,
    "Review request"
  );

  return {subject, text, html};
}

export function passwordResetEmail(params: {
  recipientName: string;
  resetLink: string;
  appBaseUrl: string;
}): EmailContent {
  const name = params.recipientName || "there";
  const subject = "[AGENCY INSIGHTS] Reset your password";
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your AGENCY INSIGHTS Control Center password.",
    "Open this link to choose a new password:",
    params.resetLink,
    "",
    "If you did not request this, you can ignore this email.",
    "",
    "— AGENCY INSIGHTS Alerts",
  ].join("\n");

  const html = layout(
    "Reset your password",
    `<p>Hi ${escapeHtml(name)},</p>
     <p>We received a request to reset your <strong>AGENCY INSIGHTS Control Center</strong> password.</p>
     <p>This link expires after a short time. If you did not request a reset, you can ignore this email.</p>`,
    params.resetLink,
    "Choose a new password"
  );

  return {subject, text, html};
}

export function userInvitedEmail(params: {
  recipientName: string;
  resetLink: string;
  role?: string;
  appBaseUrl: string;
}): EmailContent {
  const name = params.recipientName || "there";
  const subject = "[AGENCY INSIGHTS] You have been invited";
  const text = [
    `Hi ${name},`,
    "",
    "You have been invited to AGENCY INSIGHTS Control Center.",
    params.role ? `Role: ${params.role}` : "",
    "Open this link to set your password and sign in:",
    params.resetLink,
    "",
    `App: ${params.appBaseUrl}`,
    "",
    "— AGENCY INSIGHTS Alerts",
  ]
    .filter(Boolean)
    .join("\n");

  const html = layout(
    "You're invited",
    `<p>Hi ${escapeHtml(name)},</p>
     <p>You have been invited to <strong>AGENCY INSIGHTS Control Center</strong>.</p>
     ${params.role ? `<p><strong>Role:</strong> ${escapeHtml(params.role)}</p>` : ""}
     <p>Use the button below to set your password. The link is unique to your inbox.</p>`,
    params.resetLink,
    "Set password and sign in"
  );

  return {subject, text, html};
}

export function testAlertEmail(params: {appBaseUrl: string; fromEmail: string}): EmailContent {
  const subject = "[AGENCY INSIGHTS] Test alert email";
  const text = `This is a test message from ${params.fromEmail}.\n\nApp: ${params.appBaseUrl}\n`;
  const html = layout(
    "Test alert",
    `<p>This is a test message from <strong>${escapeHtml(params.fromEmail)}</strong>.</p>
     <p>If you received this, Microsoft Graph mail send is working for the shared mailbox.</p>`,
    params.appBaseUrl,
    "Open Control Center"
  );
  return {subject, text, html};
}
