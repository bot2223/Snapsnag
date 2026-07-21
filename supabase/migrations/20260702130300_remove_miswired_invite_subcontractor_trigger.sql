-- invite-subcontractor's DB webhook was wired to fire on subcontractors
-- INSERT, but its code expects a *snags* row (checks payload.record.subcontractor_id).
-- Every real invocation hit that mismatch and no-op'd immediately — the
-- account-invite step it used to perform never actually ran. That step has
-- been merged into notify-subcontractor (correctly wired to snags INSERT,
-- and already escapes HTML). Dropping the broken trigger; the
-- invite-subcontractor edge function itself should be undeployed via the
-- Supabase CLI/dashboard since this tool can't remove deployed functions.
DROP TRIGGER IF EXISTS "invite-subcontractor" ON public.subcontractors;

-- A second, undocumented snag-limit trigger (check_snag_limit_before_insert)
-- was applied directly to the DB outside any tracked migration and never
-- made it into this repo. It duplicated enforce_snag_limit (added in
-- enforce_plan_limits_server_side) with conflicting past_due semantics —
-- hard-blocking past_due immediately instead of honoring the grace period
-- has_active_access() uses everywhere else. Superseded, so removed.
DROP TRIGGER IF EXISTS trg_enforce_snag_limit ON public.snags;
DROP FUNCTION IF EXISTS public.check_snag_limit_before_insert();
