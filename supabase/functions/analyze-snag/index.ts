import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://snapsnag-tau.vercel.app";

const CATEGORIES = [
  "Structural",
  "Electrical",
  "Plumbing",
  "Finishing",
  "Safety",
];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];

// Daily cap per plan tier — mirrors the rough 4x step already used for
// snags/members in src/lib/usePlanLimits.ts. Even Business gets a cap
// rather than true "unlimited": this is metered external API spend, not a
// storage/row limit, so an unbounded tier is a real cost exposure on its
// own regardless of plan price.
const DAILY_AI_LIMIT: Record<string, number> = {
  starter: 15,
  pro: 60,
  business: 200,
};
const DEFAULT_LIMIT = DAILY_AI_LIMIT.starter;

const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth: only logged-in users may spend our Mistral credits ──────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
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
    return new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Rate limit: trailing-24h count against the caller's plan cap ──────────
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();
  const limit = (sub?.plan && DAILY_AI_LIMIT[sub.plan]) || DEFAULT_LIMIT;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: callsToday } = await supabase
    .from("ai_analysis_calls")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);

  if ((callsToday ?? 0) >= limit) {
    return new Response(JSON.stringify({ error: "rate_limited", limit }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Log this call before doing the actual work — if Mistral fails partway
  // through, the call still cost us nothing extra to count as attempted,
  // and this avoids a race where a slow request lets extra calls slip
  // through right at the limit boundary.
  await supabase.from("ai_analysis_calls").insert({ user_id: user.id });

  const AI_ERROR = { error: "ai_no_response" };

  try {
    const { location, category, notes, photoBase64, photoMimeType } =
      await req.json();
    if (!location || typeof location !== "string") {
      return new Response(JSON.stringify({ error: "location_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are a professional construction site inspector writing a formal snag/defect report. Study the photo carefully before answering.

Context:
- Location: ${location}
${category ? `- Category hint from the site worker (may be wrong, verify against the photo): ${category}` : ""}
${notes ? `- Site notes: ${notes}` : ""}

This report is read by people on site in different languages, so write the finding TWICE: once in natural professional English ("description_en") and once in natural professional German ("description_de"). Both must describe exactly the same finding — write each one properly in its own language (idiomatic phrasing a native-speaking site inspector would use), not a literal word-for-word translation of the other.

Rules for description_en / description_de:
- Base it only on what is actually visible in the photo. Name the specific component and the specific visible defect (e.g. scorch marks, arcing, cracking, corrosion, misalignment, water staining, exposed conductors, missing fixings) rather than a vague general statement.
- If a likely cause or risk is visually evident, state it briefly.
- Do NOT write generic filler like "there is an issue at this location" — if the photo genuinely shows no clear defect, say exactly that instead of inventing one.
- 1-2 sentences each. No hedging phrases like "it appears that"/"möglicherweise". No markdown.

Rules for "category": choose EXACTLY one of: Structural, Electrical, Plumbing, Finishing, Safety — based on the photo, not just the hint.

Rules for "priority": judge real-world risk from the photo.
- Critical: immediate safety, fire, or structural hazard
- High: clear defect needing prompt repair
- Medium: standard defect, not urgent
- Low: cosmetic only

Respond with ONLY this JSON object, no markdown fences, no commentary before or after:
{"description_en": "...", "description_de": "...", "category": "Finishing", "priority": "Medium"}`;

    const content: object[] = [];
    if (photoBase64) {
      content.push({
        type: "image_url",
        image_url: `data:${photoMimeType || "image/jpeg"};base64,${photoBase64}`,
      });
    }
    content.push({ type: "text", text: prompt });

    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409",
        max_tokens: 400,
        // Low temperature: this is a structured inspection report, not
        // creative writing — we want the same photo to produce a
        // consistent, specific answer instead of a different generic
        // one each time.
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      console.error("Mistral error", res.status, await res.text());
      return new Response(JSON.stringify(AI_ERROR), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const text = (json?.choices?.[0]?.message?.content ?? "").trim();

    let parsed: {
      description_en?: string;
      description_de?: string;
      priority?: string;
      category?: string;
    };
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch (parseErr) {
      console.error(
        "analyze-snag: failed to parse Mistral response",
        parseErr,
        text,
      );
      return new Response(JSON.stringify(AI_ERROR), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If Mistral didn't actually give us usable descriptions, don't paper
    // over it with fake ones — surface it as a real error instead.
    if (
      !parsed.description_en ||
      typeof parsed.description_en !== "string" ||
      !parsed.description_de ||
      typeof parsed.description_de !== "string"
    ) {
      console.error(
        "analyze-snag: Mistral returned incomplete descriptions",
        parsed,
      );
      return new Response(JSON.stringify(AI_ERROR), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        description_en: parsed.description_en,
        description_de: parsed.description_de,
        priority: PRIORITIES.includes(parsed.priority ?? "")
          ? parsed.priority
          : "Medium",
        category: CATEGORIES.includes(parsed.category ?? "")
          ? parsed.category
          : "Finishing",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("analyze-snag error:", err);
    return new Response(JSON.stringify(AI_ERROR), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
