-- The original cron job in 20260526000000_email_notifications.sql was
-- created with literal placeholder text ('<project-ref>', '<service_role_key>')
-- instead of real values, and referenced vault secrets ('project_url',
-- 'service_role_key') that were never actually created. As a result it ran
-- daily, hit a non-existent URL, and failed silently — and even if it had
-- reached the function, send-reminders itself was an exact duplicate of
-- notify-subcontractor that only ever processed payload.record, which is
-- always undefined on a cron-triggered call with an empty body. Neither
-- half of the reminders feature ever worked.
--
-- This migration assumes:
--   1. send-reminders (supabase/functions/send-reminders/index.ts) has been
--      redeployed with real logic that queries for due/overdue snags
--      instead of expecting a webhook payload.
--   2. Two Vault secrets have been created via Dashboard -> Project
--      Settings -> Vault: `project_url` and `service_role_key`.
select cron.unschedule('send-snag-reminders');

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
