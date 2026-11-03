ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_unique
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'booking_request',
      'booking_accepted',
      'booking_declined',
      'provider_on_way',
      'provider_arrived',
      'booking_completed',
      'booking_status_update',
      'provider_response',
      'new_message',
      'verification_update',
      'review_reminder',
      'service_request'
    ));

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT false,
  service_requests boolean NOT NULL DEFAULT true,
  provider_responses boolean NOT NULL DEFAULT true,
  booking_updates boolean NOT NULL DEFAULT true,
  messages boolean NOT NULL DEFAULT true,
  verification_updates boolean NOT NULL DEFAULT true,
  preferred_language text NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'fr')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_read_self
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY notification_preferences_insert_self
  ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY notification_preferences_update_self
  ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT ON public.notification_preferences TO service_role;

CREATE OR REPLACE FUNCTION private.touch_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_touch_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.touch_notification_preferences();

REVOKE ALL ON FUNCTION private.touch_notification_preferences()
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE
    CHECK (expo_push_token ~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,}\]$'),
  platform text NOT NULL DEFAULT 'android' CHECK (platform = 'android'),
  device_name text CHECK (device_name IS NULL OR length(device_name) <= 200),
  is_active boolean NOT NULL DEFAULT true,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_devices_user_active_idx
  ON public.push_devices (user_id, last_registered_at DESC)
  WHERE is_active;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.push_devices TO service_role;

CREATE OR REPLACE FUNCTION public.register_push_device(
  p_expo_push_token text,
  p_device_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_device_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_expo_push_token IS NULL
     OR p_expo_push_token !~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,}\]$'
     OR length(p_device_name) > 200 THEN
    RAISE EXCEPTION 'A valid Expo push token and device name are required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.push_devices (
    user_id,
    expo_push_token,
    device_name,
    platform,
    is_active,
    last_registered_at,
    updated_at
  )
  VALUES (
    v_user_id,
    p_expo_push_token,
    nullif(btrim(p_device_name), ''),
    'android',
    true,
    now(),
    now()
  )
  ON CONFLICT (expo_push_token) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      device_name = EXCLUDED.device_name,
      platform = EXCLUDED.platform,
      is_active = true,
      last_registered_at = now(),
      updated_at = now()
  WHERE public.push_devices.user_id = v_user_id
  RETURNING id INTO v_device_id;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'Push token is already registered to another user'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_expo_push_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.push_devices
  SET is_active = false,
      updated_at = now()
  WHERE user_id = auth.uid()
    AND expo_push_token = p_expo_push_token
    AND is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_push_device(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text)
  TO authenticated;

CREATE TABLE public.push_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid NOT NULL UNIQUE
    REFERENCES public.notifications (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL))
);

CREATE INDEX push_outbox_pending_idx
  ON public.push_outbox (available_at, id)
  WHERE status = 'pending';

CREATE TABLE public.push_delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id uuid NOT NULL
    REFERENCES public.notifications (id) ON DELETE CASCADE,
  push_device_id uuid NOT NULL
    REFERENCES public.push_devices (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'sending',
      'ticketed',
      'delivered',
      'failed',
      'invalid_token'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  expo_ticket_id text UNIQUE,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, push_device_id)
);

CREATE INDEX push_delivery_receipts_idx
  ON public.push_delivery_attempts (created_at, id)
  WHERE status = 'ticketed';
CREATE INDEX push_delivery_pending_idx
  ON public.push_delivery_attempts (notification_id, id)
  WHERE status = 'pending';

ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox, public.push_delivery_attempts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.push_outbox, public.push_delivery_attempts
  TO service_role;
GRANT SELECT ON public.notifications, public.profiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.push_outbox_id_seq,
  public.push_delivery_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.push_outbox (notification_id)
  VALUES (NEW.id)
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_notification_push();

REVOKE ALL ON FUNCTION private.enqueue_notification_push()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_new_service_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_user_id uuid;
BEGIN
  FOR v_provider_user_id IN
    SELECT provider_profile.user_id
    FROM public.provider_profiles AS provider
    JOIN public.profiles AS provider_profile
      ON provider_profile.id = provider.profile_id
    WHERE private.provider_matches_request(provider.id, NEW.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS own_response
        WHERE own_response.request_id = NEW.id
          AND own_response.provider_id = provider.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS accepted_response
        WHERE accepted_response.request_id = NEW.id
          AND accepted_response.status = 'accepted'
      )
  LOOP
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      related_entity_type,
      related_entity_id,
      dedupe_key
    )
    VALUES (
      v_provider_user_id,
      'service_request',
      'A new service request is available / Une nouvelle demande de service est disponible',
      'A customer near your service area requested a service you offer. / Un client de votre zone a demandé un service que vous proposez.',
      'service_request',
      NEW.id,
      'service-request:' || NEW.id::text || ':' || v_provider_user_id::text
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER service_requests_notify_matching_providers
  AFTER INSERT ON public.service_requests
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION private.notify_new_service_request();

REVOKE ALL ON FUNCTION private.notify_new_service_request()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recipient_user_id uuid;
BEGIN
  FOR v_recipient_user_id IN
    SELECT participant.user_id
    FROM public.conversation_participants AS participant
    WHERE participant.conversation_id = NEW.conversation_id
      AND participant.user_id <> NEW.sender_id
  LOOP
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      related_entity_type,
      related_entity_id,
      dedupe_key
    )
    VALUES (
      v_recipient_user_id,
      'new_message',
      'New message / Nouveau message',
      'You received a new message. / Vous avez reçu un nouveau message.',
      'conversation',
      NEW.conversation_id,
      'message:' || NEW.id::text || ':' || v_recipient_user_id::text
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_notify_other_participants
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.notify_new_message();

REVOKE ALL ON FUNCTION private.notify_new_message()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_push_outbox(p_limit integer DEFAULT 25)
RETURNS TABLE (id bigint, notification_id uuid, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM public.push_outbox AS outbox
    WHERE outbox.status = 'pending'
      AND outbox.available_at <= now()
      AND outbox.attempt_count < 8
    ORDER BY outbox.available_at, outbox.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.push_outbox AS outbox
  SET status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      locked_at = now(),
      last_error = NULL
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.id, outbox.notification_id, outbox.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_outbox(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_outbox(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_delivery_attempts(
  p_notification_id uuid,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id bigint,
  push_device_id uuid,
  expo_push_token text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_notification_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'A notification and valid batch size are required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT attempt.id
    FROM public.push_delivery_attempts AS attempt
    JOIN public.push_devices AS device
      ON device.id = attempt.push_device_id
     AND device.is_active
    WHERE attempt.notification_id = p_notification_id
      AND attempt.status = 'pending'
      AND attempt.attempt_count < 8
    ORDER BY attempt.id
    FOR UPDATE OF attempt SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.push_delivery_attempts AS attempt
  SET status = 'sending',
      attempt_count = attempt.attempt_count + 1,
      updated_at = now(),
      last_error = NULL
  FROM candidates, public.push_devices AS device
  WHERE attempt.id = candidates.id
    AND device.id = attempt.push_device_id
    AND device.is_active
  RETURNING attempt.id, attempt.push_device_id, device.expo_push_token,
    attempt.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery_attempts(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_attempts(uuid, integer)
  TO service_role;
