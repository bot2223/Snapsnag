import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM = "SnapSnag Notifications <notifications@snapsnag.app>";

// Web Push (VAPID) — used to send a browser/PWA push alongside the email
// whenever the assigned subcontractor has an active push subscription.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@snapsnag.app";

const PRIORITY_EMOJI: Record<string, string> = {
  Low: "🟢",
  Medium: "🟡",
  High: "🟠",
  Critical: "🔴",
};

// Company logos live in company-assets; a handful of rows uploaded before
// that bucket fix still point at snag-photos, so fall back there. Short
// expiry is fine — push services fetch the icon almost immediately.
async function getLogoIconUrl(
  supabase: ReturnType<typeof createClient>,
  logoPath: string | null | undefined,
): Promise<string | undefined> {
  if (!logoPath) return undefined;
  for (const bucket of ["company-assets", "snag-photos"]) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(logoPath, 300);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return undefined;
}

// location/category/description/notes/sub.name are typed by a manager and
// get interpolated straight into this email's HTML — escape them so a snag
// description containing markup can't inject content into mail a
// subcontractor opens.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sends a Web Push notification to every subscription on file for this
// subcontractor. Best-effort — a push failure (e.g. expired subscription)
// never throws, since email is the primary channel and must still succeed.
// Expired/invalid subscriptions (410/404 from the push service) are deleted
// so they stop being retried on every future snag.
async function sendPushNotification(
  supabase: ReturnType<typeof createClient>,
  subcontractorId: string,
  payload: { title: string; body: string; url: string; icon?: string },
): Promise<{ sent: number; failed: number } | { skipped: string }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("VAPID keys not configured — skipping push");
    return { skipped: "push not configured" };
  }

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("subcontractor_id", subcontractorId);

  if (!subs || subs.length === 0) {
    return { skipped: "no push subscriptions" };
  }

  const webpush = await import("npm:web-push@3.6.7");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const statusCode = (err as { statusCode?: number })?.statusCode;
        console.error("Push send failed:", statusCode, err);
        // 404/410 = subscription is gone (browser unsubscribed, uninstalled,
        // etc). Clean it up so we're not retrying it forever.
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }),
  );

  return { sent, failed };
}

serve(async (req) => {
  try {
    // ── Guard — only Supabase database webhooks (service role) may call this ─
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const payload = await req.json();
    const snag = payload.record;

    // Only process if a subcontractor is assigned
    if (!snag?.subcontractor_id) {
      return new Response(JSON.stringify({ skipped: "no subcontractor" }), {
        status: 200,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch subcontractor details
    const { data: sub, error: subErr } = await supabase
      .from("subcontractors")
      .select("name, email, phone, trade")
      .eq("id", snag.subcontractor_id)
      .single();

    if (subErr || !sub?.email) {
      console.error("Subcontractor not found or no email:", subErr);
      return new Response(JSON.stringify({ skipped: "no email" }), {
        status: 200,
      });
    }

    const priorityEmoji = PRIORITY_EMOJI[snag.priority] ?? "⚪";
    const snagUrl = `${Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app"}/snag/${snag.id}`;

    const { data: companySettings } = await supabase
      .from("company_settings")
      .select("push_notifications, email_footer_text, logo_url")
      .eq("user_id", snag.user_id)
      .maybeSingle();

    // Custom footer text is a Business-plan feature — re-checked here
    // server-side rather than trusting the client, since company_settings
    // rows can carry footer text saved before a downgrade.
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("user_id", snag.user_id)
      .maybeSingle();
    const footerHtml =
      subscription?.plan === "business" && companySettings?.email_footer_text
        ? `<p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;padding-top:8px;">${escapeHtml(companySettings.email_footer_text)}</p>`
        : "";

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Snag Assigned</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#e8500a;padding:28px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
                📋 New Snag Assigned
              </h1>
              <p style="margin:6px 0 0;color:#ffd4b8;font-size:14px;">
                You have a new construction snag to resolve
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#374151;font-size:16px;">
                Hi <strong>${escapeHtml(sub.name)}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
                A new snag has been logged and assigned to you. Please review the details below and action it as soon as possible.
              </p>

              <!-- Snag details card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="8">
                      <tr>
                        <td style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;" width="130">Location</td>
                        <td style="color:#111827;font-size:15px;font-weight:500;">${escapeHtml(snag.location)}</td>
                      </tr>
                      <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;"></td></tr>
                      <tr>
                        <td style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Category</td>
                        <td style="color:#111827;font-size:15px;">${escapeHtml(snag.category)}</td>
                      </tr>
                      <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;"></td></tr>
                      <tr>
                        <td style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Priority</td>
                        <td style="color:#111827;font-size:15px;font-weight:600;">${priorityEmoji} ${snag.priority}</td>
                      </tr>
                      <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;"></td></tr>
                      <tr>
                        <td style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;vertical-align:top;">Description</td>
                        <td style="color:#111827;font-size:15px;line-height:1.6;">${escapeHtml(snag.description)}</td>
                      </tr>
                      ${
                        snag.notes
                          ? `
                      <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;"></td></tr>
                      <tr>
                        <td style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;vertical-align:top;">Notes</td>
                        <td style="color:#6b7280;font-size:14px;line-height:1.6;">${escapeHtml(snag.notes)}</td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>

              ${
                snag.photo_url
                  ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 8px;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Photo</p>
                    <img src="${escapeHtml(snag.photo_url)}" alt="Snag photo" style="width:100%;max-width:540px;border-radius:8px;border:1px solid #e5e7eb;" />
                  </td>
                </tr>
              </table>`
                  : ""
              }

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${snagUrl}" style="display:inline-block;background:#e8500a;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">
                      View Full Snag →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;border-top:1px solid #f3f4f6;padding-top:20px;">
                You are receiving this because you have been assigned a snag on SnapSnag. If you believe this was sent in error, please contact your site manager.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                Sent by <strong style="color:#e8500a;">SnapSnag</strong> · Construction snag tracking
              </p>
              ${footerHtml}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [sub.email],
        subject: `${priorityEmoji} New snag assigned — ${snag.category} at ${snag.location}`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

    // ── Push notification ───────────────────────────────────────────────
    // Fires for every priority (not just Critical) as long as the
    // assigning manager has Push Alerts enabled and the subcontractor has
    // at least one active push subscription. A failure here is logged but
    // never fails the whole request — the subcontractor has already been
    // emailed successfully.
    let push: { sent: number; failed: number } | { skipped: string } = {
      skipped: "push notifications disabled",
    };

    if (companySettings?.push_notifications ?? true) {
      const icon = await getLogoIconUrl(supabase, companySettings?.logo_url);
      push = await sendPushNotification(supabase, snag.subcontractor_id, {
        title: `${priorityEmoji} New snag assigned`,
        body: `${snag.category} at ${snag.location}`,
        ...(icon ? { icon } : {}),
        url: snagUrl,
      });
    }

    return new Response(JSON.stringify({ sent: true, to: sub.email, push }), {
      status: 200,
    });
  } catch (err) {
    console.error("notify-subcontractor error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
