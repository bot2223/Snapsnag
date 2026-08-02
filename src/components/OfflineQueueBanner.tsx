import { CloudOff, RefreshCw, AlertTriangle, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOfflineQueue } from "@/lib/offline/useOfflineQueue";
import { Button } from "@/components/ui/button";

// Deliberately self-contained: reads its own state via useOfflineQueue
// rather than needing a prop threaded through from wherever it's placed.
// Renders nothing when there's nothing to say, so it's safe to drop
// anywhere without affecting layout when the queue is empty.
export function OfflineQueueBanner() {
  const { t } = useTranslation();
  const { isOnline, syncing, needsAuth, pendingCount, failedCount, retrySync } =
    useOfflineQueue();

  if (pendingCount === 0 && failedCount === 0) return null;

  if (needsAuth) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
        <LogIn className="h-4 w-4 shrink-0 text-amber-700" />
        <span className="flex-1 text-amber-900">
          {t("offline.banner.needsAuth", { count: pendingCount + failedCount })}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-primary/20 bg-primary/5 p-3 text-sm">
          <CloudOff className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">
            {t(
              isOnline
                ? "offline.banner.pendingOnline"
                : "offline.banner.pendingOffline",
              { count: pendingCount },
            )}
          </span>
          {isOnline && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={retrySync}
              disabled={syncing}
              className="h-8 rounded-xl"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>
      )}
      {failedCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" />
          <span className="flex-1 text-red-900">
            {t("offline.banner.failed", { count: failedCount })}
          </span>
        </div>
      )}
    </div>
  );
}
