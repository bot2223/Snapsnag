-- The subcontractor_id FK added in 20260710130000_invite_link_subcontractors.sql
-- had no covering index (flagged by the Supabase performance advisor
-- immediately after applying that migration). redeem_invite_code doesn't
-- look up by this column today, but the create-invite-link edge function's
-- cleanup path and any future admin/debug query joining invite_codes ->
-- subcontractors would do a seq scan without one.
CREATE INDEX IF NOT EXISTS idx_invite_codes_subcontractor_id
  ON public.invite_codes (subcontractor_id);
