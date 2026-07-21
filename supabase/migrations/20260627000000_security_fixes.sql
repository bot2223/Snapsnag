-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIXES
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Profiles: Restrict read access to only authenticated users and their own profile
-- Currently, profiles_read_all allows anyone to read all profiles.
DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read" ON public.profiles;

CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_read_team" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    -- Managers can see everyone
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'manager')
    OR
    -- Users can see their manager
    id = (SELECT manager_id FROM public.profiles WHERE id = auth.uid())
    OR
    -- Users can see others in the same team (sharing same manager)
    manager_id = (SELECT manager_id FROM public.profiles WHERE id = auth.uid())
  );

-- 2. Storage: Restrict read access to snag-photos
-- Currently, anyone can read any photo if they have the URL.
DROP POLICY IF EXISTS "snag_photos_read" ON storage.objects;

CREATE POLICY "snag_photos_read_restricted" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'snag-photos'
    AND (
      -- Owner of the snag
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      -- Subcontractor assigned to the snag
      EXISTS (
        SELECT 1 FROM public.snags s
        WHERE s.photo_url LIKE '%' || name
        AND s.subcontractor_id = (SELECT id FROM public.subcontractors WHERE email = auth.email())
      )
    )
  );

-- 3. Storage: Restrict read access to company-assets
DROP POLICY IF EXISTS "company_read" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_read" ON storage.objects;

CREATE POLICY "company_assets_read_restricted" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Snag Comments & Activity: Cleanup redundant policies
-- Ensure 'via_snag' policies only apply to authenticated users
ALTER POLICY "comments_via_snag" ON public.snag_comments TO authenticated;
ALTER POLICY "activity_via_snag" ON public.snag_activity TO authenticated;
