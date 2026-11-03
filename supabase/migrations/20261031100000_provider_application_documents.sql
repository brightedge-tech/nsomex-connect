DROP POLICY IF EXISTS provider_documents_owner_insert
ON storage.objects;

CREATE POLICY provider_documents_applicant_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'provider-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.provider_applications AS pa
    WHERE pa.id::text = (storage.foldername(name))[2]
      AND pa.user_id = auth.uid()
  )
);

