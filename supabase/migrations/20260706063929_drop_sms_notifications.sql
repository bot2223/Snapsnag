-- Reverting: decided against SMS/Twilio in favor of web push + WhatsApp fallback.
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS sms_notifications;
