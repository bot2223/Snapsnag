-- Allow team members (subcontractors, site workers) to read their
-- manager's company logo from company-assets, mirroring the existing
-- team-wide read pattern already used for snag-photos. Needed so the
-- Business-plan-gated company logo can be shown in the subcontractor
-- and site worker headers, not just the manager's own dashboard.
drop policy if exists company_assets_read_restricted on storage.objects;

create policy company_assets_read_team
on storage.objects for select
using (
  bucket_id = 'company-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.effective_manager_id(((storage.foldername(name))[1])::uuid)
       = private.effective_manager_id(auth.uid())
    or ((storage.foldername(name))[1])::uuid = (
      select user_id from public.subcontractors where email = auth.email() limit 1
    )
  )
);

-- Extend get_my_team_theme() to also return the manager's logo path,
-- gated behind the same Business-plan "unlocked" check as accent_color,
-- so team members can show the real company logo in their own header
-- instead of the generic hard-hat icon.
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
  v_logo_url text;
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

  if v_unlocked then
    select cs.logo_url into v_logo_url
    from public.company_settings cs
    where cs.user_id = v_manager_id;
  end if;

  return jsonb_build_object(
    'unlocked', coalesce(v_unlocked, false),
    'accent_color', v_accent,
    'logo_url', v_logo_url
  );
end;
$$;
