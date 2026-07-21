-- ─────────────────────────────────────────────────────────────────────────────
-- LINK-BASED SITE WORKER INVITES (replaces email invites for this flow)
-- ─────────────────────────────────────────────────────────────────────────────
-- Previously site workers were invited via supabase.auth.admin.inviteUserByEmail
-- (invite-site-worker edge function). Supabase's built-in auth email sender is
-- capped at 2 emails/hour on this project, which makes it impractical for
-- real invite volume. Rather than wire in Resend/custom SMTP for this, we
-- switch to a manager-shareable invite link: the worker opens the link,
-- picks a name + password, and is attached to the inviting manager directly.
-- No email required at all for this flow.
--
-- The invite-site-worker edge function and its Resend/Supabase-email path
-- are left in place as dead code (per product decision) for future re-use
-- once a custom domain + SMTP provider exists — this migration does not
-- touch it, and the frontend is repointed to the new flow in the same
-- change that ships this migration.
--
-- Threat model (OWASP A01 Broken Access Control / A07 Authentication Failures):
--   - Codes are generated server-side only (gen_random_bytes → base64url),
--     never client-supplied — a client cannot mint its own valid code.
--   - A manager can only ever see/manage codes they created (RLS scoped to
--     created_by = auth.uid()). No one — including other managers — can
--     list or read another manager's invite codes or their raw code value
--     after creation (see profiles_read_as_manager precedent: RLS is scoped
--     per-manager everywhere in this schema, this follows the same shape).
--   - Redemption is a single SECURITY DEFINER function that atomically
--     checks-and-consumes the code (UPDATE ... WHERE used_at IS NULL AND
--     expires_at > now() RETURNING ...) to close the TOCTOU window between
--     "is this code valid" and "mark it used" — two concurrent redemptions
--     of the same code cannot both succeed.
--   - Redemption fails closed: any invalid/expired/already-used/malformed
--     code returns a single generic error, so the endpoint can't be used to
--     enumerate which codes exist or distinguish "expired" from "already
--     used" from "never existed".
--   - Codes expire after 7 days and are single-use.
--   - The existing profiles_enforce_site_worker_limit trigger already fires
--     on INSERT into profiles regardless of how the row got there, so plan
--     member limits are enforced automatically — no duplicate limit logic
--     needed in the redemption function.

CREATE TABLE IF NOT EXISTS public.invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'site_worker' CHECK (role = 'site_worker'), -- only role invitable via link today
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Fast lookup path for redemption (by code) and for a manager's own list.
CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON public.invite_codes (code);
CREATE INDEX IF NOT EXISTS invite_codes_created_by_idx ON public.invite_codes (created_by);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- Only the manager who created a code can see it (e.g. to show "pending
-- invite" state in the UI, or revoke it). No one can read another
-- manager's codes — including the raw `code` value, which is effectively
-- a bearer credential.
CREATE POLICY "invite_codes_select_own" ON public.invite_codes
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- Managers can create invite codes. Enforcing "must be a manager" here too
-- (not just in the RPC below) so a direct table insert from the client
-- can't bypass the role check the edge function/RPC does.
CREATE POLICY "invite_codes_insert_own_as_manager" ON public.invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.my_profile_role() = 'manager'
  );

-- Managers can revoke (delete) their own unredeemed codes. Cannot delete
-- already-used codes — keep them as an audit trail of who was invited.
CREATE POLICY "invite_codes_delete_own_unused" ON public.invite_codes
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND used_at IS NULL);

-- No UPDATE policy for authenticated users at all: redemption happens only
-- through the SECURITY DEFINER function below, which bypasses RLS by
-- design and is the sole writer of used_at/used_by. This prevents a
-- worker (or anyone) from marking a code "unused" again after redeeming
-- it, or tampering with used_by.

REVOKE ALL ON public.invite_codes FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.invite_codes TO authenticated;

-- ── Redemption ──────────────────────────────────────────────────────────────
-- Called by an unauthenticated visitor who has an invite link but no
-- account yet, immediately after supabase.auth.signUp() creates their auth
-- user (so auth.uid() below is the newly created worker, not the manager).
-- Atomically validates + consumes the code and writes the profile row in
-- one transaction, so a code cannot be redeemed twice even under concurrent
-- requests, and a failure partway through cannot leave a "used but
-- unattached" code.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF invite_code IS NULL OR length(invite_code) = 0 THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  -- Atomic check-and-consume: only succeeds if the code exists, is unused,
  -- and unexpired, all in the same statement as marking it used. Two
  -- concurrent calls with the same code race on this row lock; only one
  -- can win the UPDATE.
  UPDATE public.invite_codes
  SET used_at = now(), used_by = auth.uid()
  WHERE code = invite_code
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING created_by INTO v_manager_id;

  IF v_manager_id IS NULL THEN
    -- Deliberately generic: does not distinguish "never existed" from
    -- "expired" from "already used" (avoids enumeration / status probing).
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  -- Attach the new user to the inviting manager as a site worker. The
  -- existing profiles_enforce_site_worker_limit trigger fires here and
  -- will raise (rolling back this whole function, including the code
  -- consumption above) if the manager is already at their plan's member
  -- limit — so a full invite_codes table can never be worked around to
  -- exceed plan limits.
  INSERT INTO public.profiles (id, role, manager_id)
  VALUES (auth.uid(), 'site_worker', v_manager_id)
  ON CONFLICT (id) DO UPDATE
    SET role = 'site_worker', manager_id = v_manager_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
