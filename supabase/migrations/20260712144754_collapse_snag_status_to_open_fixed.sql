CREATE TYPE public.snag_status_v2 AS ENUM ('Open', 'Fixed');

DROP TRIGGER notify_status_change_trigger ON public.snags;

ALTER TABLE public.snags
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.snags
  ALTER COLUMN status TYPE public.snag_status_v2
  USING (
    CASE status::text
      WHEN 'In Progress' THEN 'Open'
      WHEN 'Resolved' THEN 'Fixed'
      ELSE status::text
    END
  )::public.snag_status_v2;

ALTER TABLE public.snags
  ALTER COLUMN status SET DEFAULT 'Open'::public.snag_status_v2;

DROP TYPE public.snag_status;
ALTER TYPE public.snag_status_v2 RENAME TO snag_status;

CREATE TRIGGER notify_status_change_trigger AFTER UPDATE ON public.snags
  FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status)
  EXECUTE FUNCTION trigger_notify_status_change();

UPDATE public.snag_activity SET from_status = 'Open' WHERE from_status = 'In Progress';
UPDATE public.snag_activity SET to_status = 'Open' WHERE to_status = 'In Progress';
UPDATE public.snag_activity SET from_status = 'Fixed' WHERE from_status = 'Resolved';
UPDATE public.snag_activity SET to_status = 'Fixed' WHERE to_status = 'Resolved';
