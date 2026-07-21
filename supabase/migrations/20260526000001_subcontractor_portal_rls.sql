-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: allow subcontractors to read snags assigned to them
-- They match on auth.email() → subcontractors.email → subcontractors.id
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function: get subcontractor id for the current logged-in user
create or replace function public.my_subcontractor_id()
returns uuid language sql security definer stable as $$
  select id from public.subcontractors
  where email = auth.email()
  limit 1;
$$;

-- Snags: subcontractors can read snags assigned to them
create policy "subcontractor_read_own_snags"
  on public.snags for select
  using (
    subcontractor_id = public.my_subcontractor_id()
  );

-- Snags: subcontractors can update status only (not reassign, not delete)
create policy "subcontractor_update_status"
  on public.snags for update
  using (subcontractor_id = public.my_subcontractor_id())
  with check (subcontractor_id = public.my_subcontractor_id());

-- Comments: subcontractors can read comments on their snags
create policy "subcontractor_read_comments"
  on public.snag_comments for select
  using (
    exists (
      select 1 from public.snags s
      where s.id = snag_id
      and s.subcontractor_id = public.my_subcontractor_id()
    )
  );

-- Comments: subcontractors can add comments on their snags
create policy "subcontractor_insert_comments"
  on public.snag_comments for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.snags s
      where s.id = snag_id
      and s.subcontractor_id = public.my_subcontractor_id()
    )
  );
