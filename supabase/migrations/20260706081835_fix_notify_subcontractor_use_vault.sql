-- Same fix as notify-status-change: the "notify-subcontractor" trigger had
-- the old legacy JWT hardcoded as its bearer token, which no longer
-- matches Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") now that the project
-- uses the new sb_secret_ key system. Recreated using the same Vault
-- wrapper-function pattern as notify-status-change, so both now share the
-- corrected key with no plaintext token in any trigger or file.

CREATE OR REPLACE FUNCTION public.trigger_notify_subcontractor()
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
    url     := v_url || '/functions/v1/notify-subcontractor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('record', to_jsonb(NEW))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "notify-subcontractor" ON public.snags;

CREATE TRIGGER notify_subcontractor_trigger
  AFTER INSERT ON public.snags
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_notify_subcontractor();
