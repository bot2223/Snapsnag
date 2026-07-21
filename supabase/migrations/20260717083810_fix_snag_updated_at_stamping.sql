-- updated_at was meant to be stamped on every snag update, but the logic
-- lived inside log_snag_activity(), which runs AFTER UPDATE. Mutating NEW
-- in an AFTER trigger has no effect on the persisted row, so updated_at
-- has never actually changed after insert. This silently broke any
-- feature (like SLA compliance in insights.tsx) that used updated_at as
-- a proxy for "when did this snag last change". Splitting it into its own
-- BEFORE UPDATE trigger fixes it for real.
CREATE OR REPLACE FUNCTION public.set_snag_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER snag_updated_at_trigger
BEFORE UPDATE ON public.snags
FOR EACH ROW EXECUTE FUNCTION public.set_snag_updated_at();
