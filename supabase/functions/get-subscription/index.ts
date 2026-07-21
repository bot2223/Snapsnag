import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STATUS_MAP: Record<string, string> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "past_due",
  incomplete: "past_due",
  incomplete_expired: "canceled",
  paused: "canceled",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Verify JWT — user_id comes from token, never from body ───────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice(7);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 2. Resolve whose subscription actually governs this caller ─────────
    // Only managers have a row in `subscriptions` keyed to their own id.
    // Subcontractors and site workers don't — querying user.id directly for
    // them always returned null, which usePlanLimits() then silently treats
    // as Starter regardless of their manager's real plan. Every plan-gated
    // feature check made from a non-manager account has been wrong because
    // of this, not just one specific feature.
    //
    // Subcontractors are matched by email (mirrors the RLS pattern used on
    // `snags`/`snag_comments` — their profiles.role can't be trusted, see
    // the site_worker_full_team_snag_visibility migration notes). Site
    // workers are matched via profiles.manager_id. Anyone else (a real
    // manager, or a caller matching neither) uses their own id.
    let effectiveUserId = user.id;

    const { data: subRow } = await supabase
      .from("subcontractors")
      .select("user_id")
      .eq("email", user.email)
      .maybeSingle();

    if (subRow?.user_id) {
      effectiveUserId = subRow.user_id;
    } else {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("role, manager_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileRow?.role === "site_worker" && profileRow.manager_id) {
        effectiveUserId = profileRow.manager_id;
      }
    }

    // ── 3. Fetch subscription using the resolved id ─────────────────────────
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select(
        "plan, status, stripe_subscription_id, trial_ends_at, current_period_ends_at, pending_plan, pending_plan_effective_at",
      )
      .eq("user_id", effectiveUserId)
      .maybeSingle();

    if (error) {
      console.warn("get-subscription query error:", error.message);
      return new Response(JSON.stringify({ subscription: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Self-heal: the row is our cache of Stripe's state, kept in sync by
    //    the stripe-webhook. If a webhook was ever missed, dropped, or raced,
    //    the row can drift — most visibly once its cached period has already
    //    ended but it still claims to be billable. Re-check Stripe directly
    //    in that case only, so this stays a rare fallback rather than a
    //    Stripe call on every page load.
    const periodEnded = subscription?.current_period_ends_at
      ? new Date(subscription.current_period_ends_at).getTime() < Date.now()
      : false;
    const looksBillable =
      subscription?.status === "active" ||
      subscription?.status === "trialing" ||
      subscription?.status === "past_due";

    if (subscription?.stripe_subscription_id && periodEnded && looksBillable) {
      try {
        const stripe = new Stripe(STRIPE_SECRET_KEY, {
          apiVersion: "2024-06-20",
        });
        const live = await stripe.subscriptions.retrieve(
          subscription.stripe_subscription_id,
        );
        const liveStatus = STATUS_MAP[live.status] ?? "active";
        if (
          liveStatus !== subscription.status ||
          live.current_period_end * 1000 !==
            new Date(subscription.current_period_ends_at!).getTime()
        ) {
          await supabase
            .from("subscriptions")
            .update({
              status: liveStatus,
              current_period_ends_at: new Date(
                live.current_period_end * 1000,
              ).toISOString(),
              trial_ends_at: live.trial_end
                ? new Date(live.trial_end * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", effectiveUserId);
          subscription.status = liveStatus;
          subscription.current_period_ends_at = new Date(
            live.current_period_end * 1000,
          ).toISOString();
        }
      } catch (stripeErr) {
        // Stripe lookup failing shouldn't break the page — serve the cached
        // row and let the next call retry.
        console.warn(
          "get-subscription Stripe reconciliation failed:",
          stripeErr,
        );
      }
    }

    return new Response(JSON.stringify({ subscription }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-subscription error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
