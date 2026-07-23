import { supabase } from "@/integrations/supabase/client";

/**
 * Buckets are private (RLS-enforced) — there is no public URL anymore.
 * `photo_url` / `resolution_photo_url` / logo path columns now store the
 * storage object *path* (e.g. "userId/uuid.jpg"), not a resolvable URL.
 * Call this at render time to get a short-lived signed URL.
 */
export async function getSignedUrl(
  bucket: "snag-photos" | "company-assets" | "snag-reports" | "floor-plans",
  path: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!path) return null;
  // Back-compat: old rows (pre-migration) may still hold a full public URL.
  // Extract just the path portion so signing still works for them.
  const cleanPath = path.includes("/object/public/")
    ? path.split(`/object/public/${bucket}/`).pop() || path
    : path;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(cleanPath, expiresInSeconds);
  if (error) {
    console.warn(
      `getSignedUrl failed for ${bucket}/${cleanPath}:`,
      error.message,
    );
    return null;
  }
  return data.signedUrl;
}

/**
 * Fetches an image from a (signed) URL and converts it to a base64 data URL
 * — needed because jsPDF's addImage() can't fetch a remote URL itself, it
 * needs the raw image bytes. Returns null on any failure so callers can
 * fall back to rendering without the image rather than failing outright.
 */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Company logos live in company-assets. A handful of rows were uploaded
 * before that bucket fix and still point at snag-photos — fall back there
 * so those logos keep resolving until they're re-uploaded.
 * TODO: drop the snag-photos fallback once all rows are migrated.
 */
export async function getLogoSignedUrl(
  path: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const url = await getSignedUrl("company-assets", path, expiresInSeconds);
  if (url) return url;
  return getSignedUrl("snag-photos", path, expiresInSeconds);
}
