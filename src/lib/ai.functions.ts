import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/lib/i18n";

const inputSchema = z.object({
  location: z.string().min(1).max(200),
  category: z.string().max(50).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
  photoBase64: z.string().optional(),
  photoMimeType: z.string().optional().default("image/jpeg"),
});

export type SnagAIResult = {
  description_en: string;
  description_de: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  category: "Structural" | "Electrical" | "Plumbing" | "Finishing" | "Safety";
};

// The edge function returns a short error *code* (not user-facing text) so
// each client can show it in the visitor's own language instead of us
// baking English strings into the server response.
function translateErrorCode(
  code: string,
  extra?: Record<string, unknown>,
): string {
  switch (code) {
    case "rate_limited":
      return i18n.t("add.toast.rateLimited", extra);
    case "location_required":
      return i18n.t("add.toast.addLocation");
    case "unauthorized":
    case "invalid_token":
    case "ai_no_response":
    default:
      return i18n.t("add.toast.aiFailed");
  }
}

// AI analysis runs server-side in the analyze-snag edge function so the
// Mistral API key never reaches the browser bundle. Mistral is asked to
// return BOTH an English and a German description in every call, so the
// snag can later be displayed correctly to any viewer regardless of which
// app language the person who logged it was using.
export async function generateSnagDescription(
  input: z.infer<typeof inputSchema>,
): Promise<SnagAIResult> {
  const data = inputSchema.parse(input);
  const { data: result, error } = await supabase.functions.invoke<SnagAIResult>(
    "analyze-snag",
    {
      body: data,
    },
  );
  if (error) {
    // supabase-js only gives a generic "non-2xx status code" message here —
    // the actual error code lives in the JSON body of the failed response.
    let message = translateErrorCode("ai_no_response");
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.clone().json();
        if (body?.error && typeof body.error === "string") {
          message = translateErrorCode(body.error, { limit: body.limit });
        }
      } catch {
        // response body wasn't JSON — fall back to the default message above
      }
    }
    throw new Error(message);
  }
  return result!;
}
