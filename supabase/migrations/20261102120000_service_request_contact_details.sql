ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS contact_name text
    CHECK (
      contact_name IS NULL
      OR length(btrim(contact_name)) BETWEEN 1 AND 200
    ),
  ADD COLUMN IF NOT EXISTS contact_phone text
    CHECK (
      contact_phone IS NULL
      OR contact_phone ~ '^\+[1-9][0-9]{1,14}$'
    );