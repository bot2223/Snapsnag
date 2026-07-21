-- report_schedules, snag_reports, and the trigger that auto-creates a
-- schedule when a user upgrades to Business all already exist live but,
-- like snags.manager_id before them, were never captured in any migration
-- file — created directly against the DB outside migration history.
-- IF NOT EXISTS / OR REPLACE throughout so this is a no-op against the
-- live DB and just brings the repo's history in line with reality.

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  day_of_week INT DEFAULT 1,
  time_utc TEXT DEFAULT '09:00',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.snag_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_period_start TIMESTAMPTZ NOT NULL,
  report_period_end TIMESTAMPTZ NOT NULL,
  pdf_url TEXT,
  email_sent_at TIMESTAMPTZ,
  snag_count_open INT DEFAULT 0,
  snag_count_fixed INT DEFAULT 0,
  snag_count_in_progress INT DEFAULT 0,
  sla_compliance_percent NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snag_reports ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_report_schedule_for_business()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.plan = 'business' AND (OLD.plan IS NULL OR OLD.plan != 'business') THEN
    INSERT INTO public.report_schedules (user_id, enabled, day_of_week, time_utc)
    VALUES (NEW.user_id, true, 1, '09:00')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_report_schedule ON public.subscriptions;
CREATE TRIGGER trg_create_report_schedule
  AFTER INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.create_report_schedule_for_business();
