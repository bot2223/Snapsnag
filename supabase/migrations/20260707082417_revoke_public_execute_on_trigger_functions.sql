-- trigger_notify_status_change and trigger_notify_subcontractor are
-- SECURITY DEFINER functions meant to run only as table triggers, but
-- Postgres grants EXECUTE to PUBLIC by default, which PostgREST exposes
-- as callable RPC endpoints (/rest/v1/rpc/...) to anon and authenticated
-- roles. They can't actually do anything if called directly (they're
-- RETURNS trigger and error outside trigger context), but there's no
-- reason to leave that surface open. Revoking does not affect the
-- triggers themselves, which fire independent of caller grants.
REVOKE EXECUTE ON FUNCTION public.trigger_notify_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_notify_subcontractor() FROM PUBLIC, anon, authenticated;
