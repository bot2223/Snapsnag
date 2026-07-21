import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  AlertTriangle,
  ScrollText,
  Timer,
  CheckCircle2,
  PlusCircle,
  ArrowRightLeft,
  ChevronRight,
  Lock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/Pagination";
import { getLocalizedDescription } from "@/lib/snag-i18n";
import { timeAgo } from "@/lib/time-ago";

type Snag = {
  id: string;
  description: string;
  description_en: string | null;
  description_de: string | null;
  location: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "Fixed";
  created_at: string;
  deadline_at: string | null;
  subcontractors: { name: string } | null;
};

type ActivityEntry = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
  actor_name: string | null;
  snags: { id: string; location: string; category: string } | null;
};

function formatCountdown(deadlineIso: string, now: number) {
  const ms = new Date(deadlineIso).getTime() - now;
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const totalHours = Math.floor(abs / 3_600_000);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const label = d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  return { label, overdue };
}

export function ManagerDashboard() {
  const { user } = useAuth();
  const { canUseSlaCountdowns } = usePlanLimits();
  const { t, i18n } = useTranslation();

  // snag_activity.from_status / to_status are stored as plain English
  // words ("Open"/"Fixed"), not translation keys — interpolating them
  // straight into the German sentence template is what showed English
  // status words in an otherwise German activity feed.
  const statusLabel = (v: string | null) =>
    v ? t(`snagDetail.statuses.${v}`, v) : "";

  // Drives the live SLA countdown — ticks every second so the HH:MM:SS
  // display actually counts down instead of only updating on data refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Snag list — capped at 100 for the feed below. NOT used for KPI counts,
  // since a capped list would silently miscount once a company passes 100
  // snags total.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["snags", user?.id],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snags")
        .select(
          "id, description, description_en, description_de, location, priority, status, created_at, deadline_at, subcontractors(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Snag[];
    },
  });

  // Real, uncapped counts for the KPI cards — exact DB-side counts, not
  // derived from the capped list above.
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["snag-stats", user?.id],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const [openRes, resolvedRes, criticalRes, totalRes, resolvedSnagsRes] =
        await Promise.all([
          supabase
            .from("snags")
            .select("*", { count: "exact", head: true })
            .eq("status", "Open"),
          supabase
            .from("snags")
            .select("*", { count: "exact", head: true })
            .eq("status", "Fixed"),
          supabase
            .from("snags")
            .select("*", { count: "exact", head: true })
            .eq("priority", "Critical")
            .neq("status", "Fixed"),
          supabase.from("snags").select("*", { count: "exact", head: true }),
          // Fixed snags with a deadline — used to work out how many were
          // actually resolved on time vs late, rather than just "resolved".
          supabase
            .from("snags")
            .select("id, deadline_at")
            .eq("status", "Fixed")
            .not("deadline_at", "is", null),
        ]);
      const open = openRes.count ?? 0;
      const resolved = resolvedRes.count ?? 0;
      const total = totalRes.count ?? 0;

      // For each fixed snag with a deadline, find the actual moment it
      // flipped to "Fixed" from snag_activity (updated_at on the snag
      // itself isn't reliable — it can be touched by unrelated edits).
      const resolvedWithDeadline = resolvedSnagsRes.data ?? [];
      let onTime = 0;
      let lateOrUnknown = 0;
      if (resolvedWithDeadline.length > 0) {
        const ids = resolvedWithDeadline.map((s) => s.id);
        const { data: resolveEvents } = await supabase
          .from("snag_activity")
          .select("snag_id, created_at")
          .in("snag_id", ids)
          .eq("to_status", "Fixed")
          .order("created_at", { ascending: false });

        // Keep only the most recent "resolved" event per snag, in case it
        // was reopened and resolved again.
        const resolvedAtBySnag = new Map<string, string>();
        for (const ev of resolveEvents ?? []) {
          if (ev.created_at && !resolvedAtBySnag.has(ev.snag_id)) {
            resolvedAtBySnag.set(ev.snag_id, ev.created_at);
          }
        }

        for (const s of resolvedWithDeadline) {
          const resolvedAt = resolvedAtBySnag.get(s.id);
          if (!resolvedAt || !s.deadline_at) {
            lateOrUnknown++;
            continue;
          }
          if (
            new Date(resolvedAt).getTime() <= new Date(s.deadline_at).getTime()
          ) {
            onTime++;
          } else {
            lateOrUnknown++;
          }
        }
      }
      const resolvedWithDeadlineCount = resolvedWithDeadline.length;
      const onTimeRate =
        resolvedWithDeadlineCount > 0
          ? Math.round((onTime / resolvedWithDeadlineCount) * 100)
          : null;

      return {
        totalActive: open,
        criticalPath: criticalRes.count ?? 0,
        resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
        onTimeRate,
      };
    },
  });

  // Audit trail is paginated server-side (5 rows/page) rather than capped —
  // total count drives the page-number strip, actual rows come from the
  // ranged query below keyed on the current page.
  const ACTIVITY_PAGE_SIZE = 5;
  const [activityPage, setActivityPage] = useState(0);

  const { data: activityCount } = useQuery({
    queryKey: ["snag-activity-count", user?.id],
    retry: false,
    staleTime: 15_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("snag_activity")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ["snag-activity-feed", user?.id, activityPage],
    retry: false,
    staleTime: 15_000,
    queryFn: async () => {
      const from = activityPage * ACTIVITY_PAGE_SIZE;
      const { data, error } = await supabase
        .from("snag_activity")
        .select(
          "id, action, from_status, to_status, created_at, actor_name, snags(id, location, category)",
        )
        .order("created_at", { ascending: false })
        .range(from, from + ACTIVITY_PAGE_SIZE - 1);
      if (error) throw error;
      return data as unknown as ActivityEntry[];
    },
  });

  const activityTotalPages = Math.max(
    1,
    Math.ceil((activityCount ?? 0) / ACTIVITY_PAGE_SIZE),
  );
  useEffect(() => {
    if (activityPage > activityTotalPages - 1)
      setActivityPage(activityTotalPages - 1);
  }, [activityTotalPages, activityPage]);

  const totalActive = stats?.totalActive ?? 0;
  const criticalPath = stats?.criticalPath ?? 0;
  // "Resolution rate" is meant to reflect on-time SLA performance, not just
  // "did it eventually get fixed". Use the on-time rate (resolved-by-deadline
  // vs resolved-late) when we have deadline data to judge it against; only
  // fall back to plain resolved/total when no resolved snags have a deadline
  // at all (e.g. a brand new account with no SLA data yet).
  const resolutionRate = stats?.onTimeRate ?? stats?.resolutionRate ?? 0;

  // SLA countdown is paginated client-side (5/page) over every non-fixed
  // snag with a deadline in the already-loaded 100-snag window, rather than
  // hard-cutting to the soonest 5 and hiding the rest.
  const SLA_PAGE_SIZE = 5;
  const [slaPage, setSlaPage] = useState(0);

  const allDeadlines =
    data
      ?.filter((s) => s.status !== "Fixed" && s.deadline_at)
      .sort(
        (a, b) =>
          new Date(a.deadline_at!).getTime() -
          new Date(b.deadline_at!).getTime(),
      ) ?? [];

  const slaTotalPages = Math.max(
    1,
    Math.ceil(allDeadlines.length / SLA_PAGE_SIZE),
  );
  const upcomingDeadlines = allDeadlines.slice(
    slaPage * SLA_PAGE_SIZE,
    slaPage * SLA_PAGE_SIZE + SLA_PAGE_SIZE,
  );

  useEffect(() => {
    if (slaPage > slaTotalPages - 1) setSlaPage(slaTotalPages - 1);
  }, [slaTotalPages, slaPage]);

  return (
    <div className="space-y-6 md:space-y-8 soft-fade-in">
      {/* KPI Metrics — mobile gets a single fused instrument strip (three
          columns in one card, like a gauge cluster) instead of three
          separate full-width boxes stacked in a row; at 375px three
          identical bordered cards in a column read as repetitive filler
          before you reach anything urgent. Desktop keeps the original
          separate-card grid untouched. */}
      <div className="md:hidden rounded-2xl border-2 bg-card shadow-sm card-machined mb-6 overflow-hidden">
        <Link
          to="/my-snags"
          className="block active:bg-muted/40 transition-colors"
        >
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="p-4">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                {t("dashboard.totalActive")}
              </p>
              {statsLoading ? (
                <Skeleton className="h-8 w-10 skeleton-shimmer mt-1" />
              ) : (
                <p className="text-2xl font-bold text-foreground data-field mt-1">
                  {totalActive}
                </p>
              )}
            </div>
            <div className="p-4">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                {t("dashboard.criticalPath")}
              </p>
              {statsLoading ? (
                <Skeleton className="h-8 w-10 skeleton-shimmer mt-1" />
              ) : (
                <p className="text-2xl font-bold text-destructive data-field mt-1">
                  {criticalPath}
                </p>
              )}
            </div>
            <div className="p-4">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                {t("dashboard.resolutionRate")}
              </p>
              {statsLoading ? (
                <Skeleton className="h-8 w-10 skeleton-shimmer mt-1" />
              ) : (
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 data-field mt-1">
                  {resolutionRate}%
                </p>
              )}
            </div>
          </div>
        </Link>
        {criticalPath > 0 && (
          <p className="text-[11px] font-semibold text-destructive flex items-center gap-1 px-4 pb-3 -mt-1">
            <AlertTriangle className="h-3 w-3" />{" "}
            {t("dashboard.immediateAction")}
          </p>
        )}
      </div>

      {/* Desktop/tablet — original separate-card grid, unchanged */}
      <div className="hidden md:grid md:grid-cols-3 gap-4">
        <Link to="/my-snags" className="block">
          <Card className="p-6 card-machined shadow-sm border-2 transition-colors hover:border-primary/40 active:scale-[0.99]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("dashboard.totalActive")}
                </p>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              {statsLoading ? (
                <Skeleton className="h-10 w-24 skeleton-shimmer" />
              ) : (
                <p className="text-3xl font-bold text-foreground data-field">
                  {totalActive}
                </p>
              )}
            </div>
          </Card>
        </Link>
        <Card className="p-6 card-machined shadow-sm border-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("dashboard.criticalPath")}
            </p>
            {statsLoading ? (
              <Skeleton className="h-10 w-24 skeleton-shimmer" />
            ) : (
              <>
                <p className="text-3xl font-bold text-destructive data-field">
                  {criticalPath}
                </p>
                {criticalPath > 0 && (
                  <p className="text-[11px] font-semibold text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />{" "}
                    {t("dashboard.immediateAction")}
                  </p>
                )}
              </>
            )}
          </div>
        </Card>
        <Card className="p-6 card-machined shadow-sm border-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("dashboard.resolutionRate")}
            </p>
            {statsLoading ? (
              <Skeleton className="h-10 w-24 skeleton-shimmer" />
            ) : (
              <>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 data-field">
                  {resolutionRate}%
                </p>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                    style={{ width: `${resolutionRate}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">
          {t("dashboard.auditAndSla")}
        </h2>
        <Link to="/add">
          <button className="flex items-center gap-1 h-9 px-4 rounded-xl bg-primary text-white text-sm font-bold shadow-md hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" /> {t("dashboard.newSnag")}
          </button>
        </Link>
      </div>

      {isError && (
        <div className="rounded-2xl border-dashed border-2 p-8 text-center text-muted-foreground text-sm">
          {t("dashboard.errorLoading")}
        </div>
      )}

      {/* Audit Trail + SLA Countdown — mobile: one fused panel, SLA as a
          navy header band on top (collapses to a slim strip when there are
          no upcoming deadlines instead of a large empty state) with the
          audit log rolling beneath it in the same card, rather than two
          full-width cards of equal visual weight stacked in a column. */}
      <div className="md:hidden rounded-2xl border-2 border-border shadow-sm overflow-hidden card-machined">
        <div className="bg-slate-900 text-white px-5 py-4">
          <h3 className="font-bold text-sm flex items-center gap-2 mb-1">
            <Timer className="h-4 w-4 text-primary" />
            {t("dashboard.slaCountdown")}
          </h3>

          {!canUseSlaCountdowns ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-2 py-2">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <p>
                {t("dashboard.slaCountdownLocked")}{" "}
                <Link
                  to="/billing"
                  className="text-primary underline underline-offset-2"
                >
                  {t("snagDetail.upgradeToPro")}
                </Link>
              </p>
            </div>
          ) : (
            <>
              {isLoading && (
                <div className="space-y-2 mt-2">
                  {[1, 2].map((i) => (
                    <Skeleton
                      key={i}
                      className="h-14 w-full bg-slate-800 skeleton-shimmer"
                    />
                  ))}
                </div>
              )}

              {!isLoading && upcomingDeadlines.length === 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  {t("dashboard.noDeadlines")}
                </p>
              )}

              {upcomingDeadlines.length > 0 && (
                <div className="space-y-2 mt-2">
                  {upcomingDeadlines.map((snag) => {
                    const { label, overdue } = formatCountdown(
                      snag.deadline_at!,
                      now,
                    );
                    return (
                      <Link
                        key={snag.id}
                        to="/snag/$id"
                        params={{ id: snag.id }}
                        className="block bg-slate-800 rounded-xl p-3 active:bg-slate-700 transition-colors"
                      >
                        <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                          #SN-{snag.id.slice(0, 4).toUpperCase()}
                        </p>
                        <p className="text-sm font-semibold truncate mt-0.5">
                          {getLocalizedDescription(snag, i18n.language)}
                        </p>
                        {overdue ? (
                          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mt-1">
                            {t("dashboard.overdueLabel")} · {label}
                          </p>
                        ) : (
                          <p className="text-lg font-bold data-field text-primary mt-1">
                            {label}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
              <Pagination
                page={slaPage}
                totalPages={slaTotalPages}
                onPageChange={setSlaPage}
                dark
              />
            </>
          )}
        </div>

        <div className="bg-card p-5">
          <h3 className="font-bold text-sm flex items-center gap-2 mb-4">
            <ScrollText className="h-4 w-4 text-primary" />
            {t("dashboard.auditTrail")}
          </h3>

          {activityLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full skeleton-shimmer" />
              ))}
            </div>
          )}

          {!activityLoading && (!activity || activity.length === 0) && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t("dashboard.noActivity")}
            </p>
          )}

          <div className="space-y-0">
            {activity?.map((entry, i) => (
              <Link
                key={entry.id}
                to="/snag/$id"
                params={{ id: entry.snags?.id ?? "" }}
                className={`flex gap-3 py-3 active:bg-muted/40 rounded-lg px-2 -mx-2 transition-colors ${i !== activity.length - 1 ? "border-b border-dashed" : ""}`}
              >
                <div className="mt-0.5 shrink-0">
                  {entry.action === "created" ? (
                    <PlusCircle className="h-4 w-4 text-primary" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {entry.action === "created" ? (
                      <span>
                        {t("dashboard.activityCreated", {
                          location: entry.snags?.location ?? "—",
                        })}
                      </span>
                    ) : (
                      <span>
                        {t("dashboard.activityStatusChanged", {
                          from: statusLabel(entry.from_status),
                          to: statusLabel(entry.to_status),
                        })}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.actor_name ? `${entry.actor_name} · ` : ""}
                    {entry.snags?.location && entry.action !== "created"
                      ? `${entry.snags.location} · `
                      : ""}
                    {timeAgo(entry.created_at, t)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <Pagination
            page={activityPage}
            totalPages={activityTotalPages}
            onPageChange={setActivityPage}
          />
        </div>
      </div>

      {/* Desktop/tablet — original two-card layout, unchanged */}
      <div className="hidden md:grid md:grid-cols-3 gap-4">
        {/* Audit Trail */}
        <div className="lg:col-span-2 rounded-2xl border-2 bg-card p-5 shadow-sm card-machined">
          <h3 className="font-bold text-base flex items-center gap-2 mb-4">
            <ScrollText className="h-4 w-4 text-primary" />
            {t("dashboard.auditTrail")}
          </h3>

          {activityLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full skeleton-shimmer" />
              ))}
            </div>
          )}

          {!activityLoading && (!activity || activity.length === 0) && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t("dashboard.noActivity")}
            </p>
          )}

          <div className="space-y-0">
            {activity?.map((entry, i) => (
              <Link
                key={entry.id}
                to="/snag/$id"
                params={{ id: entry.snags?.id ?? "" }}
                className={`flex gap-3 py-3 hover:bg-muted/40 rounded-lg px-2 -mx-2 transition-colors cursor-pointer ${i !== activity.length - 1 ? "border-b border-dashed" : ""}`}
              >
                <div className="mt-0.5 shrink-0">
                  {entry.action === "created" ? (
                    <PlusCircle className="h-4 w-4 text-primary" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {entry.action === "created" ? (
                      <span>
                        {t("dashboard.activityCreated", {
                          location: entry.snags?.location ?? "—",
                        })}
                      </span>
                    ) : (
                      <span>
                        {t("dashboard.activityStatusChanged", {
                          from: statusLabel(entry.from_status),
                          to: statusLabel(entry.to_status),
                        })}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.actor_name ? `${entry.actor_name} · ` : ""}
                    {entry.snags?.location && entry.action !== "created"
                      ? `${entry.snags.location} · `
                      : ""}
                    {timeAgo(entry.created_at, t)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <Pagination
            page={activityPage}
            totalPages={activityTotalPages}
            onPageChange={setActivityPage}
          />
        </div>

        {/* SLA Countdown */}
        <div className="rounded-2xl bg-slate-900 border-2 border-slate-800 text-white p-5 shadow-sm">
          <h3 className="font-bold text-base flex items-center gap-2 mb-4">
            <Timer className="h-4 w-4 text-primary" />
            {t("dashboard.slaCountdown")}
          </h3>

          {!canUseSlaCountdowns ? (
            <div className="flex items-start gap-2 text-sm text-slate-400 py-6">
              <Lock className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                {t("dashboard.slaCountdownLocked")}{" "}
                <Link
                  to="/billing"
                  className="text-primary underline underline-offset-2"
                >
                  {t("snagDetail.upgradeToPro")}
                </Link>
              </p>
            </div>
          ) : (
            <>
              {isLoading && (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <Skeleton
                      key={i}
                      className="h-16 w-full bg-slate-800 skeleton-shimmer"
                    />
                  ))}
                </div>
              )}

              {!isLoading && upcomingDeadlines.length === 0 && (
                <div className="py-6 text-center">
                  <CheckCircle2 className="h-6 w-6 text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">
                    {t("dashboard.noDeadlines")}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {upcomingDeadlines.map((snag) => {
                  const { label, overdue } = formatCountdown(
                    snag.deadline_at!,
                    now,
                  );
                  return (
                    <Link
                      key={snag.id}
                      to="/snag/$id"
                      params={{ id: snag.id }}
                      className="block bg-slate-800 rounded-xl p-3 hover:bg-slate-700 transition-colors"
                    >
                      <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                        #SN-{snag.id.slice(0, 4).toUpperCase()}
                      </p>
                      <p className="text-sm font-semibold truncate mt-0.5">
                        {getLocalizedDescription(snag, i18n.language)}
                      </p>
                      {overdue ? (
                        <p className="text-xs font-bold text-red-400 uppercase tracking-wider mt-1">
                          {t("dashboard.overdueLabel")} · {label}
                        </p>
                      ) : (
                        <p className="text-xl font-bold data-field text-primary mt-1">
                          {label}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
              <Pagination
                page={slaPage}
                totalPages={slaTotalPages}
                onPageChange={setSlaPage}
                dark
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
