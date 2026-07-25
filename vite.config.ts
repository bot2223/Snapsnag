import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
  ],
  build: {
    outDir: "dist",
    // Needed for offline mode: with route-level code splitting, each
    // route (dashboard, add, my-snags, ...) is a separate hashed JS file
    // fetched on first visit. The manifest lists every one of those
    // filenames so the app can proactively cache them all after the first
    // successful online load — see src/lib/offline/precache-routes.ts.
    //
    // Explicit filename, not `true` (which defaults to .vite/manifest.json):
    // dot-prefixed paths get caught by Vercel's SPA rewrite before it ever
    // checks for a matching static file, so that path 404s (actually serves
    // index.html, which your own router then shows as its own 404 page).
    // Also can't be named manifest.json — public/manifest.json (the PWA
    // manifest) already deploys to that exact path in dist/.
    manifest: "vite-manifest.json",
  },
});
