-- Purely additive, nullable, no backfill needed — existing rows simply have
-- captured_at = null and the app treats null as "same as created_at" (it
-- was captured and synced in the same moment, which is true for every row
-- that predates offline mode).
--
-- Needed for offline mode: a snag queued at 9am but not synced until 2pm
-- would otherwise look like it was reported at 2pm (created_at is set by
-- the server at insert time). captured_at preserves the moment the person
-- actually pressed the button, client-side, so the UI can be honest about
-- when it really happened even though deadline_at is still correctly
-- computed from created_at (the deadline clock starting at sync time,
-- not capture time, is a deliberate, separate decision — not a bug).
ALTER TABLE public.snags
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

COMMENT ON COLUMN public.snags.captured_at IS
  'Client-side timestamp of when the snag was actually captured (may predate created_at for offline-queued snags). Null for snags created before offline mode / captured and synced in the same moment.';
