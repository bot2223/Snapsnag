-- The parameterized helpers added in gate_assignee_access_on_manager_subscription
-- and enforce_plan_limits_server_side are only meant to be called from inside
-- RLS policies/triggers, not invoked directly. RLS-embedded calls still work
-- for `authenticated` after this (Postgres requires the invoking role to hold
-- EXECUTE for policy-embedded calls, so that grant has to stay) — this only
-- closes the unauthenticated (`anon`) path, and removes the trigger
-- functions from direct callability entirely since nothing legitimately
-- calls those outside the trigger mechanism.
--
-- NOTE: this migration turned out to be a no-op — see
-- fix_function_grants_public_default, applied right after it, for why and
-- for the actual fix. Left in place rather than edited/removed because
-- migrations here are append-only.

REVOKE EXECUTE ON FUNCTION public.has_active_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.plan_snag_limit(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.plan_member_limit(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.enforce_snag_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_member_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_site_worker_limit() FROM anon, authenticated;
