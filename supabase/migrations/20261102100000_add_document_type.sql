ALTER TABLE public.provider_application_documents
ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'other';

ALTER TABLE public.provider_application_documents
ADD CONSTRAINT provider_application_documents_type_check
CHECK (
  document_type IN (
    'national_id',
    'passport',
    'professional_certificate',
    'business_registration',
    'other'
  )
);
