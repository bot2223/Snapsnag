-- Personal accent-color picker for subcontractors/site workers, unlocked
-- only while the manager who owns them is on the Business plan. This is a
-- personal preference (their own nav color), not a sync of the manager's
-- brand identity — each team member picks their own.
--
-- subcontractors/profiles RLS only allows the *manager* to UPDATE these
-- rows (subs_update / profile update policies are owner-scoped), so a
-- subcontractor/site worker cannot write accent_color directly from the
-- client. Two SECURITY DEFINER functions below do the narrow, validated
-- read/write on the caller's own behalf instead of loosening RLS/grants.

alter table public.subcontractors
  add column if not exists accent_color text;

alter table public.profiles
  add column if not exists accent_color text;

-- Returns what the caller (subcontractor or site worker) should see:
-- whether their manager currently has the feature unlocked, and their own
-- stored accent color (if any). Managers get {unlocked: false, accent_color: null}
-- since this endpoint isn't meant for them — they use the Branding tab instead.
create or replace function public.get_my_team_theme()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_id uuid;
  v_accent text;
  v_unlocked boolean := false;
begin
  select s.user_id, s.accent_color into v_manager_id, v_accent
  from public.subcontractors s
  where s.email = auth.email()
  limit 1;

  if v_manager_id is null then
    select p.manager_id, p.accent_color into v_manager_id, v_accent
    from public.profiles p
    where p.id = auth.uid() and p.role = 'site_worker'
    limit 1;
  end if;

  if v_manager_id is not null then
    select true into v_unlocked
    from public.subscriptions sub
    where sub.user_id = v_manager_id
      and sub.plan = 'business'
      and private.has_active_access(v_manager_id)
    limit 1;
  end if;

  return jsonb_build_object(
    'unlocked', coalesce(v_unlocked, false),
    'accent_color', v_accent
  );
end;
$$;

-- Validates the feature is actually unlocked server-side (never trusts the
-- client's word for it) and the color is a plain hex value before writing
-- it to whichever row belongs to the caller.
create or replace function public.set_my_accent_color(p_color text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_id uuid;
  v_is_sub boolean := false;
begin
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid color format';
  end if;

  select user_id into v_manager_id from public.subcontractors where email = auth.email() limit 1;
  if v_manager_id is not null then
    v_is_sub := true;
  else
    select manager_id into v_manager_id
    from public.profiles
    where id = auth.uid() and role = 'site_worker'
    limit 1;
  end if;

  if v_manager_id is null then
    raise exception 'no linked manager found';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_manager_id
      and plan = 'business'
      and private.has_active_access(v_manager_id)
  ) then
    raise exception 'feature not unlocked';
  end if;

  if v_is_sub then
    update public.subcontractors set accent_color = p_color where email = auth.email();
  else
    update public.profiles set accent_color = p_color where id = auth.uid();
  end if;

  return jsonb_build_object('accent_color', p_color);
end;
$$;

grant execute on function public.get_my_team_theme() to authenticated;
grant execute on function public.set_my_accent_color(text) to authenticated;

-- Functions are PUBLIC-executable by default in Postgres, which would let
-- logged-out (anon) callers hit these too. Match the existing
-- redeem_invite_code pattern and revoke that.
revoke execute on function public.get_my_team_theme() from public;
revoke execute on function public.get_my_team_theme() from anon;
revoke execute on function public.set_my_accent_color(text) from public;
revoke execute on function public.set_my_accent_color(text) from anon;
