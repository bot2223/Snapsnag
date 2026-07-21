import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart3,
  Lock,
  FileDown,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Clock,
  Mail,
  Calendar,
  Zap,
  ClipboardList,
  Wrench,
  Tags,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { findBrandPreset } from "@/lib/brand-presets";
import {
  getLogoSignedUrl,
  getSignedUrl,
  fetchAsDataUrl,
} from "@/lib/storage-url";
import {
  generateSnagReportPdf,
  type ReportLang,
} from "@/lib/generate-snag-report-pdf";
import { getLocalizedDescription } from "@/lib/snag-i18n";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/insights")({
  component: InsightsPage,
});

// ── Colours ────────────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#eab308",
  Low: "#22c55e",
};
const STATUS_COLORS: Record<string, string> = {
  Open: "#ef4444",
  Fixed: "#22c55e",
};
const CATEGORY_COLOR = "#f97316";

// Stable display order — ties tally rows to severity/workflow sequence
// rather than whatever order Object.entries happens to return.
const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"];
const STATUS_ORDER = ["Open", "Fixed"];

const DAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

// ── Tally row ────────────────────────────────────────────────────────────
// One line in the "site log" — a label, a count, and a stub bar sized
// relative to the largest value in its group. Reads like a hand-tallied
// inspection sheet rather than a chart axis; degrades to mobile width
// without losing legibility the way a squeezed pie/bar chart does.
function TallyRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 0) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-[88px] sm:w-24 shrink-0 text-xs font-semibold text-muted-foreground truncate">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-sm font-bold data-field">
        {value}
      </span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
function InsightsPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const { plan, canUseCustomBranding } = usePlanLimits();
  const qc = useQueryClient();
  const isPro = plan === "pro" || plan === "business";

  // ── Stats query ──────────────────────────────────────────────────────────
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["insights-stats", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snags")
        .select("id, priority, status, category, created_at, deadline_at");
      if (error) throw error;

      // Actual resolution timestamps for Fixed snags come from snag_activity,
      // not snags.updated_at — updated_at reflects the last edit to the row
      // for any reason, not specifically when it was marked Fixed, so it's
      // not a reliable "resolved at" proxy. Same approach as ManagerDashboard.
      const fixedIds = data
        .filter((s) => s.status === "Fixed")
        .map((s) => s.id);
      const resolvedAtBySnag = new Map<string, string>();
      if (fixedIds.length > 0) {
        const { data: resolveEvents, error: activityError } = await supabase
          .from("snag_activity")
          .select("snag_id, created_at")
          .in("snag_id", fixedIds)
          .eq("to_status", "Fixed")
          .order("created_at", { ascending: false });
        if (activityError) throw activityError;
        for (const ev of resolveEvents ?? []) {
          if (ev.created_at && !resolvedAtBySnag.has(ev.snag_id)) {
            resolvedAtBySnag.set(ev.snag_id, ev.created_at);
          }
        }
      }

      const byPriority: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      let slaBreached = 0;
      let slaTotal = 0;

      for (const s of data) {
        byPriority[s.priority ?? "Low"] =
          (byPriority[s.priority ?? "Low"] ?? 0) + 1;
        byStatus[s.status ?? "Open"] = (byStatus[s.status ?? "Open"] ?? 0) + 1;
        byCategory[s.category ?? "Finishing"] =
          (byCategory[s.category ?? "Finishing"] ?? 0) + 1;

        // SLA compliance — only counts snags that have actually been decided
        // one way or the other: resolved (on time or late), or still open
        // but already past its deadline (a live breach). A snag that's open
        // with a deadline still in the future hasn't succeeded or failed yet
        // — counting it as "compliant" just because it exists would let
        // compliance go up simply by logging more work, without fixing
        // anything. Excluding it entirely from the denominator until it's
        // actually decided is the honest version of this metric.
        if (s.deadline_at) {
          const deadline = new Date(s.deadline_at).getTime();
          const resolvedAt =
            s.status === "Fixed" ? resolvedAtBySnag.get(s.id) : undefined;
          const isDecided = s.status === "Fixed" || deadline < Date.now();
          if (isDecided) {
            slaTotal++;
            const resolvedOrNow = resolvedAt
              ? new Date(resolvedAt).getTime()
              : Date.now();
            if (resolvedOrNow > deadline) slaBreached++;
          }
        }
      }

      const slaCompliance =
        slaTotal > 0
          ? Math.round(((slaTotal - slaBreached) / slaTotal) * 100)
          : 100;

      return {
        byPriority: Object.entries(byPriority).map(([name, value]) => ({
          name,
          value,
        })),
        byStatus: Object.entries(byStatus).map(([name, value]) => ({
          name,
          value,
        })),
        byCategory: Object.entries(byCategory).map(([name, value]) => ({
          name,
          value,
        })),
        slaCompliance,
        total: data.length,
        resolved: data.filter((s) => s.status === "Fixed").length,
      };
    },
  });

  // ── Report schedule query ────────────────────────────────────────────────
  const { data: schedule, isLoading: schedLoading } = useQuery({
    queryKey: ["report-schedule", user?.id],
    enabled: !!user && isPro,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("report_schedules")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  // ── Recent reports query ─────────────────────────────────────────────────
  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ["snag-reports", user?.id],
    enabled: !!user && isPro,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("snag_reports")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  // ── Schedule form state ──────────────────────────────────────────────────
  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedDay, setSchedDay] = useState(1);
  const [schedTime, setSchedTime] = useState("08:00");
  const [schedLoaded, setSchedLoaded] = useState(false);

  // Sync local form state from the server once, when the schedule first loads
  if (schedule && !schedLoaded) {
    setSchedEnabled(schedule.enabled ?? true);
    setSchedDay(schedule.day_of_week ?? 1);
    setSchedTime(schedule.time_utc ?? "08:00");
    setSchedLoaded(true);
  }

  // ── Save schedule mutation ───────────────────────────────────────────────
  const saveSched = useMutation({
    mutationFn: async () => {
      // Mirrors the edge function's mostRecentOccurrence() but finds the
      // NEXT future occurrence instead of the most recent past one — this
      // is purely for immediate UI feedback ("next report on..."); the
      // generate-scheduled-reports cron recomputes this itself from
      // day_of_week/time_utc every run and doesn't trust this value.
      const [hh, mm] = schedTime.split(":").map(Number);
      const next = new Date();
      next.setUTCHours(hh, mm, 0, 0);
      const diff = (schedDay - next.getUTCDay() + 7) % 7;
      next.setUTCDate(next.getUTCDate() + diff);
      if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 7);

      const { error } = await supabase.from("report_schedules").upsert(
        {
          user_id: user!.id,
          enabled: schedEnabled,
          day_of_week: schedDay,
          time_utc: schedTime,
          next_run_at: schedEnabled ? next.toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedule", user?.id] });
      toast.success(t("insights.schedSaved"));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // ── Generate report mutation ─────────────────────────────────────────────
  const generateReport = useMutation({
    mutationFn: async () => {
      if (!stats || !user) return;
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 86400000);

      // Company letterhead info — logo/address/phone are available on every
      // plan; brand color only applies if Business plan has it unlocked
      // (same rule as the nav theme), otherwise the report stays neutral.
      const { data: companySettings } = await supabase
        .from("company_settings")
        .select(
          "company_name, company_address, company_phone, logo_url, brand_color, brand_accent_color",
        )
        .eq("user_id", user.id)
        .maybeSingle();

      let logoDataUrl: string | null = null;
      if (companySettings?.logo_url) {
        const signedUrl = await getLogoSignedUrl(companySettings.logo_url);
        if (signedUrl) logoDataUrl = await fetchAsDataUrl(signedUrl);
      }
      const preset = canUseCustomBranding
        ? findBrandPreset(
            companySettings?.brand_color,
            companySettings?.brand_accent_color,
          )
        : undefined;

      // Full snag detail for the per-snag cards — capped at 150 so a very
      // large backlog doesn't turn "Generate Now" into a multi-minute wait
      // (each photo needs its own signed-URL + fetch round trip).
      const { data: snagRows } = await supabase
        .from("snags")
        .select(
          "location, category, priority, status, created_at, deadline_at, description, description_en, description_de, notes, photo_url, resolution_photo_url, subcontractors(name)",
        )
        .order("created_at", { ascending: false })
        .limit(150);

      const lang: ReportLang = i18n.language.startsWith("de") ? "de" : "en";

      const snags = await Promise.all(
        (snagRows ?? []).map(async (sn) => {
          const [beforeUrl, afterUrl] = await Promise.all([
            sn.photo_url
              ? getSignedUrl("snag-photos", sn.photo_url)
              : Promise.resolve(null),
            sn.resolution_photo_url
              ? getSignedUrl("snag-photos", sn.resolution_photo_url)
              : Promise.resolve(null),
          ]);
          const [beforePhotoDataUrl, afterPhotoDataUrl] = await Promise.all([
            beforeUrl ? fetchAsDataUrl(beforeUrl) : Promise.resolve(null),
            afterUrl ? fetchAsDataUrl(afterUrl) : Promise.resolve(null),
          ]);
          return {
            location: sn.location,
            category: sn.category,
            priority: sn.priority ?? "Low",
            status: sn.status ?? "Open",
            created_at: sn.created_at ?? new Date().toISOString(),
            deadline_at: sn.deadline_at,
            description: getLocalizedDescription(sn, lang),
            notes: sn.notes,
            assignedTo: sn.subcontractors?.name ?? null,
            beforePhotoDataUrl,
            afterPhotoDataUrl,
          };
        }),
      );

      const blob = generateSnagReportPdf({
        lang,
        company: {
          name: companySettings?.company_name ?? null,
          address: companySettings?.company_address ?? null,
          phone: companySettings?.company_phone ?? null,
          logoDataUrl,
          brandColor: preset?.primary ?? null,
        },
        periodStart: weekAgo,
        periodEnd: now,
        stats: {
          total: stats.total,
          resolved: stats.resolved,
          slaCompliance: stats.slaCompliance,
        },
        snags,
      });

      // snag-reports is a private bucket — store the object path (not a
      // signed URL, which would expire) and resolve it to a signed URL at
      // render/download time, same pattern as company logos.
      const path = `${user.id}/report-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("snag-reports")
        .upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      const { error } = await supabase.from("snag_reports").insert({
        user_id: user.id,
        report_period_start: weekAgo.toISOString(),
        report_period_end: now.toISOString(),
        snag_count_open:
          stats.byStatus.find((s) => s.name === "Open")?.value ?? 0,
        // "In Progress" no longer exists as a status — this column is kept
        // in the DB for historical reports, always 0 going forward.
        snag_count_in_progress: 0,
        snag_count_fixed: stats.resolved,
        sla_compliance_percent: stats.slaCompliance,
        pdf_url: path,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snag-reports", user?.id] });
      toast.success(t("insights.reportGenerated"));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6 pb-6 soft-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("insights.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("insights.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isPro && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl font-semibold"
              onClick={() => generateReport.mutate()}
              disabled={generateReport.isPending || statsLoading}
            >
              {generateReport.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              {t("insights.generateNow")}
            </Button>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: t("insights.totalSnags"),
            value: stats?.total ?? 0,
            color: "text-foreground",
          },
          {
            label: t("insights.resolved"),
            value: stats?.resolved ?? 0,
            color: "text-green-600 dark:text-green-400",
          },
          {
            label: t("insights.slaCompliance"),
            value: `${stats?.slaCompliance ?? 100}%`,
            color:
              (stats?.slaCompliance ?? 100) === 100
                ? "text-green-600 dark:text-green-400"
                : (stats?.slaCompliance ?? 100) >= 80
                  ? "text-orange-500"
                  : "text-red-500",
          },
          {
            label: t("insights.resolutionRate"),
            value: stats?.total
              ? `${Math.round((stats.resolved / stats.total) * 100)}%`
              : "—",
            color: "text-primary",
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-2xl border-2 bg-card p-4 card-machined shadow-sm"
          >
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            {statsLoading ? (
              <Skeleton className="h-8 w-20 mt-2 skeleton-shimmer" />
            ) : (
              <p className={`text-2xl font-bold data-field mt-1 ${color}`}>
                {value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* SLA gauge + site log — the gauge is the hero (deadline compliance is
          the number that actually drives the paid tiers); status/priority/
          category read as a tallied inspection log beside it rather than
          three competing mini-charts. */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        {/* SLA gauge */}
        <div className="rounded-2xl border-2 bg-card p-5 card-machined shadow-sm flex flex-col items-center justify-center">
          <h3 className="font-bold text-sm self-start mb-1">
            {t("insights.slaCompliance")}
          </h3>
          <p className="text-xs text-muted-foreground self-start mb-2">
            {t("insights.slaHint")}
          </p>
          {statsLoading ? (
            <Skeleton className="h-[180px] w-[180px] rounded-full skeleton-shimmer" />
          ) : (
            <div className="relative h-[180px] w-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[{ name: "sla", value: stats?.slaCompliance ?? 100 }]}
                  startAngle={90}
                  endAngle={-270}
                  innerRadius="78%"
                  outerRadius="100%"
                  barSize={14}
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    tick={false}
                  />
                  <RadialBar
                    dataKey="value"
                    cornerRadius={7}
                    fill={
                      (stats?.slaCompliance ?? 100) >= 80
                        ? "#22c55e"
                        : (stats?.slaCompliance ?? 100) >= 50
                          ? "#f97316"
                          : "#ef4444"
                    }
                    background={{ fill: "var(--muted)" }}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className={`text-3xl font-bold data-field ${
                    (stats?.slaCompliance ?? 100) === 100
                      ? "text-green-600 dark:text-green-400"
                      : (stats?.slaCompliance ?? 100) >= 80
                        ? "text-orange-500"
                        : "text-red-500"
                  }`}
                >
                  {stats?.slaCompliance ?? 100}%
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {t("insights.onTime")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Site log — status / priority / category as tallied rows */}
        <div className="rounded-2xl border-2 bg-card p-5 card-machined shadow-sm">
          <h3 className="flex items-center gap-1.5 font-bold text-sm mb-4">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            {t("insights.siteLog")}
          </h3>

          {statsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-2.5 w-full skeleton-shimmer" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
              {/* By Status */}
              <div className="space-y-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  <Wrench className="h-3 w-3" />
                  {t("insights.byStatus")}
                </p>
                {STATUS_ORDER.map((name) => (
                  <TallyRow
                    key={name}
                    label={t(`insights.statuses.${name}`, name)}
                    value={
                      stats?.byStatus.find((s) => s.name === name)?.value ?? 0
                    }
                    max={stats?.total || 1}
                    color={STATUS_COLORS[name]}
                  />
                ))}
              </div>

              {/* By Priority */}
              <div className="space-y-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  <Zap className="h-3 w-3" />
                  {t("insights.byPriority")}
                </p>
                {PRIORITY_ORDER.map((name) => (
                  <TallyRow
                    key={name}
                    label={t(`insights.priorities.${name}`, name)}
                    value={
                      stats?.byPriority.find((p) => p.name === name)?.value ?? 0
                    }
                    max={stats?.total || 1}
                    color={PRIORITY_COLORS[name]}
                  />
                ))}
              </div>

              {/* By Category */}
              <div className="space-y-2.5">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  <Tags className="h-3 w-3" />
                  {t("insights.byCategory")}
                </p>
                {(stats?.byCategory ?? []).map((c) => (
                  <TallyRow
                    key={c.name}
                    label={c.name}
                    value={c.value}
                    max={stats?.total || 1}
                    color={CATEGORY_COLOR}
                  />
                ))}
                {(stats?.byCategory?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("insights.noData")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report scheduling — Pro/Business only */}
      {!isPro ? (
        <div className="rounded-2xl border-2 border-dashed bg-card p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-bold text-lg">{t("insights.proFeature")}</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {t("insights.proHint")}
          </p>
          <Button asChild className="rounded-xl font-bold mt-2">
            <Link to="/billing">
              <Zap className="h-4 w-4 mr-1" />
              {t("insights.upgradeNow")}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Schedule config */}
          <div className="rounded-2xl border-2 bg-card p-5 card-machined shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {t("insights.reportScheduling")}
              </h3>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold text-muted-foreground">
                  {t("insights.enabled")}
                </Label>
                <Switch
                  checked={schedEnabled}
                  onCheckedChange={setSchedEnabled}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("insights.frequency")}
                </Label>
                <select
                  value={schedDay}
                  onChange={(e) => setSchedDay(Number(e.target.value))}
                  className="w-full h-11 rounded-xl border-2 bg-background text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {DAY_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {t(`insights.days.${label}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("insights.time")}
                </Label>
                <input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 bg-background text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {schedule?.next_run_at && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t("insights.nextReport")}:{" "}
                {new Date(schedule.next_run_at).toLocaleDateString()}
              </p>
            )}

            <Button
              onClick={() => saveSched.mutate()}
              disabled={saveSched.isPending}
              className="w-full h-11 font-bold rounded-xl"
            >
              {saveSched.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-1" />
                  {t("insights.saveSchedule")}
                </>
              )}
            </Button>
          </div>

          {/* Recent reports */}
          <div className="rounded-2xl border-2 bg-card p-5 card-machined shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base flex items-center gap-2">
                <FileDown className="h-4 w-4 text-primary" />
                {t("insights.recentReports")}
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs font-bold"
                onClick={() => generateReport.mutate()}
                disabled={generateReport.isPending}
              >
                {generateReport.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                {t("insights.generateNow")}
              </Button>
            </div>

            {reportsLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full skeleton-shimmer" />
                ))}
              </div>
            )}

            {!reportsLoading && reports?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                {t("insights.noReports")}
              </p>
            )}

            <div className="space-y-2">
              {reports?.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {new Date(r.report_period_start).toLocaleDateString()} →{" "}
                      {new Date(r.report_period_end).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.snag_count_open} {t("insights.open")} ·{" "}
                      {r.snag_count_fixed} {t("insights.fixed")} · SLA{" "}
                      {r.sla_compliance_percent}%
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.email_sent_at && (
                      <span className="text-[10px] font-bold text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />{" "}
                        {t("insights.sent")}
                      </span>
                    )}
                    {r.pdf_url && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const url = await getSignedUrl(
                              "snag-reports",
                              r.pdf_url,
                            );
                            if (!url) throw new Error("no signed url");
                            const res = await fetch(url);
                            if (!res.ok) throw new Error("fetch failed");
                            const blob = await res.blob();
                            // Direct <a download> click — never opens a new
                            // window/tab, so there's nothing for a popup
                            // blocker (or anything else intercepting
                            // window.open) to silently swallow.
                            const objectUrl = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = objectUrl;
                            const dateLabel =
                              r.report_period_start?.slice(0, 10) ?? "report";
                            a.download = `snapsnag-report-${dateLabel}.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(objectUrl);
                          } catch (err) {
                            console.error("Report download failed:", err);
                            toast.error(t("insights.downloadFailed"));
                          }
                        }}
                        className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                      >
                        <FileDown className="h-3 w-3" />{" "}
                        {t("insights.download")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
