DO $migration$
DECLARE
  v_supported_types text[] := ARRAY[
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
    'review_reminder'
  ];
  v_required_existing_types text[] := ARRAY[
    'booking_request',
    'booking_accepted',
    'booking_declined',
    'provider_on_way',
    'provider_arrived',
    'booking_completed',
    'new_message',
    'verification_update',
    'review_reminder'
  ];
  v_constraint_types text[];
  v_unknown_constraint_types text[];
  v_unknown_row_types text[];
  v_missing_existing_types text[];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.service_request_responses AS response
    WHERE response.status = 'accepted'
    GROUP BY response.request_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Resolve requests with multiple accepted provider responses before applying this migration';
  END IF;

  SELECT array_agg(DISTINCT type_match.matches[1] ORDER BY type_match.matches[1])
  INTO v_constraint_types
  FROM pg_catalog.pg_constraint AS constraint_row
  CROSS JOIN LATERAL regexp_matches(
    pg_catalog.pg_get_constraintdef(constraint_row.oid),
    $regex$'([^']*)'$regex$,
    'g'
  ) AS type_match(matches)
  WHERE constraint_row.conrelid = 'public.notifications'::regclass
    AND constraint_row.conname = 'notifications_type_check'
    AND constraint_row.contype = 'c';

  IF v_constraint_types IS NULL THEN
    RAISE EXCEPTION
      'Expected notifications_type_check was not found or did not contain a type allowlist; inspect the existing notification constraint before applying this migration';
  END IF;

  SELECT array_agg(required_type ORDER BY required_type)
  INTO v_missing_existing_types
  FROM unnest(v_required_existing_types) AS required_types(required_type)
  WHERE NOT (required_type = ANY(v_constraint_types));

  IF v_missing_existing_types IS NOT NULL THEN
    RAISE EXCEPTION
      'notifications_type_check is missing expected existing notification types: %. Inspect the constraint before applying this migration',
      v_missing_existing_types;
  END IF;

  SELECT array_agg(existing_type ORDER BY existing_type)
  INTO v_unknown_constraint_types
  FROM unnest(v_constraint_types) AS existing_types(existing_type)
  WHERE NOT (existing_type = ANY(v_supported_types));

  IF v_unknown_constraint_types IS NOT NULL THEN
    RAISE EXCEPTION
      'notifications_type_check contains additional types not preserved by this migration: %. Extend the migration allowlist before applying it',
      v_unknown_constraint_types;
  END IF;

  SELECT array_agg(DISTINCT notification.type ORDER BY notification.type)
  INTO v_unknown_row_types
  FROM public.notifications AS notification
  WHERE NOT (notification.type = ANY(v_supported_types));

  IF v_unknown_row_types IS NOT NULL THEN
    RAISE EXCEPTION
      'Existing notifications use types not preserved by this migration: %. Extend the migration allowlist before applying it',
      v_unknown_row_types;
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.provider_matches_request(
  p_provider_id uuid,
  p_request_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_requests AS sr
    JOIN public.services AS service
      ON service.id = sr.service_id
      AND service.is_active
    JOIN public.professions AS profession
      ON profession.id = service.profession_id
      AND profession.is_active
    JOIN public.service_categories AS category
      ON category.id = profession.category_id
      AND category.is_active
    JOIN public.provider_profiles AS provider
      ON provider.id = p_provider_id
      AND provider.verification_status = 'verified'
    JOIN public.profiles AS provider_profile
      ON provider_profile.id = provider.profile_id
    JOIN public.provider_applications AS application
      ON application.user_id = provider_profile.user_id
      AND application.verification_status = 'approved'
    JOIN public.provider_services AS provider_service
      ON provider_service.provider_id = provider.id
      AND provider_service.service_id = service.id
      AND provider_service.is_active
    JOIN public.provider_professions AS provider_profession
      ON provider_profession.provider_id = provider.id
      AND provider_profession.profession_id = profession.id
      AND provider_profession.verification_status = 'verified'
    JOIN public.provider_service_areas AS area
      ON area.provider_id = provider.id
      AND area.country_id = sr.country_id
      AND area.region_id = sr.region_id
      AND area.city_id = sr.city_id
      AND (
        area.neighborhood_id IS NULL
        OR area.neighborhood_id = sr.neighborhood_id
      )
    WHERE sr.id = p_request_id
  );
$$;

CREATE OR REPLACE FUNCTION private.provider_is_authorized(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_profiles AS provider
    JOIN public.profiles AS profile
      ON profile.id = provider.profile_id
      AND profile.user_id = auth.uid()
    JOIN public.provider_applications AS application
      ON application.user_id = profile.user_id
      AND application.verification_status = 'approved'
    WHERE provider.id = p_provider_id
      AND provider.verification_status = 'verified'
  );
$$;

CREATE OR REPLACE FUNCTION private.current_verified_provider_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT provider.id
  INTO v_provider_id
  FROM public.provider_profiles AS provider
  JOIN public.profiles AS profile
    ON profile.id = provider.profile_id
    AND profile.user_id = auth.uid()
  JOIN public.provider_applications AS application
    ON application.user_id = profile.user_id
    AND application.verification_status = 'approved'
  WHERE provider.verification_status = 'verified';

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'An approved and verified provider profile is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_provider_id;
END;
$$;

REVOKE ALL ON FUNCTION private.provider_matches_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.provider_is_authorized(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.current_verified_provider_id()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.can_access_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.service_requests AS sr
    WHERE sr.id = p_request_id
      AND sr.customer_id = private.current_profile_id()
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_requests AS sr
    JOIN public.provider_profiles AS provider
      ON provider.profile_id = private.current_profile_id()
    WHERE sr.id = p_request_id
      AND sr.status = 'pending'
      AND private.provider_matches_request(provider.id, sr.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS accepted_response
        WHERE accepted_response.request_id = sr.id
          AND accepted_response.status = 'accepted'
          AND accepted_response.provider_id <> provider.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS own_response
        WHERE own_response.request_id = sr.id
          AND own_response.provider_id = provider.id
          AND own_response.status IN ('declined', 'withdrawn')
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookings AS booking
    JOIN public.provider_profiles AS provider
      ON provider.id = booking.provider_id
    WHERE booking.request_id = p_request_id
      AND provider.profile_id = private.current_profile_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.provider_complete_setup(
  p_profession_ids uuid[],
  p_service_ids uuid[],
  p_service_areas jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application public.provider_applications%ROWTYPE;
  v_profile_id uuid;
  v_provider_id uuid;
  v_count bigint;
  v_valid_count bigint;
  v_unique_area_count bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.provider_applications AS application
  WHERE application.user_id = auth.uid()
    AND application.verification_status = 'approved'
  ORDER BY application.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An approved provider application is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.id
  INTO v_profile_id
  FROM public.profiles AS profile
  WHERE profile.user_id = auth.uid();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Provider account profile was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_profiles AS provider
    WHERE provider.profile_id = v_profile_id
  ) THEN
    RAISE EXCEPTION 'A provider profile already exists. Contact support to update setup.'
      USING ERRCODE = '23505';
  END IF;

  IF p_profession_ids IS NULL
     OR cardinality(p_profession_ids) NOT BETWEEN 1 AND 20
     OR p_service_ids IS NULL
     OR cardinality(p_service_ids) NOT BETWEEN 1 AND 100
     OR p_service_areas IS NULL
     OR jsonb_typeof(p_service_areas) <> 'array'
     OR jsonb_array_length(p_service_areas) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Select at least one profession, service, and service location'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT profession.id)
  INTO v_count
  FROM public.professions AS profession
  JOIN public.service_categories AS category
    ON category.id = profession.category_id
  WHERE profession.id = ANY(p_profession_ids)
    AND profession.is_active
    AND category.is_active;

  IF v_count <> cardinality(p_profession_ids) THEN
    RAISE EXCEPTION 'One or more selected professions are invalid or duplicated'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT service.id)
  INTO v_count
  FROM public.services AS service
  JOIN public.professions AS profession
    ON profession.id = service.profession_id
  JOIN public.service_categories AS category
    ON category.id = profession.category_id
  WHERE service.id = ANY(p_service_ids)
    AND service.profession_id = ANY(p_profession_ids)
    AND service.is_active
    AND profession.is_active
    AND category.is_active;

  IF v_count <> cardinality(p_service_ids) THEN
    RAISE EXCEPTION 'Each selected service must belong to a selected active profession'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE city.id IS NOT NULL
             AND region.id IS NOT NULL
             AND country.id IS NOT NULL
             AND country.is_active
             AND region.is_active
             AND city.is_active
             AND (
               area.neighborhood_id IS NULL
               OR (
                 neighborhood.id IS NOT NULL
                 AND neighborhood.is_active
               )
             )
         ),
         count(DISTINCT (
           area.city_id,
           coalesce(area.neighborhood_id, '00000000-0000-0000-0000-000000000000'::uuid)
         ))
  INTO v_count, v_valid_count, v_unique_area_count
  FROM jsonb_to_recordset(p_service_areas)
    AS area(city_id uuid, neighborhood_id uuid)
  LEFT JOIN public.cities AS city ON city.id = area.city_id
  LEFT JOIN public.regions AS region ON region.id = city.region_id
  LEFT JOIN public.countries AS country ON country.id = city.country_id
  LEFT JOIN public.neighborhoods AS neighborhood
    ON neighborhood.id = area.neighborhood_id
   AND neighborhood.city_id = city.id;

  IF v_count <> jsonb_array_length(p_service_areas)
     OR v_valid_count <> v_count
     OR v_unique_area_count <> v_count THEN
    RAISE EXCEPTION 'One or more selected service locations are invalid or duplicated'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.provider_profiles (
    profile_id,
    professional_name,
    verification_status
  )
  VALUES (
    (SELECT profile.id FROM public.profiles AS profile WHERE profile.user_id = auth.uid()),
    coalesce(nullif(btrim(v_application.business_name), ''), v_application.contact_name),
    'verified'
  )
  RETURNING id INTO v_provider_id;

  -- Application approval does not independently verify each profession.
  INSERT INTO public.provider_professions (
    provider_id,
    profession_id
  )
  SELECT v_provider_id, profession_id
  FROM unnest(p_profession_ids) AS profession_id;

  INSERT INTO public.provider_services (provider_id, service_id)
  SELECT v_provider_id, service_id
  FROM unnest(p_service_ids) AS service_id;

  INSERT INTO public.provider_service_areas (
    provider_id,
    country_id,
    region_id,
    city_id,
    neighborhood_id
  )
  SELECT
    v_provider_id,
    city.country_id,
    city.region_id,
    city.id,
    area.neighborhood_id
  FROM jsonb_to_recordset(p_service_areas)
    AS area(city_id uuid, neighborhood_id uuid)
  JOIN public.cities AS city ON city.id = area.city_id;

  RETURN v_provider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_complete_setup(uuid[], uuid[], jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_complete_setup(uuid[], uuid[], jsonb)
  TO authenticated;

CREATE UNIQUE INDEX service_request_responses_one_accepted_request
  ON public.service_request_responses (request_id)
  WHERE status = 'accepted';

CREATE OR REPLACE FUNCTION public.provider_respond_to_request(
  p_request_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
  v_request public.service_requests%ROWTYPE;
  v_existing public.service_request_responses%ROWTYPE;
  v_response_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Response must be accepted or declined'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NOT NULL AND length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Response reason must not exceed 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.service_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending'
     OR NOT private.provider_matches_request(v_provider_id, p_request_id) THEN
    RAISE EXCEPTION 'This request is not available to this provider'
      USING ERRCODE = '42501';
  END IF;

  SELECT response.*
  INTO v_existing
  FROM public.service_request_responses AS response
  WHERE response.request_id = p_request_id
    AND response.provider_id = v_provider_id;

  IF FOUND THEN
    RAISE EXCEPTION 'This provider has already responded to the request'
      USING ERRCODE = '23505';
  END IF;

  IF p_status = 'accepted'
     AND EXISTS (
       SELECT 1
       FROM public.service_request_responses AS response
       WHERE response.request_id = p_request_id
         AND response.status = 'accepted'
     ) THEN
    RAISE EXCEPTION 'Another provider has already accepted this request'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.service_request_responses (
    request_id,
    provider_id,
    status,
    response_message
  )
  VALUES (p_request_id, v_provider_id, p_status, v_reason)
  RETURNING id INTO v_response_id;

  RETURN v_response_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_respond_to_request(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_respond_to_request(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_dashboard_summary()
RETURNS TABLE (
  total_incoming bigint,
  pending_requests bigint,
  accepted_jobs bigint,
  in_progress_jobs bigint,
  completed_jobs bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT count(*)
      FROM public.service_requests AS request
      WHERE request.status = 'pending'
        AND private.provider_matches_request(v_provider_id, request.id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.service_request_responses AS accepted_response
          WHERE accepted_response.request_id = request.id
            AND accepted_response.status = 'accepted'
            AND accepted_response.provider_id <> v_provider_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.service_request_responses AS own_response
          WHERE own_response.request_id = request.id
            AND own_response.provider_id = v_provider_id
            AND own_response.status IN ('declined', 'withdrawn')
        )
    ),
    (
      SELECT count(*)
      FROM public.service_requests AS request
      WHERE request.status = 'pending'
        AND private.provider_matches_request(v_provider_id, request.id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.service_request_responses AS response
          WHERE response.request_id = request.id
        )
    ),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.provider_id = v_provider_id
        AND booking.status IN ('accepted', 'provider_on_way', 'arrived')
    ),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.provider_id = v_provider_id
        AND booking.status = 'in_progress'
    ),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.provider_id = v_provider_id
        AND booking.status = 'completed'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_dashboard_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_list_requests(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  service_id uuid,
  service_name text,
  description text,
  requested_date date,
  requested_time time,
  location text,
  country_id uuid,
  country_name text,
  region_id uuid,
  region_name text,
  city_id uuid,
  city_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  contact_name text,
  contact_phone text,
  response_status text,
  response_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
BEGIN
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
    request.id,
    request.created_at,
    request.service_id,
    service.name,
    request.description,
    request.requested_date,
    request.requested_time,
    request.location,
    request.country_id,
    country.name,
    request.region_id,
    region.name,
    request.city_id,
    city.name,
    request.neighborhood_id,
    neighborhood.name,
    request.contact_name,
    request.contact_phone,
    own_response.status,
    own_response.response_message
  FROM public.service_requests AS request
  JOIN public.services AS service ON service.id = request.service_id
  JOIN public.countries AS country ON country.id = request.country_id
  JOIN public.regions AS region ON region.id = request.region_id
  JOIN public.cities AS city ON city.id = request.city_id
  LEFT JOIN public.neighborhoods AS neighborhood
    ON neighborhood.id = request.neighborhood_id
  LEFT JOIN public.service_request_responses AS own_response
    ON own_response.request_id = request.id
   AND own_response.provider_id = v_provider_id
  WHERE request.status = 'pending'
    AND private.provider_matches_request(v_provider_id, request.id)
    AND (
      own_response.id IS NULL
      OR own_response.status = 'accepted'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.service_request_responses AS accepted_response
      WHERE accepted_response.request_id = request.id
        AND accepted_response.status = 'accepted'
        AND accepted_response.provider_id <> v_provider_id
    )
    AND (
      p_before_created_at IS NULL
      OR (request.created_at, request.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY request.created_at DESC, request.id DESC
  LIMIT p_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_list_requests(timestamptz, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_list_requests(timestamptz, uuid, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.provider_list_jobs(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  request_id uuid,
  status text,
  created_at timestamptz,
  service_name text,
  agreed_price numeric,
  currency_code text,
  scheduled_date date,
  scheduled_time time,
  location text,
  city_name text,
  customer_name text,
  customer_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_id uuid := private.current_verified_provider_id();
BEGIN
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
    booking.id,
    booking.request_id,
    booking.status,
    booking.created_at,
    service.name,
    booking.agreed_price,
    currency.code,
    booking.scheduled_date,
    booking.scheduled_time,
    booking.customer_location,
    city.name,
    coalesce(customer.display_name, concat_ws(' ', customer.first_name, customer.last_name)),
    customer.phone
  FROM public.bookings AS booking
  JOIN public.services AS service ON service.id = booking.service_id
  JOIN public.currencies AS currency ON currency.id = booking.currency_id
  JOIN public.cities AS city ON city.id = booking.city_id
  JOIN public.profiles AS customer ON customer.id = booking.customer_id
  WHERE booking.provider_id = v_provider_id
    AND (
      p_before_created_at IS NULL
      OR (booking.created_at, booking.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY booking.created_at DESC, booking.id DESC
  LIMIT p_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_list_jobs(timestamptz, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_list_jobs(timestamptz, uuid, integer)
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
  IF p_status IS NULL
     OR p_status NOT IN (
       'accepted',
       'provider_on_way',
       'arrived',
       'in_progress',
       'completed',
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
    WHEN 'in_progress' THEN p_status = 'completed'
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

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
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
      'review_reminder'
    )
  );

CREATE OR REPLACE FUNCTION private.notify_service_request_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_user_id uuid;
  v_title text;
  v_message text;
BEGIN
  SELECT profile.user_id
  INTO v_customer_user_id
  FROM public.service_requests AS request
  JOIN public.profiles AS profile ON profile.id = request.customer_id
  WHERE request.id = NEW.request_id;

  IF v_customer_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := CASE NEW.status
    WHEN 'accepted' THEN 'A provider accepted your request / Un prestataire accepte votre demande'
    WHEN 'declined' THEN 'Provider response / Réponse du prestataire'
    ELSE 'Provider response update / Mise à jour du prestataire'
  END;
  v_message := CASE NEW.status
    WHEN 'accepted' THEN 'A provider is interested in your service request. / Un prestataire est intéressé par votre demande.'
    WHEN 'declined' THEN 'A provider is unable to take your request. / Un prestataire ne peut pas prendre votre demande.'
    ELSE 'Your provider response has changed. / La réponse du prestataire a changé.'
  END;

  IF NEW.response_message IS NOT NULL THEN
    v_message := left(v_message || E'\n\n' || NEW.response_message, 5000);
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    related_entity_type,
    related_entity_id
  )
  VALUES (
    v_customer_user_id,
    'provider_response',
    v_title,
    v_message,
    'service_request',
    NEW.request_id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER service_request_responses_notify_customer
  AFTER INSERT ON public.service_request_responses
  FOR EACH ROW EXECUTE FUNCTION private.notify_service_request_response();

REVOKE ALL ON FUNCTION private.notify_service_request_response()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_booking_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_user_id uuid;
  v_provider_user_id uuid;
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

  v_title := CASE NEW.status
    WHEN 'in_progress' THEN 'Your job is in progress / Votre prestation a commencé'
    WHEN 'completed' THEN 'Your job is complete / Votre prestation est terminée'
    WHEN 'cancelled' THEN 'Your booking was cancelled / Votre réservation a été annulée'
    WHEN 'provider_on_way' THEN 'Your provider is on the way / Votre prestataire est en route'
    WHEN 'arrived' THEN 'Your provider has arrived / Votre prestataire est arrivé'
    ELSE 'Booking status updated / Statut de réservation mis à jour'
  END;
  v_message := v_title;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    related_entity_type,
    related_entity_id
  )
  VALUES (
    v_customer_user_id,
    'booking_status_update',
    v_title,
    v_message,
    'booking',
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_notify_provider
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.notify_booking_activity();

CREATE TRIGGER bookings_notify_customer_status
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_booking_activity();

REVOKE ALL ON FUNCTION private.notify_booking_activity()
  FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS service_requests_status_created_id_idx
  ON public.service_requests (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS provider_service_areas_eligibility_idx
  ON public.provider_service_areas (
    provider_id,
    country_id,
    region_id,
    city_id,
    neighborhood_id
  );

CREATE INDEX IF NOT EXISTS provider_applications_approved_user_idx
  ON public.provider_applications (user_id)
  WHERE verification_status = 'approved';

CREATE OR REPLACE FUNCTION public.start_conversation(
  p_booking_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_provider_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_conversation_id uuid;
  v_customer_user_id uuid;
  v_provider_id uuid;
  v_provider_user_id uuid;
  v_customer_profile_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '42501';
  END IF;

  IF (p_booking_id IS NULL) = (p_request_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one booking or service request'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_id IS NOT NULL THEN
    SELECT customer.user_id, booking.provider_id, provider_profile.user_id
    INTO v_customer_user_id, v_provider_id, v_provider_user_id
    FROM public.bookings AS booking
    JOIN public.profiles AS customer ON customer.id = booking.customer_id
    JOIN public.provider_profiles AS provider ON provider.id = booking.provider_id
    JOIN public.profiles AS provider_profile ON provider_profile.id = provider.profile_id
    WHERE booking.id = p_booking_id;

    IF v_customer_user_id IS NULL
       OR v_actor NOT IN (v_customer_user_id, v_provider_user_id) THEN
      RAISE EXCEPTION 'Only booking participants can start its conversation'
        USING ERRCODE = '42501';
    END IF;

    SELECT profile.id
    INTO v_customer_profile_id
    FROM public.profiles AS profile
    WHERE profile.user_id = v_actor;

    INSERT INTO public.conversations (booking_id, provider_id, created_by)
    VALUES (p_booking_id, v_provider_id, v_customer_profile_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT conversation.id
      INTO v_conversation_id
      FROM public.conversations AS conversation
      WHERE conversation.booking_id = p_booking_id;
    END IF;
  ELSE
    IF p_provider_id IS NULL THEN
      RAISE EXCEPTION 'A provider is required for a service request conversation'
        USING ERRCODE = '22023';
    END IF;

    SELECT customer.id, customer.user_id, provider_profile.user_id
    INTO v_customer_profile_id, v_customer_user_id, v_provider_user_id
    FROM public.service_requests AS request
    JOIN public.profiles AS customer ON customer.id = request.customer_id
    JOIN public.provider_profiles AS provider ON provider.id = p_provider_id
    JOIN public.profiles AS provider_profile ON provider_profile.id = provider.profile_id
    WHERE request.id = p_request_id
      AND request.status = 'pending'
      AND private.provider_matches_request(provider.id, request.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS accepted_response
        WHERE accepted_response.request_id = request.id
          AND accepted_response.status = 'accepted'
          AND accepted_response.provider_id <> provider.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS response
        WHERE response.request_id = request.id
          AND response.provider_id = provider.id
          AND response.status IN ('declined', 'withdrawn')
      );

    IF v_customer_user_id IS NULL
       OR v_actor NOT IN (v_customer_user_id, v_provider_user_id) THEN
      RAISE EXCEPTION 'Only the requesting customer or an eligible provider can start this conversation'
        USING ERRCODE = '42501';
    END IF;

    SELECT profile.id
    INTO v_customer_profile_id
    FROM public.profiles AS profile
    WHERE profile.user_id = v_actor;

    INSERT INTO public.conversations (request_id, provider_id, created_by)
    VALUES (p_request_id, p_provider_id, v_customer_profile_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT conversation.id
      INTO v_conversation_id
      FROM public.conversations AS conversation
      WHERE conversation.request_id = p_request_id
        AND conversation.provider_id = p_provider_id;
    END IF;
  END IF;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Could not create or locate the conversation'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES
    (v_conversation_id, v_customer_user_id),
    (v_conversation_id, v_provider_user_id)
  ON CONFLICT DO NOTHING;

  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_conversation(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_conversation(uuid, uuid, uuid)
  TO authenticated;
