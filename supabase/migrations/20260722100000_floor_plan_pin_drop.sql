-- Floor plan pin-drop: managers upload one image per level, snags can
-- optionally reference a plan + a normalized (0-1) pin position on it.
-- Purely additive: the existing free-text `location` field is untouched.

CREATE TABLE public.floor_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.floor_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "floor_plans_select" ON public.floor_plans
FOR SELECT USING (
  (
    (SELECT auth.uid()) = user_id
    OR private.effective_manager_id((SELECT auth.uid())) = user_id
    OR EXISTS (
      SELECT 1 FROM public.subcontractors sc
      WHERE sc.email = (SELECT auth.email()) AND sc.user_id = floor_plans.user_id
    )
  )
  AND private.has_active_access(user_id)
);

CREATE POLICY "floor_plans_write" ON public.floor_plans
FOR ALL USING (
  (SELECT auth.uid()) = user_id AND private.has_active_access()
) WITH CHECK (
  (SELECT auth.uid()) = user_id AND private.has_active_access()
);

ALTER TABLE public.snags
  ADD COLUMN floor_plan_id uuid REFERENCES public.floor_plans(id) ON DELETE SET NULL,
  ADD COLUMN pin_x numeric,
  ADD COLUMN pin_y numeric;

-- Bucket is private (RLS-enforced), matching every other bucket in this
-- app — access always goes through signed URLs, never a public URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('floor-plans', 'floor-plans', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "floor_plans_storage_insert" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'floor-plans' AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "floor_plans_storage_update" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'floor-plans' AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "floor_plans_storage_delete" ON storage.objects
FOR DELETE USING (
  bucket_id = 'floor-plans' AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "floor_plans_storage_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'floor-plans' AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR private.effective_manager_id((SELECT auth.uid())) = ((storage.foldername(name))[1])::uuid
    OR EXISTS (
      SELECT 1 FROM public.subcontractors sc
      WHERE sc.email = (SELECT auth.email()) AND sc.user_id = ((storage.foldername(name))[1])::uuid
    )
  )
);
