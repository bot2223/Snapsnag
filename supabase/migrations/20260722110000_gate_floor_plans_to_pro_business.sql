-- Floor plan pin-drop is a Pro/Business feature (usePlanLimits.ts:
-- floorPlans). Enforce it at the DB layer too, same pattern as
-- resolution-photo-proof and the activity log — not just a hidden UI element.

-- Creating/renaming/deleting floor plans requires Pro or Business.
DROP POLICY IF EXISTS "floor_plans_write" ON public.floor_plans;
CREATE POLICY "floor_plans_write" ON public.floor_plans
FOR ALL USING (
  (SELECT auth.uid()) = user_id
  AND private.has_active_access()
  AND private.plan_includes_pro_features(user_id)
) WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND private.has_active_access()
  AND private.plan_includes_pro_features(user_id)
);

-- Uploading a floor plan image requires Pro or Business too.
DROP POLICY IF EXISTS "floor_plans_storage_insert" ON storage.objects;
CREATE POLICY "floor_plans_storage_insert" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'floor-plans'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  AND private.plan_includes_pro_features((SELECT auth.uid()))
);

-- Pinning a snag to a floor plan requires Pro or Business — blocks a
-- Starter user from setting floor_plan_id/pin_x/pin_y via a direct
-- console/API call even if a plan row happens to exist (e.g. after a
-- downgrade).
CREATE OR REPLACE FUNCTION public.enforce_floor_plan_pin_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.floor_plan_id IS NOT NULL
     AND NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id
     AND NOT private.plan_includes_pro_features(private.effective_manager_id(NEW.user_id))
  THEN
    RAISE EXCEPTION 'Floor plan pin-drop requires the Pro or Business plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snags_enforce_floor_plan_pin_plan ON public.snags;
CREATE TRIGGER snags_enforce_floor_plan_pin_plan
  BEFORE INSERT OR UPDATE ON public.snags
  FOR EACH ROW EXECUTE FUNCTION public.enforce_floor_plan_pin_plan();
