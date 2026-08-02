import { useState } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOfflineQueue } from "@/lib/offline/useOfflineQueue";
import { updateQueuedSnag, removeQueuedSnag } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";

// This is the destination the offline banner points to ("check My Snags for
// details") — without it, that message was a dead end. Renders nothing when
// there's nothing failed, so it's safe to always mount at the top of My Snags.
export function FailedSyncPanel() {
  const { t } = useTranslation();
  const { items, failedCount, retrySync } = useOfflineQueue();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (failedCount === 0) return null;
  const failed = items.filter((i) => i.status === "failed");

  const handleRetry = async (id: string) => {
    setBusyId(id);
    try {
      await updateQueuedSnag(id, { status: "queued", lastError: null });
      await retrySync();
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = async (id: string) => {
    if (!window.confirm(t("offline.failedPanel.discardConfirm"))) return;
    setBusyId(id);
    try {
      await removeQueuedSnag(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2 text-red-900 dark:text-red-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <h2 className="text-sm font-bold">{t("offline.failedPanel.title")}</h2>
      </div>
      <div className="space-y-2">
        {failed.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 bg-card rounded-xl border p-2.5 sm:p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">
                {item.payload.location || t("offline.failedPanel.title")}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {item.lastError || t("offline.failedPanel.reasonUnknown")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-xl shrink-0"
              disabled={busyId === item.id}
              onClick={() => handleRetry(item.id)}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busyId === item.id ? "animate-spin" : ""}`}
              />
              <span className="ml-1.5">{t("offline.failedPanel.retry")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-xl shrink-0 text-red-700 hover:text-red-800 hover:bg-red-100"
              disabled={busyId === item.id}
              onClick={() => handleDiscard(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="ml-1.5">{t("offline.failedPanel.discard")}</span>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
