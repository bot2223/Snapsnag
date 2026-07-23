-- Same downgrade landmine as floor_plans_select, one layer down: even after
-- gating the table row, floor_plans_storage_read had no
-- plan_includes_pro_features check, so a downgraded user's client wouldn't
-- fetch the floor_plans row anymore, but a known/cached image path would
-- still resolve via a direct signed-URL request. Each branch checks the
-- plan of the manager the path actually belongs to (via
-- effective_manager_id / subcontractor email match), not the caller's own
-- id, matching how ownership is resolved everywhere else in this policy.
DROP POLICY IF EXISTS "floor_plans_storage_read" ON storage.objects;
CREATE POLICY "floor_plans_storage_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'floor-plans' AND (
    (
      (storage.foldername(objects.name))[1] = (SELECT auth.uid())::text
      AND private.plan_includes_pro_features((SELECT auth.uid()))
    )
    OR (
      private.effective_manager_id((SELECT auth.uid())) = ((storage.foldername(objects.name))[1])::uuid
      AND private.plan_includes_pro_features(((storage.foldername(objects.name))[1])::uuid)
    )
    OR EXISTS (
      SELECT 1 FROM public.subcontractors sc
      WHERE sc.email = (SELECT auth.email())
        AND sc.user_id = ((storage.foldername(objects.name))[1])::uuid
        AND private.plan_includes_pro_features(sc.user_id)
    )
  )
);
