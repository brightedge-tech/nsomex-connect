CREATE OR REPLACE FUNCTION public.customer_cancel_service_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid := private.current_profile_id();
  v_request_status text;
  v_booking_id uuid;
  v_booking_status text;
BEGIN
  IF auth.uid() IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT booking.id, booking.status
  INTO v_booking_id, v_booking_status
  FROM public.bookings AS booking
  WHERE booking.request_id = p_request_id
    AND booking.customer_id = v_customer_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT request.status
    INTO v_request_status
    FROM public.service_requests AS request
    WHERE request.id = p_request_id
      AND request.customer_id = v_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Request not found or not available to this customer'
        USING ERRCODE = '42501';
    END IF;

    IF v_request_status = 'cancelled' THEN
      RETURN;
    END IF;

    IF v_booking_status NOT IN (
      'pending',
      'accepted',
      'provider_on_way',
      'arrived'
    ) THEN
      RAISE EXCEPTION 'This booking can no longer be cancelled by the customer'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.bookings
    SET status = 'cancelled'
    WHERE id = v_booking_id
      AND customer_id = v_customer_id
      AND status = v_booking_status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking status changed before cancellation'
        USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  SELECT request.status
  INTO v_request_status
  FROM public.service_requests AS request
  WHERE request.id = p_request_id
    AND request.customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or not available to this customer'
      USING ERRCODE = '42501';
  END IF;

  IF v_request_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings AS booking
    WHERE booking.request_id = p_request_id
      AND booking.customer_id = v_customer_id
  ) THEN
    RAISE EXCEPTION 'Booking was created while the request was being cancelled; retry'
      USING ERRCODE = '40001';
  END IF;

  IF v_request_status <> 'pending' THEN
    RAISE EXCEPTION 'This request can no longer be cancelled'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.service_requests
  SET status = 'cancelled'
  WHERE id = p_request_id
    AND customer_id = v_customer_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request status changed before cancellation'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_cancel_service_request(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_cancel_service_request(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.notify_service_request_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status <> 'cancelled' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    related_entity_type,
    related_entity_id,
    dedupe_key
  )
  SELECT
    provider_profile.user_id,
    'service_request',
    'A customer cancelled a service request / Un client a annulé une demande de service',
    'The customer cancelled the request. / Le client a annulé la demande.',
    'service_request',
    NEW.id,
    'service-request-cancelled:' || NEW.id::text || ':' || response.provider_id::text
  FROM public.service_request_responses AS response
  JOIN public.provider_profiles AS provider
    ON provider.id = response.provider_id
  JOIN public.profiles AS provider_profile
    ON provider_profile.id = provider.profile_id
  WHERE response.request_id = NEW.id
    AND response.status IN ('accepted', 'declined')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_service_request_cancelled()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_requests_notify_customer_cancelled
  ON public.service_requests;
CREATE TRIGGER service_requests_notify_customer_cancelled
  AFTER UPDATE OF status ON public.service_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_service_request_cancelled();
