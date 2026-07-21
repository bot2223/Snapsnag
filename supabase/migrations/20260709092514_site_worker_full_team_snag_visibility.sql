-- ─────────────────────────────────────────────────────────────────────────────
-- SITE WORKERS SEE THE WHOLE TEAM'S SNAGS, LIKE THEIR MANAGER DOES.
-- SUBCONTRACTORS STAY SCOPED TO ONLY WHAT'S ASSIGNED TO THEM.
-- ─────────────────────────────────────────────────────────────────────────────
-- Previously (20260705140000) a site worker could only see (a) snags they
-- personally logged, and (b) snags their manager personally logged — NOT
-- snags logged by their teammates. A manager had the same gap in reverse:
-- they could only see snags with user_id = their own id, never snags their
-- own site workers logged. Site workers are long-term crew, not outside
-- contractors, so this widens their (and the manager's) visibility to the
-- whole team while leaving subcontractors exactly as they were —
-- assigned-only, per instruction.
--
-- private.effective_manager_id(uid) resolves "whose team is this person
-- on" — a manager's team is themselves, a site worker's/subcontractor's
-- team is their manager_id. This lets one clause serve both manager and
-- site worker: "show me every snag whose logger is on my team."
--
-- This migration also fixes a real bug it would otherwise inherit:
-- has_active_access(user_id) was being checked against the literal
-- snags.user_id. Site workers never have their own subscriptions row (only
-- managers pay) — so any snag logged BY a site worker was silently
-- invisible to everyone, including the site worker who logged it, because
-- has_active_access(that site worker's id) always returned false. Billing
-- must be checked against the paying manager, not the person who happened
-- to log the snag — so every has_active_access(user_id) call below is now
-- has_active_access(private.effective_manager_id(user_id)) instead.
--
-- Write scope (insert/update/delete) is intentionally NOT widened here —
-- everyone still only inserts/updates/deletes their own snags (or, for
-- subcontractors, snags assigned to them). Only read visibility changes.
-- If you also want site workers editing/deleting teammates' snags, that's
-- a separate, bigger decision — ask and I'll do that as its own migration.

CREATE OR REPLACE FUNCTION private.effective_manager_id(target_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p.role = 'manager' THEN p.id ELSE p.manager_id END
  FROM public.profiles p
  WHERE p.id = target_user_id;
$$;

REVOKE ALL ON FUNCTION private.effective_manager_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.effective_manager_id(uuid) TO authenticated;

DROP POLICY IF EXISTS snags_select ON public.snags;
DROP POLICY IF EXISTS snags_insert ON public.snags;
DROP POLICY IF EXISTS snags_update ON public.snags;
DROP POLICY IF EXISTS snags_delete ON public.snags;

CREATE POLICY snags_select ON public.snags
FOR SELECT TO authenticated
USING (
  (
    -- Manager and site worker share one team scope: everything logged by
    -- anyone on their team. coalesce(my_manager_id(), auth.uid()) is the
    -- manager's own id whether you ARE the manager (my_manager_id() is
    -- null, falls back to yourself) or you're a site worker under them
    -- (my_manager_id() is their id directly).
    (
      private.my_profile_role() IN ('manager', 'site_worker')
      AND private.effective_manager_id(user_id) = coalesce(private.my_manager_id(), (select auth.uid()))
    )
    -- Subcontractors: unchanged, assigned-only.
    OR subcontractor_id IN (SELECT s.id FROM subcontractors s WHERE s.email = (select auth.email()))
  )
  AND private.has_active_access(private.effective_manager_id(user_id))
);

CREATE POLICY snags_insert ON public.snags
FOR INSERT TO authenticated
WITH CHECK (
  (
    (select auth.uid()) = user_id
    OR user_id = (SELECT p.manager_id FROM profiles p WHERE p.id = (select auth.uid()) AND p.role = 'site_worker')
  )
  AND private.has_active_access(private.effective_manager_id(user_id))
);

CREATE POLICY snags_update ON public.snags
FOR UPDATE TO authenticated
USING (
  (
    (select auth.uid()) = user_id
    OR user_id = (SELECT p.manager_id FROM profiles p WHERE p.id = (select auth.uid()) AND p.role = 'site_worker')
    OR subcontractor_id IN (SELECT s.id FROM subcontractors s WHERE s.email = (select auth.email()))
  )
  AND private.has_active_access(private.effective_manager_id(user_id))
)
WITH CHECK (
  (
    (select auth.uid()) = user_id
    OR user_id = (SELECT p.manager_id FROM profiles p WHERE p.id = (select auth.uid()) AND p.role = 'site_worker')
    OR subcontractor_id IN (SELECT s.id FROM subcontractors s WHERE s.email = (select auth.email()))
  )
  AND private.has_active_access(private.effective_manager_id(user_id))
);

CREATE POLICY snags_delete ON public.snags
FOR DELETE TO authenticated
USING (
  (
    (select auth.uid()) = user_id
    OR user_id = (SELECT p.manager_id FROM profiles p WHERE p.id = (select auth.uid()) AND p.role = 'site_worker')
  )
  AND private.has_active_access(private.effective_manager_id(user_id))
);
