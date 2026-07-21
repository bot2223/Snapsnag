-- ─────────────────────────────────────────────────────────────────────────────
-- LINK-BASED SUBCONTRACTOR INVITES (mirrors the site-worker link flow)
-- ─────────────────────────────────────────────────────────────────────────────
-- Previously, adding a subcontractor meant the manager typed the
-- subcontractor's own email address into a form, and that record just sat
-- there with no account attached — role resolution (auth-context.tsx) only
-- ever recognizes someone as this subcontractor if they happen to sign up
-- with that exact email later, and nothing prompted them to. This mirrors
-- the site-worker invite-link UX instead: the manager only enters Name +
-- Trade, gets a shareable link back, and the subcontractor supplies their
-- own email + password when they open it.
--
-- Design: the subcontractors row is created immediately (server-side, by
-- the create-invite-link edge function) with auth_user_id/email left NULL,
-- and the invite code stores that row's id directly. Redemption just
-- writes the redeemer's id/email onto that specific row by id — no
-- matching on name/trade (which could collide across subcontractors)
-- needed.
--
-- invite_codes.role's CHECK constraint only allowed 'site_worker'; widen it
-- to also allow 'subcontractor'.

ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_role_check;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT invite_codes_role_check CHECK (role IN ('site_worker', 'subcontractor'));

-- Points at the pre-created subcontractors row this code will attach an
-- account to. NULL for site_worker invites (unused there).
ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES public.subcontractors(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id uuid;
  v_role text;
  v_sub_id uuid;
  v_email text;
  v_updated_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF invite_code IS NULL OR length(invite_code) = 0 THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  -- Same atomic check-and-consume as before, now also returning which role
  -- this code was minted for and (for subcontractors) which pre-created
  -- row to attach.
  UPDATE public.invite_codes
  SET used_at = now(), used_by = auth.uid()
  WHERE code = invite_code
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING created_by, role, subcontractor_id
    INTO v_manager_id, v_role, v_sub_id;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  IF v_role = 'subcontractor' THEN
    -- Attach this account to the manager's pre-created subcontractor slot.
    -- auth_user_id IS NULL guards against redeeming into an already-claimed
    -- row (shouldn't happen since codes are single-use, but cheap to keep).
    UPDATE public.subcontractors
    SET email = v_email,
        auth_user_id = auth.uid()
    WHERE id = v_sub_id
      AND user_id = v_manager_id
      AND auth_user_id IS NULL
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      RAISE EXCEPTION 'Invalid or expired invite link';
    END IF;
  ELSE
    -- Existing site-worker path, unchanged.
    INSERT INTO public.profiles (id, role, manager_id, email)
    VALUES (auth.uid(), 'site_worker', v_manager_id, v_email)
    ON CONFLICT (id) DO UPDATE
      SET role = 'site_worker', manager_id = v_manager_id, email = v_email;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
