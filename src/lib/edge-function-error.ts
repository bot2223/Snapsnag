import { FunctionsHttpError } from "@supabase/supabase-js";

// supabase.functions.invoke() rejects with a FunctionsHttpError whose
// `.message` is always the generic "Edge Function returned a non-2xx
// status code" — it does NOT read the JSON body our functions actually
// return (e.g. { error: "Name is required" }). Callers that just did
// `toast.error(err.message)` were showing that generic string instead of
// the real reason, which is useless for figuring out what went wrong.
//
// This reads the response body ourselves and falls back gracefully if
// that fails for any reason (non-JSON body, already-consumed stream,
// network-level error instead of an HTTP error, etc).
export async function getEdgeFunctionErrorMessage(
  error: unknown,
  fallback = "Something went wrong",
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      // Body wasn't JSON (or couldn't be read) — fall through to the
      // generic message below rather than throwing from an error handler.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
