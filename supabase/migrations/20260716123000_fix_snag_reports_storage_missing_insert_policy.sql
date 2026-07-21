-- snag-reports storage bucket only had a read policy, same gap as the
-- snag_reports table itself — uploads were silently rejected with an RLS
-- error. Mirrors the company-assets bucket's insert policy pattern
-- (owner's own folder only).
create policy "snag_reports_insert_own" on storage.objects
  for insert
  with check (
    bucket_id = 'snag-reports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "snag_reports_update_own" on storage.objects
  for update
  using (
    bucket_id = 'snag-reports'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'snag-reports'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
