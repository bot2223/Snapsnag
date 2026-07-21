import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";
const FROM = "SnapSnag Notifications <notifications@snapsnag.app>";

const PRIORITY_EMOJI: Record<string, string> = {
  Low: "🟢",
  Medium: "🟡",
  High: "🟠",
  Critical: "🔴",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ReminderSnag = {
  id: string;
  location: string;
  category: string;
  priority: string;
  deadline_at: string;
  subcontractor_id: string;
  user_id: string;
};

function snagRow(s: ReminderSnag) {
  const overdue = new Date(s.deadline_at).getTime() < Date.now();
  const emoji = PRIORITY_EMOJI[s.priority] ?? "⚪";
  return `
    <tr>
      <td style="padding:14px 0;border-top:1px solid #e5e7eb;">
        <a href="${SITE_URL}/snag/${s.id}" style="color:#111827;text-decoration:none;font-weight:600;font-size:14px;">
          ${emoji} ${escapeHtml(s.location)} — ${escapeHtml(s.category)}
        </a>
        <p style="margin:4px 0 0;font-size:13px;color:${overdue ? "#dc2626" : "#6b7280"};font-weight:${overdue ? "600" : "400"};">
          ${overdue ? "Overdue since" : "Due"} ${new Date(s.deadline_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      </td>
    </tr>`;
}

serve(async (req) => {
  try {
    // ── Guard — only the daily cron job (service role) may call this ────────
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Reminder-worthy = not resolved, assigned to a subcontractor, and either
    // already overdue or due within the next 24 hours.
    const horizon = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { data: snags, error } = await supabase
      .from("snags")
      .select(
        "id, location, category, priority, deadline_at, subcontractor_id, user_id",
      )
      .neq("status", "Fixed")
      .not("subcontractor_id", "is", null)
      .not("deadline_at", "is", null)
      .lt("deadline_at", horizon);

    if (error) throw error;
    if (!snags || snags.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no snags due" }), {
        status: 200,
      });
    }

    // Group by subcontractor so each person gets one digest email, not one
    // per snag.
    const bySub = new Map<string, ReminderSnag[]>();
    for (const s of snags as ReminderSnag[]) {
      const list = bySub.get(s.subcontractor_id) ?? [];
      list.push(s);
      bySub.set(s.subcontractor_id, list);
    }

    const { data: subs } = await supabase
      .from("subcontractors")
      .select("id, name, email")
      .in("id", [...bySub.keys()]);

    let sent = 0;
    for (const sub of subs ?? []) {
      if (!sub.email) continue;
      const items = bySub.get(sub.id) ?? [];
      const overdueCount = items.filter(
        (s) => new Date(s.deadline_at).getTime() < Date.now(),
      ).length;

      // Footer text is a Business-plan feature, scoped to whichever manager
      // logged the first snag in this digest (a subcontractor's snags are
      // expected to belong to one company/manager in practice).
      const { data: companySettings } = await supabase
        .from("company_settings")
        .select("email_footer_text")
        .eq("user_id", items[0].user_id)
        .maybeSingle();
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("plan")
        .eq("user_id", items[0].user_id)
        .maybeSingle();
      const footerHtml =
        subscription?.plan === "business" && companySettings?.email_footer_text
          ? `<p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;padding-top:8px;">${escapeHtml(companySettings.email_footer_text)}</p>`
          : "";

      const html = `
<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%;">
        <tr><td style="background:#e8500a;padding:28px 32px;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">⏰ Snag deadline reminder</h1>
          <p style="margin:6px 0 0;color:#ffd4b8;font-size:14px;">
            ${overdueCount > 0 ? `${overdueCount} snag${overdueCount > 1 ? "s" : ""} overdue, ` : ""}${items.length} due within 24 hours
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi <strong>${escapeHtml(sub.name)}</strong>,</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:15px;line-height:1.6;">
            You have ${items.length} snag${items.length > 1 ? "s" : ""} approaching or past deadline:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">${items.map(snagRow).join("")}</table>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0 0;">
            <a href="${SITE_URL}/login" style="display:inline-block;background:#e8500a;color:#fff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">View all snags →</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Sent by <strong style="color:#e8500a;">SnapSnag</strong> · Construction snag tracking</p>
          ${footerHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: [sub.email],
          subject: `⏰ ${items.length} snag${items.length > 1 ? "s" : ""} due soon${overdueCount > 0 ? ` (${overdueCount} overdue)` : ""}`,
          html,
        }),
      });

      if (emailRes.ok) sent++;
      else console.error("Resend error for", sub.email, await emailRes.text());
    }

    return new Response(
      JSON.stringify({ sent, subcontractors: bySub.size, snags: snags.length }),
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error("send-reminders error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
