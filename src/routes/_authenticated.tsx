import {
  createFileRoute,
  Outlet,
  useNavigate,
  useSearch,
  useLocation,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { SubcontractorShell } from "@/components/SubcontractorShell";
import { SiteWorkerShell } from "@/components/SiteWorkerShell";
import { NameGate } from "@/components/NameGate";
import { TrialExpiredWall } from "@/components/TrialExpiredWall";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading, role } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { upgraded?: string };
  const location = useLocation();
  const isBillingRoute = location.pathname.startsWith("/billing");

  // Stripe redirects back with ?upgraded=true — force-refetch the subscription
  // immediately so the UI reflects the new plan without waiting for cache expiry.
  useEffect(() => {
    if (search?.upgraded === "true" && user?.id) {
      qc.invalidateQueries({ queryKey: ["subscription", user.id] });
    }
  }, [search?.upgraded, user?.id, qc]);
  const navigate = useNavigate();

  // Subscription gate — managers only, subcontractors/site_workers never see the wall
  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ["subscription", user?.id],
    enabled: role === "manager" && !!user,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } =
        await supabase.functions.invoke("get-subscription");
      if (error) throw error;
      return data?.subscription ?? null;
    },
  });

  useEffect(() => {
    // Only redirect to login after auth loading is complete AND no user is found
    if (loading === false && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  // Wait for auth AND subscription (managers only) before rendering
  // This prevents 404 errors on page refresh for authenticated users
  const isPageLoading = loading || (role === "manager" && subLoading);

  if (isPageLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-sm text-muted-foreground">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

  // Subcontractors and site workers — skip wall entirely
  if (role === "subcontractor") {
    return (
      <SubcontractorShell>
        <Outlet />
      </SubcontractorShell>
    );
  }

  if (role === "site_worker") {
    return (
      <NameGate>
        <SiteWorkerShell>
          <Outlet />
        </SiteWorkerShell>
      </NameGate>
    );
  }

  // Manager — check subscription before rendering AppShell
  const trialPastDue =
    subscription?.status === "trialing" &&
    !!subscription.trial_ends_at &&
    new Date(subscription.trial_ends_at).getTime() < Date.now();

  const isExpired =
    subscription?.status === "canceled" ||
    subscription?.status === "past_due" ||
    trialPastDue;

  if (isExpired && !isBillingRoute) {
    return (
      <TrialExpiredWall
        status={subscription!.status === "past_due" ? "past_due" : "canceled"}
      />
    );
  }

  return (
    <NameGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </NameGate>
  );
}
