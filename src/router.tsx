import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // never retry — a failed query should show an error, not hang
        staleTime: 30_000, // 30s cache so navigating back doesn't re-fetch every time
        refetchOnWindowFocus: false, // don't re-fetch when user switches tabs
        // Query results are persisted to localStorage (see __root.tsx) so an
        // offline reload — which the service worker forces by re-serving the
        // cached shell HTML, wiping all in-memory React state — still has
        // something to show instead of a blank/skeleton screen. The default
        // 5-minute gcTime would drop everything from memory (and therefore
        // from what gets persisted) long before that matters; a full day
        // means a snag list checked this morning is still there offline
        // this afternoon.
        gcTime: 24 * 60 * 60 * 1000, // 24h
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
