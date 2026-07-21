-- Carry the site worker name entered on invite creation through to
-- profiles.full_name at redemption, so NameGate doesn't ask for it again.

ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS name text;

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
  v_name text;
  v_email text;
  v_updated_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF invite_code IS NULL OR length(invite_code) = 0 THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  UPDATE public.invite_codes
  SET used_at = now(), used_by = auth.uid()
  WHERE code = invite_code
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING created_by, role, subcontractor_id, name
    INTO v_manager_id, v_role, v_sub_id, v_name;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  IF v_role = 'subcontractor' THEN
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
    INSERT INTO public.profiles (id, role, manager_id, email, full_name)
    VALUES (auth.uid(), 'site_worker', v_manager_id, v_email, v_name)
    ON CONFLICT (id) DO UPDATE
      SET role = 'site_worker',
          manager_id = v_manager_id,
          email = v_email,
          full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
