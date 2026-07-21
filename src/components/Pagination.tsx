import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

// First/last page always shown, plus current ±1; gaps collapse to a single
// "…" so a large page count never overflows a 375px-wide panel.
function getPageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const keep = new Set([0, total - 1, current - 1, current, current + 1]);
  const sorted = [...keep]
    .filter((p) => p >= 0 && p < total)
    .sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  let prev = -1;
  for (const p of sorted) {
    if (prev !== -1 && p - prev > 1) result.push("ellipsis");
    result.push(p);
    prev = p;
  }
  return result;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  dark,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  dark?: boolean;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  const btn =
    "h-7 min-w-7 px-1.5 rounded-lg text-xs font-bold transition-colors";
  const inactive = dark
    ? "text-slate-400 hover:text-white hover:bg-slate-700"
    : "text-muted-foreground hover:text-foreground hover:bg-muted";
  const active = "bg-primary text-primary-foreground";
  const ellipsisColor = dark ? "text-slate-500" : "text-muted-foreground";

  return (
    <div className="flex items-center justify-center gap-1 pt-3">
      <button
        type="button"
        aria-label={t("dashboard.paginationPrev")}
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
        className={`${btn} ${inactive} disabled:opacity-30 disabled:pointer-events-none`}
      >
        <ChevronLeft className="h-3.5 w-3.5 mx-auto" />
      </button>
      {getPageList(page, totalPages).map((p, i) =>
        p === "ellipsis" ? (
          <span
            key={`ellipsis-${i}`}
            className={`px-1 text-xs ${ellipsisColor}`}
          >
            …
          </span>
        ) : (
          <button
            type="button"
            key={p}
            onClick={() => onPageChange(p)}
            className={`${btn} ${p === page ? active : inactive}`}
          >
            {p + 1}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label={t("dashboard.paginationNext")}
        disabled={page === totalPages - 1}
        onClick={() => onPageChange(page + 1)}
        className={`${btn} ${inactive} disabled:opacity-30 disabled:pointer-events-none`}
      >
        <ChevronRight className="h-3.5 w-3.5 mx-auto" />
      </button>
    </div>
  );
}
