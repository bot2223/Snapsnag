import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { ManagerDashboard } from "@/components/ManagerDashboard";
import { SubcontractorDashboard } from "@/components/SubcontractorDashboard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { role, loading } = useAuth();

  // Site workers see the exact same dashboard a manager does — RLS already
  // scopes the underlying snags/activity queries to what each role is
  // allowed to see (their own snags plus their manager's), so no separate
  // component or client-side filtering is needed here.
  if (role === "subcontractor") return <SubcontractorDashboard />;

  // `role` starts out null and only settles once auth finishes resolving
  // it (see AuthProvider.resolveRole). Falling through to ManagerDashboard
  // in that window meant a subcontractor could briefly see the manager's
  // skeleton layout before flipping to their own — wrong shape, wrong
  // colors, confusing flash. AuthLayout already renders a shared spinner
  // while `loading` is true, so mirror that guard here instead of
  // guessing a role.
  if (loading) return null;

  return <ManagerDashboard />;
}
