-- Tracks which escalation stages have already fired for a snag, so the
-- 15-minute-cron that checks for overdue snags doesn't re-send the same
-- stage every time it runs. Two independent stages: first push right after
-- crossing the deadline, second stronger push if it's still open 24h later.
ALTER TABLE public.snags
  ADD COLUMN IF NOT EXISTS escalated_15m_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_24h_at timestamptz;

-- Runs every 15 minutes: checks for snags that just crossed their deadline
-- (first escalation) or have been overdue for 24h+ (second, stronger
-- escalation), and pushes to the owning manager. Business logic (which
-- snags qualify, plan gating, push sending) lives in the edge function —
-- this cron's only job is to invoke it on schedule.
select cron.schedule(
  'send-snag-escalations',
  '*/15 * * * *',
  $$
  select
    net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-escalations',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- Runs every 15 minutes too: report_schedules.time_utc is minute-precision
-- (an HTML <input type="time">), so an hourly cron would miss most chosen
-- times entirely. The edge function itself decides which schedules are
-- actually due (comparing against last_run_at), so a 15-minute tick rate
-- just bounds how late a report can be, not how often work happens.
select cron.schedule(
  'generate-scheduled-snag-reports',
  '*/15 * * * *',
  $$
  select
    net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/generate-scheduled-reports',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);
