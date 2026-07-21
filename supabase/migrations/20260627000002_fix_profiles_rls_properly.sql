-- ─────────────────────────────────────────────────────────────────────────────
-- PROPER FIX FOR PROFILES RLS RECURSION
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260627000000_security_fixes.sql tried to scope "profiles" reads to a
-- user's own team, but the policy queried public.profiles from within a
-- policy on public.profiles itself -> infinite recursion.
--
-- 20260627000001_fix_rls_recursion.sql "fixed" the recursion by replacing the
-- policy with `USING (true)`, which removed the recursion but also removed
-- all access control: any authenticated user (including subcontractors and
-- site workers on other teams) can read every profile row in the database,
-- including everyone's full_name / email / role / manager_id.
--
-- This migration replaces that with the same pattern already used elsewhere
-- in this codebase (see public.my_subcontractor_id() in
-- 20260526000001_subcontractor_portal_rls.sql): a SECURITY DEFINER helper
-- function. Functions marked SECURITY DEFINER run with the privileges of
-- their owner and bypass RLS *inside the function body*, so they can safely
-- look up the caller's own row without re-triggering the policy on the
-- outer query (which is what caused the recursion originally).

DROP POLICY IF EXISTS "profiles_read_all_auth" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_team" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_own" ON public.profiles;

-- Helper: the calling user's own role, read without going through RLS.
CREATE OR REPLACE FUNCTION public.my_profile_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Helper: the calling user's own manager_id, read without going through RLS.
CREATE OR REPLACE FUNCTION public.my_manager_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT manager_id FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.my_profile_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_manager_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_manager_id() TO authenticated;

-- 1. Everyone can always read their own profile.
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- 2. Managers can read everyone on their team (their site workers / the
--    people whose manager_id points at them).
CREATE POLICY "profiles_read_as_manager" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.my_profile_role() = 'manager'
    AND manager_id = auth.uid()
  );

-- 3. Non-manager team members (e.g. site workers) can read their manager's
--    profile and their teammates' profiles (anyone sharing the same manager).
CREATE POLICY "profiles_read_teammates" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = public.my_manager_id()
    OR manager_id = public.my_manager_id()
  );
