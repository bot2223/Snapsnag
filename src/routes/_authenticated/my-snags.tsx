import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ImageIcon,
  Clock,
  AlertTriangle,
  Search,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { getSignedUrl } from "@/lib/storage-url";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { timeAgo } from "@/lib/time-ago";

export const Route = createFileRoute("/_authenticated/my-snags")({
  component: MySnags,
});

const PRIORITY_BORDER: Record<string, string> = {
  Critical: "border-l-red-500",
  High: "border-l-orange-500",
  Medium: "border-l-yellow-400",
  Low: "border-l-green-500",
};
const PRIORITY_PILL: Record<string, string> = {
  Critical: "status-critical",
  High: "status-high",
  Medium: "status-medium",
  Low: "status-low",
};
const STATUS_CHIP: Record<string, string> = {
  Open: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Fixed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

function formatDue(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type Snag = {
  id: string;
  photo_url: string | null;
  description: string | null;
  description_en: string | null;
  description_de: string | null;
  location: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  created_at: string | null;
  deadline_at: string | null;
};

/** One row, used identically on mobile and desktop — the whole row is a single tap/click target. */
function SnagRow({
  snag,
  t,
}: {
  snag: Snag;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const overdue =
    snag.deadline_at &&
    snag.status !== "Fixed" &&
    new Date(snag.deadline_at) < new Date();

  return (
    <Link
      to="/snag/$id"
      params={{ id: snag.id }}
      className={`group flex items-center gap-3 sm:gap-4 bg-card border border-l-4 ${
        PRIORITY_BORDER[snag.priority ?? ""] ?? "border-l-border"
      } rounded-2xl p-3 sm:p-4 card-machined transition-shadow hover:shadow-md active:opacity-80 active:scale-[0.995]`}
    >
      {/* Thumbnail */}
      {snag.photo_url ? (
        <img
          src={snag.photo_url}
          loading="lazy"
          alt=""
          className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover shrink-0"
        />
      ) : (
        <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl bg-muted flex items-center justify-center shrink-0">
          <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="data-field text-[11px] font-bold text-primary">
            SN-{snag.id.slice(0, 4).toUpperCase()}
          </span>
          <span
            className={`status-pill ${PRIORITY_PILL[snag.priority ?? ""] ?? ""}`}
          >
            {snag.priority ?? "—"}
          </span>
          {snag.priority === "Critical" && (
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          )}
        </div>
        <p className="text-sm sm:text-[15px] font-semibold truncate">
          {snag.location}
        </p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[snag.status ?? ""] ?? ""}`}
          >
            {snag.status
              ? t(`snagDetail.statuses.${snag.status}`, snag.status)
              : ""}
          </span>
          <span
            className={`text-xs flex items-center gap-1 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground/70"}`}
          >
            <Clock className="h-3 w-3" />
            {overdue
              ? `${t("mySnags.table.due")} ${formatDue(snag.deadline_at)}`
              : timeAgo(snag.created_at ?? new Date().toISOString(), t)}
          </span>
        </div>
      </div>

      {/* Affordance: hint this row is clickable */}
      <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function MySnags() {
  const { user, role } = useAuth();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["my-snags", user?.id, role],
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      // RLS already scopes results to "this team's snags" for both
      // managers and site workers (a site worker's row gets its user_id
      // rewritten to the billing manager server-side), so a plain
      // unfiltered query — same as ManagerDashboard — is enough. Filtering
      // by manager_id here would only show snags a site worker logged
      // themselves, hiding the rest of the team's.
      const { data, error } = await supabase
        .from("snags")
        .select(
          "id, photo_url, description, description_en, description_de, location, category, priority, status, created_at, deadline_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const withSignedUrls = await Promise.all(
        (data as Snag[]).map(async (s) => ({
          ...s,
          photo_url: await getSignedUrl("snag-photos", s.photo_url),
        })),
      );
      return withSignedUrls;
    },
  });

  const filtered = data?.filter((snag) => {
    const matchesStatus =
      statusFilter === "all" || snag.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      snag.description?.toLowerCase().includes(q) ||
      snag.description_en?.toLowerCase().includes(q) ||
      snag.description_de?.toLowerCase().includes(q) ||
      snag.location?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("mySnags.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("mySnags.loggedByYou", { count: data?.length ?? 0 })}
        </p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mySnags.searchPlaceholder")}
            className="w-full pl-9 pr-3 h-10 rounded-xl border-2 bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-xl border-2 bg-card text-sm px-3 font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">{t("mySnags.filterAll")}</option>
          <option value="Open">{t("dashboard.open")}</option>
          <option value="Fixed">{t("dashboard.fixed")}</option>
        </select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[76px] rounded-2xl border bg-card skeleton-shimmer"
            />
          ))}
        </div>
      )}

      {!isLoading && filtered?.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed bg-card py-16 text-center text-muted-foreground">
          <p className="font-semibold">{t("mySnags.empty")}</p>
          <p className="text-sm mt-1">{t("mySnags.emptyHint")}</p>
        </div>
      )}

      {/* Single row list — identical component on every breakpoint, whole row is the tap target */}
      {filtered && filtered.length > 0 && (
        <div className="space-y-2.5">
          {filtered.map((snag) => (
            <SnagRow key={snag.id} snag={snag} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
