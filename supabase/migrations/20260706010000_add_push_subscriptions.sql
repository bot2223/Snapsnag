-- Stores one row per browser/device push subscription for a subcontractor.
-- A subcontractor can have multiple (phone + laptop, or after reinstalling),
-- so this is a separate table rather than columns on subcontractors.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES public.subcontractors(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subcontractor_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_subcontractor_id_idx
  ON public.push_subscriptions (subcontractor_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A subcontractor manages only their own subscriptions. Matched the same
-- way subs_select matches subcontractors: by email against auth.email(),
-- since that's the identity link already used for subcontractor self-access
-- elsewhere in this schema.
CREATE POLICY push_subs_select ON public.push_subscriptions
  FOR SELECT
  USING (
    subcontractor_id IN (
      SELECT id FROM public.subcontractors
      WHERE email = (SELECT auth.email())
    )
  );

CREATE POLICY push_subs_insert ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (
    subcontractor_id IN (
      SELECT id FROM public.subcontractors
      WHERE email = (SELECT auth.email())
    )
  );

CREATE POLICY push_subs_delete ON public.push_subscriptions
  FOR DELETE
  USING (
    subcontractor_id IN (
      SELECT id FROM public.subcontractors
      WHERE email = (SELECT auth.email())
    )
  );

-- No UPDATE policy: subscriptions are replaced (delete+insert), not edited.
-- Service role (used by the notify-subcontractor edge function) bypasses
-- RLS entirely, so it can read/delete any row to send pushes and clean up
-- expired subscriptions.
