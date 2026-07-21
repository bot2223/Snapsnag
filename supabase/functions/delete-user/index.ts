import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    // ── 1. Verify the caller's JWT ──────────────────────────────────────────
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
      data: { user: requestingUser },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 2. Parse body and enforce ownership ─────────────────────────────────
    // Two legitimate cases: a user deleting their own account, or a manager
    // deleting a subcontractor/site worker they own. The original version
    // only allowed self-deletion, which meant every manager-initiated team
    // removal (team.tsx calls this with the *member's* id, not the caller's)
    // was rejected with 403 — subcontractor rows got deleted client-side but
    // the linked auth account, and site workers entirely, were never removed.
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let authorized = requestingUser.id === user_id;

    if (!authorized) {
      const [{ data: ownedSub }, { data: ownedWorker }] = await Promise.all([
        supabase
          .from("subcontractors")
          .select("id")
          .eq("auth_user_id", user_id)
          .eq("user_id", requestingUser.id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id")
          .eq("id", user_id)
          .eq("manager_id", requestingUser.id)
          .maybeSingle(),
      ]);
      authorized = !!ownedSub || !!ownedWorker;
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({
          error:
            "Forbidden — you can only delete your own account or a team member you manage",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 3. Delete — safe to proceed ─────────────────────────────────────────
    const { error } = await supabase.auth.admin.deleteUser(user_id);
    if (error) {
      console.error("deleteUser error:", error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ deleted: true, user_id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-user error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
