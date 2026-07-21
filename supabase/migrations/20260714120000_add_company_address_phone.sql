-- Add address + phone to company_settings (Company tab additions).
-- Nullable, no defaults — purely informational fields for the company profile.
alter table public.company_settings
  add column if not exists company_address text,
  add column if not exists company_phone text;
