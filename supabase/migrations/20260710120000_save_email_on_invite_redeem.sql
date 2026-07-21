-- The join-by-link flow collects an email at signUp() time but never
-- copied it into public.profiles, so site workers' emails were always
-- NULL there (even though auth.users has it) and never showed up in the
-- Team page. Pull it from auth.users at redemption time, same place the
-- function already trusts auth.uid() from.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id uuid;
  v_email text;
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
  RETURNING created_by INTO v_manager_id;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite link';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.profiles (id, role, manager_id, email)
  VALUES (auth.uid(), 'site_worker', v_manager_id, v_email)
  ON CONFLICT (id) DO UPDATE
    SET role = 'site_worker', manager_id = v_manager_id, email = v_email;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

-- Backfill existing site workers who joined before this fix, so their
-- email shows up immediately without needing to rejoin.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'site_worker'
  AND p.email IS NULL;
