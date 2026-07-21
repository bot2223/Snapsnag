import { Link } from "@tanstack/react-router";
import { HardHat, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type Props = {
  type: "snag" | "member";
  used: number;
  limit: number;
  onClose: () => void;
};

const hazardStripe =
  "repeating-linear-gradient(135deg, var(--color-primary) 0px, var(--color-primary) 8px, var(--color-navy) 8px, var(--color-navy) 16px)";

export function LimitDialog({ type, used, limit, onClose }: Props) {
  const { t } = useTranslation();
  const isSnag = type === "snag";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in-0 duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-background rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        {/* Hazard stripe */}
        <div className="h-2.5 w-full" style={{ background: hazardStripe }} />

        <div className="p-6 space-y-5">
          {/* Header row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <HardHat className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-xl leading-tight">
                  {t("limits.title")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isSnag
                    ? t("limits.snagSubtitle")
                    : t("limits.memberSubtitle")}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Usage bar */}
          <div className="rounded-2xl border bg-muted/40 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">
                {isSnag ? t("limits.snagUsage") : t("limits.memberUsage")}
              </span>
              <span className="font-bold text-destructive">
                {used} / {limit === Infinity ? "∞" : limit}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-destructive transition-all duration-500"
                style={{
                  width: `${limit === Infinity ? 100 : Math.min(100, Math.round((used / limit) * 100))}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {isSnag
                ? t("limits.snagResetHint")
                : t("limits.memberRemoveHint")}
            </p>
          </div>

          {/* CTA */}
          <div className="space-y-2.5">
            <Link to="/billing" onClick={onClose} className="block">
              <Button className="w-full h-13 text-base font-bold rounded-2xl gap-2 shadow-md shadow-primary/20">
                <TrendingUp className="h-5 w-5" />
                {t("limits.upgradePlan")}
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={onClose}
              className="w-full h-11 text-muted-foreground font-medium rounded-2xl"
            >
              {t("limits.maybeLater")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
