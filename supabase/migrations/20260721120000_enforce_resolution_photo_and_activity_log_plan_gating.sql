-- Two plan-gated features (usePlanLimits.ts: resolutionPhotos, activityLog)
-- were UI-only — a direct console/API call could set resolution_photo_url
-- or read snag_activity regardless of plan. Mirrors the enforcement pattern
-- already used for snag/member limits (private.plan_snag_limit /
-- plan_member_limit): DB-level check, not just a hidden UI element.

CREATE OR REPLACE FUNCTION private.plan_includes_pro_features(target_manager_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT plan FROM public.subscriptions WHERE user_id = target_manager_id) IN ('pro', 'business'),
    false
  );
$$;

-- ── Resolution Photo Proof (Pro/Business only) ──────────────────────────────
-- Block setting resolution_photo_url unless the owning manager's plan
-- allows it. Only fires when the value actually changes, so unrelated
-- updates (status, reassignment, etc.) on a Starter snag are unaffected.
CREATE OR REPLACE FUNCTION public.enforce_resolution_photo_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.resolution_photo_url IS NOT NULL
     AND NEW.resolution_photo_url IS DISTINCT FROM OLD.resolution_photo_url
     AND NOT private.plan_includes_pro_features(private.effective_manager_id(NEW.user_id))
  THEN
    RAISE EXCEPTION 'Resolution photo proof requires the Pro or Business plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snags_enforce_resolution_photo_plan ON public.snags;
CREATE TRIGGER snags_enforce_resolution_photo_plan
  BEFORE UPDATE ON public.snags
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resolution_photo_plan();

-- ── Activity Log (Pro/Business only) — restrict at the RLS layer ───────────
-- Same read policy as before, with a plan check ANDed in. INSERT/UPDATE/
-- DELETE policies are untouched — activity rows are written by internal
-- triggers, this only governs who can read the log back.
DROP POLICY IF EXISTS "snag_activity_select" ON public.snag_activity;
CREATE POLICY "snag_activity_select" ON public.snag_activity
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.snags s
    WHERE s.id = snag_activity.snag_id
      AND (
        (SELECT auth.uid()) = s.user_id
        OR s.user_id = (SELECT p.manager_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'site_worker')
        OR s.subcontractor_id IN (SELECT sc.id FROM public.subcontractors sc WHERE sc.email = (SELECT auth.email()))
      )
      AND private.has_active_access(s.user_id)
      AND private.plan_includes_pro_features(private.effective_manager_id(s.user_id))
  )
);
