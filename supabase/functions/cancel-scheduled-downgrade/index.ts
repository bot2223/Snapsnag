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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_schedule_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub?.stripe_schedule_id) {
      return new Response(
        JSON.stringify({ error: "No scheduled downgrade to cancel" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    // release() returns the subscription to being a normal, unscheduled
    // subscription on its current (unchanged) price — the pending downgrade
    // never takes effect.
    try {
      await stripe.subscriptionSchedules.release(sub.stripe_schedule_id);
    } catch (releaseErr) {
      // If Stripe already completed/released/canceled the schedule (e.g. a
      // race with the phase transition itself), don't block clearing our
      // local pending_* fields below — the DB should reflect reality either way.
      console.warn(
        "subscriptionSchedules.release failed, continuing to clear local state:",
        releaseErr,
      );
    }

    await supabase
      .from("subscriptions")
      .update({
        pending_plan: null,
        pending_plan_effective_at: null,
        stripe_schedule_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return new Response(JSON.stringify({ released: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("cancel-scheduled-downgrade error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
