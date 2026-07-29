import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./lib/i18n";
// Self-hosted fonts (same weights previously pulled live from
// fonts.googleapis.com/fonts.gstatic.com) — bundled as ordinary same-origin
// assets so the service worker's existing /assets/ caching covers them for
// free. A cross-origin Google Fonts request has no chance offline: the app
// shell itself is served from cache, but the CSS-then-font-file request to
// Google's CDN just fails, and the browser silently falls back to a system
// font instead — an easy thing to miss since nothing actually errors, the
// page just looks subtly (or not so subtly) different.
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "./styles.css";
import { precacheAllRoutes } from "./lib/offline/precache-routes";

// Registers the service worker that receives push notifications and caches
// the app shell. Safe to call unconditionally — browsers without support
// just skip it, and this doesn't block first paint since it runs after load.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => {
        // Warm the cache for every route, not just the ones visited so
        // far — see precache-routes.ts for why this is needed on top of
        // the service worker's own runtime caching.
        if (navigator.onLine) precacheAllRoutes();
      })
      .catch((err) => {
        console.error("Service worker registration failed:", err);
      });
  });
  // Also warm the cache on later reconnects, not just app startup — covers
  // someone who opened the app once while offline (nothing to precache
  // yet) and only got a connection partway through the session.
  window.addEventListener("online", () => {
    precacheAllRoutes();
  });
}

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
