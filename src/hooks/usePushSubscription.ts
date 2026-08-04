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
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

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

  const saveSubscription = useCallback(
    async (sub: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) => {
      if (!target) return { ok: false as const, error: "no target" };
      const { error } =
        target.table === "push_subscriptions"
          ? await supabase.from("push_subscriptions").upsert(
              {
                subcontractor_id: target.id,
                endpoint: sub.endpoint,
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth,
              },
              { onConflict: "subcontractor_id,endpoint" },
            )
          : await supabase.from("manager_push_subscriptions").upsert(
              {
                user_id: target.id,
                endpoint: sub.endpoint,
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth,
              },
              { onConflict: "user_id,endpoint" },
            );
      if (error) {
        console.error("Failed to save push subscription:", error);
        return { ok: false as const, error: error.message };
      }
      return { ok: true as const };
    },
    [target?.table, target?.id],
  );

  const deleteSubscriptionByEndpoint = useCallback(
    async (endpoint: string) => {
      if (!target) return;
      if (target.table === "push_subscriptions") {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("subcontractor_id", target.id)
          .eq("endpoint", endpoint);
      } else {
        await supabase
          .from("manager_push_subscriptions")
          .delete()
          .eq("user_id", target.id)
          .eq("endpoint", endpoint);
      }
    },
    [target?.table, target?.id],
  );

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
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          setSubscribed(false);
          return;
        }
        // Supabase's generated types can't narrow on a dynamic table name,
        // so branch explicitly rather than fighting the generics.
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
      } catch (err) {
        // Leaving `subscribed` at its default (false) here would otherwise
        // permanently show the "enable notifications" banner with no way
        // to tell why — surfacing the error at least makes it debuggable
        // instead of silently swallowed.
        console.error("Failed to check push subscription state:", err);
      }
    })();
  }, [supported, target?.table, target?.id]);

  // Browsers rotate a push subscription's endpoint on their own from time
  // to time — the service worker's pushsubscriptionchange handler resubs
  // and posts the result here (see public/sw.js). Without this, a rotation
  // makes the device look unsubscribed (the old endpoint is dead, so the
  // check above finds no matching row) and the person gets asked to
  // "enable notifications" again despite never having changed anything.
  useEffect(() => {
    if (!supported || !target) return;
    const handler = async (event: MessageEvent) => {
      if (event.data?.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
      const { subscription, oldEndpoint } = event.data as {
        subscription: {
          endpoint: string;
          keys?: { p256dh: string; auth: string };
        };
        oldEndpoint: string | null;
      };
      if (!subscription?.endpoint || !subscription.keys) return;

      const result = await saveSubscription({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      });
      if (!result.ok) return;
      setSubscribed(true);

      // Best-effort: drop the dead row so they don't accumulate indefinitely
      // (harmless to leave — the send functions already self-clean on a
      // 404/410 from the push service — but no reason not to tidy up here
      // too, and it happens right when we know for certain it's dead).
      if (oldEndpoint) await deleteSubscriptionByEndpoint(oldEndpoint);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [
    supported,
    target?.table,
    target?.id,
    saveSubscription,
    deleteSubscriptionByEndpoint,
  ]);

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
      if (!json.endpoint || !json.keys) {
        return { ok: false, error: "invalid subscription" };
      }
      const result = await saveSubscription({
        endpoint: json.endpoint,
        keys: json.keys as { p256dh: string; auth: string },
      });
      if (!result.ok) return result;

      setSubscribed(true);
      return { ok: true };
    } finally {
      setLoading(false);
    }
  }, [supported, target?.table, target?.id, saveSubscription]);

  return { supported, permission, subscribed, loading, subscribe };
}
