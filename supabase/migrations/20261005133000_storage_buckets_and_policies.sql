INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('provider-avatars', 'provider-avatars', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('service-images', 'service-images', true, 20971520,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('provider-documents', 'provider-documents', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]),
  ('service-request-attachments', 'service-request-attachments', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]),
  ('chat-attachments', 'chat-attachments', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY provider_avatars_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY provider_avatars_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY provider_avatars_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY service_images_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'service-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.profiles AS p ON p.id = pp.profile_id
      JOIN public.provider_services AS ps
        ON ps.provider_id = pp.id AND ps.is_active
      JOIN public.services AS s
        ON s.id = ps.service_id AND s.is_active
      WHERE p.user_id = auth.uid()
        AND pp.id::text = (storage.foldername(name))[1]
        AND s.id::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY service_images_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'service-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.profiles AS p ON p.id = pp.profile_id
      JOIN public.provider_services AS ps
        ON ps.provider_id = pp.id AND ps.is_active
      JOIN public.services AS s
        ON s.id = ps.service_id AND s.is_active
      WHERE p.user_id = auth.uid()
        AND pp.id::text = (storage.foldername(name))[1]
        AND s.id::text = (storage.foldername(name))[2]
    )
  )
  WITH CHECK (
    bucket_id = 'service-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.profiles AS p ON p.id = pp.profile_id
      JOIN public.provider_services AS ps
        ON ps.provider_id = pp.id AND ps.is_active
      JOIN public.services AS s
        ON s.id = ps.service_id AND s.is_active
      WHERE p.user_id = auth.uid()
        AND pp.id::text = (storage.foldername(name))[1]
        AND s.id::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY service_images_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.profiles AS p ON p.id = pp.profile_id
      JOIN public.provider_services AS ps
        ON ps.provider_id = pp.id AND ps.is_active
      JOIN public.services AS s
        ON s.id = ps.service_id AND s.is_active
      WHERE p.user_id = auth.uid()
        AND pp.id::text = (storage.foldername(name))[1]
        AND s.id::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY provider_documents_owner_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.is_admin()
    )
  );

CREATE POLICY provider_documents_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.profiles AS p ON p.id = pp.profile_id
      WHERE pp.id::text = (storage.foldername(name))[2]
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY request_attachments_related_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'service-request-attachments'
    AND (
      private.can_access_request_path((storage.foldername(name))[1])
      OR private.is_admin()
    )
  );

CREATE POLICY request_attachments_customer_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'service-request-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.service_requests AS sr
      WHERE sr.id::text = (storage.foldername(name))[1]
        AND sr.customer_id = private.current_profile_id()
        AND sr.status = 'pending'
    )
  );

CREATE POLICY request_attachments_customer_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-request-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.service_requests AS sr
      WHERE sr.id::text = (storage.foldername(name))[1]
        AND sr.customer_id = private.current_profile_id()
    )
  );

CREATE POLICY chat_attachments_participant_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND private.is_conversation_participant_path((storage.foldername(name))[1])
  );

CREATE POLICY chat_attachments_participant_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND private.is_conversation_participant_path((storage.foldername(name))[1])
  );

CREATE POLICY chat_attachments_participant_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND private.is_conversation_participant_path((storage.foldername(name))[1])
  );

CREATE POLICY provider_documents_admin_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'provider-documents' AND private.is_admin());
