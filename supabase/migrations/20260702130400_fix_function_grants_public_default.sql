-- lock_down_new_function_grants revoked from anon/authenticated directly,
-- but new functions get EXECUTE granted to PUBLIC by default, and anon/
-- authenticated inherit through PUBLIC — so that migration didn't actually
-- change anything. Matches the working pattern already used for
-- my_profile_role()/my_manager_id() in fix_profiles_rls_properly: revoke
-- from PUBLIC (which anon/authenticated both inherit), then grant back
-- explicitly only to authenticated where RLS policies need to call it.

REVOKE EXECUTE ON FUNCTION public.has_active_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_snag_limit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_member_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_snag_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_member_limit(uuid) TO authenticated;

-- Trigger functions are never called directly by any role, only by the
-- trigger mechanism itself, so no grant-back is needed.
REVOKE EXECUTE ON FUNCTION public.enforce_snag_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_member_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_site_worker_limit() FROM PUBLIC, anon, authenticated;
