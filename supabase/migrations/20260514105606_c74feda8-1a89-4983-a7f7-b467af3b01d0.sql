
DROP POLICY "snag_photos_read" ON storage.objects;
DROP POLICY "company_read" ON storage.objects;
CREATE POLICY "snag_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'snag-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "company_read" ON storage.objects FOR SELECT USING (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE OR REPLACE FUNCTION public.log_snag_activity() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.snag_activity(snag_id, user_id, action, to_status) VALUES (NEW.id, NEW.user_id, 'created', NEW.status);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.snag_activity(snag_id, user_id, action, from_status, to_status) VALUES (NEW.id, NEW.user_id, 'status_changed', OLD.status, NEW.status);
    IF NEW.status = 'fixed' AND NEW.fixed_at IS NULL THEN
      NEW.fixed_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_snag_activity() FROM PUBLIC, anon, authenticated;
