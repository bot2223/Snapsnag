import { createFileRoute } from "@tanstack/react-router";
import { CreditCard, HardHat, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlanCards } from "@/components/PlanCards";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

// Diagonal hazard stripe style
const hazardStripe = (a = "var(--color-primary)", b = "var(--color-navy)") =>
  `repeating-linear-gradient(135deg, ${a} 0px, ${a} 10px, ${b} 10px, ${b} 20px)`;

function BillingPage() {
  const { t } = useTranslation();
  const { role } = useAuth();

  // Access to a team's plan is gated to managers everywhere else in the app
  // (billing is the manager's, not a site worker's or subcontractor's — see
  // SiteWorkerShell/SubcontractorShell, neither of which link here). This
  // route itself has no auth-context role check upstream, so it's still
  // reachable directly; render a plain notice instead of real plan-cards +
  // checkout for anyone who isn't a manager, rather than relying on the
  // create-checkout edge function's own role check as the only backstop.
  if (role !== "manager") {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-20">
        <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-bold">{t("billing.managerOnlyTitle")}</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          {t("billing.managerOnlyBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* ── Hero banner ── */}
      <div className="rounded-2xl overflow-hidden border shadow-sm">
        <div className="h-2.5 w-full" style={{ background: hazardStripe() }} />
        <div className="bg-card px-5 py-5 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("billing.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("billing.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <PlanCards />

      {/* ── Site notice ── */}
      <div
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{
          background:
            "repeating-linear-gradient(135deg, oklch(0.20 0.05 258 / 0.04) 0px, oklch(0.20 0.05 258 / 0.04) 8px, transparent 8px, transparent 16px)",
          border: "1px solid oklch(0.20 0.05 258 / 0.15)",
        }}
      >
        <HardHat className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("billing.siteNotice")}
        </p>
      </div>
    </div>
  );
}
