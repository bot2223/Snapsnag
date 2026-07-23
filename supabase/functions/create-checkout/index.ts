import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

const PRICE_IDS: Record<string, string> = {
  starter: Deno.env.get("STRIPE_PRICE_STARTER") ?? "",
  pro: Deno.env.get("STRIPE_PRICE_PRO") ?? "",
  business: Deno.env.get("STRIPE_PRICE_BUSINESS") ?? "",
};

// Mirrors PLAN_ORDER in src/components/PlanCards.tsx. This is also the
// security boundary for upgrade-vs-downgrade — never trust the frontend's
// classification, always re-derive it here.
const PLAN_ORDER = ["starter", "pro", "business"] as const;
type PlanId = (typeof PLAN_ORDER)[number];
function isDowngrade(fromPlan: string, toPlan: string): boolean {
  const fromIdx = PLAN_ORDER.indexOf(fromPlan as PlanId);
  const toIdx = PLAN_ORDER.indexOf(toPlan as PlanId);
  // Unknown current plan (e.g. no prior plan) can't be a downgrade.
  if (fromIdx === -1) return false;
  return toIdx < fromIdx;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    const token = authHeader.slice(7);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { plan } = await req.json();
    const priceId = PRICE_IDS[plan];
    if (!priceId) throw new Error(`Invalid plan: ${plan}`);

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    // 1. Get existing subscription record
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // 2a. Already has a live Stripe subscription (active or trialing) → switch
    //     the price on THAT subscription instead of creating a second one.
    //     Stripe automatically preserves the existing trial_end when we omit it
    //     from the update payload, so the trial never resets.
    if (
      sub?.stripe_subscription_id &&
      (sub.status === "active" || sub.status === "trialing")
    ) {
      const existing = await stripe.subscriptions.retrieve(
        sub.stripe_subscription_id,
      );
      const currentItemId = existing.items.data[0]?.id;
      if (!currentItemId) throw new Error("Existing subscription has no items");

      // ── Downgrade: don't touch the price now. Schedule the switch to take
      //    effect at the end of the current paid period, via a Stripe
      //    Subscription Schedule, so the customer keeps their current plan's
      //    features until they've actually used up what they paid for.
      if (isDowngrade(sub.plan, plan)) {
        // If a downgrade is already scheduled, release it first — only one
        // scheduled downgrade at a time (enforced here too, not just in the UI).
        if (sub.stripe_schedule_id) {
          try {
            await stripe.subscriptionSchedules.release(sub.stripe_schedule_id);
          } catch (releaseErr) {
            // Schedule may already be released/completed — proceed anyway,
            // we're about to create a fresh one.
            console.warn(
              "Failed to release existing schedule before creating a new one:",
              releaseErr,
            );
          }
        }

        // from_subscription cannot be combined with `phases` in the same
        // create() call — it pre-fills phase 1 from the subscription's
        // current price/interval. Phase 2 is appended in a follow-up update().
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: sub.stripe_subscription_id,
        });

        const phase1 = schedule.phases[0];
        const currentPeriodEnd = existing.current_period_end;

        const updatedSchedule = await stripe.subscriptionSchedules.update(
          schedule.id,
          {
            end_behavior: "release",
            phases: [
              {
                items: phase1.items.map((item) => ({
                  price: item.price as string,
                  quantity: item.quantity,
                })),
                start_date: phase1.start_date,
                end_date: currentPeriodEnd,
                proration_behavior: "none",
              },
              {
                items: [{ price: priceId, quantity: 1 }],
                start_date: currentPeriodEnd,
                proration_behavior: "none",
                // Stripe does NOT automatically propagate/update subscription
                // metadata on a phase transition — set it explicitly here or
                // the webhook (which reads subscription.metadata.plan) will
                // never see the new plan.
                metadata: { supabase_user_id: user.id, plan },
              },
            ],
          },
        );

        const effectiveAt = new Date(currentPeriodEnd * 1000).toISOString();

        await supabase
          .from("subscriptions")
          .update({
            pending_plan: plan,
            pending_plan_effective_at: effectiveAt,
            stripe_schedule_id: updatedSchedule.id,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);

        return new Response(
          JSON.stringify({ scheduled: true, plan, effective_at: effectiveAt }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ── Upgrade or lateral move: unchanged — immediate prorated switch.
      //    If a downgrade schedule is pending, release it first: a schedule
      //    still attached to the subscription would otherwise fight this
      //    direct update (or apply a stale phase 2 later). release() returns
      //    the subscription to being a normal, unscheduled subscription on
      //    its current (unchanged) price, which we then update below.
      if (sub.stripe_schedule_id) {
        try {
          await stripe.subscriptionSchedules.release(sub.stripe_schedule_id);
        } catch (releaseErr) {
          console.warn(
            "Failed to release pending schedule before upgrade:",
            releaseErr,
          );
        }
      }

      const updated = await stripe.subscriptions.update(
        sub.stripe_subscription_id,
        {
          items: [{ id: currentItemId, price: priceId }],
          metadata: { supabase_user_id: user.id, plan },
          proration_behavior: "create_prorations",
        },
      );

      await supabase.from("subscriptions").upsert(
        {
          user_id: user.id,
          stripe_customer_id: sub.stripe_customer_id,
          stripe_subscription_id: updated.id,
          plan,
          status: updated.status === "trialing" ? "trialing" : "active",
          trial_ends_at: updated.trial_end
            ? new Date(updated.trial_end * 1000).toISOString()
            : null,
          current_period_ends_at: new Date(
            updated.current_period_end * 1000,
          ).toISOString(),
          // Upgrading back onto/above the pending downgrade's target cancels
          // that schedule as a side effect (handled above before this branch
          // runs when isDowngrade() is false but a schedule still exists).
          pending_plan: null,
          pending_plan_effective_at: null,
          stripe_schedule_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      return new Response(JSON.stringify({ switched: true, plan }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2b. No live Stripe subscription yet (new signup, mid-trial pick, or
    //     previously canceled) → create a checkout session.
    let stripeCustomerId = sub?.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      stripeCustomerId = customer.id;
    }

    const now = Date.now();
    const existingTrialEndsAt = sub?.trial_ends_at
      ? new Date(sub.trial_ends_at).getTime()
      : null;
    // Must actually be status "trialing" — a canceled subscription whose old
    // trial_ends_at date simply hasn't passed yet is NOT mid-trial, it's
    // canceled, and must be charged immediately like any other resubscribe.
    const isMidTrial =
      sub?.status === "trialing" &&
      !!existingTrialEndsAt &&
      existingTrialEndsAt > now;
    const hadFinishedOrCanceledSubscription =
      (!!sub?.stripe_subscription_id || !!sub?.trial_ends_at) && !isMidTrial;

    // - Mid-trial (DB-tracked trial still running, no Stripe sub yet): start a
    //   real Stripe subscription whose trial ends on the SAME original date —
    //   no charge until then, and the trial length is never extended or reset.
    // - Trial already used up, or previously canceled: charge immediately, no
    //   second free trial.
    // - Brand new, no trial history at all: standard 15-day trial.
    let subscriptionData: Record<string, unknown>;
    if (isMidTrial) {
      subscriptionData = {
        trial_end: Math.floor(existingTrialEndsAt! / 1000),
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { supabase_user_id: user.id, plan },
      };
    } else if (hadFinishedOrCanceledSubscription) {
      subscriptionData = { metadata: { supabase_user_id: user.id, plan } };
    } else {
      subscriptionData = {
        trial_period_days: 15,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { supabase_user_id: user.id, plan },
      };
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      payment_method_collection: hadFinishedOrCanceledSubscription
        ? "always"
        : "if_required",
      success_url: `${SITE_URL}/dashboard?upgraded=true`,
      cancel_url: `${SITE_URL}/billing`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
