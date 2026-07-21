-- Fixes a real bug found while testing the RLS merge: subcontractors could
-- never see their own row in `subcontractors`, which meant the
-- email-match subqueries inside snags/snag_activity's subcontractor
-- branches always came back empty for an actual subcontractor session —
-- so assigned snags never showed up for them, even though the outer
-- policy logic was correct. subs_authenticated (owner/manager only) is
-- split into per-command policies so a self-read path can be added to
-- SELECT alone, without recreating the multiple-permissive-policy issue
-- just cleaned up elsewhere.
--
-- Verified post-apply: a subcontractor identity now sees exactly their
-- own subcontractor row + their 1 assigned snag + its activity (1/1/1).
-- An unrelated stranger still sees 0/0/0. The owning manager is
-- unaffected (still sees all 3 subcontractors / 3 snags / 6 activity
-- rows). See chat for the full verification queries.

drop policy if exists subs_authenticated on public.subcontractors;

create policy subs_select on public.subcontractors
for select to authenticated
using (
  ((select auth.uid()) = user_id and private.has_active_access())
  or (email = (select auth.email()) and private.has_active_access(user_id))
);

create policy subs_insert on public.subcontractors
for insert to authenticated
with check (
  (select auth.uid()) = user_id and private.has_active_access()
);

create policy subs_update on public.subcontractors
for update to authenticated
using (
  (select auth.uid()) = user_id and private.has_active_access()
)
with check (
  (select auth.uid()) = user_id and private.has_active_access()
);

create policy subs_delete on public.subcontractors
for delete to authenticated
using (
  (select auth.uid()) = user_id and private.has_active_access()
);
