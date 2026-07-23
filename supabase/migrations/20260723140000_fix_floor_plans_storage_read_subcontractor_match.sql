-- Bug: floor_plans_storage_read used a bare `name` inside the subcontractor
-- EXISTS subquery: `sc.user_id = ((storage.foldername(name))[1])::uuid`.
-- Postgres resolves an unqualified column to the innermost FROM clause
-- where it exists — and public.subcontractors also has a `name` column
-- (the subcontractor's display name) — so `name` silently bound to
-- sc.name instead of the outer storage.objects.name (the file path).
-- storage.foldername() on a plain display name like 'John Doe' (no '/')
-- returns an empty array, so [1] is NULL and the whole branch was always
-- false.
--
-- Effect: subcontractors could see a floor plan's row (name, zones) via
-- table RLS on public.floor_plans, and could see pin_x/pin_y on a snag,
-- but the actual floor plan *image* silently failed to load for them —
-- every signed URL request hit this policy and was denied. Managers and
-- site workers were unaffected; only the subcontractor branch referenced
-- the wrong column.
--
-- Fix: qualify every reference to the object's path as `objects.name`
-- (the implicit correlation name for the table the policy is on) so nothing
-- inside the nested EXISTS can shadow it.
DROP POLICY IF EXISTS "floor_plans_storage_read" ON storage.objects;
CREATE POLICY "floor_plans_storage_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'floor-plans' AND (
    (storage.foldername(objects.name))[1] = (SELECT auth.uid())::text
    OR private.effective_manager_id((SELECT auth.uid())) = ((storage.foldername(objects.name))[1])::uuid
    OR EXISTS (
      SELECT 1 FROM public.subcontractors sc
      WHERE sc.email = (SELECT auth.email())
        AND sc.user_id = ((storage.foldername(objects.name))[1])::uuid
    )
  )
);
