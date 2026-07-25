// Route-level code splitting (autoCodeSplitting: true in vite.config.ts)
// means each route — dashboard, add, my-snags, insights, settings, etc —
// is its own hashed JS file, fetched via dynamic import() the first time
// someone navigates there. The service worker's runtime cache only knows
// about a chunk once it's actually been fetched, so a route nobody's
// opened yet in this browser has nothing to fall back to offline, and the
// dynamic import throws outright.
//
// This closes that gap: read Vite's build manifest (build.manifest: true
// in vite.config.ts), walk every entry, and cache all of them up front —
// so by the time someone goes offline, every route is already available,
// not just the ones they happened to visit first.

const SHELL_CACHE = "snapsnag-shell-v1"; // must match public/sw.js

interface ManifestChunk {
  file: string;
  css?: string[];
}

export async function precacheAllRoutes(): Promise<void> {
  if (!("caches" in window)) return;
  if (!navigator.onLine) return; // nothing to fetch if we're already offline

  try {
    const res = await fetch("/.vite/manifest.json");
    if (!res.ok) return; // dev server / manifest not deployed — skip quietly
    const manifest: Record<string, ManifestChunk> = await res.json();

    const urls = new Set<string>();
    for (const chunk of Object.values(manifest)) {
      if (chunk.file) urls.add(`/${chunk.file}`);
      for (const css of chunk.css ?? []) urls.add(`/${css}`);
    }
    if (urls.size === 0) return;

    const cache = await caches.open(SHELL_CACHE);
    // allSettled, not addAll: one missing/failed asset shouldn't stop every
    // other route from getting cached.
    await Promise.allSettled(
      Array.from(urls).map((url) =>
        cache.match(url).then((existing) =>
          existing ? undefined : cache.add(url),
        ),
      ),
    );
  } catch {
    // No manifest, or the fetch itself failed — this is a best-effort
    // warm-up, not something that should ever block or break app startup.
  }
}
