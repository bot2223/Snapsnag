-- snag_reports only had a SELECT policy, so INSERT (and UPDATE/DELETE) were
-- silently rejected by RLS with no policy allowing them at all — that's
-- why "Generate Now" on the Insights page failed with a row-level
-- security violation. Replace with the same FOR ALL, owner-scoped pattern
-- already used by the sibling report_schedules table.
drop policy if exists "users_view_own_reports" on public.snag_reports;

create policy "users_manage_own_reports" on public.snag_reports
  for all
  using ((select auth.uid()) = user_id and private.has_active_access())
  with check ((select auth.uid()) = user_id and private.has_active_access());
