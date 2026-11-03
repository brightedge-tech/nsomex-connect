CREATE TABLE IF NOT EXISTS public.provider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_type text NOT NULL
    CHECK (provider_type IN ('individual', 'business')),
  contact_name text NOT NULL,
  business_name text,
  phone text NOT NULL,
  service_location text NOT NULL,
  profession text NOT NULL,
  services text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_name_required CHECK (
    provider_type <> 'business'
    OR (business_name IS NOT NULL AND length(trim(business_name)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS provider_applications_user_id_idx
  ON public.provider_applications(user_id);

CREATE INDEX IF NOT EXISTS provider_applications_status_idx
  ON public.provider_applications(verification_status);

ALTER TABLE public.provider_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can submit their own provider application"
  ON public.provider_applications;

CREATE POLICY "Users can submit their own provider application"
  ON public.provider_applications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own provider applications"
  ON public.provider_applications;

CREATE POLICY "Users can view their own provider applications"
  ON public.provider_applications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
