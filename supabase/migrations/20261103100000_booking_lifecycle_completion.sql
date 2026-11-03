ALTER TABLE public.service_requests
  DROP CONSTRAINT service_requests_status_check,
  ADD CONSTRAINT service_requests_status_check
    CHECK (status IN (
      'pending',
      'accepted',
      'declined',
      'cancelled',
      'in_progress',
      'provider_completed',
      'completed',
      'disputed'
    ));

ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_status_check,
  ADD CONSTRAINT bookings_status_check
    CHECK (status IN (
      'pending',
      'accepted',
      'provider_on_way',
      'arrived',
      'in_progress',
      'provider_completed',
      'completed',
      'cancelled',
      'disputed'
    )),
  DROP CONSTRAINT bookings_started_at_check,
  ADD CONSTRAINT bookings_started_at_check
    CHECK (started_at IS NULL OR status IN (
      'in_progress',
      'provider_completed',
      'completed',
      'disputed'
    )),
  DROP CONSTRAINT bookings_completed_at_check,
  ADD CONSTRAINT bookings_completed_at_check
    CHECK (completed_at IS NULL OR status IN (
      'provider_completed',
      'completed',
      'disputed'
    ));

ALTER TABLE public.booking_status_history
  DROP CONSTRAINT booking_status_history_new_status_check,
  ADD CONSTRAINT booking_status_history_new_status_check
    CHECK (new_status IN (
      'pending',
      'accepted',
      'provider_on_way',
      'arrived',
      'in_progress',
      'provider_completed',
      'completed',
      'cancelled',
      'disputed'
    ));

CREATE OR REPLACE FUNCTION private.sync_request_status_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_status text;
BEGIN
  IF NEW.request_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_request_status := CASE NEW.status
    WHEN 'pending' THEN 'accepted'
    WHEN 'accepted' THEN 'accepted'
    WHEN 'provider_on_way' THEN 'accepted'
    WHEN 'arrived' THEN 'accepted'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'provider_completed' THEN 'provider_completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'disputed' THEN 'disputed'
    ELSE NULL
  END;

  IF v_request_status IS NOT NULL THEN
    UPDATE public.service_requests
    SET status = v_request_status
    WHERE id = NEW.request_id
      AND status IS DISTINCT FROM v_request_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_booking_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_customer_user_id uuid;
  v_provider_user_id uuid;
  v_request_customer_id uuid;
  v_request_service_id uuid;
  v_provider_owns boolean;
  v_customer_owns boolean;
  v_schedule_changed boolean;
  v_allowed_transition boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.started_at IS NOT NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bookings must be created in the pending state'
        USING ERRCODE = '23514';
    END IF;

    SELECT profile.user_id
    INTO v_customer_user_id
    FROM public.profiles AS profile
    WHERE profile.id = NEW.customer_id;

    IF v_customer_user_id IS NULL THEN
      RAISE EXCEPTION 'Booking customer must exist'
        USING ERRCODE = '23503';
    END IF;

    IF v_actor IS NOT NULL
       AND NOT private.is_admin()
       AND v_actor <> v_customer_user_id THEN
      RAISE EXCEPTION 'Only the booking customer can create a booking'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.request_id IS NOT NULL THEN
      SELECT request.customer_id, request.service_id
      INTO v_request_customer_id, v_request_service_id
      FROM public.service_requests AS request
      WHERE request.id = NEW.request_id
        AND request.status = 'pending';

      IF v_request_customer_id IS NULL
         OR v_request_customer_id <> NEW.customer_id
         OR v_request_service_id <> NEW.service_id
         OR NOT EXISTS (
           SELECT 1
           FROM public.service_request_responses AS response
           WHERE response.request_id = NEW.request_id
             AND response.provider_id = NEW.provider_id
             AND response.status = 'accepted'
         ) THEN
        RAISE EXCEPTION 'Booking must match an open request accepted by the specified provider'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.provider_services AS provider_service
      JOIN public.services AS service
        ON service.id = provider_service.service_id
      JOIN public.provider_profiles AS provider
        ON provider.id = provider_service.provider_id
      WHERE provider_service.provider_id = NEW.provider_id
        AND provider_service.service_id = NEW.service_id
        AND provider_service.is_active
        AND service.is_active
        AND provider.verification_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'Provider must actively offer the booked service'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.agreed_price IS DISTINCT FROM OLD.agreed_price
     OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
     OR NEW.country_id IS DISTINCT FROM OLD.country_id
     OR NEW.region_id IS DISTINCT FROM OLD.region_id
     OR NEW.city_id IS DISTINCT FROM OLD.city_id
     OR NEW.neighborhood_id IS DISTINCT FROM OLD.neighborhood_id
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude
     OR NEW.customer_location IS DISTINCT FROM OLD.customer_location
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Booking identity, agreed price, and location are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    RAISE EXCEPTION 'Booking lifecycle timestamps are managed by the database'
      USING ERRCODE = '23514';
  END IF;

  v_schedule_changed :=
    NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
    OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
    OR NEW.time_zone IS DISTINCT FROM OLD.time_zone;

  IF v_schedule_changed AND OLD.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'The schedule cannot be changed after a booking has started'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT profile.user_id
    INTO v_provider_user_id
    FROM public.provider_profiles AS provider
    JOIN public.profiles AS profile ON profile.id = provider.profile_id
    WHERE provider.id = NEW.provider_id;

    SELECT profile.user_id
    INTO v_customer_user_id
    FROM public.profiles AS profile
    WHERE profile.id = NEW.customer_id;

    v_provider_owns := v_actor = v_provider_user_id;
    v_customer_owns := v_actor = v_customer_user_id;

    v_allowed_transition := CASE OLD.status
      WHEN 'pending' THEN
        (NEW.status = 'accepted' AND v_provider_owns)
        OR (NEW.status = 'cancelled' AND (v_provider_owns OR v_customer_owns))
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'accepted' THEN
        (NEW.status = 'provider_on_way' AND v_provider_owns)
        OR (NEW.status = 'cancelled' AND (v_provider_owns OR v_customer_owns))
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'provider_on_way' THEN
        (NEW.status = 'arrived' AND v_provider_owns)
        OR (NEW.status = 'cancelled' AND (v_provider_owns OR v_customer_owns))
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'arrived' THEN
        (NEW.status = 'in_progress' AND v_provider_owns)
        OR (NEW.status = 'cancelled' AND (v_provider_owns OR v_customer_owns))
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'in_progress' THEN
        (NEW.status = 'provider_completed' AND v_provider_owns)
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'provider_completed' THEN
        (NEW.status = 'completed' AND v_customer_owns)
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'completed' THEN
        NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns)
      ELSE false
    END;

    IF v_actor IS NOT NULL AND NOT private.is_admin() AND NOT v_allowed_transition THEN
      RAISE EXCEPTION 'Invalid booking status transition for this user'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'in_progress' THEN
      NEW.started_at := coalesce(OLD.started_at, now());
    ELSIF NEW.status = 'provider_completed' THEN
      NEW.started_at := coalesce(OLD.started_at, now());
      NEW.completed_at := coalesce(OLD.completed_at, now());
    ELSIF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_create_booking(
  p_request_id uuid,
  p_agreed_price numeric,
  p_currency_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid := private.current_profile_id();
  v_request public.service_requests%ROWTYPE;
  v_provider_id uuid;
  v_booking_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
     OR p_currency_id IS NULL
     OR p_agreed_price IS NULL
     OR p_agreed_price < 0
     OR p_agreed_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'A request, non-negative agreed price, and currency are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.service_requests AS request
  WHERE request.id = p_request_id
    AND request.customer_id = v_customer_id
    AND request.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or no longer available'
      USING ERRCODE = '42501';
  END IF;

  SELECT response.provider_id
  INTO v_provider_id
  FROM public.service_request_responses AS response
  WHERE response.request_id = v_request.id
    AND response.status = 'accepted';

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'An accepted provider offer is required'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.currencies AS currency
    WHERE currency.id = p_currency_id
      AND currency.is_active
  ) THEN
    RAISE EXCEPTION 'The selected currency is not active'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.bookings (
    request_id,
    customer_id,
    provider_id,
    service_id,
    agreed_price,
    currency_id,
    scheduled_date,
    scheduled_time,
    time_zone,
    customer_location,
    country_id,
    region_id,
    city_id,
    neighborhood_id,
    latitude,
    longitude
  )
  VALUES (
    v_request.id,
    v_customer_id,
    v_provider_id,
    v_request.service_id,
    p_agreed_price,
    p_currency_id,
    v_request.requested_date,
    v_request.requested_time,
    v_request.time_zone,
    v_request.location,
    v_request.country_id,
    v_request.region_id,
    v_request.city_id,
    v_request.neighborhood_id,
    v_request.latitude,
    v_request.longitude
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_create_booking(uuid, numeric, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_create_booking(uuid, numeric, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_awaiting_customer_confirmation_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
BEGIN
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'A verified provider account is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT count(*)
    FROM public.bookings AS booking
    WHERE booking.provider_id = v_provider_id
      AND booking.status = 'provider_completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_awaiting_customer_confirmation_count()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_awaiting_customer_confirmation_count()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_update_booking_status(
  p_booking_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
  v_booking public.bookings%ROWTYPE;
  v_transition_allowed boolean := false;
BEGIN
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'A verified provider account is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL
     OR p_status NOT IN (
       'accepted',
       'provider_on_way',
       'arrived',
       'in_progress',
       'provider_completed',
       'cancelled'
     ) THEN
    RAISE EXCEPTION 'Unsupported provider booking status'
      USING ERRCODE = '22023';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.provider_id = v_provider_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or not available to this provider'
      USING ERRCODE = '42501';
  END IF;

  v_transition_allowed := CASE v_booking.status
    WHEN 'pending' THEN p_status = 'accepted'
    WHEN 'accepted' THEN p_status IN ('provider_on_way', 'cancelled')
    WHEN 'provider_on_way' THEN p_status IN ('arrived', 'cancelled')
    WHEN 'arrived' THEN p_status IN ('in_progress', 'cancelled')
    WHEN 'in_progress' THEN p_status = 'provider_completed'
    ELSE false
  END;

  IF NOT v_transition_allowed THEN
    RAISE EXCEPTION 'Invalid booking status transition from % to %',
      v_booking.status, p_status
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.bookings AS booking
  SET status = p_status
  WHERE booking.id = p_booking_id
    AND booking.provider_id = v_provider_id
    AND booking.status = v_booking.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking status changed before the requested transition'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_booking_status(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_update_booking_status(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_confirm_booking_completion(
  p_booking_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid := private.current_profile_id();
BEGIN
  IF auth.uid() IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings AS booking
  SET status = 'completed'
  WHERE booking.id = p_booking_id
    AND booking.customer_id = v_customer_id
    AND booking.status = 'provider_completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or not awaiting your completion confirmation'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_confirm_booking_completion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_confirm_booking_completion(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_submit_booking_review(
  p_booking_id uuid,
  p_rating smallint,
  p_comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_id uuid := private.current_profile_id();
  v_provider_id uuid;
  v_review_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5
     OR length(p_comment) > 5000 THEN
    RAISE EXCEPTION 'A rating from 1 to 5 and a comment of at most 5000 characters are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT booking.provider_id
  INTO v_provider_id
  FROM public.bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.customer_id = v_customer_id
    AND booking.status = 'completed';

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'Only a customer with a confirmed completed booking can submit a review'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reviews (
    booking_id,
    customer_id,
    provider_id,
    rating,
    comment
  )
  VALUES (
    p_booking_id,
    v_customer_id,
    v_provider_id,
    p_rating,
    nullif(btrim(p_comment), '')
  )
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_submit_booking_review(uuid, smallint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_submit_booking_review(uuid, smallint, text)
  TO authenticated;

DROP POLICY IF EXISTS bookings_insert_customer ON public.bookings;
DROP POLICY IF EXISTS bookings_update_participant ON public.bookings;
REVOKE INSERT, UPDATE ON public.bookings FROM authenticated;
GRANT SELECT ON public.bookings TO authenticated;

DROP POLICY IF EXISTS reviews_insert_completed_customer_booking ON public.reviews;
REVOKE INSERT ON public.reviews FROM authenticated;
GRANT SELECT ON public.reviews TO authenticated;

CREATE OR REPLACE FUNCTION private.notify_booking_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_user_id uuid;
  v_provider_user_id uuid;
  v_recipient_user_id uuid;
  v_title text;
  v_message text;
BEGIN
  SELECT customer.user_id, provider_profile.user_id
  INTO v_customer_user_id, v_provider_user_id
  FROM public.bookings AS booking
  JOIN public.profiles AS customer ON customer.id = booking.customer_id
  JOIN public.provider_profiles AS provider ON provider.id = booking.provider_id
  JOIN public.profiles AS provider_profile ON provider_profile.id = provider.profile_id
  WHERE booking.id = NEW.id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      related_entity_type,
      related_entity_id
    )
    VALUES (
      v_provider_user_id,
      'booking_request',
      'A customer selected your offer / Un client a choisi votre offre',
      'Review the new booking and schedule. / Consultez la nouvelle réservation et son horaire.',
      'booking',
      NEW.id
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = v_customer_user_id THEN
    v_recipient_user_id := v_provider_user_id;
  ELSE
    v_recipient_user_id := v_customer_user_id;
  END IF;

  v_title := CASE NEW.status
    WHEN 'accepted' THEN 'Your booking was accepted / Votre réservation a été acceptée'
    WHEN 'provider_on_way' THEN 'Your provider is on the way / Votre prestataire est en route'
    WHEN 'arrived' THEN 'Your provider has arrived / Votre prestataire est arrivé'
    WHEN 'in_progress' THEN 'Your job is in progress / Votre prestation a commencé'
    WHEN 'provider_completed' THEN 'Your provider marked the job complete / Le prestataire a terminé la prestation'
    WHEN 'completed' THEN 'The customer confirmed completion / Le client a confirmé la fin de la prestation'
    WHEN 'cancelled' THEN 'Your booking was cancelled / Votre réservation a été annulée'
    ELSE 'Booking status updated / Statut de réservation mis à jour'
  END;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    related_entity_type,
    related_entity_id
  )
  VALUES (
    v_recipient_user_id,
    'booking_status_update',
    v_title,
    v_title,
    'booking',
    NEW.id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_booking_activity()
  FROM PUBLIC, anon, authenticated;
