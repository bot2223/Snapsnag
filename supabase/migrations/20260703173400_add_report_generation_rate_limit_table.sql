-- Backs the flat 10/day rate limit on the generate-report edge function.
-- Same shape and convention as ai_analysis_calls.

CREATE TABLE public.report_generation_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_generation_calls_user_created ON public.report_generation_calls(user_id, created_at);

ALTER TABLE public.report_generation_calls ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user; all writes go through generate-report's
-- service-role client, so no INSERT policy for `authenticated`.
CREATE POLICY "report_generation_calls_read_own" ON public.report_generation_calls
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
