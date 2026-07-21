-- Enable pg_net and pg_cron extensions (needed for webhooks and cron)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- ─────────────────────────────────────────────
-- Database webhook: fire notify-subcontractor
-- on every INSERT into snags
-- ─────────────────────────────────────────────
select
  net.http_post(
    url    := '', -- placeholder; real URL set via Supabase dashboard webhook UI
    body   := '{}'::jsonb
  );
-- NOTE: The actual webhook is created in the Supabase dashboard:
-- Database → Webhooks → Create webhook
--   Table: snags | Event: INSERT
--   URL: https://<project-ref>.supabase.co/functions/v1/notify-subcontractor
--   HTTP Headers: Authorization: Bearer <service_role_key>

-- ─────────────────────────────────────────────
-- Cron job: run send-reminders every 24 hours
-- ─────────────────────────────────────────────
select cron.schedule(
  'send-snag-reminders',       -- job name
  '0 8 * * *',                  -- every day at 08:00 UTC
  $$
  select
    net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);
