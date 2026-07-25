// SnapSnag service worker.
// Scope: (1) lets the browser treat the site as installable, (2)
// receives/displays push notifications, (3) caches the app shell (HTML +
// built JS/CSS) so the app can actually open when there's no connection —
// a cold offline load or an offline navbar reload previously hit the
// browser's own ERR_INTERNET_DISCONNECTED page instead of the app.
//
// What's deliberately NOT cached: anything cross-origin. Supabase API
// calls, storage signed URLs, and Google Fonts all bypass this file
// entirely (see the origin check in the fetch handler below) — that's what
// keeps this safe. The shell is just the JS bundle and static HTML; it
// never contains snag data, so caching it can't show someone stale data,
// only a stale app *version* until they're next online — which the
// network-first strategy below minimizes anyway.

const SHELL_CACHE = "snapsnag-shell-v1";
const PRECACHE_URLS = ["/", "/manifest.json", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Install running offline itself (e.g. a re-registration attempt
        // with no network) — nothing to precache yet, runtime caching
        // below will fill this in on the next successful online visit.
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Drop caches from a previous SHELL_CACHE version so old bundles
      // don't accumulate across deploys. Bump the version string above
      // whenever a change needs a hard cache bust.
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("snapsnag-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

// Deliberately narrow:
//   - Same-origin GET only. Any cross-origin request (Supabase, storage,
//     fonts) falls through untouched.
//   - Navigations (full page loads / URL-bar reloads / navbar navigation):
//     network-first, falling back to the cached shell when offline. This
//     is what fixes the browser error page you'd otherwise see.
//   - Built assets under /assets/ (Vite content-hashes these filenames):
//     cache-first, since a given hash is either already correct forever
//     or doesn't exist yet — never stale.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((cached) => cached || caches.match(req))),
    );
    return;
  }

  if (new URL(req.url).pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
  }
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
