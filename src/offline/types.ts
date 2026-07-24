// A queued snag moves through these states left to right. Retrying a sync
// always resumes from the current state rather than restarting — this is
// what makes the queue safe to retry after a killed app, a dropped
// connection mid-upload, or a duplicate sync trigger from two tabs.
//
//   queued          → nothing has reached the server yet
//   photo_uploaded   → the photo (if any) is confirmed on storage
//   row_inserted     → the snags row exists — this item is done
//   failed           → the server rejected it for a real reason (limit hit,
//                      plan lapsed, etc). Stops auto-retry; needs the person
//                      to see why and decide what to do.
export type QueueStatus =
  | "queued"
  | "photo_uploaded"
  | "row_inserted"
  | "failed";

export interface QueuedSnag {
  /** Client-generated UUID. Reused as both the storage object name and the
   *  snags.id — this single ID is what makes every step of sync idempotent. */
  id: string;
  status: QueueStatus;
  /** When the person actually pressed "Log Snag", not when it synced. */
  capturedAt: string;
  userId: string;
  /** Populated once the photo upload step succeeds (or is confirmed already
   *  present on a retry) — lets a resumed sync skip re-uploading. */
  photoPath: string | null;
  lastError: string | null;
  attempts: number;
  payload: {
    description: string;
    description_en: string | null;
    description_de: string | null;
    location: string;
    category: string;
    priority: string;
    subcontractor_id: string | null;
    notes: string | null;
    /** Base64-free — the actual bytes live in the Blob below, not here. */
    photoName: string | null;
    photoType: string | null;
  };
  /** Stored separately from `payload` so listing/inspecting queue metadata
   *  never has to touch the (potentially large) image bytes. */
  photoBlob: Blob | null;
}

export type EnqueueInput = Omit<
  QueuedSnag,
  "id" | "status" | "capturedAt" | "photoPath" | "lastError" | "attempts"
> & {
  photo: File | null;
};
