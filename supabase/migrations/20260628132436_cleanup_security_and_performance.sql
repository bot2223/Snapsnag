-- ─────────────────────────────────────────────────────────────────────────
-- 1. Drop dead "comments" table (superseded by snag_comments; RLS enabled,
--    zero policies, zero rows, nothing in the frontend references it)
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.comments;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Pin search_path on all SECURITY DEFINER / trigger functions
--    (prevents schema-shadowing privilege escalation)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_report_schedule_for_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.plan = 'business' AND (OLD.plan IS NULL OR OLD.plan != 'business') THEN
    INSERT INTO public.report_schedules (user_id, enabled, day_of_week, time_utc)
    VALUES (NEW.user_id, true, 1, '09:00')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.generate_avatar_initials()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  parts text[];
BEGIN
  IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
    parts := string_to_array(trim(NEW.full_name), ' ');
    IF array_length(parts, 1) >= 2 THEN
      NEW.avatar_initials := upper(left(parts[1], 1) || left(parts[2], 1));
    ELSE
      NEW.avatar_initials := upper(left(parts[1], 2));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.subscriptions (user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trialing', now() + INTERVAL '30 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'manager')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_snag_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.snag_activity (snag_id, user_id, action, to_status)
    VALUES (NEW.id, NEW.user_id, 'created', NEW.status);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.snag_activity (snag_id, user_id, action, from_status, to_status)
    VALUES (NEW.id, NEW.user_id, 'status_changed', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_snag_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.deadline_at := CASE NEW.priority
    WHEN 'Critical' THEN NEW.created_at + INTERVAL '24 hours'
    WHEN 'High'     THEN NEW.created_at + INTERVAL '72 hours'
    WHEN 'Medium'   THEN NEW.created_at + INTERVAL '7 days'
    WHEN 'Low'      THEN NEW.created_at + INTERVAL '14 days'
    ELSE                 NEW.created_at + INTERVAL '7 days'
  END;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Revoke anon/authenticated EXECUTE on functions that should only ever
--    run as triggers (never called directly via RPC)
-- ─────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_report_schedule_for_business() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_snag_activity() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Drop redundant duplicate-permissive policies (same qual as another
--    policy on the same table/role/action -> wasted evaluation per row)
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "activity_authenticated" ON public.snag_activity;     -- identical qual to activity_via_snag
DROP POLICY IF EXISTS "comments_authenticated" ON public.snag_comments;    -- strict subset of comments_via_snag

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Rewrite remaining policies to use (select auth.<fn>()) so Postgres
--    caches the result once per statement instead of once per row
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snags_authenticated" ON public.snags;
CREATE POLICY "snags_authenticated" ON public.snags
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "subs_authenticated" ON public.subcontractors;
CREATE POLICY "subs_authenticated" ON public.subcontractors
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "settings_authenticated" ON public.company_settings;
CREATE POLICY "settings_authenticated" ON public.company_settings
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "comments_via_snag" ON public.snag_comments;
CREATE POLICY "comments_via_snag" ON public.snag_comments
  FOR ALL TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_comments.snag_id AND s.user_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "activity_via_snag" ON public.snag_activity;
CREATE POLICY "activity_via_snag" ON public.snag_activity
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_activity.snag_id AND s.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "subscriptions_own" ON public.subscriptions;
CREATE POLICY "subscriptions_own" ON public.subscriptions
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users_view_own_reports" ON public.snag_reports;
CREATE POLICY "users_view_own_reports" ON public.snag_reports
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "users_manage_own_schedules" ON public.report_schedules;
CREATE POLICY "users_manage_own_schedules" ON public.report_schedules
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "profiles_read_as_manager" ON public.profiles;
CREATE POLICY "profiles_read_as_manager" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.my_profile_role() = 'manager' AND manager_id = (select auth.uid()));

DROP POLICY IF EXISTS "profiles_read_own" ON public.profiles;
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Add missing covering indexes on foreign keys
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_snag_comments_snag_id ON public.snag_comments(snag_id);
CREATE INDEX IF NOT EXISTS idx_snag_comments_user_id ON public.snag_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_snag_activity_snag_id ON public.snag_activity(snag_id);
CREATE INDEX IF NOT EXISTS idx_snag_activity_user_id ON public.snag_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_snag_reports_user_id ON public.snag_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_snags_subcontractor_id ON public.snags(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_snags_user_id ON public.snags(user_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_user_id ON public.subcontractors(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON public.profiles(manager_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Drop the never-used index flagged by the performance advisor
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_snags_manager_id;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Reconcile the one out-of-sync subscription row with Stripe's actual
--    state (sub_1TmxBr3TanCu75uCRWKZkAzy is canceled in Stripe, was still
--    "active" in our DB)
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.subscriptions
SET status = 'canceled', updated_at = now()
WHERE stripe_subscription_id = 'sub_1TmxBr3TanCu75uCRWKZkAzy'
  AND status != 'canceled';
