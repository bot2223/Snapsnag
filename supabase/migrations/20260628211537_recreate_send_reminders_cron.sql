-- Recreates the daily reminder cron job correctly: real project URL and
-- service role key pulled live from Vault (no more literal placeholder
-- text), pointed at the now-functional send-reminders function which
-- actually queries for due/overdue snags instead of short-circuiting on an
-- empty cron-triggered body.
select cron.schedule(
  'send-snag-reminders',
  '0 8 * * *',
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
