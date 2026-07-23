-- Trial length reduced from 30 to 15 days. Only affects NEW signups going
-- forward — existing users' trial_ends_at rows are untouched (someone
-- already mid-trial keeps whatever they were promised).
CREATE OR REPLACE FUNCTION public.handle_new_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trialing', now() + INTERVAL '15 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
