import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useIsOnline } from "@/hooks/useIsOnline";

export type PlanId = "starter" | "pro" | "business";

const PLANS: {
  id: PlanId;
  price: string;
  badge?: string;
  features: {
    labelKey: string;
    labelParams?: Record<string, string | number>;
    included: boolean;
  }[];
}[] = [
  {
    id: "starter",
    price: "€29.99/mo",
    features: [
      {
        labelKey: "billing.features.snagsPerMonth",
        labelParams: { count: 50 },
        included: true,
      },
      {
        labelKey: "billing.features.teamMembers",
        labelParams: { count: 5 },
        included: true,
      },
      { labelKey: "billing.features.aiPhotoDescriptions", included: true },
      { labelKey: "billing.features.notifications", included: true },
      { labelKey: "billing.features.slaDeadlines", included: false },
      { labelKey: "billing.features.escalationAlerts", included: false },
      { labelKey: "billing.features.resolutionPhotoProof", included: false },
      { labelKey: "billing.features.activityLog", included: false },
    ],
  },
  {
    id: "pro",
    price: "€59.99/mo",
    badge: "Most popular",
    features: [
      {
        labelKey: "billing.features.snagsPerMonth",
        labelParams: { count: 200 },
        included: true,
      },
      {
        labelKey: "billing.features.teamMembers",
        labelParams: { count: 20 },
        included: true,
      },
      { labelKey: "billing.features.aiPhotoDescriptions", included: true },
      { labelKey: "billing.features.notifications", included: true },
      { labelKey: "billing.features.slaDeadlines", included: true },
      { labelKey: "billing.features.escalationAlerts", included: true },
      { labelKey: "billing.features.resolutionPhotoProof", included: true },
      { labelKey: "billing.features.activityLog", included: true },
    ],
  },
  {
    id: "business",
    price: "€99.99/mo",
    features: [
      { labelKey: "billing.features.snagsUnlimited", included: true },
      { labelKey: "billing.features.teamMembersUnlimited", included: true },
      { labelKey: "billing.features.aiPhotoDescriptions", included: true },
      { labelKey: "billing.features.notifications", included: true },
      { labelKey: "billing.features.slaDeadlines", included: true },
      { labelKey: "billing.features.escalationAlerts", included: true },
      { labelKey: "billing.features.resolutionPhotoProof", included: true },
      { labelKey: "billing.features.activityLog", included: true },
      { labelKey: "billing.features.weeklyReport", included: true },
    ],
  },
];

// Canonical comparison rows — mobile-only table view. PLANS above is kept
// as-is (still drives the desktop 3-card layout and the per-card feature
// lists), but a literal row-by-row zip of those three arrays would
// misalign: Business splits Pro's single "Custom branding & PDF reports"
// line into two separate rows, and "48hr deadline reminders" only exists
// standalone on Starter (folded into the others' combined email line).
// Each row here is hand-mapped to what each tier actually provides, not
// derived positionally, so the table can't silently drift out of sync
// with the card copy above if PLANS changes — both must be updated together.
type ComparisonCell = { yes: boolean; text?: string };
const COMPARISON_ROWS: {
  labelKey: string;
  cells: Record<PlanId, ComparisonCell>;
}[] = [
  {
    labelKey: "billing.compareRows.snags",
    cells: {
      starter: { yes: true, text: "50" },
      pro: { yes: true, text: "200" },
      business: { yes: true, text: "Unlimited" },
    },
  },
  {
    labelKey: "billing.compareRows.teamMembers",
    cells: {
      starter: { yes: true, text: "5" },
      pro: { yes: true, text: "20" },
      business: { yes: true, text: "Unlimited" },
    },
  },
  {
    labelKey: "billing.features.aiPhotoDescriptions",
    cells: {
      starter: { yes: true },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.features.notifications",
    cells: {
      starter: { yes: true },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.compareRows.slaDeadlines",
    cells: {
      starter: { yes: false },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.features.escalationAlerts",
    cells: {
      starter: { yes: false },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.features.resolutionPhotoProof",
    cells: {
      starter: { yes: false },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.features.activityLog",
    cells: {
      starter: { yes: false },
      pro: { yes: true },
      business: { yes: true },
    },
  },
  {
    labelKey: "billing.compareRows.automatedReports",
    cells: {
      starter: { yes: false },
      pro: { yes: false },
      business: { yes: true },
    },
  },
];

// Plan order, used to tell upgrade from downgrade for button labeling
const PLAN_ORDER: PlanId[] = ["starter", "pro", "business"];

/**
 * Shared plan/subscription UI — current plan banner + plan comparison cards.
 * Used by both the standalone /billing page and the Settings > Billing tab,
 * so checkout/subscription logic only lives in one place.
 */
export function PlanCards() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isOnline = useIsOnline();
  const [checkoutBusy, setCheckoutBusy] = useState<PlanId | null>(null);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number>(0);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<PlanId | null>(null);
  const [cancelDowngradeBusy, setCancelDowngradeBusy] = useState(false);

  const { data: subscription, isLoading } = useQuery({
    queryKey: ["subscription", user?.id],
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } =
        await supabase.functions.invoke("get-subscription");
      if (error) throw error;
      return data?.subscription ?? null;
    },
  });

  // Update trial days left every minute
  useEffect(() => {
    if (!subscription?.trial_ends_at) return;
    const updateTrialDays = () => {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(subscription.trial_ends_at).getTime() - Date.now()) /
            86400000,
        ),
      );
      setTrialDaysLeft(daysLeft);
    };
    updateTrialDays();
    const interval = setInterval(updateTrialDays, 60000);
    return () => clearInterval(interval);
  }, [subscription?.trial_ends_at]);

  const startCheckout = async (plan: PlanId) => {
    if (!user) return;
    setCheckoutBusy(plan);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-checkout",
        {
          body: { plan, user_id: user.id },
        },
      );
      if (error) throw error;
      if (data?.scheduled) {
        // Downgrade — create-checkout scheduled it for end of the current
        // billing period rather than switching immediately; nothing to
        // redirect to, just reflect the new pending state.
        toast.success(
          t("billing.downgradeScheduled", {
            date: new Date(data.effective_at).toLocaleDateString(),
          }),
        );
        await qc.invalidateQueries({ queryKey: ["subscription", user.id] });
        await qc.refetchQueries({ queryKey: ["subscription", user.id] });
      } else if (data?.switched) {
        // Plan switched in place on the existing Stripe subscription — no redirect needed.
        toast.success(t("billing.planSwitched"));
        // Invalidate and refetch subscription data to reflect the new plan
        await qc.invalidateQueries({ queryKey: ["subscription", user.id] });
        // Force an immediate refetch to update the UI
        await qc.refetchQueries({ queryKey: ["subscription", user.id] });
      } else if (data?.url) {
        toast.success(t("billing.upgrading"));
        window.location.href = data.url;
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCheckoutBusy(null);
      setDowngradeTarget(null);
    }
  };

  const cancelSubscription = async () => {
    setCancelBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "cancel-subscription",
      );
      if (error) throw error;
      if (data?.accessUntil) {
        toast.success(
          t("billing.cancelSuccess", {
            date: new Date(data.accessUntil).toLocaleDateString(),
          }),
        );
      } else {
        toast.success(t("billing.cancelSuccessGeneric"));
      }
      await qc.invalidateQueries({ queryKey: ["subscription", user?.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelBusy(false);
      setCancelDialogOpen(false);
    }
  };

  const cancelScheduledDowngrade = async () => {
    setCancelDowngradeBusy(true);
    try {
      const { error } = await supabase.functions.invoke(
        "cancel-scheduled-downgrade",
      );
      if (error) throw error;
      toast.success(t("billing.downgradeCanceled"));
      await qc.invalidateQueries({ queryKey: ["subscription", user?.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelDowngradeBusy(false);
    }
  };

  // Active = paying or trialing; canceled is NOT active
  const activePlan: PlanId | null =
    subscription?.status === "active" || subscription?.status === "trialing"
      ? subscription.plan
      : null;

  // Index of the active plan in the upgrade/downgrade order, for button labeling
  const activePlanIndex = activePlan ? PLAN_ORDER.indexOf(activePlan) : -1;

  return (
    <>
      {/* ── Current plan status ── */}
      {isLoading ? (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : subscription ? (
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="text-sm">
            <span className="font-semibold">
              {t("billing.activePlanLabel")}:
            </span>{" "}
            <span className="capitalize">
              {t(`billing.plans.${subscription.plan}`)}
            </span>
          </p>
          {subscription.status === "trialing" && subscription.trial_ends_at ? (
            <p className="text-sm mt-1">
              <span className="font-semibold">
                {t("billing.trialEndsLabel")}:
              </span>{" "}
              {t("billing.trialDaysLeft", { count: trialDaysLeft })}
            </p>
          ) : (
            <p className="text-sm mt-1 flex items-center gap-1.5">
              <span className="font-semibold">{t("billing.currentPlan")}:</span>
              <span
                className={`inline-flex items-center gap-1 ${
                  subscription.status === "active"
                    ? "text-green-700 dark:text-green-400"
                    : subscription.status === "past_due"
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-red-600 dark:text-red-400"
                }`}
              >
                {subscription.status === "active" && (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {subscription.status === "past_due" && (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {t(`billing.status.${subscription.status}`)}
              </span>
            </p>
          )}

          {subscription.status === "past_due" && (
            <p className="text-xs text-orange-700 dark:text-orange-400 mt-2 leading-relaxed">
              {t("billing.pastDueWarning")}
            </p>
          )}

          {subscription.pending_plan &&
            subscription.pending_plan_effective_at && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("billing.pendingDowngradeBanner", {
                    plan: t(`billing.plans.${subscription.pending_plan}`),
                    date: new Date(
                      subscription.pending_plan_effective_at,
                    ).toLocaleDateString(),
                  })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={cancelScheduledDowngrade}
                  disabled={cancelDowngradeBusy || !isOnline}
                  title={!isOnline ? t("offline.requiresInternet") : undefined}
                >
                  {cancelDowngradeBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t("billing.cancelScheduledDowngrade")
                  )}
                </Button>
              </div>
            )}
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("billing.noSubscription")}
        </div>
      )}

      {/* ── Plan cards ── */}
      <div>
        <h2 className="text-base font-semibold mb-3">
          {t("billing.choosePlan")}
        </h2>

        {/* Mobile — comparison table. Each feature is one row, plans are
            columns; swipe horizontally, feature names stay pinned. Replaces
            three full-height stacked cards that repeated ~7 lines 3x. */}
        <div className="md:hidden space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("billing.swipeHint")}
          </p>
          <div className="plan-table-wrap">
            <div className="plan-table-scroll">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th className="feat-col" />
                    {PLANS.map(({ id, price, badge }) => {
                      const isCurrent = activePlan === id;
                      return (
                        <th
                          key={id}
                          className={`plan-col ${isCurrent ? "is-current" : ""}`}
                        >
                          {isCurrent ? (
                            <span className="plan-badge cur">
                              {t("billing.current")}
                            </span>
                          ) : badge ? (
                            <span className="plan-badge pop">{badge}</span>
                          ) : (
                            <span className="plan-badge pop invisible">·</span>
                          )}
                          <div className="plan-name">
                            {t(`billing.plans.${id}`)}
                          </div>
                          <div className="plan-price">
                            {price.split("/")[0]}
                            <span className="unit">/{price.split("/")[1]}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.labelKey}>
                      <td className="feat-col">{t(row.labelKey)}</td>
                      {PLAN_ORDER.map((id) => {
                        const cell = row.cells[id];
                        const isCurrent = activePlan === id;
                        return (
                          <td
                            key={id}
                            className={`plan-col ${isCurrent ? "is-current" : ""}`}
                          >
                            {cell.text ? (
                              <span className="font-semibold data-field">
                                {cell.text}
                              </span>
                            ) : cell.yes ? (
                              <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="feat-col" />
                    {PLANS.map(({ id }, planIndex) => {
                      const isCurrent = activePlan === id;
                      const isDowngrade =
                        activePlanIndex > -1 && planIndex < activePlanIndex;
                      return (
                        <td key={id} className={isCurrent ? "is-current" : ""}>
                          {isCurrent ? (
                            subscription?.stripe_subscription_id ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                className="w-full h-9 text-xs"
                                onClick={() => setCancelDialogOpen(true)}
                              >
                                {t("billing.cancelPlan")}
                              </Button>
                            ) : (
                              <p className="text-[10px] text-muted-foreground text-center leading-relaxed px-1">
                                {t("billing.noActiveStripeSub")}
                              </p>
                            )
                          ) : (
                            <Button
                              variant={isDowngrade ? "outline" : "default"}
                              size="sm"
                              className="w-full h-9 text-xs"
                              onClick={() =>
                                isDowngrade
                                  ? setDowngradeTarget(id)
                                  : startCheckout(id)
                              }
                              disabled={
                                !!checkoutBusy ||
                                subscription?.pending_plan === id ||
                                !isOnline
                              }
                              title={
                                !isOnline
                                  ? t("offline.requiresInternet")
                                  : undefined
                              }
                            >
                              {checkoutBusy === id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : subscription?.pending_plan === id ? (
                                t("billing.downgradeScheduledLabel")
                              ) : isDowngrade ? (
                                t("billing.downgrade")
                              ) : (
                                t("billing.upgrade")
                              )}
                            </Button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Desktop/tablet — unchanged 3-card grid */}
        <div className="hidden md:grid md:grid-cols-3 gap-4">
          {PLANS.map(({ id, price, features, badge }, planIndex) => {
            const isCurrent = activePlan === id;
            const isDowngrade =
              activePlanIndex > -1 && planIndex < activePlanIndex;
            const isScheduled = subscription?.pending_plan === id;
            const buttonLabel =
              checkoutBusy === id
                ? null
                : isScheduled
                  ? t("billing.downgradeScheduledLabel")
                  : isDowngrade
                    ? t("billing.downgrade")
                    : t("billing.upgrade");

            return (
              <div
                key={id}
                className={`relative rounded-xl border bg-card flex flex-col ${
                  isCurrent ? "border-primary border-2" : "border-border"
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                    {t("billing.current")}
                  </span>
                )}
                {badge && !isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap border">
                    {badge}
                  </span>
                )}

                <div className="p-5 pt-6 flex flex-col flex-1">
                  <h3 className="font-semibold text-base capitalize">
                    {t(`billing.plans.${id}`)}
                  </h3>
                  <p className="text-2xl font-bold text-primary mt-1">
                    {price.split("/")[0]}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{price.split("/")[1]}
                    </span>
                  </p>

                  <ul className="mt-4 space-y-2 flex-1">
                    {features.map(({ labelKey, labelParams, included }) => (
                      <li
                        key={labelKey}
                        className={`flex items-start gap-2 text-sm ${
                          included
                            ? "text-foreground"
                            : "text-muted-foreground/60"
                        }`}
                      >
                        {included ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                        )}
                        <span>{t(labelKey, labelParams)}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5">
                    {isCurrent ? (
                      subscription?.stripe_subscription_id ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full"
                          onClick={() => setCancelDialogOpen(true)}
                        >
                          {t("billing.cancelPlan")}
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                          {t("billing.noActiveStripeSub")}
                        </p>
                      )
                    ) : (
                      <Button
                        variant={isDowngrade ? "outline" : "default"}
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          isDowngrade
                            ? setDowngradeTarget(id)
                            : startCheckout(id)
                        }
                        disabled={!!checkoutBusy || isScheduled || !isOnline}
                        title={
                          !isOnline ? t("offline.requiresInternet") : undefined
                        }
                      >
                        {buttonLabel ?? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("billing.cancelConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("billing.cancelConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("billing.cancelConfirmBack")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={cancelSubscription}
              disabled={cancelBusy || !isOnline}
              title={!isOnline ? t("offline.requiresInternet") : undefined}
            >
              {cancelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("billing.cancelConfirmAction")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!downgradeTarget}
        onOpenChange={(open) => !open && setDowngradeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("billing.downgradeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {downgradeTarget &&
                t("billing.downgradeConfirmBody", {
                  plan: t(`billing.plans.${downgradeTarget}`),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("billing.downgradeConfirmBack")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => downgradeTarget && startCheckout(downgradeTarget)}
              disabled={!!checkoutBusy || !isOnline}
              title={!isOnline ? t("offline.requiresInternet") : undefined}
            >
              {checkoutBusy === downgradeTarget ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("billing.downgradeConfirmAction")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
