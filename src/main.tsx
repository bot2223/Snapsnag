import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./lib/i18n";
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
