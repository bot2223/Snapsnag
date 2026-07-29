import { supabase } from "@/integrations/supabase/client";
import { getQueuedSnags, updateQueuedSnag, removeQueuedSnag } from "./queue";
import type { QueuedSnag } from "./types";
import type { Database } from "@/integrations/supabase/types";

const LOCK_NAME = "snapsnag-offline-sync";

export type SyncOutcome =
  | { status: "ok"; synced: number; failed: number }
  | { status: "needs-auth" }
  | { status: "offline" }
  | { status: "already-running" };

// Errors that mean "the server actively rejected this" — stop retrying and
// surface it. Everything else (network drop, timeout, 5xx) is assumed
// transient and left as-is for the next sync attempt.
function isTerminalError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("limit") ||
    m.includes("plan") ||
    m.includes("subscription") ||
    m.includes("permission") ||
    m.includes("row-level security") ||
    m.includes("violates")
  );
}

function extFromType(type: string | null): string {
  if (!type) return "jpg";
  const parts = type.split("/");
  return parts[1] || "jpg";
}

async function uploadPhotoIfNeeded(item: QueuedSnag): Promise<string | null> {
  if (!item.photoBlob) return null;
  if (item.photoPath) return item.photoPath; // already uploaded on a prior attempt

  const ext = extFromType(item.photoBlob.type) || extFromType(item.payload.photoType);
  const path = `${item.userId}/${item.id}.${ext}`;

  const { error } = await supabase.storage
    .from("snag-photos")
    .upload(path, item.photoBlob, {
      contentType: item.payload.photoType || item.photoBlob.type || "image/jpeg",
    });

  if (error) {
    // No upsert here on purpose — snag-photos only has an INSERT storage
    // policy, not UPDATE, so upsert:true would 403 on a retry even when the
    // first attempt actually succeeded. A plain insert instead: if the
    // object is already there (first attempt succeeded, only the response
    // was lost — classic weak-signal scenario), Storage returns "The
    // resource already exists"; treat that as success rather than an error.
    if (!/already exists/i.test(error.message)) {
      throw error;
    }
  }
  return path;
}

async function insertRowIfNeeded(item: QueuedSnag, photoPath: string | null) {
  // Explicit id + upsert with ignoreDuplicates means a retried insert after
  // a lost response is a guaranteed no-op on the server (ON CONFLICT DO
  // NOTHING) instead of a second row — and because it's a no-op, the
  // deadline/escalation/notification triggers only ever fire on the row's
  // real first insert, never again on a retry.
  const { error } = await supabase.from("snags").upsert(
    {
      id: item.id,
      user_id: item.userId,
      photo_url: photoPath,
      description: item.payload.description,
      description_en: item.payload.description_en,
      description_de: item.payload.description_de,
      location: item.payload.location,
      category: item.payload.category as Database["public"]["Enums"]["snag_category"],
      subcontractor_id: item.payload.subcontractor_id,
      priority: item.payload.priority as Database["public"]["Enums"]["snag_priority"],
      notes: item.payload.notes,
      captured_at: item.capturedAt,
      // Floor plan pinning is out of scope for offline v1 (see sync engine
      // design notes) — queued items never carry a pin.
      floor_plan_id: null,
      pin_x: null,
      pin_y: null,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function syncOne(item: QueuedSnag): Promise<"synced" | "failed" | "retry-later"> {
  try {
    let photoPath = item.photoPath;
    if (item.status === "queued") {
      photoPath = await uploadPhotoIfNeeded(item);
      await updateQueuedSnag(item.id, {
        status: "photo_uploaded",
        photoPath,
        attempts: item.attempts + 1,
      });
    }
    await insertRowIfNeeded(item, photoPath);
    await removeQueuedSnag(item.id);
    return "synced";
  } catch (e) {
    const message = (e as Error).message || "Sync failed";
    if (isTerminalError(message)) {
      await updateQueuedSnag(item.id, {
        status: "failed",
        lastError: message,
        attempts: item.attempts + 1,
      });
      return "failed";
    }
    // Transient — leave status as-is (photo_uploaded if we got that far),
    // bump attempts, try again on the next sync pass.
    await updateQueuedSnag(item.id, {
      lastError: message,
      attempts: item.attempts + 1,
    });
    return "retry-later";
  }
}

async function runSync(): Promise<SyncOutcome> {
  if (!navigator.onLine) return { status: "offline" };

  // Refresh the session before touching anything. A stale-but-refreshable
  // token recovers here silently. A genuinely expired/revoked one fails
  // here — cleanly, before any queue item is touched — rather than each
  // queued item failing individually with a confusing per-item error.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { status: "needs-auth" };
  }

  const items = await getQueuedSnags();
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "failed") continue; // needs a person, not a retry
    const outcome = await syncOne(item);
    if (outcome === "synced") synced++;
    if (outcome === "failed") failed++;
  }
  return { status: "ok", synced, failed };
}

// Web Locks means two tabs (or a foreground tab plus a background sync
// event) can never process the same queue at once — without this, both
// could read the same "queued" item before either finishes, and the
// idempotent-insert guarantee alone wouldn't stop a double photo upload.
export async function syncQueue(): Promise<SyncOutcome> {
  if (!("locks" in navigator)) {
    // Very old browser without Web Locks — fall back to running directly.
    // Rare enough (and the idempotent insert/upload logic above still
    // holds) that a missing lock here isn't worth blocking sync over.
    return runSync();
  }
  let ran = false;
  const result = await navigator.locks.request(
    LOCK_NAME,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return { status: "already-running" } as SyncOutcome;
      ran = true;
      return runSync();
    },
  );
  return ran ? result : { status: "already-running" };
}
