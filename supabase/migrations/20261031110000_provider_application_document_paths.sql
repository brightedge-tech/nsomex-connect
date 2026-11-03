ALTER TABLE public.provider_applications
ADD COLUMN IF NOT EXISTS document_paths text[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "Users can update their own provider applications"
ON public.provider_applications;

CREATE POLICY "Users can update their own provider applications"
ON public.provider_applications
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

