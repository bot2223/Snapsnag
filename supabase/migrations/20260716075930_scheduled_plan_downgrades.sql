alter table public.subscriptions
  add column if not exists pending_plan text,
  add column if not exists pending_plan_effective_at timestamptz,
  add column if not exists stripe_schedule_id text;
