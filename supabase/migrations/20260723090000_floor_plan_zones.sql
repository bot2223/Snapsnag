-- Named room zones per floor plan. Since uploaded floor plans are just
-- images (no OCR), the only reliable way to auto-fill Location from a pin
-- is to let the manager label rectangular zones once per plan, then match
-- a placed pin against them. Normalized 0-1 coordinates, same system as
-- snags.pin_x/pin_y.
ALTER TABLE public.floor_plans
  ADD COLUMN zones jsonb NOT NULL DEFAULT '[]'::jsonb;
