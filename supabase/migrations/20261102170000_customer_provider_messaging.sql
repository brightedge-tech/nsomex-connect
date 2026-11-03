CREATE POLICY messages_participants_select_only
  ON public.messages AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (private.is_conversation_participant(conversation_id));

CREATE POLICY messages_participants_insert_only
  ON public.messages AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND private.is_conversation_participant(conversation_id)
  );

CREATE OR REPLACE FUNCTION public.list_my_conversations(
  p_before_updated_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  conversation_id uuid,
  booking_id uuid,
  request_id uuid,
  provider_id uuid,
  updated_at timestamptz,
  other_party_name text,
  service_name text,
  latest_message_id uuid,
  latest_message_text text,
  latest_message_sender_id uuid,
  latest_message_created_at timestamptz,
  unread_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF (p_before_updated_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Both conversation cursor values must be supplied together'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.booking_id,
    conversation.request_id,
    coalesce(conversation.provider_id, booking.provider_id),
    conversation.updated_at,
    CASE
      WHEN provider_user.user_id = v_user_id THEN
        coalesce(
          nullif(btrim(request.contact_name), ''),
          nullif(btrim(concat_ws(' ', customer.first_name, customer.last_name)), ''),
          nullif(btrim(customer.display_name), ''),
          'Customer'
        )
      ELSE
        coalesce(
          nullif(btrim(directory.professional_name), ''),
          nullif(btrim(directory.display_name), ''),
          'Service provider'
        )
    END,
    service.name,
    latest_message.id,
    latest_message.message_text,
    latest_message.sender_id,
    latest_message.created_at,
    (
      SELECT count(*)
      FROM public.messages AS unread
      WHERE unread.conversation_id = conversation.id
        AND unread.sender_id <> v_user_id
        AND unread.read_at IS NULL
    )
  FROM public.conversations AS conversation
  JOIN public.conversation_participants AS participant
    ON participant.conversation_id = conversation.id
   AND participant.user_id = v_user_id
  LEFT JOIN public.bookings AS booking
    ON booking.id = conversation.booking_id
  LEFT JOIN public.service_requests AS request
    ON request.id = coalesce(conversation.request_id, booking.request_id)
  LEFT JOIN public.profiles AS customer
    ON customer.id = coalesce(request.customer_id, booking.customer_id)
  LEFT JOIN public.provider_profiles AS provider
    ON provider.id = coalesce(conversation.provider_id, booking.provider_id)
  LEFT JOIN public.profiles AS provider_user
    ON provider_user.id = provider.profile_id
  LEFT JOIN public.provider_directory AS directory
    ON directory.provider_id = provider.id
  LEFT JOIN public.services AS service
    ON service.id = coalesce(request.service_id, booking.service_id)
  LEFT JOIN LATERAL (
    SELECT message.id, message.message_text, message.sender_id, message.created_at
    FROM public.messages AS message
    WHERE message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON true
  WHERE (p_before_updated_at IS NULL
      OR (conversation.updated_at, conversation.id) < (p_before_updated_at, p_before_id))
  ORDER BY conversation.updated_at DESC, conversation.id DESC
  LIMIT least(greatest(coalesce(p_page_size, 25), 1), 50);
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_conversations(timestamptz, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_conversations(timestamptz, uuid, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'Conversation not found or not available to this user'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.messages
  SET read_at = coalesce(read_at, now())
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_user_id
    AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

ALTER TABLE public.messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION
      'Supabase Realtime publication is missing; enable Realtime before applying messaging migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
      AND pubinsert
      AND pubupdate
  ) THEN
    RAISE EXCEPTION
      'Supabase Realtime publication must publish INSERT and UPDATE events for messages.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END;
$$;
