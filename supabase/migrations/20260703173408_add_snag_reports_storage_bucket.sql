-- Same pattern as snag-photos/company-assets: public bucket flag, but read
-- access is actually gated by RLS on storage.objects, not bucket publicity.
-- Reports are more sensitive than photos/logos, so read is owner-only
-- rather than open like the existing two buckets. Path convention:
-- {user_id}/{report_id}.pdf — writes only via generate-report's
-- service-role client, so no INSERT policy for `authenticated`.

INSERT INTO storage.buckets (id, name, public)
VALUES ('snag-reports', 'snag-reports', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "snag_reports_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'snag-reports'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );
