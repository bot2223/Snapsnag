import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateSnagReportPdf, type ReportLang } from "./pdf-generator.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

// Web Push (VAPID) — same setup as notify-status-change / send-escalations.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@snapsnag.app";

// Ported from src/lib/brand-presets.ts — kept in sync manually, same as the
// PDF generator itself (see the note at the top of pdf-generator.ts).
const BRAND_PRESETS = [
  { name: "Site Orange", primary: "#F38D31", accent: "#0F172A" },
  { name: "Safety Yellow", primary: "#F5B700", accent: "#1E293B" },
  { name: "Steel Blue", primary: "#3B82F6", accent: "#0F172A" },
  { name: "Forest Green", primary: "#22C55E", accent: "#14532D" },
  { name: "Concrete Red", primary: "#EF4444", accent: "#1F2937" },
  { name: "Slate", primary: "#94A3B8", accent: "#0F172A" },
];
function findBrandPreset(primary?: string | null, accent?: string | null) {
  return BRAND_PRESETS.find((p) => p.primary === primary && p.accent === accent);
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000; // avoid call-stack overflow on large images
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${bufferToBase64(buf)}`;
  } catch (err) {
    console.warn("fetchAsDataUrl failed:", err);
    return null;
  }
}

async function signedUrl(
  supabase: ReturnType<typeof createClient>,
  bucket: "snag-photos" | "company-assets",
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const cleanPath = path.includes("/object/public/")
    ? path.split(`/object/public/${bucket}/`).pop() || path
    : path;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(cleanPath, 3600);
  if (error) return null;
  return data.signedUrl;
}

async function getLogoDataUrl(
  supabase: ReturnType<typeof createClient>,
  logoPath: string | null | undefined,
): Promise<string | null> {
  if (!logoPath) return null;
  for (const bucket of ["company-assets", "snag-photos"] as const) {
    const url = await signedUrl(supabase, bucket, logoPath);
    if (url) {
      const dataUrl = await fetchAsDataUrl(url);
      if (dataUrl) return dataUrl;
    }
  }
  return null;
}

async function sendPushToManager(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  payload: { title: string; body: string; url: string },
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("VAPID keys not configured — skipping push");
    return;
  }
  const { data: subs } = await supabase
    .from("manager_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return;

  const webpush = await import("npm:web-push@3.6.7");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        console.error("Report-ready push failed:", statusCode, err);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("manager_push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }),
  );
}

/** Most recent moment this weekly schedule was due, at or before `now`. */
function mostRecentOccurrence(dayOfWeek: number, timeUtc: string, now: Date): Date {
  const [hh, mm] = timeUtc.split(":").map(Number);
  const d = new Date(now);
  d.setUTCHours(hh, mm, 0, 0);
  const diff = (d.getUTCDay() - dayOfWeek + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

serve(async (req) => {
  try {
    // ── Guard — only the cron job (service role) may call this ────────────
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();

    const { data: schedules, error: schedError } = await supabase
      .from("report_schedules")
      .select("user_id, enabled, day_of_week, time_utc, last_run_at")
      .eq("enabled", true);
    if (schedError) throw schedError;
    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "no schedules" }), {
        status: 200,
      });
    }

    let generated = 0;
    const results: Record<string, string> = {};

    for (const sched of schedules) {
      const occurrence = mostRecentOccurrence(
        sched.day_of_week ?? 1,
        sched.time_utc ?? "08:00",
        now,
      );
      const lastRun = sched.last_run_at ? new Date(sched.last_run_at) : new Date(0);
      const due = occurrence.getTime() > lastRun.getTime() && occurrence.getTime() <= now.getTime();
      if (!due) continue;

      // Report generation is Business-only — the schedule row only ever
      // gets auto-created on upgrade, but re-check here too: a manager who
      // has since downgraded shouldn't keep getting these, even if the row
      // is still sitting there enabled.
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan, status")
        .eq("user_id", sched.user_id)
        .maybeSingle();
      const active = sub?.status === "active" || sub?.status === "trialing" || sub?.status === "past_due";
      if (sub?.plan !== "business" || !active) {
        // Not eligible right now — still advance last_run_at so this
        // schedule doesn't get re-evaluated every 15 minutes until the
        // next occurrence, and doesn't suddenly fire a backlog of reports
        // if they later re-upgrade mid-week.
        await supabase
          .from("report_schedules")
          .update({ last_run_at: now.toISOString() })
          .eq("user_id", sched.user_id);
        results[sched.user_id] = "skipped: not on business plan";
        continue;
      }

      try {
        const periodEnd = now;
        const periodStart = new Date(now.getTime() - 7 * 86400_000);

        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", sched.user_id)
          .maybeSingle();
        // Report language follows the manager's UI language if we have any
        // signal for it; default to English. (No per-user locale column
        // exists today, so this always falls back — kept as a named
        // constant rather than inlined so it's obvious where to wire a
        // stored preference in later, if one gets added.)
        const lang: ReportLang = "en";
        void profile;

        const { data: companySettings } = await supabase
          .from("company_settings")
          .select(
            "company_name, company_address, company_phone, logo_url, brand_color, brand_accent_color",
          )
          .eq("user_id", sched.user_id)
          .maybeSingle();

        const logoDataUrl = await getLogoDataUrl(supabase, companySettings?.logo_url);
        const preset = findBrandPreset(
          companySettings?.brand_color,
          companySettings?.brand_accent_color,
        );

        const { data: snagRows } = await supabase
          .from("snags")
          .select(
            "id, location, category, priority, status, created_at, deadline_at, description, description_en, description_de, notes, photo_url, resolution_photo_url, subcontractors(name)",
          )
          .eq("user_id", sched.user_id)
          .order("created_at", { ascending: false })
          .limit(150);

        const snags = await Promise.all(
          (snagRows ?? []).map(async (sn) => {
            const [beforeUrl, afterUrl] = await Promise.all([
              sn.photo_url ? signedUrl(supabase, "snag-photos", sn.photo_url) : Promise.resolve(null),
              sn.resolution_photo_url
                ? signedUrl(supabase, "snag-photos", sn.resolution_photo_url)
                : Promise.resolve(null),
            ]);
            const [beforePhotoDataUrl, afterPhotoDataUrl] = await Promise.all([
              beforeUrl ? fetchAsDataUrl(beforeUrl) : Promise.resolve(null),
              afterUrl ? fetchAsDataUrl(afterUrl) : Promise.resolve(null),
            ]);
            const description =
              lang === "de"
                ? sn.description_de || sn.description || ""
                : sn.description_en || sn.description || "";
            return {
              location: sn.location,
              category: sn.category,
              priority: sn.priority ?? "Low",
              status: sn.status ?? "Open",
              created_at: sn.created_at ?? new Date().toISOString(),
              deadline_at: sn.deadline_at,
              description,
              notes: sn.notes,
              assignedTo: sn.subcontractors?.name ?? null,
              beforePhotoDataUrl,
              afterPhotoDataUrl,
            };
          }),
        );

        // Same "decided-only" SLA formula as insights.tsx — a snag with a
        // future deadline that hasn't been fixed yet doesn't count toward
        // compliance either way until it's actually been decided.
        const fixedIds = (snagRows ?? [])
          .filter((s) => s.status === "Fixed")
          .map((s) => s.id);
        const resolvedAtBySnag = new Map<string, string>();
        if (fixedIds.length > 0) {
          const { data: resolveEvents } = await supabase
            .from("snag_activity")
            .select("snag_id, created_at")
            .in("snag_id", fixedIds)
            .eq("to_status", "Fixed")
            .order("created_at", { ascending: false });
          for (const ev of resolveEvents ?? []) {
            if (ev.created_at && !resolvedAtBySnag.has(ev.snag_id)) {
              resolvedAtBySnag.set(ev.snag_id, ev.created_at);
            }
          }
        }
        let slaTotal = 0;
        let slaBreached = 0;
        for (const s of snagRows ?? []) {
          if (!s.deadline_at) continue;
          const deadline = new Date(s.deadline_at).getTime();
          const resolvedAt = s.status === "Fixed" ? resolvedAtBySnag.get(s.id) : undefined;
          const isDecided = s.status === "Fixed" || deadline < Date.now();
          if (!isDecided) continue;
          slaTotal++;
          const resolvedOrNow = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
          if (resolvedOrNow > deadline) slaBreached++;
        }
        const slaCompliance = slaTotal > 0 ? Math.round(((slaTotal - slaBreached) / slaTotal) * 100) : 100;
        const resolvedCount = (snagRows ?? []).filter((s) => s.status === "Fixed").length;

        const blob = generateSnagReportPdf({
          lang,
          company: {
            name: companySettings?.company_name ?? null,
            address: companySettings?.company_address ?? null,
            phone: companySettings?.company_phone ?? null,
            logoDataUrl,
            brandColor: preset?.primary ?? null,
          },
          periodStart,
          periodEnd,
          stats: {
            total: (snagRows ?? []).length,
            resolved: resolvedCount,
            slaCompliance,
          },
          snags,
        });

        const path = `${sched.user_id}/report-${Date.now()}.pdf`;
        const arrayBuffer = await blob.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from("snag-reports")
          .upload(path, arrayBuffer, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from("snag_reports").insert({
          user_id: sched.user_id,
          report_period_start: periodStart.toISOString(),
          report_period_end: periodEnd.toISOString(),
          snag_count_open: (snagRows ?? []).filter((s) => s.status === "Open").length,
          snag_count_in_progress: 0,
          snag_count_fixed: resolvedCount,
          sla_compliance_percent: slaCompliance,
          pdf_url: path,
        });
        if (insertError) throw insertError;

        await supabase
          .from("report_schedules")
          .update({
            last_run_at: now.toISOString(),
            next_run_at: new Date(occurrence.getTime() + 7 * 86400_000).toISOString(),
          })
          .eq("user_id", sched.user_id);

        await sendPushToManager(supabase, sched.user_id, {
          title: "📄 Your weekly snag report is ready",
          body: `${(snagRows ?? []).length} snags · ${slaCompliance}% SLA compliance`,
          url: `${SITE_URL}/insights`,
        });

        generated++;
        results[sched.user_id] = "generated";
      } catch (perUserErr) {
        // One manager's report failing (bad photo, storage hiccup, etc.)
        // shouldn't block everyone else's in the same run. Deliberately
        // does NOT advance last_run_at on failure, so it's retried on the
        // next tick rather than silently skipped for a week.
        console.error(`Report generation failed for ${sched.user_id}:`, perUserErr);
        results[sched.user_id] = `error: ${String(perUserErr)}`;
      }
    }

    return new Response(JSON.stringify({ generated, results }), { status: 200 });
  } catch (err) {
    console.error("generate-scheduled-reports error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
