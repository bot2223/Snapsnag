-- Plan limits (usePlanLimits.ts) were UI-only — a direct API call could
-- insert past a plan's snag/member cap. Mirrors the same numbers server
-- side via triggers. Keep these limits in sync with PLAN_LIMITS in
-- src/lib/usePlanLimits.ts if either changes.

CREATE OR REPLACE FUNCTION public.plan_snag_limit(target_manager_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE (SELECT plan FROM public.subscriptions WHERE user_id = target_manager_id)
    WHEN 'pro' THEN 200
    WHEN 'business' THEN 2147483647
    ELSE 50
  END;
$$;

CREATE OR REPLACE FUNCTION public.plan_member_limit(target_manager_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE (SELECT plan FROM public.subscriptions WHERE user_id = target_manager_id)
    WHEN 'pro' THEN 20
    WHEN 'business' THEN 2147483647
    ELSE 5
  END;
$$;

-- Rolling monthly snag count, same window usePlanLimits.ts uses.
CREATE OR REPLACE FUNCTION public.enforce_snag_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (
    SELECT count(*) FROM public.snags
    WHERE user_id = NEW.user_id AND created_at >= date_trunc('month', now())
  ) >= public.plan_snag_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Monthly snag limit reached for this plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snags_enforce_limit ON public.snags;
CREATE TRIGGER snags_enforce_limit
  BEFORE INSERT ON public.snags
  FOR EACH ROW EXECUTE FUNCTION public.enforce_snag_limit();

-- Subcontractors count toward the same member cap as site workers.
CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (
    (SELECT count(*) FROM public.subcontractors WHERE user_id = NEW.user_id)
    + (SELECT count(*) FROM public.profiles WHERE manager_id = NEW.user_id AND role = 'site_worker')
  ) >= public.plan_member_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Team member limit reached for this plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subcontractors_enforce_limit ON public.subcontractors;
CREATE TRIGGER subcontractors_enforce_limit
  BEFORE INSERT ON public.subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_limit();

-- Site workers are written via upsert from an edge function (service role,
-- bypasses RLS but not triggers). Only check when a row is newly becoming
-- a site worker under this manager, so re-inviting an existing one is a
-- no-op, not a false block.
CREATE OR REPLACE FUNCTION public.enforce_site_worker_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'site_worker' AND NEW.manager_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'site_worker' OR OLD.manager_id IS DISTINCT FROM NEW.manager_id)
  THEN
    IF (
      (SELECT count(*) FROM public.subcontractors WHERE user_id = NEW.manager_id)
      + (SELECT count(*) FROM public.profiles WHERE manager_id = NEW.manager_id AND role = 'site_worker')
    ) >= public.plan_member_limit(NEW.manager_id) THEN
      RAISE EXCEPTION 'Team member limit reached for this plan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_site_worker_limit ON public.profiles;
CREATE TRIGGER profiles_enforce_site_worker_limit
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_site_worker_limit();
