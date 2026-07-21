
-- ENUMS
CREATE TYPE snag_status AS ENUM ('open', 'in_progress', 'fixed');
CREATE TYPE snag_category AS ENUM ('Structural', 'Electrical', 'Plumbing', 'Finishing', 'Safety');
CREATE TYPE snag_priority AS ENUM ('Low', 'Medium', 'High', 'Critical');

-- SUBCONTRACTORS
CREATE TABLE public.subcontractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trade TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_user ON public.subcontractors(user_id);
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs_owner_all" ON public.subcontractors FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SNAGS
CREATE TABLE public.snags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url TEXT,
  description TEXT,
  location TEXT NOT NULL,
  category snag_category NOT NULL,
  subcontractor_id UUID REFERENCES public.subcontractors(id) ON DELETE SET NULL,
  priority snag_priority NOT NULL DEFAULT 'Medium',
  status snag_status NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fixed_at TIMESTAMPTZ
);
CREATE INDEX idx_snags_user ON public.snags(user_id);
CREATE INDEX idx_snags_status ON public.snags(status);
ALTER TABLE public.snags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snags_owner_all" ON public.snags FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- COMMENTS
CREATE TABLE public.snag_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id UUID NOT NULL REFERENCES public.snags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_snag ON public.snag_comments(snag_id);
ALTER TABLE public.snag_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_via_snag" ON public.snag_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_id AND s.user_id = auth.uid()));

-- ACTIVITY LOG
CREATE TABLE public.snag_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id UUID NOT NULL REFERENCES public.snags(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status snag_status,
  to_status snag_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_snag ON public.snag_activity(snag_id);
ALTER TABLE public.snag_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_via_snag" ON public.snag_activity FOR ALL
  USING (EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.snags s WHERE s.id = snag_id AND s.user_id = auth.uid()));

-- SETTINGS
CREATE TABLE public.company_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  logo_url TEXT,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  push_notifications BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_owner_all" ON public.company_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Auto activity log on snag insert + status change
CREATE OR REPLACE FUNCTION public.log_snag_activity() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE TRIGGER trg_snag_activity_ins AFTER INSERT ON public.snags FOR EACH ROW EXECUTE FUNCTION public.log_snag_activity();
CREATE TRIGGER trg_snag_activity_upd BEFORE UPDATE ON public.snags FOR EACH ROW EXECUTE FUNCTION public.log_snag_activity();

-- STORAGE
INSERT INTO storage.buckets (id, name, public) VALUES ('snag-photos','snag-photos', true), ('company-assets','company-assets', true);

CREATE POLICY "snag_photos_read" ON storage.objects FOR SELECT USING (bucket_id = 'snag-photos');
CREATE POLICY "snag_photos_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'snag-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "snag_photos_update" ON storage.objects FOR UPDATE USING (bucket_id = 'snag-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "snag_photos_delete" ON storage.objects FOR DELETE USING (bucket_id = 'snag-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "company_read" ON storage.objects FOR SELECT USING (bucket_id = 'company-assets');
CREATE POLICY "company_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "company_update" ON storage.objects FOR UPDATE USING (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "company_delete" ON storage.objects FOR DELETE USING (bucket_id = 'company-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
