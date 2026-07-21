-- Collapses the overlapping permissive-policy sets flagged by the
-- performance advisor (profiles/SELECT, snags/SELECT, snags/UPDATE,
-- snag_activity/SELECT) into one policy per command. Postgres already
-- OR's multiple permissive policies together at read time, so this is a
-- pure consolidation — every condition below is copied verbatim from the
-- policies it replaces, just combined with OR instead of living in
-- separate rows. No access is being loosened or tightened.
--
-- Verified post-apply: manager identity sees the same row counts as
-- before (1 profile / 3 snags / 6 activity rows); an unrelated uid sees
-- zero rows everywhere. See chat for the full verification queries.

-- ── profiles: 3 SELECT policies -> 1 ────────────────────────────────────
drop policy if exists profiles_read_own on public.profiles;
drop policy if exists profiles_read_as_manager on public.profiles;
drop policy if exists profiles_read_teammates on public.profiles;

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (private.my_profile_role() = 'manager' and manager_id = (select auth.uid()))
  or id = private.my_manager_id()
  or manager_id = private.my_manager_id()
);

-- ── snags: ALL policy split into per-command, merged with the
--    subcontractor-only SELECT/UPDATE policies where they overlapped ────
drop policy if exists snags_owner_or_site_worker on public.snags;
drop policy if exists snags_assigned_subcontractor on public.snags;
drop policy if exists snags_assigned_subcontractor_update on public.snags;

create policy snags_select on public.snags
for select to authenticated
using (
  (
    (select auth.uid()) = user_id
    or user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
    or subcontractor_id in (select s.id from subcontractors s where s.email = (select auth.email()))
  )
  and private.has_active_access(user_id)
);

create policy snags_insert on public.snags
for insert to authenticated
with check (
  (
    (select auth.uid()) = user_id
    or user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
  )
  and private.has_active_access(user_id)
);

create policy snags_update on public.snags
for update to authenticated
using (
  (
    (select auth.uid()) = user_id
    or user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
    or subcontractor_id in (select s.id from subcontractors s where s.email = (select auth.email()))
  )
  and private.has_active_access(user_id)
)
with check (
  (
    (select auth.uid()) = user_id
    or user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
    or subcontractor_id in (select s.id from subcontractors s where s.email = (select auth.email()))
  )
  and private.has_active_access(user_id)
);

create policy snags_delete on public.snags
for delete to authenticated
using (
  (
    (select auth.uid()) = user_id
    or user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
  )
  and private.has_active_access(user_id)
);

-- ── snag_activity: ALL policy split into per-command, merged with the
--    subcontractor-read SELECT policy where it overlapped ──────────────
drop policy if exists activity_via_snag on public.snag_activity;
drop policy if exists activity_via_snag_subcontractor_read on public.snag_activity;

create policy snag_activity_select on public.snag_activity
for select to authenticated
using (
  exists (
    select 1 from snags s
    where s.id = snag_activity.snag_id
      and (
        (
          (select auth.uid()) = s.user_id
          or s.user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
        )
        or s.subcontractor_id in (select sc.id from subcontractors sc where sc.email = (select auth.email()))
      )
      and private.has_active_access(s.user_id)
  )
);

create policy snag_activity_insert on public.snag_activity
for insert to authenticated
with check (
  exists (
    select 1 from snags s
    where s.id = snag_activity.snag_id
      and (
        (select auth.uid()) = s.user_id
        or s.user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
      )
      and private.has_active_access(s.user_id)
  )
);

create policy snag_activity_update on public.snag_activity
for update to authenticated
using (
  exists (
    select 1 from snags s
    where s.id = snag_activity.snag_id
      and (
        (select auth.uid()) = s.user_id
        or s.user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
      )
      and private.has_active_access(s.user_id)
  )
)
with check (
  exists (
    select 1 from snags s
    where s.id = snag_activity.snag_id
      and (
        (select auth.uid()) = s.user_id
        or s.user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
      )
      and private.has_active_access(s.user_id)
  )
);

create policy snag_activity_delete on public.snag_activity
for delete to authenticated
using (
  exists (
    select 1 from snags s
    where s.id = snag_activity.snag_id
      and (
        (select auth.uid()) = s.user_id
        or s.user_id = (select p.manager_id from profiles p where p.id = (select auth.uid()) and p.role = 'site_worker')
      )
      and private.has_active_access(s.user_id)
  )
);
