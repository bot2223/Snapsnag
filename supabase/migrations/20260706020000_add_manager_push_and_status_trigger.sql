-- Manager-side push subscriptions. Kept separate from push_subscriptions
-- (subcontractor-side) because the RLS identity check differs: managers
-- match on auth.uid() directly, subcontractors match via an email lookup
-- against the subcontractors table.
CREATE TABLE IF NOT EXISTS public.manager_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS manager_push_subscriptions_user_id_idx
  ON public.manager_push_subscriptions (user_id);

ALTER TABLE public.manager_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY manager_push_subs_select ON public.manager_push_subscriptions
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY manager_push_subs_insert ON public.manager_push_subscriptions
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY manager_push_subs_delete ON public.manager_push_subscriptions
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ── Status-change notification trigger ──────────────────────────────────
-- SUPERSEDED by 20260706071742_fix_notify_status_change_use_vault.sql,
-- which drops this trigger and recreates it via a wrapper function that
-- reads the bearer token from Vault instead of embedding it here. Left
-- as-is for history; do not copy the pattern below for new triggers.
--
-- Fires notify-status-change (new edge function) whenever a snag's status
-- actually changes value — same condition log_snag_activity() already uses
-- for its "status_changed" audit rows, so this fires on exactly the events
-- already visible in snag_activity today.
--
-- Follows the same supabase_functions.http_request pattern already used by
-- the notify-subcontractor / send-reminders triggers on this table
-- (trigger args must be static literals, so the bearer token is embedded
-- the same way it already is on those two triggers).
CREATE TRIGGER "notify-status-change"
  AFTER UPDATE ON public.snags
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://ychataqdegycjdsgicxx.supabase.co/functions/v1/notify-status-change',
    'POST',
    '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljaGF0YXFkZWd5Y2pkc2dpY3h4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc2NjIxNCwiZXhwIjoyMDk0MzQyMjE0fQ.E-jOAH2naaniq0GLS3gOgUul7J5HRxOsedcljxan9gM"}',
    '{}',
    '5000'
  );
