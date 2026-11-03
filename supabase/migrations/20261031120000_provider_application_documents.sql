-- Applicants must not be able to change their verification status.
DROP POLICY IF EXISTS "Users can update their own provider applications"
ON public.provider_applications;

CREATE TABLE IF NOT EXISTS public.provider_application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL
    REFERENCES public.provider_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  document_name text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_application_documents_application_idx
ON public.provider_application_documents(application_id);

ALTER TABLE public.provider_application_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_application_documents_owner_insert
ON public.provider_application_documents;

CREATE POLICY provider_application_documents_owner_insert
ON public.provider_application_documents
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.provider_applications pa
    WHERE pa.id = application_id
      AND pa.user_id = auth.uid()
  )
  AND split_part(storage_path, '/', 1) = auth.uid()::text
  AND split_part(storage_path, '/', 2) = application_id::text
);

DROP POLICY IF EXISTS provider_application_documents_owner_read
ON public.provider_application_documents;

CREATE POLICY provider_application_documents_owner_read
ON public.provider_application_documents
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id OR private.is_admin()
);

