-- A separate migration (enforce_subscription_status_in_rls) correctly added
-- a has_active_access() gate to snags/snag_comments/snag_activity so that
-- canceled/past-due users lose data access at the database level, not just
-- via the TrialExpiredWall UI gate. It reintroduced per-row auth.uid()
-- re-evaluation that an earlier cleanup pass had fixed. This migration
-- reapplies (select auth.uid()) so Postgres caches the value once per
-- statement instead of once per row, while preserving the access-gating
-- logic exactly as introduced.
--
-- Note: company_settings, report_schedules, snag_reports, and
-- subcontractors intentionally still only check ownership (no
-- has_active_access() gate) — account-management data stays accessible
-- while a user picks a new plan. Revisit if that's not the intended model.

DROP POLICY IF EXISTS "snags_owner_active" ON public.snags;
CREATE POLICY "snags_owner_active" ON public.snags
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id AND has_active_access())
  WITH CHECK ((select auth.uid()) = user_id AND has_active_access());

DROP POLICY IF EXISTS "comments_via_snag" ON public.snag_comments;
CREATE POLICY "comments_via_snag" ON public.snag_comments
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_comments.snag_id AND s.user_id = (select auth.uid()))
    AND has_active_access()
  );

DROP POLICY IF EXISTS "activity_via_snag" ON public.snag_activity;
CREATE POLICY "activity_via_snag" ON public.snag_activity
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_activity.snag_id AND s.user_id = (select auth.uid()))
    AND has_active_access()
  );
