-- Site workers and subcontractors currently bypass has_active_access()
-- entirely: they were matched on identity only, with no check on the
-- owning manager's subscription status. A manager could cancel and keep
-- working through a site worker or subcontractor login. Fixes that by
-- adding a parameterized overload of has_active_access() so callers can
-- check *any* manager's subscription, not just their own, and applying it
-- uniformly after identity matching on every policy touched in
-- fix_snags_rls_assignee_access.

CREATE OR REPLACE FUNCTION public.has_active_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

CREATE OR REPLACE FUNCTION public.has_active_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_active_access(auth.uid());
$$;

-- ── snags ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snags_owner_or_site_worker" ON public.snags;
CREATE POLICY "snags_owner_or_site_worker" ON public.snags
  FOR ALL TO authenticated
  USING (
    (
      (select auth.uid()) = user_id
      OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
    )
    AND has_active_access(user_id)
  )
  WITH CHECK (
    (
      (select auth.uid()) = user_id
      OR user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
    )
    AND has_active_access(user_id)
  );

DROP POLICY IF EXISTS "snags_assigned_subcontractor" ON public.snags;
CREATE POLICY "snags_assigned_subcontractor" ON public.snags
  FOR SELECT TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND has_active_access(user_id)
  );

DROP POLICY IF EXISTS "snags_assigned_subcontractor_update" ON public.snags;
CREATE POLICY "snags_assigned_subcontractor_update" ON public.snags
  FOR UPDATE TO authenticated
  USING (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND has_active_access(user_id)
  )
  WITH CHECK (
    subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
    AND has_active_access(user_id)
  );

-- ── snag_comments ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "comments_via_snag" ON public.snag_comments;
CREATE POLICY "comments_via_snag" ON public.snag_comments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_comments.snag_id
        AND (
          (select auth.uid()) = s.user_id
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
          OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
        )
        AND has_active_access(s.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_comments.snag_id
        AND (
          (select auth.uid()) = s.user_id
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
          OR s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
        )
        AND has_active_access(s.user_id)
    )
  );

-- ── snag_activity ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "activity_via_snag" ON public.snag_activity;
CREATE POLICY "activity_via_snag" ON public.snag_activity
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND (
          (select auth.uid()) = s.user_id
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
        )
        AND has_active_access(s.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND (
          (select auth.uid()) = s.user_id
          OR s.user_id = (SELECT manager_id FROM public.profiles WHERE id = (select auth.uid()) AND role = 'site_worker')
        )
        AND has_active_access(s.user_id)
    )
  );

DROP POLICY IF EXISTS "activity_via_snag_subcontractor_read" ON public.snag_activity;
CREATE POLICY "activity_via_snag_subcontractor_read" ON public.snag_activity
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.snags s
      WHERE s.id = snag_activity.snag_id
        AND s.subcontractor_id IN (SELECT id FROM public.subcontractors WHERE email = (select auth.email()))
        AND has_active_access(s.user_id)
    )
  );
