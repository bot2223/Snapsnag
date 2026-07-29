import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

// Sync (localStorage) rather than the IndexedDB persister on purpose: it's
// small text (snag lists, insights numbers, signed photo URLs — never the
// photo bytes themselves), and a synchronous persister can flush on the
// 'pagehide' fired right before the service worker swaps in the cached
// shell, where an async IndexedDB write could get cut off mid-write.
const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "snapsnag-query-cache",
});

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <p className="mt-4 text-muted-foreground">
          {t("errors.notFoundTitle")}
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {t("errors.backToDashboard")}
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  // Route chunks are fetched on first visit and precached proactively
  // after that (see src/lib/offline/precache-routes.ts) — but a route
  // added since the last precache run, or a truly first-ever offline
  // visit before precaching had a chance to run, can still hit this.
  // The browser's own wording ("Failed to fetch dynamically imported
  // module: ...") is accurate but not something a site worker should have
  // to parse, and "Try again" is actively misleading while still offline.
  const isChunkLoadFailure = /dynamically imported module/i.test(
    error.message,
  );
  const offline = isChunkLoadFailure && !navigator.onLine;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">
          {offline
            ? t(
                "errors.pageNeedsConnection",
                "This page hasn't loaded on this device yet",
              )
            : t("errors.somethingWentWrong")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {offline
            ? t(
                "errors.pageNeedsConnectionBody",
                "It needs a connection the first time you open it. Once you're back online, it'll work offline too from then on.",
              )
            : error.message}
        </p>
        {!offline && (
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {t("errors.tryAgain")}
          </button>
        )}
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // Only invalidate on actual sign-in / sign-out — NOT on token refresh.
    // The old code called invalidateQueries() on every auth event including
    // the automatic token refresh that fires every hour, which wiped all
    // cached data and caused every query to re-run unexpectedly.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        router.invalidate();
        queryClient.invalidateQueries();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <I18nextProvider i18n={i18n}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000, // 24h — matches queryClient's gcTime
          // Photo signed URLs are time-limited (see storage-url.ts); if one
          // expired while the device was offline, restoring it just means a
          // broken image `src` until the query naturally refetches once back
          // online — never a hard failure, so don't bother filtering it out.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => query.state.status === "success",
          },
        }}
      >
        <AuthProvider>
          <Outlet />
          <Toaster />
        </AuthProvider>
      </PersistQueryClientProvider>
    </I18nextProvider>
  );
}
