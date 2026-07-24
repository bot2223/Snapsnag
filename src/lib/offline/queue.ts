import { idbGetAll, idbGet, idbPut, idbDelete, QUEUE_STORE } from "./db";
import type { QueuedSnag, EnqueueInput } from "./types";

// Not using a full pub-sub library for one event — a plain EventTarget is
// enough for "something in the queue changed, re-read it."
const bus = new EventTarget();
const CHANGE_EVENT = "queue-changed";

export function onQueueChange(cb: () => void): () => void {
  const handler = () => cb();
  bus.addEventListener(CHANGE_EVENT, handler);
  return () => bus.removeEventListener(CHANGE_EVENT, handler);
}

function notifyChange() {
  bus.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function enqueueSnag(input: EnqueueInput): Promise<QueuedSnag> {
  const item: QueuedSnag = {
    id: crypto.randomUUID(),
    status: "queued",
    capturedAt: new Date().toISOString(),
    userId: input.userId,
    photoPath: null,
    lastError: null,
    attempts: 0,
    payload: input.payload,
    photoBlob: input.photo,
  };
  await idbPut(QUEUE_STORE, item);
  notifyChange();
  return item;
}

export async function getQueuedSnags(): Promise<QueuedSnag[]> {
  const items = await idbGetAll<QueuedSnag>(QUEUE_STORE);
  // Oldest capture first — process (and display) in the order they actually
  // happened, not IndexedDB's internal key order.
  return items.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function getQueuedSnag(
  id: string,
): Promise<QueuedSnag | undefined> {
  return idbGet<QueuedSnag>(QUEUE_STORE, id);
}

export async function updateQueuedSnag(
  id: string,
  patch: Partial<QueuedSnag>,
): Promise<void> {
  const existing = await idbGet<QueuedSnag>(QUEUE_STORE, id);
  if (!existing) return;
  await idbPut(QUEUE_STORE, { ...existing, ...patch });
  notifyChange();
}

export async function removeQueuedSnag(id: string): Promise<void> {
  await idbDelete(QUEUE_STORE, id);
  notifyChange();
}
