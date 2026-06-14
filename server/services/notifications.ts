/**
 * notifications.ts
 * Thin wrappers around Resend (email) and Twilio (SMS).
 * Both are optional — functions throw descriptive errors if credentials are absent.
 */

import { Resend } from "resend";
import twilio from "twilio";

// ── App URL ─────────────────────────────────────────────────────────────────
const APP_URL = process.env.APP_URL ?? "https://fitfriends-z30o.onrender.com";
const APP_NAME = "Fit Friends";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? `noreply@${process.env.RESEND_DOMAIN ?? "fitcore.app"}`;

// ── Email via Resend ─────────────────────────────────────────────────────────
export async function sendInviteEmail(opts: {
  toEmail: string;
  inviterName: string;
  personalNote?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email invitations are not configured. Set RESEND_API_KEY in the server environment.");
  }

  const resend = new Resend(apiKey);
  const { toEmail, inviterName, personalNote } = opts;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to ${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:20px;border:1px solid #2a2a2a;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background:#c8e84c;padding:18px 32px;">
              <span style="font-size:22px;font-weight:900;color:#0a0a0a;letter-spacing:-0.5px;">${APP_NAME}</span>
              <span style="font-size:13px;color:#0a0a0a;margin-left:8px;opacity:0.65;">fitness tracker</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px;">
              <p style="margin:0 0 8px;font-size:26px;font-weight:800;color:#f4f4f4;line-height:1.25;">
                ${inviterName} invited you to ${APP_NAME}! 💪
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#888;line-height:1.6;">
                Track workouts, log nutrition, hit goals, and compete on leaderboards together.
              </p>

              ${personalNote ? `
              <div style="background:#1e1e1e;border-left:3px solid #c8e84c;border-radius:0 12px 12px 0;padding:14px 16px;margin-bottom:24px;">
                <p style="margin:0;font-size:14px;color:#ccc;font-style:italic;">"${personalNote}"</p>
                <p style="margin:6px 0 0;font-size:12px;color:#666;">— ${inviterName}</p>
              </div>
              ` : ""}

              <!-- Feature pills -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:0 8px 8px 0;">
                    <span style="display:inline-block;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:7px 14px;font-size:12px;color:#ccc;">🏋️ Workout Logger</span>
                  </td>
                  <td style="padding:0 8px 8px 0;">
                    <span style="display:inline-block;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:7px 14px;font-size:12px;color:#ccc;">🥗 Food Tracker</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 8px 0 0;">
                    <span style="display:inline-block;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:7px 14px;font-size:12px;color:#ccc;">🎯 Goal Engine</span>
                  </td>
                  <td style="padding:0 8px 0 0;">
                    <span style="display:inline-block;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:7px 14px;font-size:12px;color:#ccc;">🏆 Leaderboards</span>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <a href="${APP_URL}" style="display:inline-block;background:#c8e84c;color:#0a0a0a;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:50px;">
                Join ${APP_NAME} — It's Free →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #1e1e1e;">
              <p style="margin:0;font-size:11px;color:#555;line-height:1.6;">
                You received this because ${inviterName} thought you'd love ${APP_NAME}.
                If you didn't expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: `${APP_NAME} <${FROM_EMAIL}>`,
    to:   toEmail,
    subject: `${inviterName} invited you to ${APP_NAME} 💪`,
    html,
  });

  if (error) throw new Error(error.message ?? "Failed to send email");
}

// ── SMS via Twilio ──────────────────────────────────────────────────────────
export async function sendInviteSms(opts: {
  toPhone: string;
  inviterName: string;
  personalNote?: string;
}): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    throw new Error("SMS invitations are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in the server environment.");
  }

  const { toPhone, inviterName, personalNote } = opts;
  const note = personalNote ? ` "${personalNote}"` : "";
  const body =
    `${inviterName} invited you to ${APP_NAME} — a free fitness tracker for workouts, nutrition, and goal tracking.${note} Join here: ${APP_URL}`;

  const client = twilio(sid, token);
  await client.messages.create({ body, from, to: toPhone });
}
