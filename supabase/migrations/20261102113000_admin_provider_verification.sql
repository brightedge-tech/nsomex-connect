ALTER TABLE public.provider_applications
  DROP CONSTRAINT IF EXISTS provider_applications_verification_status_check;

ALTER TABLE public.provider_applications
  ADD CONSTRAINT provider_applications_verification_status_check
  CHECK (
    verification_status IN (
      'pending',
      'requires_documents',
      'approved',
      'rejected'
    )
  );

ALTER TABLE public.provider_applications
  ADD COLUMN IF NOT EXISTS review_reason text
  CHECK (review_reason IS NULL OR length(btrim(review_reason)) BETWEEN 1 AND 2000);

CREATE INDEX IF NOT EXISTS provider_applications_status_created_id_idx
  ON public.provider_applications (
    verification_status,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS provider_applications_created_id_idx
  ON public.provider_applications (created_at DESC, id DESC);

CREATE POLICY provider_applications_admin_read
  ON public.provider_applications
  FOR SELECT TO authenticated
  USING (private.is_admin());

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_related_entity_type_check
  CHECK (
    related_entity_type IS NULL
    OR related_entity_type IN (
      'service_request',
      'booking',
      'conversation',
      'message',
      'provider_document',
      'provider_application',
      'review'
    )
  );

CREATE OR REPLACE FUNCTION public.admin_list_provider_applications(
  p_status text DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  provider_type text,
  contact_name text,
  business_name text,
  phone text,
  service_location text,
  profession text,
  verification_status text,
  review_reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN (
       'pending',
       'requires_documents',
       'approved',
       'rejected'
     ) THEN
    RAISE EXCEPTION 'Invalid provider application status'
      USING ERRCODE = '22023';
  END IF;

  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50 THEN
    RAISE EXCEPTION 'Page size must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor values must be supplied together'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    application.id,
    application.user_id,
    application.provider_type,
    application.contact_name,
    application.business_name,
    application.phone,
    application.service_location,
    application.profession,
    application.verification_status,
    application.review_reason,
    application.created_at
  FROM public.provider_applications AS application
  WHERE (p_status IS NULL OR application.verification_status = p_status)
    AND (
      p_before_created_at IS NULL
      OR (application.created_at, application.id)
        < (p_before_created_at, p_before_id)
    )
  ORDER BY application.created_at DESC, application.id DESC
  LIMIT p_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_provider_applications(
  text,
  timestamptz,
  uuid,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_applications(
  text,
  timestamptz,
  uuid,
  integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_provider_application(
  p_application_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  verification_status text,
  review_reason text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application public.provider_applications%ROWTYPE;
  v_admin_profile_id uuid;
  v_new_status text;
  v_old_status text;
  v_old_reason text;
  v_reason text;
  v_action_name text;
  v_notification_title text;
  v_notification_message text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_application_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('approve', 'reject', 'request_documents') THEN
    RAISE EXCEPTION 'Invalid provider application review request'
      USING ERRCODE = '22023';
  END IF;

  v_reason := NULLIF(btrim(p_reason), '');
  IF p_action IN ('reject', 'request_documents')
     AND (v_reason IS NULL OR length(v_reason) > 2000) THEN
    RAISE EXCEPTION 'A reason of at most 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  v_new_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    WHEN 'request_documents' THEN 'requires_documents'
  END;

  v_action_name := CASE p_action
    WHEN 'approve' THEN 'provider_application.approved'
    WHEN 'reject' THEN 'provider_application.rejected'
    WHEN 'request_documents' THEN 'provider_application.documents_requested'
  END;

  SELECT profile.id
  INTO v_admin_profile_id
  FROM public.profiles AS profile
  WHERE profile.user_id = auth.uid()
    AND profile.role = 'admin';

  IF v_admin_profile_id IS NULL THEN
    RAISE EXCEPTION 'Administrator profile not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.provider_applications AS application
  WHERE application.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider application not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_old_status := v_application.verification_status;
  v_old_reason := v_application.review_reason;

  UPDATE public.provider_applications AS application
  SET verification_status = v_new_status,
      review_reason = v_reason,
      updated_at = now()
  WHERE application.id = p_application_id
  RETURNING application.* INTO v_application;

  INSERT INTO public.admin_actions (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  VALUES (
    v_admin_profile_id,
    v_action_name,
    'provider_application',
    v_application.id,
    jsonb_build_object(
      'previous_status', v_old_status,
      'new_status', v_new_status,
      'reason', v_reason
    )
  );

  v_notification_title := CASE p_action
    WHEN 'approve' THEN 'Provider application approved / Demande approuvée'
    WHEN 'reject' THEN 'Provider application rejected / Demande refusée'
    WHEN 'request_documents' THEN
      'Additional documents requested / Documents supplémentaires requis'
  END;

  v_notification_message := CASE p_action
    WHEN 'approve' THEN
      'Your provider application has been approved. / Votre demande de prestataire a été approuvée.'
    WHEN 'reject' THEN
      'Your provider application was rejected. / Votre demande de prestataire a été refusée.'
    WHEN 'request_documents' THEN
      'Additional documents are required for your application. / Des documents supplémentaires sont requis pour votre demande.'
  END;

  IF v_reason IS NOT NULL THEN
    v_notification_message := v_notification_message
      || E'\n\n'
      || 'Reason / Motif: '
      || v_reason;
  END IF;

  IF v_old_status IS DISTINCT FROM v_new_status
     OR v_old_reason IS DISTINCT FROM v_reason THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      related_entity_type,
      related_entity_id
    )
    VALUES (
      v_application.user_id,
      'verification_update',
      v_notification_title,
      v_notification_message,
      'provider_application',
      v_application.id
    );
  END IF;

  RETURN QUERY
  SELECT
    v_application.id,
    v_application.verification_status,
    v_application.review_reason,
    v_application.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_provider_application(
  uuid,
  text,
  text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_application(
  uuid,
  text,
  text
) TO authenticated;
