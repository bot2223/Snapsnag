-- The "send-reminders" trigger on public.snags (AFTER INSERT) was a
-- misconfigured Dashboard webhook pointing at the notify-subcontractor
-- edge function URL instead of send-reminders — an exact duplicate of the
-- correctly-named "notify-subcontractor" trigger, causing every new snag
-- to send two emails and two push notifications to the assignee.
-- The separate send-snag-reminders CRON JOB (pg_cron) is unrelated and
-- untouched by this migration.
DROP TRIGGER IF EXISTS "send-reminders" ON public.snags;
