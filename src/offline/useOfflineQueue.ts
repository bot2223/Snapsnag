import { useCallback, useEffect, useState } from "react";
import { getQueuedSnags, onQueueChange } from "./queue";
import { syncQueue } from "./sync";
import type { QueuedSnag } from "./types";

export function useOfflineQueue() {
  const [items, setItems] = useState<QueuedSnag[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    getQueuedSnags().then(setItems);
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const outcome = await syncQueue();
      setNeedsAuth(outcome.status === "needs-auth");
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [refresh, syncing]);

  useEffect(() => {
    refresh();
    const unsubscribe = onQueueChange(refresh);

    const onOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const onOffline = () => setIsOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        runSync();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    // navigator.onLine / the 'online' event both only reflect "connected to
    // a network," not "internet actually works" (classic lie-fi false
    // positive) — and on iOS there's no Background Sync API to wake this up
    // at all, so foreground polling is the primary mechanism there, not a
    // fallback. A short interval while the tab is open and appears online
    // catches both cases cheaply.
    const interval = window.setInterval(() => {
      if (navigator.onLine) runSync();
    }, 45_000);

    // Try once on mount too — covers "app was already open when
    // connectivity came back but the 'online' event fired before this
    // component existed."
    if (navigator.onLine) runSync();

    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = items.filter((i) => i.status !== "failed");
  const failed = items.filter((i) => i.status === "failed");

  return {
    isOnline,
    syncing,
    needsAuth,
    pendingCount: pending.length,
    failedCount: failed.length,
    items,
    retrySync: runSync,
  };
}
