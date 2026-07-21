-- Fixes a foundational RLS gap present since the very first migration
-- (snags_owner_all / snags_owner_active): every policy on snags,
-- snag_comments, and snag_activity only ever matched the owning manager
-- (user_id = auth.uid()). Subcontractors could never see snags assigned to
-- them, and site workers — whose snags carry the *manager's* user_id, not
-- their own — could never create or read any snags at all. This had not
-- surfaced because no subcontractor/site-worker account in production had
-- ever actually logged in (subcontractors.auth_user_id was null for every
-- row at the time this was found).
--
-- Consolidated into as few policies per table/action as the differing role
-- scopes allow, matching the multiple-permissive-policies tradeoff the
-- profiles table already accepted (see 20260627000000_security_fixes.sql).

-- ── snags ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snags_owner_active" ON public.snags;

CREATE POLICY "snags_owner_or_site_worker" ON public.snags
  FOR ALL TO authenticated
  USING (
    ((select auth.uid()) = user_id AND has_active_access())
    OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
  )
  WITH CHECK (
    ((select auth.uid()) = user_id AND has_active_access())
    OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
  );

-- Subcontractors — read + status-update access to snags assigned to them.
-- Matched by email (not auth_user_id) to stay consistent with the identity
-- check auth-context.tsx already uses for subcontractor role resolution,
-- and with the storage policy in 20260627000000_security_fixes.sql.
CREATE POLICY "snags_assigned_subcontractor" ON public.snags
  FOR SELECT TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
  );

CREATE POLICY "snags_assigned_subcontractor_update" ON public.snags
  FOR UPDATE TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
  )
  WITH CHECK (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
  );

-- ── snag_comments — same shape for everyone who can see the snag at all ───
DROP POLICY IF EXISTS "comments_via_snag" ON public.snag_comments;

CREATE POLICY "comments_via_snag" ON public.snag_comments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_comments.snag_id
        AND (
          (s.user_id = (select auth.uid()) AND has_active_access())
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
          OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_comments.snag_id
        AND (
          (s.user_id = (select auth.uid()) AND has_active_access())
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
          OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
        )
    )
  );

-- ── snag_activity — owner + site worker read/write, subcontractors read-only
--    (they shouldn't be able to fabricate activity-log entries) ───────────
DROP POLICY IF EXISTS "activity_via_snag" ON public.snag_activity;

CREATE POLICY "activity_via_snag" ON public.snag_activity
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND (
          (s.user_id = (select auth.uid()) AND has_active_access())
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND (
          (s.user_id = (select auth.uid()) AND has_active_access())
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
        )
    )
  );

CREATE POLICY "activity_via_snag_subcontractor_read" ON public.snag_activity
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    )
  );
