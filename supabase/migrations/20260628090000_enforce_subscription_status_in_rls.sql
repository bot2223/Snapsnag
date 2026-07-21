-- Reconstructed from the live database — this migration was applied
-- directly (outside this repo's migration history) and is captured here so
-- `supabase db reset` / a fresh deploy matches what's actually running.
--
-- Enforces "canceled/past-due users lose access to snag data" at the
-- database level via RLS, not only via the TrialExpiredWall UI gate (which
-- a direct API call could bypass).

CREATE OR REPLACE FUNCTION public.has_active_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = auth.uid()
      AND (
        (status = 'trialing' AND trial_ends_at > now())
        OR (status = 'active')
        OR (status = 'past_due' AND current_period_ends_at > now())
      )
  );
$$;

DROP POLICY IF EXISTS "snags_authenticated" ON public.snags;
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
