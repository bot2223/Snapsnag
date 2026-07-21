
-- 1. Storage buckets: stop serving files via the public, unauthenticated
--    endpoint. RLS read policies already exist on storage.objects for all
--    three buckets; with public=false those policies actually get enforced.
UPDATE storage.buckets SET public = false WHERE id IN ('snag-photos', 'company-assets', 'snag-reports');

-- 2. Move plan/access-check helpers into a schema PostgREST never exposes,
--    so they stop being directly callable as /rest/v1/rpc/... by any
--    authenticated user with an arbitrary uuid (Supabase advisor flagged
--    this). They stay callable from RLS policies and triggers, since that
--    happens inside Postgres directly and doesn't go through PostgREST's
--    schema exposure list.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.has_active_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = target_user_id
      AND (
        (status = 'trialing' AND trial_ends_at > now())
        OR (status = 'active')
        OR (status = 'past_due' AND current_period_ends_at > now())
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.has_active_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_active_access(auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.my_manager_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT manager_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.my_profile_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.plan_snag_limit(target_manager_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE (SELECT plan FROM public.subscriptions WHERE user_id = target_manager_id)
    WHEN 'pro' THEN 200
    WHEN 'business' THEN 2147483647
    ELSE 50
  END;
$$;

CREATE OR REPLACE FUNCTION private.plan_member_limit(target_manager_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE (SELECT plan FROM public.subscriptions WHERE user_id = target_manager_id)
    WHEN 'pro' THEN 20
    WHEN 'business' THEN 2147483647
    ELSE 5
  END;
$$;

REVOKE EXECUTE ON FUNCTION private.has_active_access() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.has_active_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.my_manager_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.my_profile_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.plan_snag_limit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.plan_member_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_active_access() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_active_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.my_manager_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.my_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.plan_snag_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.plan_member_limit(uuid) TO authenticated;

-- 3. Repoint trigger functions at the private versions.
CREATE OR REPLACE FUNCTION public.enforce_snag_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.snags
    WHERE user_id = NEW.user_id AND created_at >= date_trunc('month', now())
  ) >= private.plan_snag_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Monthly snag limit reached for this plan';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (
    (SELECT count(*) FROM public.subcontractors WHERE user_id = NEW.user_id)
    + (SELECT count(*) FROM public.profiles WHERE manager_id = NEW.user_id AND role = 'site_worker')
  ) >= private.plan_member_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Team member limit reached for this plan';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_site_worker_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'site_worker' AND NEW.manager_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'site_worker' OR OLD.manager_id IS DISTINCT FROM NEW.manager_id)
  THEN
    IF (
      (SELECT count(*) FROM public.subcontractors WHERE user_id = NEW.manager_id)
      + (SELECT count(*) FROM public.profiles WHERE manager_id = NEW.manager_id AND role = 'site_worker')
    ) >= private.plan_member_limit(NEW.manager_id) THEN
      RAISE EXCEPTION 'Team member limit reached for this plan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Recreate every RLS policy that referenced the public.* helpers so they
--    point at private.* instead. Logic is unchanged, only the function
--    qualification.
DROP POLICY IF EXISTS "settings_authenticated" ON public.company_settings;
CREATE POLICY "settings_authenticated" ON public.company_settings
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND private.has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND private.has_active_access());

DROP POLICY IF EXISTS "profiles_read_as_manager" ON public.profiles;
CREATE POLICY "profiles_read_as_manager" ON public.profiles
  FOR SELECT TO authenticated
  USING (private.my_profile_role() = 'manager' AND manager_id = (select auth.uid()));

DROP POLICY IF EXISTS "profiles_read_teammates" ON public.profiles;
CREATE POLICY "profiles_read_teammates" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = private.my_manager_id() OR manager_id = private.my_manager_id());

DROP POLICY IF EXISTS "users_manage_own_schedules" ON public.report_schedules;
CREATE POLICY "users_manage_own_schedules" ON public.report_schedules
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND private.has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND private.has_active_access());

DROP POLICY IF EXISTS "activity_via_snag" ON public.snag_activity;
CREATE POLICY "activity_via_snag" ON public.snag_activity
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_activity.snag_id
      AND ((select auth.uid()) = s.user_id
           OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker'))
      AND private.has_active_access(s.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_activity.snag_id
      AND ((select auth.uid()) = s.user_id
           OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker'))
      AND private.has_active_access(s.user_id)
  ));

DROP POLICY IF EXISTS "activity_via_snag_subcontractor_read" ON public.snag_activity;
CREATE POLICY "activity_via_snag_subcontractor_read" ON public.snag_activity
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_activity.snag_id
      AND s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
      AND private.has_active_access(s.user_id)
  ));

DROP POLICY IF EXISTS "comments_via_snag" ON public.snag_comments;
CREATE POLICY "comments_via_snag" ON public.snag_comments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_comments.snag_id
      AND ((select auth.uid()) = s.user_id
           OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
           OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email())))
      AND private.has_active_access(s.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_comments.snag_id
      AND ((select auth.uid()) = s.user_id
           OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
           OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email())))
      AND private.has_active_access(s.user_id)
  ));

DROP POLICY IF EXISTS "users_view_own_reports" ON public.snag_reports;
CREATE POLICY "users_view_own_reports" ON public.snag_reports
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id AND private.has_active_access());

DROP POLICY IF EXISTS "snags_assigned_subcontractor" ON public.snags;
CREATE POLICY "snags_assigned_subcontractor" ON public.snags
  FOR SELECT TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND private.has_active_access(user_id)
  );

DROP POLICY IF EXISTS "snags_assigned_subcontractor_update" ON public.snags;
CREATE POLICY "snags_assigned_subcontractor_update" ON public.snags
  FOR UPDATE TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND private.has_active_access(user_id)
  )
  WITH CHECK (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND private.has_active_access(user_id)
  );

DROP POLICY IF EXISTS "snags_owner_or_site_worker" ON public.snags;
CREATE POLICY "snags_owner_or_site_worker" ON public.snags
  FOR ALL TO authenticated
  USING (
    ((select auth.uid()) = user_id
     OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker'))
    AND private.has_active_access(user_id)
  )
  WITH CHECK (
    ((select auth.uid()) = user_id
     OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker'))
    AND private.has_active_access(user_id)
  );

DROP POLICY IF EXISTS "subs_authenticated" ON public.subcontractors;
CREATE POLICY "subs_authenticated" ON public.subcontractors
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND private.has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND private.has_active_access());

-- 5. Drop the now-unreferenced public versions so only the private,
--    non-exposed copies remain.
DROP FUNCTION IF EXISTS public.has_active_access();
DROP FUNCTION IF EXISTS public.has_active_access(uuid);
DROP FUNCTION IF EXISTS public.my_manager_id();
DROP FUNCTION IF EXISTS public.my_profile_role();
DROP FUNCTION IF EXISTS public.plan_snag_limit(uuid);
DROP FUNCTION IF EXISTS public.plan_member_limit(uuid);
