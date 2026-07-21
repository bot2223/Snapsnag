-- Canceled/past-due users are now fully locked out, not just from snags.
-- Same has_active_access() gate already used on snags/snag_comments/
-- snag_activity, applied to the remaining account-management tables.

DROP POLICY IF EXISTS "subs_authenticated" ON public.subcontractors;
CREATE POLICY "subs_authenticated" ON public.subcontractors
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND has_active_access());

DROP POLICY IF EXISTS "settings_authenticated" ON public.company_settings;
CREATE POLICY "settings_authenticated" ON public.company_settings
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND has_active_access());

DROP POLICY IF EXISTS "users_manage_own_schedules" ON public.report_schedules;
CREATE POLICY "users_manage_own_schedules" ON public.report_schedules
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND has_active_access());

DROP POLICY IF EXISTS "users_view_own_reports" ON public.snag_reports;
CREATE POLICY "users_view_own_reports" ON public.snag_reports
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id AND has_active_access());
