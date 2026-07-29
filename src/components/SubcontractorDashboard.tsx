import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ImageIcon,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { getSignedUrl } from "@/lib/storage-url";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { getLocalizedDescription } from "@/lib/snag-i18n";

const PRIORITY_STYLES: Record<string, { bar: string; badge: string }> = {
  Critical: { bar: "bg-red-500", badge: "bg-red-100 text-red-700" },
  High: { bar: "bg-orange-500", badge: "bg-orange-100 text-orange-700" },
  Medium: { bar: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-700" },
  Low: { bar: "bg-green-500", badge: "bg-green-100 text-green-700" },
};

function useCountdown(
  deadlineAt: string | null,
  resolved: boolean,
  t: (key: string, opts?: { h?: number; m?: number; d?: number }) => string,
) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [overdue, setOverdue] = useState(false);

  useEffect(() => {
    if (!deadlineAt || resolved) return;
    function tick() {
      const diff = new Date(deadlineAt!).getTime() - Date.now();
      if (diff <= 0) {
        const over = Math.abs(diff);
        const h = Math.floor(over / 3600000);
        const m = Math.floor((over % 3600000) / 60000);
        setText(
          h > 0
            ? t("subDashboard.countdown.overdueHoursMins", { h, m })
            : t("subDashboard.countdown.overdueMins", { m }),
        );
        setOverdue(true);
        setUrgent(true);
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0)
        setText(
          t("subDashboard.countdown.leftDaysHours", { d: days, h: hours }),
        );
      else if (hours > 0)
        setText(
          t("subDashboard.countdown.leftHoursMins", { h: hours, m: mins }),
        );
      else setText(t("subDashboard.countdown.leftMins", { m: mins }));
      setOverdue(false);
      setUrgent(diff < 6 * 3600000);
    }
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [deadlineAt, resolved, t]);

  return { text, urgent, overdue };
}

function CountdownBadge({
  deadlineAt,
  resolved,
}: {
  deadlineAt: string | null;
  resolved: boolean;
}) {
  const { t } = useTranslation();
  const { canUseSlaCountdowns } = usePlanLimits();
  const { text, urgent, overdue } = useCountdown(deadlineAt, resolved, t);
  if (!canUseSlaCountdowns || !text || resolved) return null;
  return (
    <span
      className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
        overdue
          ? "bg-red-100 text-red-700 animate-pulse"
          : urgent
            ? "bg-orange-100 text-orange-700"
            : "bg-muted text-muted-foreground"
      }`}
    >
      <Clock3 className="h-3 w-3" />
      {text}
    </span>
  );
}

export function SubcontractorDashboard() {
  const { subcontractorId, subcontractorName } = useAuth();
  const { t, i18n } = useTranslation();

  const STATUS_STYLES: Record<
    string,
    { label: string; icon: typeof Clock3; className: string }
  > = {
    Open: {
      label: t("subDashboard.status.Open"),
      icon: Clock3,
      className: "text-destructive",
    },
    Fixed: {
      label: t("subDashboard.status.Fixed"),
      icon: CheckCircle2,
      className: "text-green-600",
    },
  };

  const { data, isLoading } = useQuery({
    queryKey: ["sub-snags", subcontractorId],
    retry: false,
    staleTime: 30_000,
    enabled: !!subcontractorId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snags")
        .select(
          "id, photo_url, description, description_en, description_de, location, category, priority, status, created_at, deadline_at",
        )
        .eq("subcontractor_id", subcontractorId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return Promise.all(
        data.map(async (s) => ({
          ...s,
          photo_url: await getSignedUrl("snag-photos", s.photo_url),
        })),
      );
    },
  });

  // Real DB-side counts — not derived from the capped list above
  const { data: counts } = useQuery({
    queryKey: ["sub-snag-counts", subcontractorId],
    retry: false,
    staleTime: 30_000,
    enabled: !!subcontractorId,
    queryFn: async () => {
      const now = new Date().toISOString();
      const [openRes, resolvedRes, overdueRes] = await Promise.all([
        supabase
          .from("snags")
          .select("*", { count: "exact", head: true })
          .eq("subcontractor_id", subcontractorId!)
          .neq("status", "Fixed"),
        supabase
          .from("snags")
          .select("*", { count: "exact", head: true })
          .eq("subcontractor_id", subcontractorId!)
          .eq("status", "Fixed"),
        supabase
          .from("snags")
          .select("*", { count: "exact", head: true })
          .eq("subcontractor_id", subcontractorId!)
          .neq("status", "Fixed")
          .lt("deadline_at", now),
      ]);
      // See ManagerDashboard's equivalent query for why this matters: a
      // network failure resolves here instead of throwing, and without this
      // check an offline attempt "succeeds" with every count zeroed out,
      // wiping the last good cached numbers instead of leaving them alone.
      const firstError = openRes.error || resolvedRes.error || overdueRes.error;
      if (firstError) throw firstError;
      return {
        open: openRes.count ?? 0,
        fixed: resolvedRes.count ?? 0,
        overdue: overdueRes.count ?? 0,
      };
    },
  });

  const open = counts?.open ?? 0;
  const fixed = counts?.fixed ?? 0;
  const overdue = counts?.overdue ?? 0;
  const showSkeleton = isLoading && !data;

  return (
    <div className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {showSkeleton ? (
        <div className="rounded-2xl bg-navy p-5 animate-pulse">
          <Skeleton className="h-4 w-24 mb-2 bg-white/10" />
          <Skeleton className="h-8 w-40 mb-4 bg-white/10" />
        </div>
      ) : (
        <div className="rounded-2xl bg-navy text-navy-foreground p-5 shadow-lg">
          <p className="text-sm text-navy-foreground/60 mb-0.5">
            {t("subDashboard.welcomeBack")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight mb-3">
            {subcontractorName ?? "Subcontractor"}
          </h1>
          <div className="flex gap-6">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-primary">{open}</span>
              <span className="text-sm text-navy-foreground/60">
                {t("subDashboard.open")}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-green-400">{fixed}</span>
              <span className="text-sm text-navy-foreground/60">
                {t("subDashboard.fixed")}
              </span>
            </div>
            {overdue > 0 && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-red-400">
                  {overdue}
                </span>
                <span className="text-sm text-navy-foreground/60">
                  {t("subDashboard.overdue")}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <section>
        <h2 className="font-bold text-lg mb-3">
          {t("subDashboard.yourSnags")}
        </h2>
        {showSkeleton && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl bg-card border overflow-hidden flex"
              >
                <div className="w-1.5 shrink-0 bg-muted" />
                <Skeleton className="h-24 w-24 shrink-0" />
                <div className="flex-1 p-3 space-y-2">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!showSkeleton && data?.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed bg-card py-16 text-center">
            <CheckCircle2 className="h-14 w-14 mx-auto mb-4 text-green-500" />
            <p className="font-semibold text-lg mb-1">
              {t("subDashboard.allClear")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("subDashboard.allClearHint")}
            </p>
          </div>
        )}

        {!showSkeleton && data && data.length > 0 && (
          <div className="space-y-3">
            {data.map((snag) => {
              const p = snag.priority
                ? PRIORITY_STYLES[snag.priority]
                : PRIORITY_STYLES.Medium;
              const s = snag.status
                ? STATUS_STYLES[snag.status]
                : STATUS_STYLES["Open"];
              const StatusIcon = s.icon;
              const resolved = snag.status === "Fixed";
              return (
                <Link
                  key={snag.id}
                  to="/snag/$id"
                  params={{ id: snag.id }}
                  className="group rounded-2xl bg-card border overflow-hidden flex hover:shadow-md active:scale-[0.98] transition-all duration-150 cursor-pointer"
                >
                  <div className={`w-1.5 shrink-0 ${p.bar}`} />
                  {snag.photo_url ? (
                    <img
                      src={snag.photo_url}
                      alt=""
                      loading="lazy"
                      className="h-24 w-24 object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-24 w-24 bg-muted flex items-center justify-center shrink-0">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 p-3">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.badge}`}
                      >
                        {snag.priority}
                      </span>
                      <span
                        className={`flex items-center gap-1 text-xs font-semibold ${s.className}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {s.label}
                      </span>
                      <CountdownBadge
                        deadlineAt={snag.deadline_at}
                        resolved={resolved}
                      />
                    </div>
                    <p className="font-semibold text-sm truncate flex items-center gap-1 mb-0.5">
                      <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {snag.location}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {getLocalizedDescription(snag, i18n.language)}
                    </p>
                  </div>
                  {snag.priority === "Critical" && !resolved && (
                    <div className="flex items-center pr-3">
                      <AlertTriangle className="h-5 w-5 text-red-500 animate-pulse" />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
