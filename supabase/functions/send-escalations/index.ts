import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

// Web Push (VAPID) — same keys/setup as notify-status-change and
// notify-subcontractor. Duplicated rather than shared: these are
// independently deployed edge functions and don't share a module graph.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@snapsnag.app";

// Escalation Notifications is a Pro/Business feature (see usePlanLimits.ts
// slaCountdowns — escalation isn't in that table since it has no client-side
// gate, only this server-side one, but the plan boundary is the same).
const ESCALATION_PLANS = ["pro", "business"];

async function sendPushToManager(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<{ sent: number; failed: number } | { skipped: string }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("VAPID keys not configured — skipping push");
    return { skipped: "push not configured" };
  }

  const { data: subs } = await supabase
    .from("manager_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

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
        console.error("Escalation push send failed:", statusCode, err);
        if (statusCode === 404 || statusCode === 410) {
          await supabase
            .from("manager_push_subscriptions")
            .delete()
            .eq("id", sub.id);
        }
      }
    }),
  );

  return { sent, failed };
}

serve(async (req) => {
  try {
    // ── Guard — only the cron job (service role) may call this ────────────
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = Date.now();

    // ── Stage 1: first escalation, 15+ minutes overdue ──────────────────────
    const { data: firstStage, error: firstError } = await supabase
      .from("snags")
      .select("id, location, category, priority, deadline_at, user_id")
      .neq("status", "Fixed")
      .not("deadline_at", "is", null)
      .lt("deadline_at", new Date(now - 15 * 60_000).toISOString())
      .is("escalated_15m_at", null);
    if (firstError) throw firstError;

    // ── Stage 2: second escalation, 24h+ overdue, already got stage 1 ───────
    const { data: secondStage, error: secondError } = await supabase
      .from("snags")
      .select("id, location, category, priority, deadline_at, user_id")
      .neq("status", "Fixed")
      .not("deadline_at", "is", null)
      .lt("deadline_at", new Date(now - 24 * 3600_000).toISOString())
      .not("escalated_15m_at", "is", null)
      .is("escalated_24h_at", null);
    if (secondError) throw secondError;

    const ownerIds = [
      ...new Set([
        ...(firstStage ?? []).map((s) => s.user_id),
        ...(secondStage ?? []).map((s) => s.user_id),
      ]),
    ];
    if (ownerIds.length === 0) {
      return new Response(
        JSON.stringify({ stage1: 0, stage2: 0, reason: "nothing overdue" }),
        { status: 200 },
      );
    }

    // Escalation is Pro/Business only — check every owning manager's plan
    // once, up front, rather than per-snag.
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, plan, status")
      .in("user_id", ownerIds);
    const eligibleManagers = new Set(
      (subs ?? [])
        .filter(
          (s) =>
            ESCALATION_PLANS.includes(s.plan) &&
            (s.status === "active" ||
              s.status === "trialing" ||
              s.status === "past_due"),
        )
        .map((s) => s.user_id),
    );

    let stage1Sent = 0;
    for (const snag of firstStage ?? []) {
      if (eligibleManagers.has(snag.user_id)) {
        await sendPushToManager(supabase, snag.user_id, {
          title: `🔴 Overdue: ${snag.location}`,
          body: `${snag.category} · ${snag.priority} priority — just passed its deadline`,
          url: `${SITE_URL}/snag/${snag.id}`,
        });
        stage1Sent++;
      }
      // Mark as escalated regardless of plan/push outcome — otherwise a
      // Starter manager who later upgrades would get a flood of "just
      // crossed deadline" pushes for things that crossed days ago.
      await supabase
        .from("snags")
        .update({ escalated_15m_at: new Date().toISOString() })
        .eq("id", snag.id);
    }

    let stage2Sent = 0;
    for (const snag of secondStage ?? []) {
      if (eligibleManagers.has(snag.user_id)) {
        await sendPushToManager(supabase, snag.user_id, {
          title: `🚨 Still overdue (24h+): ${snag.location}`,
          body: `${snag.category} · ${snag.priority} priority — this has been overdue for a full day now`,
          url: `${SITE_URL}/snag/${snag.id}`,
        });
        stage2Sent++;
      }
      await supabase
        .from("snags")
        .update({ escalated_24h_at: new Date().toISOString() })
        .eq("id", snag.id);
    }

    return new Response(
      JSON.stringify({ stage1: stage1Sent, stage2: stage2Sent }),
      { status: 200 },
    );
  } catch (err) {
    console.error("send-escalations error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
