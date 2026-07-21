import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Link-based site worker / subcontractor invites ──────────────────────────
// Generates a single-use, expiring invite code a manager can share as a link
// (text, WhatsApp, printed QR, etc). Replaces email-based invites for site
// workers — see 20260708120000_invite_link_site_workers.sql for the full
// threat model and rationale — and now also covers subcontractors (see
// 20260710130000_invite_link_subcontractors.sql): the manager enters just a
// name + trade, we create the subcontractors row right away with no
// email/auth_user_id yet, and the invite code points at that row so
// redemption can attach whoever opens the link.
//
// The code itself is generated here, server-side, with a CSPRNG — never
// derived from or accepted from client input. This is the only place a
// valid code can be minted (OWASP A07: authentication/credential material
// must not be client-controlled).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 24 random bytes → 32-char base64url string. ~192 bits of entropy, well
// above the ASVS L1 minimum (128 bits) for session/credential tokens.
function generateCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Verify JWT ──────────────────────────────────────────────────────
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

    // ── 2. Verify caller is a manager — same access rule as the old email
    //      invite path and as the invite_codes_insert_own_as_manager RLS
    //      policy (defense in depth: checked here AND enforced by RLS on
    //      the insert below, so this still holds even if this check were
    //      ever accidentally removed).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", requestingUser.id)
      .maybeSingle();

    if (profile?.role !== "manager") {
      return new Response(
        JSON.stringify({ error: "Forbidden — only managers can send invites" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 3. Figure out what kind of invite this is ──────────────────────────
    // Defaults to site_worker to keep existing callers (which pass no
    // body) working unchanged.
    let body: { role?: string; name?: string; trade?: string } = {};
    try {
      body = await req.json();
    } catch {
      // no body sent — fine, defaults below cover it
    }
    const role =
      body.role === "subcontractor" ? "subcontractor" : "site_worker";

    let subcontractorId: string | null = null;
    if (role === "subcontractor") {
      const name = body.name?.trim();
      const trade = body.trade?.trim();
      if (!name || !trade) {
        return new Response(
          JSON.stringify({ error: "Name and trade are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      // Create the subcontractor slot now, unclaimed (no email/auth_user_id
      // yet) — redemption fills those in once someone actually opens the
      // link and signs up.
      const { data: subRow, error: subError } = await supabase
        .from("subcontractors")
        .insert({ user_id: requestingUser.id, name, trade })
        .select("id")
        .single();
      if (subError) throw subError;
      subcontractorId = subRow.id;
    }

    // ── 4. Generate + store the code ────────────────────────────────────────
    // Retry on the astronomically unlikely event of a collision on the
    // UNIQUE constraint rather than trusting uniqueness blindly.
    let code = "";
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      code = generateCode();
      const { error: insertError } = await supabase
        .from("invite_codes")
        .insert({
          code,
          role,
          created_by: requestingUser.id,
          subcontractor_id: subcontractorId,
        });
      if (!insertError) {
        inserted = true;
      } else if (!insertError.message?.includes("duplicate")) {
        throw insertError;
      }
    }

    if (!inserted) {
      // Clean up the orphaned subcontractor row if we created one but
      // couldn't mint a code to go with it.
      if (subcontractorId) {
        await supabase
          .from("subcontractors")
          .delete()
          .eq("id", subcontractorId);
      }
      throw new Error("Failed to generate a unique invite code");
    }

    return new Response(
      JSON.stringify({
        code,
        url: `${SITE_URL}/join/${code}`,
        expiresInDays: 7,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("create-invite-link error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to create invite link" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
