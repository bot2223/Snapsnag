import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(`Webhook error: ${err}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const subscriptionId = session.subscription as string;
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        // create-checkout sets supabase_user_id / plan on subscription_data.metadata,
        // which lands on the Subscription object (not on session.metadata, and not on
        // session.subscription_data — Stripe's webhook payload for
        // checkout.session.completed never includes that field). So we read it from
        // the subscription we just retrieved, with session.metadata as a fallback in
        // case a future checkout session sets it directly.
        const userId =
          subscription.metadata?.supabase_user_id ??
          session.metadata?.supabase_user_id;
        if (!userId) {
          console.error("No user_id in subscription/session metadata");
          break;
        }

        const plan = subscription.metadata?.plan ?? "starter";

        await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            plan,
            status: subscription.status === "trialing" ? "trialing" : "active",
            trial_ends_at: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_ends_at: new Date(
              subscription.current_period_end * 1000,
            ).toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) {
          // Look up by stripe_subscription_id
          const { data } = await supabase
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();
          if (!data?.user_id) {
            console.error("No user found for subscription:", subscription.id);
            break;
          }
        }

        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("user_id, pending_plan")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        const targetUserId = userId ?? subRow?.user_id;
        if (!targetUserId) break;

        const statusMap: Record<string, string> = {
          trialing: "trialing",
          active: "active",
          past_due: "past_due",
          canceled: "canceled",
          unpaid: "past_due",
          incomplete: "past_due",
          incomplete_expired: "canceled",
          paused: "canceled",
        };

        const newPlan = subscription.metadata?.plan ?? "starter";

        // This fires for both direct API updates (upgrades) AND scheduled
        // subscription-schedule phase transitions (downgrades taking effect)
        // — Stripe sends the same event shape either way, so no separate
        // event type needs to be handled. If the plan we just received
        // matches what was pending, the scheduled downgrade has now actually
        // happened — clear the pending_* bookkeeping fields.
        const scheduledDowngradeJustLanded =
          !!subRow?.pending_plan && subRow.pending_plan === newPlan;

        await supabase.from("subscriptions").upsert(
          {
            user_id: targetUserId,
            stripe_subscription_id: subscription.id,
            plan: newPlan,
            status: statusMap[subscription.status] ?? "active",
            trial_ends_at: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_ends_at: new Date(
              subscription.current_period_end * 1000,
            ).toISOString(),
            ...(scheduledDowngradeJustLanded
              ? {
                  pending_plan: null,
                  pending_plan_effective_at: null,
                  stripe_schedule_id: null,
                }
              : {}),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: subRow } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (!subRow?.user_id) break;

        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", subRow.user_id);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
