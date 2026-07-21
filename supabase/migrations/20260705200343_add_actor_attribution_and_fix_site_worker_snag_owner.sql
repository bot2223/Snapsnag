-- ── 1. Helper: resolve a human display name for any actor id ────────────
-- Subcontractors get a default `profiles` row with role 'manager' on
-- signup (handle_new_user() doesn't know any better), so role alone can't
-- distinguish a subcontractor from a real manager. Matched by email
-- against `subcontractors`, consistent with how every subcontractor RLS
-- policy already identifies them (auth_user_id is unreliable — see
-- 20260701101408_fix_snags_rls_assignee_access.sql).
create or replace function private.actor_display_name(p_actor_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_email text;
  v_sub_name text;
begin
  select role, full_name into v_role, v_name
  from public.profiles where id = p_actor_id;

  if v_role = 'site_worker' then
    return coalesce(v_name, 'Site worker');
  end if;

  select email into v_email from auth.users where id = p_actor_id;
  if v_email is not null then
    select name into v_sub_name from public.subcontractors where email = v_email limit 1;
    if v_sub_name is not null then
      return v_sub_name;
    end if;
  end if;

  return coalesce(v_name, 'Manager');
end;
$$;

revoke all on function private.actor_display_name(uuid) from public, anon;
grant execute on function private.actor_display_name(uuid) to authenticated;

-- ── 2. snag_activity: repurpose `user_id` to mean the actual actor ──────
-- It was never used by RLS or the frontend — only ever held the snag's
-- owner id via NEW.user_id, which is why every status change/creation
-- looked like it came from the manager regardless of who really did it.
-- actor_name is a write-time snapshot so the dashboard doesn't need a
-- join or RPC call per row, and stays accurate even if someone's name
-- changes later.
alter table public.snag_activity add column if not exists actor_name text;

create or replace function public.log_snag_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.snag_activity (snag_id, user_id, actor_name, action, to_status)
    values (NEW.id, auth.uid(), private.actor_display_name(auth.uid()), 'created', NEW.status);
  elsif TG_OP = 'UPDATE' and OLD.status is distinct from NEW.status then
    insert into public.snag_activity (snag_id, user_id, actor_name, action, from_status, to_status)
    values (NEW.id, auth.uid(), private.actor_display_name(auth.uid()), 'status_changed', OLD.status, NEW.status);
  end if;
  return NEW;
end;
$$;

update public.snag_activity set actor_name = private.actor_display_name(user_id) where actor_name is null;

-- ── 3. snag_comments: same actor_name snapshot ──────────────────────────
-- Populated automatically by trigger so the client insert doesn't need to
-- know any of the naming/fallback rules.
alter table public.snag_comments add column if not exists actor_name text;

create or replace function private.stamp_comment_actor_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.actor_name := private.actor_display_name(NEW.user_id);
  return NEW;
end;
$$;

create trigger snag_comments_stamp_actor
before insert on public.snag_comments
for each row execute function private.stamp_comment_actor_name();

update public.snag_comments set actor_name = private.actor_display_name(user_id) where actor_name is null;

-- ── 4. Fix: site workers could never actually create a snag ────────────
-- The client inserts user_id = their own auth id, but a site worker's own
-- id has no subscription row, so has_active_access() on their own id
-- always failed and the insert was silently rejected by RLS. This trigger
-- corrects user_id server-side to the real tenant owner (their manager)
-- regardless of what any client sends, so the fix doesn't depend on every
-- insert code path getting it right.
--
-- Named to sort alphabetically before the existing snag_deadline_trigger
-- and snags_enforce_limit (Postgres fires same-timing triggers in name
-- order) — enforce_snag_limit reads NEW.user_id directly and must see the
-- corrected owner, not the site worker's own id, or the monthly count
-- would check the wrong account.
create or replace function private.enforce_snag_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_manager_id uuid;
begin
  select role, manager_id into v_role, v_manager_id
  from public.profiles where id = auth.uid();

  if v_role = 'site_worker' then
    NEW.user_id := v_manager_id;
  else
    NEW.user_id := auth.uid();
  end if;
  return NEW;
end;
$$;

create trigger snag_00_enforce_owner
before insert on public.snags
for each row execute function private.enforce_snag_owner();

-- ── 5. Unified activity + comments feed for the dashboard Audit Trail ──
-- security_invoker is required (PG15+) — without it this view runs as its
-- owner (postgres, which has BYPASSRLS) and would silently leak every
-- tenant's data regardless of the underlying table policies.
create view public.snag_feed
with (security_invoker = true)
as
select
  a.id,
  a.snag_id,
  s.location,
  s.category,
  a.action,
  a.from_status,
  a.to_status,
  null::text as content,
  a.actor_name,
  a.created_at
from public.snag_activity a
join public.snags s on s.id = a.snag_id

union all

select
  c.id,
  c.snag_id,
  s.location,
  s.category,
  'commented' as action,
  null::text as from_status,
  null::text as to_status,
  c.content,
  c.actor_name,
  c.created_at
from public.snag_comments c
join public.snags s on s.id = c.snag_id;

revoke all on public.snag_feed from public, anon;
grant select on public.snag_feed to authenticated;
