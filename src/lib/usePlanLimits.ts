import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

// ── Plan limits & feature flags ───────────────────────────────────────────────
// null → treat as Starter (safe fallback; signup trigger always creates trialing row)
const PLAN_LIMITS: Record<
  string,
  {
    snags: number;
    members: number;
    resolutionPhotos: boolean; // "Mark as Fixed" with photo proof
    activityLog: boolean; // full audit log
    slaCountdowns: boolean; // deadline countdown badges
    namedComments: boolean; // role labels on comments
    emailFooter: boolean; // custom footer text on outgoing Resend emails
    customBranding: boolean; // brand theme picker (manager) + personal accent picker (team)
    floorPlans: boolean; // upload floor plans + pin snags to an exact spot
  }
> = {
  starter: {
    snags: 50,
    members: 5,
    resolutionPhotos: false,
    activityLog: false,
    slaCountdowns: false,
    namedComments: false,
    emailFooter: false,
    customBranding: false,
    floorPlans: false,
  },
  pro: {
    snags: 200,
    members: 20,
    resolutionPhotos: true,
    activityLog: true,
    slaCountdowns: true,
    namedComments: true,
    emailFooter: false,
    customBranding: false,
    floorPlans: true,
  },
  business: {
    snags: Infinity,
    members: Infinity,
    resolutionPhotos: true,
    activityLog: true,
    slaCountdowns: true,
    namedComments: true,
    emailFooter: true,
    customBranding: true,
    floorPlans: true,
  },
};
const FALLBACK = PLAN_LIMITS.starter;

export function usePlanLimits() {
  const { user } = useAuth();

  // Reads from cache populated by _authenticated.tsx — zero extra network calls
  const { data: subscription } = useQuery<{
    plan: string;
    status: string;
  } | null>({
    queryKey: ["subscription", user?.id],
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } =
        await supabase.functions.invoke("get-subscription");
      // Throwing here (rather than resolving with null) means react-query
      // treats a network failure as a failed fetch and keeps showing the
      // last successful plan instead of quietly downgrading everyone to
      // Starter limits the moment they go offline — and, since that's now
      // persisted (see __root.tsx), permanently overwriting the real plan
      // in the cache too. A genuinely new user with no successful fetch yet
      // still falls through to the FALLBACK (Starter) below exactly as
      // before, since `subscription` simply stays undefined until one
      // succeeds.
      if (error) throw error;
      return data?.subscription ?? null;
    },
  });

  // Rolling monthly snag count: created_at >= first day of current calendar month
  const { data: snagCount = 0, isLoading: snagLoading } = useQuery({
    queryKey: ["snag-count-month", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("snags")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .gte("created_at", start.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Combined team member count: subcontractors + site_workers (excludes manager)
  const { data: memberCount = 0, isLoading: memberLoading } = useQuery({
    queryKey: ["member-count", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const [subRes, workerRes] = await Promise.all([
        supabase
          .from("subcontractors")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("role", "site_worker"),
      ]);
      if (subRes.error || workerRes.error) {
        throw subRes.error || workerRes.error;
      }
      return (subRes.count ?? 0) + (workerRes.count ?? 0);
    },
  });

  const plan = subscription?.plan ?? null;
  const limits = plan && PLAN_LIMITS[plan] ? PLAN_LIMITS[plan] : FALLBACK;

  return {
    plan,
    // Numeric limits
    snagLimit: limits.snags,
    memberLimit: limits.members,
    snagCount,
    memberCount,
    // While loading, default to allowed — never block on a pending query
    canAddSnag: snagLoading ? true : snagCount < limits.snags,
    canAddMember: memberLoading ? true : memberCount < limits.members,
    isLoading: snagLoading || memberLoading,
    // Feature flags — used to gate Pro/Business UI elements
    canUseResolutionPhotos: limits.resolutionPhotos,
    canUseActivityLog: limits.activityLog,
    canUseSlaCountdowns: limits.slaCountdowns,
    canUseNamedComments: limits.namedComments,
    canUseEmailFooter: limits.emailFooter,
    canUseCustomBranding: limits.customBranding,
    canUseFloorPlans: limits.floorPlans,
  };
}
