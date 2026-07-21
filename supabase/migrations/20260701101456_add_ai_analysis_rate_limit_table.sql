-- Backs the per-plan daily rate limit on the analyze-snag edge function.
-- Previously any authenticated user could call analyze-snag with no cap,
-- which is an unbounded Mistral API cost exposure once real paying
-- customers are making real calls. analyze-snag now counts rows here for
-- the trailing 24h and rejects with 429 once the caller's plan limit is hit.

CREATE TABLE public.ai_analysis_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_analysis_calls_user_created ON public.ai_analysis_calls(user_id, created_at);

ALTER TABLE public.ai_analysis_calls ENABLE ROW LEVEL SECURITY;

-- Read-only for the owning user (so the client could show "X/Y AI analyses
-- used today" if ever wanted); all writes go through analyze-snag's
-- service-role client, never directly from the browser, so there's no
-- INSERT policy for `authenticated` — that's deliberate, not an omission.
CREATE POLICY "ai_analysis_calls_read_own" ON public.ai_analysis_calls
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
