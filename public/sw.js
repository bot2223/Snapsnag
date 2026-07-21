// SnapSnag service worker.
// Scope is intentionally minimal: this only exists to (1) let the browser
// treat the site as installable and (2) receive/display push notifications.
// It does not do offline caching — adding that later is a separate,
// deliberate decision (stale cached pages showing wrong snag data would be
// worse than no offline support).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The edge function sends JSON: { title, body, url, icon? }
// icon, when present, is a short-lived signed URL to the company's logo —
// falls back to the app icon if no logo is set or the signed URL expired.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "SnapSnag", body: event.data.text() };
  }

  const title = payload.title || "SnapSnag";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an existing SnapSnag tab if one is
// open, otherwise opens a new one at the snag's URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
