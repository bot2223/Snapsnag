import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Web Push (VAPID) — same keys as notify-subcontractor, since both send to
// the same push service infrastructure, just to different subscriber sets.
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

// Best-effort push to every subscription on file for a manager. Mirrors
// sendPushNotification in notify-subcontractor — kept as a separate copy
// rather than a shared import, since these are two independently deployed
// edge functions and Deno edge functions don't share a local module graph
// across function directories in this project.
async function sendPushToManager(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  payload: { title: string; body: string; url: string; icon?: string },
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
        console.error("Push send failed:", statusCode, err);
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
    // ── Guard — only this project's DB trigger (service role) may call this ─
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const payload = await req.json();
    const snag = payload.record;
    const oldSnag = payload.old_record;

    if (!snag?.user_id || !oldSnag || snag.status === oldSnag.status) {
      return new Response(JSON.stringify({ skipped: "no status change" }), {
        status: 200,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const priorityEmoji = PRIORITY_EMOJI[snag.priority] ?? "⚪";
    const snagUrl = `${Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app"}/snag/${snag.id}`;

    const { data: companySettings } = await supabase
      .from("company_settings")
      .select("logo_url")
      .eq("user_id", snag.user_id)
      .maybeSingle();
    const icon = await getLogoIconUrl(supabase, companySettings?.logo_url);

    const push = await sendPushToManager(supabase, snag.user_id, {
      title: `${priorityEmoji} Snag updated: ${oldSnag.status} → ${snag.status}`,
      body: `${snag.category} at ${snag.location}`,
      ...(icon ? { icon } : {}),
      url: snagUrl,
    });

    return new Response(JSON.stringify({ sent: true, push }), { status: 200 });
  } catch (err) {
    console.error("notify-status-change error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
