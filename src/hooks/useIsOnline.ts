import { useEffect, useState } from "react";

/**
 * Lightweight isOnline tracking for gating UI that needs a real network
 * round-trip and has no offline fallback (inviting someone, changing a
 * subscription, etc.) — as opposed to useOfflineQueue, which additionally
 * pulls in the whole snag-capture sync engine and is overkill for "should
 * this button be disabled right now."
 *
 * Same caveat as useOfflineQueue: navigator.onLine reflects "connected to a
 * network," not "the network actually works" (lie-fi). Good enough for
 * disabling a button pre-emptively — the action itself should still handle
 * a failed request gracefully if this false-positives.
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
}
