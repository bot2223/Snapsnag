-- Add deadline_at column to snags
ALTER TABLE public.snags ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

-- Auto-calculate deadline on insert based on priority
CREATE OR REPLACE FUNCTION public.set_snag_deadline()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.deadline_at := CASE NEW.priority
    WHEN 'Critical' THEN NEW.created_at + INTERVAL '24 hours'
    WHEN 'High'     THEN NEW.created_at + INTERVAL '72 hours'
    WHEN 'Medium'   THEN NEW.created_at + INTERVAL '7 days'
    WHEN 'Low'      THEN NEW.created_at + INTERVAL '14 days'
    ELSE                 NEW.created_at + INTERVAL '7 days'
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER snag_deadline_trigger
BEFORE INSERT ON public.snags
FOR EACH ROW EXECUTE FUNCTION public.set_snag_deadline();

-- Backfill existing snags that have no deadline yet
UPDATE public.snags SET deadline_at = CASE priority
  WHEN 'Critical' THEN created_at + INTERVAL '24 hours'
  WHEN 'High'     THEN created_at + INTERVAL '72 hours'
  WHEN 'Medium'   THEN created_at + INTERVAL '7 days'
  WHEN 'Low'      THEN created_at + INTERVAL '14 days'
  ELSE                 created_at + INTERVAL '7 days'
END
WHERE deadline_at IS NULL;
