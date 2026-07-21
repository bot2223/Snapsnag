-- The enforce_snag_owner trigger rewrites NEW.user_id to the manager's id
-- for site-worker-created snags (correct — snags must be owned by the
-- billing manager account for RLS/subscription purposes). But it never
-- recorded who the *actual creator* was, leaving manager_id permanently
-- null despite its column comment promising it would be set. That broke
-- "My Snags" for site workers, which filters on user_id = own id and can
-- never match once user_id has been rewritten to the manager.
--
-- Fix: when the creator is a site worker, stamp manager_id with their own
-- auth.uid() (repurposed here as "creator_id" for site-worker-created
-- snags) so the frontend can filter on who created it, independent of who
-- owns it for billing.
create or replace function private.enforce_snag_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_manager_id uuid;
begin
  select role, manager_id into v_role, v_manager_id
  from public.profiles where id = auth.uid();

  if v_role = 'site_worker' then
    NEW.user_id := v_manager_id;
    NEW.manager_id := auth.uid();
  else
    NEW.user_id := auth.uid();
  end if;
  return NEW;
end;
$function$;

-- Backfill manager_id for existing snags that were actually created by a
-- site worker (identified via the "created" snag_activity row's user_id
-- pointing at a site_worker profile), so historical snags aren't excluded
-- from "My Snags" either.
update public.snags s
set manager_id = sa.user_id
from public.snag_activity sa
join public.profiles p on p.id = sa.user_id
where sa.snag_id = s.id
  and sa.action = 'created'
  and p.role = 'site_worker'
  and s.manager_id is null;
