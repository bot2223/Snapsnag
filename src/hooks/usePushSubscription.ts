import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to expose client-side, it's the whole point of
// the public/private key split. The matching private key lives only in the
// notify-subcontractor / notify-status-change edge functions' secrets.
const VAPID_PUBLIC_KEY =
  "BGYVJOrjiZenkFaLCKcM8xuzViWcZeoTcL_OKqw6nzOL5oxRnIH2OXqzf2D7Pu2U6ynyRTrn1C3PRal9v_BxwsI";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes.buffer;
}

export type PushPermissionState =
  "unsupported" | "default" | "granted" | "denied";

type PushTarget =
  | { table: "push_subscriptions"; idColumn: "subcontractor_id"; id: string }
  | { table: "manager_push_subscriptions"; idColumn: "user_id"; id: string };

/**
 * Manages this device's push subscription for a logged-in subcontractor or
 * manager, depending on which table `target` points at. `permission`
 * reflects the browser's Notification permission; `subscribed` reflects
 * whether *this device* has a row saved (the two can differ right after
 * granting permission but before the subscribe() call finishes).
 */
export function usePushSubscription(target: PushTarget | null) {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  useEffect(() => {
    if (!supported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PushPermissionState);
  }, [supported]);

  // Check whether this exact device already has a subscription saved.
  useEffect(() => {
    if (!supported || !target) return;
    (async () => {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!existing) {
        setSubscribed(false);
        return;
      }
      // Supabase's generated types can't narrow on a dynamic table name, so
      // branch explicitly rather than fighting the generics.
      const { data } =
        target.table === "push_subscriptions"
          ? await supabase
              .from("push_subscriptions")
              .select("id")
              .eq("subcontractor_id", target.id)
              .eq("endpoint", existing.endpoint)
              .maybeSingle()
          : await supabase
              .from("manager_push_subscriptions")
              .select("id")
              .eq("user_id", target.id)
              .eq("endpoint", existing.endpoint)
              .maybeSingle();
      setSubscribed(!!data);
    })();
  }, [supported, target?.table, target?.id]);

  const subscribe = useCallback(async () => {
    if (!supported || !target) return { ok: false, error: "unsupported" };
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermissionState);
      if (perm !== "granted") {
        return { ok: false, error: "permission denied" };
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json = subscription.toJSON();
      const { error } =
        target.table === "push_subscriptions"
          ? await supabase.from("push_subscriptions").upsert(
              {
                subcontractor_id: target.id,
                endpoint: subscription.endpoint,
                p256dh: json.keys!.p256dh,
                auth: json.keys!.auth,
              },
              { onConflict: "subcontractor_id,endpoint" },
            )
          : await supabase.from("manager_push_subscriptions").upsert(
              {
                user_id: target.id,
                endpoint: subscription.endpoint,
                p256dh: json.keys!.p256dh,
                auth: json.keys!.auth,
              },
              { onConflict: "user_id,endpoint" },
            );

      if (error) {
        console.error("Failed to save push subscription:", error);
        return { ok: false, error: error.message };
      }

      setSubscribed(true);
      return { ok: true };
    } finally {
      setLoading(false);
    }
  }, [supported, target?.table, target?.id]);

  return { supported, permission, subscribed, loading, subscribe };
}
