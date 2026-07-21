-- Adds a per-manager toggle for SMS alerts, mirroring email_notifications /
-- push_notifications. Defaults to false since it costs money per text and
-- requires a subcontractor phone number to do anything.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN NOT NULL DEFAULT false;
