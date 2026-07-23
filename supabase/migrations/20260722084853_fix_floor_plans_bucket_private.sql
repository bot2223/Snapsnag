-- Reconstructed migration. This was applied live via the Supabase tool on
-- 2026-07-22 (version 20260722084853, between floor_plan_pin_drop and
-- gate_floor_plans_to_pro_business) but the matching .sql file was never
-- written to the repo, so on-disk history didn't match what's actually
-- deployed. This file closes that gap; it does not change current
-- production behavior since the bucket is already private.
--
-- The floor-plans bucket was briefly created with public = true (a
-- copy/paste slip from another bucket setup) before this fix. All access
-- was meant to go through RLS-checked signed URLs like every other bucket
-- in this app, never a public URL.
UPDATE storage.buckets
SET public = false
WHERE id = 'floor-plans';
