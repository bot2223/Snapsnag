-- Replaces the "notify-status-change" trigger, which previously embedded
-- the service-role JWT as a plaintext literal in its own definition
-- (visible in pg_trigger and in the migration file that created it).
-- This wrapper function instead reads project_url / service_role_key from
-- Vault at call time, matching the pattern already used by the
-- send-snag-reminders cron job. No plaintext key remains in any trigger
-- definition or file after this migration.

CREATE OR REPLACE FUNCTION public.trigger_notify_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/notify-status-change',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('record', to_jsonb(NEW), 'old_record', to_jsonb(OLD))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "notify-status-change" ON public.snags;

CREATE TRIGGER notify_status_change_trigger
  AFTER UPDATE ON public.snags
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trigger_notify_status_change();
