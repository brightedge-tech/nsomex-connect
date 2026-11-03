CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
  FROM public.profiles AS p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.owns_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_profile_id
      AND p.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.owns_provider(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_profiles AS pp
    JOIN public.profiles AS p ON p.id = pp.profile_id
    WHERE pp.id = p_provider_id
      AND p.user_id = auth.uid()
  );
$$;

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
    JOIN public.profiles AS customer ON customer.id = sr.customer_id
    WHERE sr.id = p_request_id
      AND customer.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_requests AS sr
    JOIN public.provider_services AS ps
      ON ps.service_id = sr.service_id
      AND ps.is_active
    JOIN public.provider_profiles AS pp
      ON pp.id = ps.provider_id
      AND pp.verification_status = 'verified'
    JOIN public.profiles AS provider ON provider.id = pp.profile_id
    WHERE sr.id = p_request_id
      AND sr.status = 'pending'
      AND provider.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookings AS b
    JOIN public.provider_profiles AS pp ON pp.id = b.provider_id
    JOIN public.profiles AS provider ON provider.id = pp.profile_id
    WHERE b.request_id = p_request_id
      AND provider.user_id = auth.uid()
  );
$$;

-- Providers can see an open request before booking; after selection, only the
-- provider on its booking retains access to the request and attachments.
CREATE OR REPLACE FUNCTION private.can_access_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings AS b
    JOIN public.profiles AS customer ON customer.id = b.customer_id
    WHERE b.id = p_booking_id
      AND customer.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookings AS b
    JOIN public.provider_profiles AS pp ON pp.id = b.provider_id
    JOIN public.profiles AS provider ON provider.id = pp.profile_id
    WHERE b.id = p_booking_id
      AND provider.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants AS cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_request_path(p_request_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN private.can_access_request(p_request_id::uuid);
END;
$$;

CREATE OR REPLACE FUNCTION private.is_conversation_participant_path(p_conversation_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_conversation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN private.is_conversation_participant(p_conversation_id::uuid);
END;
$$;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

CREATE OR REPLACE FUNCTION private.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM NEW.role
     AND auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can grant the administrator role'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change an administrator role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_guard_role
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_profile_role();

CREATE OR REPLACE FUNCTION private.guard_provider_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Provider verification status can only be changed by an administrator'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_profiles_guard_verification
  BEFORE UPDATE OF verification_status ON public.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_provider_verification();

CREATE TRIGGER provider_professions_guard_verification
  BEFORE UPDATE OF verification_status ON public.provider_professions
  FOR EACH ROW EXECUTE FUNCTION private.guard_provider_verification();

CREATE OR REPLACE FUNCTION private.guard_provider_document_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (
    NEW.verification_status IS DISTINCT FROM OLD.verification_status
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
  ) AND auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can review provider documents'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_documents_guard_review
  BEFORE UPDATE ON public.provider_documents
  FOR EACH ROW EXECUTE FUNCTION private.guard_provider_document_review();

CREATE OR REPLACE FUNCTION private.audit_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_profile_id uuid;
  v_target_id uuid;
  v_old_value jsonb;
  v_new_value jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT private.is_admin()
     AND NOT (
       TG_TABLE_NAME = 'profiles'
       AND (to_jsonb(OLD) ->> 'user_id')::uuid = auth.uid()
       AND to_jsonb(OLD) ->> 'role' = 'admin'
     ) THEN
    RETURN NEW;
  END IF;

  v_actor_profile_id := private.current_profile_id();
  v_target_id := (to_jsonb(NEW) ->> 'id')::uuid;
  v_old_value := to_jsonb(OLD) -> TG_ARGV[2];
  v_new_value := to_jsonb(NEW) -> TG_ARGV[2];

  IF v_actor_profile_id IS NOT NULL AND v_old_value IS DISTINCT FROM v_new_value THEN
    INSERT INTO public.admin_actions (
      admin_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    VALUES (
      v_actor_profile_id,
      TG_ARGV[0],
      TG_ARGV[1],
      v_target_id,
      jsonb_build_object('old_value', v_old_value, 'new_value', v_new_value)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_audit_role_change
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_admin_change(
    'profile.role_changed', 'profile', 'role'
  );

CREATE TRIGGER provider_profiles_audit_verification
  AFTER UPDATE OF verification_status ON public.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_admin_change(
    'provider.verification_changed', 'provider_profile', 'verification_status'
  );

CREATE TRIGGER provider_professions_audit_verification
  AFTER UPDATE OF verification_status ON public.provider_professions
  FOR EACH ROW EXECUTE FUNCTION private.audit_admin_change(
    'provider_profession.verification_changed', 'provider_profession', 'verification_status'
  );

CREATE TRIGGER provider_documents_audit_review
  AFTER UPDATE OF verification_status ON public.provider_documents
  FOR EACH ROW EXECUTE FUNCTION private.audit_admin_change(
    'provider_document.reviewed', 'provider_document', 'verification_status'
  );

CREATE TRIGGER reports_audit_status
  AFTER UPDATE OF status ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.audit_admin_change(
    'report.status_changed', 'report', 'status'
  );

CREATE OR REPLACE FUNCTION private.guard_service_request_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
      IF NOT private.owns_provider(NEW.provider_id)
         OR NOT EXISTS (
           SELECT 1
           FROM public.service_requests AS sr
           JOIN public.provider_profiles AS pp ON pp.id = NEW.provider_id
           JOIN public.provider_services AS ps
             ON ps.provider_id = pp.id
             AND ps.service_id = sr.service_id
             AND ps.is_active
           WHERE sr.id = NEW.request_id
             AND sr.status = 'pending'
             AND pp.verification_status = 'verified'
         ) THEN
        RAISE EXCEPTION 'Only an eligible provider can respond to an open request'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Request response ownership and identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    IF NOT private.owns_provider(OLD.provider_id)
       OR NOT EXISTS (
         SELECT 1
         FROM public.service_requests AS sr
         WHERE sr.id = OLD.request_id
           AND sr.status = 'pending'
       )
       OR (
         NEW.status IS DISTINCT FROM OLD.status
         AND NOT (OLD.status IN ('accepted', 'declined') AND NEW.status = 'withdrawn')
       )
       OR (
         NEW.status = 'withdrawn'
         AND (
           NEW.response_message IS DISTINCT FROM OLD.response_message
           OR NEW.proposed_price IS DISTINCT FROM OLD.proposed_price
           OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
         )
       )
       OR (
         NEW.status <> 'withdrawn'
         AND NOT EXISTS (
           SELECT 1
           FROM public.service_requests AS sr
           JOIN public.provider_profiles AS pp ON pp.id = OLD.provider_id
           JOIN public.provider_services AS ps
             ON ps.provider_id = pp.id
             AND ps.service_id = sr.service_id
             AND ps.is_active
           WHERE sr.id = OLD.request_id
             AND sr.status = 'pending'
             AND pp.verification_status = 'verified'
         )
       ) THEN
      RAISE EXCEPTION 'Invalid request response update'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_request_responses_guard_write
  BEFORE INSERT OR UPDATE ON public.service_request_responses
  FOR EACH ROW EXECUTE FUNCTION private.guard_service_request_response();

CREATE OR REPLACE FUNCTION private.guard_service_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Service request ownership and identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' AND (
    NEW.description IS DISTINCT FROM OLD.description
    OR NEW.requested_date IS DISTINCT FROM OLD.requested_date
    OR NEW.requested_time IS DISTINCT FROM OLD.requested_time
    OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
    OR NEW.location IS DISTINCT FROM OLD.location
    OR NEW.country_id IS DISTINCT FROM OLD.country_id
    OR NEW.region_id IS DISTINCT FROM OLD.region_id
    OR NEW.city_id IS DISTINCT FROM OLD.city_id
    OR NEW.neighborhood_id IS DISTINCT FROM OLD.neighborhood_id
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.budget_min IS DISTINCT FROM OLD.budget_min
    OR NEW.budget_max IS DISTINCT FROM OLD.budget_max
    OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
  ) THEN
    RAISE EXCEPTION 'A request cannot be edited after a provider accepts it'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT private.is_admin()
     AND NOT (
       OLD.status = 'pending'
       AND NEW.status = 'cancelled'
       AND OLD.customer_id = private.current_profile_id()
     )
     AND NOT (
       OLD.status = 'pending'
       AND NEW.status = 'accepted'
       AND EXISTS (
         SELECT 1 FROM public.bookings AS b
         WHERE b.request_id = OLD.id
           AND b.status = 'pending'
           AND private.can_access_booking(b.id)
       )
     )
     AND NOT (
       OLD.status IN ('accepted', 'in_progress', 'completed')
       AND NEW.status IN ('in_progress', 'completed', 'cancelled', 'disputed')
       AND EXISTS (
         SELECT 1 FROM public.bookings AS b
         WHERE b.request_id = OLD.id
           AND b.status = NEW.status
           AND private.can_access_booking(b.id)
       )
     ) THEN
    RAISE EXCEPTION 'Invalid service request status transition'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_requests_guard_update
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION private.guard_service_request_update();

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

CREATE TRIGGER bookings_sync_request_after_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.sync_request_status_from_booking();

CREATE TRIGGER bookings_sync_request_after_status_change
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.sync_request_status_from_booking();

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

    SELECT p.user_id INTO v_customer_user_id
    FROM public.profiles AS p
    WHERE p.id = NEW.customer_id;

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
      SELECT sr.customer_id, sr.service_id
        INTO v_request_customer_id, v_request_service_id
      FROM public.service_requests AS sr
      WHERE sr.id = NEW.request_id
        AND sr.status = 'pending';

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
      FROM public.provider_services AS ps
      JOIN public.services AS s ON s.id = ps.service_id
      JOIN public.provider_profiles AS pp ON pp.id = ps.provider_id
      WHERE ps.provider_id = NEW.provider_id
        AND ps.service_id = NEW.service_id
        AND ps.is_active
        AND s.is_active
        AND pp.verification_status = 'verified'
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
    SELECT p.user_id INTO v_provider_user_id
    FROM public.provider_profiles AS pp
    JOIN public.profiles AS p ON p.id = pp.profile_id
    WHERE pp.id = NEW.provider_id;

    SELECT p.user_id INTO v_customer_user_id
    FROM public.profiles AS p
    WHERE p.id = NEW.customer_id;

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
        (NEW.status = 'completed' AND v_provider_owns)
        OR (NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns))
      WHEN 'completed' THEN NEW.status = 'disputed' AND (v_provider_owns OR v_customer_owns)
      ELSE false
    END;

    IF v_actor IS NOT NULL AND NOT private.is_admin() AND NOT v_allowed_transition THEN
      RAISE EXCEPTION 'Invalid booking status transition for this user'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'in_progress' THEN
      NEW.started_at := coalesce(OLD.started_at, now());
    ELSIF NEW.status = 'completed' THEN
      NEW.started_at := coalesce(OLD.started_at, now());
      NEW.completed_at := now();
    ELSIF NEW.status = 'cancelled' THEN
      NEW.cancelled_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_guard_write
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.guard_booking_write();

CREATE OR REPLACE FUNCTION private.record_booking_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.booking_status_history (
    booking_id,
    old_status,
    new_status,
    actor_user_id
  )
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_record_initial_status
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.record_booking_status();

CREATE TRIGGER bookings_record_status_change
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.record_booking_status();

CREATE OR REPLACE FUNCTION private.guard_review_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.bookings AS b
      WHERE b.id = NEW.booking_id
        AND b.customer_id = NEW.customer_id
        AND b.provider_id = NEW.provider_id
        AND b.status = 'completed'
    ) THEN
      RAISE EXCEPTION 'A review requires the customer''s completed booking'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Review booking and ownership fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_guard_write
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION private.guard_review_write();

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
  v_request_service_id uuid;
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
    SELECT customer.user_id, b.provider_id, provider.user_id
      INTO v_customer_user_id, v_provider_id, v_provider_user_id
    FROM public.bookings AS b
    JOIN public.profiles AS customer ON customer.id = b.customer_id
    JOIN public.provider_profiles AS pp ON pp.id = b.provider_id
    JOIN public.profiles AS provider ON provider.id = pp.profile_id
    WHERE b.id = p_booking_id;

    IF v_customer_user_id IS NULL
       OR v_actor NOT IN (v_customer_user_id, v_provider_user_id) THEN
      RAISE EXCEPTION 'Only booking participants can start its conversation'
        USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_customer_profile_id
    FROM public.profiles
    WHERE user_id = v_actor;

    INSERT INTO public.conversations (booking_id, provider_id, created_by)
    VALUES (p_booking_id, v_provider_id, v_customer_profile_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT id INTO v_conversation_id
      FROM public.conversations
      WHERE booking_id = p_booking_id;
    END IF;
  ELSE
    IF p_provider_id IS NULL THEN
      RAISE EXCEPTION 'A provider is required for a service request conversation'
        USING ERRCODE = '22023';
    END IF;

    SELECT sr.customer_id, sr.service_id, customer.user_id, provider.user_id
      INTO v_customer_profile_id, v_request_service_id, v_customer_user_id, v_provider_user_id
    FROM public.service_requests AS sr
    JOIN public.profiles AS customer ON customer.id = sr.customer_id
    JOIN public.provider_profiles AS pp ON pp.id = p_provider_id
    JOIN public.profiles AS provider ON provider.id = pp.profile_id
    WHERE sr.id = p_request_id
      AND sr.status = 'pending'
      AND pp.verification_status = 'verified'
      AND EXISTS (
        SELECT 1
        FROM public.provider_services AS ps
        WHERE ps.provider_id = pp.id
          AND ps.service_id = sr.service_id
          AND ps.is_active
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.service_request_responses AS response
        WHERE response.request_id = sr.id
          AND response.provider_id = pp.id
          AND response.status IN ('declined', 'withdrawn')
      );

    IF v_customer_user_id IS NULL
       OR v_actor NOT IN (v_customer_user_id, v_provider_user_id) THEN
      RAISE EXCEPTION 'Only the requesting customer or an eligible provider can start this conversation'
        USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_customer_profile_id
    FROM public.profiles
    WHERE user_id = v_actor;

    INSERT INTO public.conversations (request_id, provider_id, created_by)
    VALUES (p_request_id, p_provider_id, v_customer_profile_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conversation_id;

    IF v_conversation_id IS NULL THEN
      SELECT id INTO v_conversation_id
      FROM public.conversations
      WHERE request_id = p_request_id
        AND provider_id = p_provider_id;
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

CREATE OR REPLACE FUNCTION public.mark_message_read(p_message_id uuid)
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

  UPDATE public.messages AS m
  SET read_at = coalesce(m.read_at, now())
  WHERE m.id = p_message_id
    AND m.sender_id <> auth.uid()
    AND private.is_conversation_participant(m.conversation_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or not available to this user'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
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

  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found or not available to this user'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.bump_conversation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_bump_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.bump_conversation_updated_at();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'currencies', 'countries', 'regions', 'cities', 'neighborhoods', 'profiles',
    'service_categories', 'professions', 'services', 'provider_profiles',
    'provider_professions', 'provider_services', 'provider_service_areas',
    'provider_documents', 'provider_availability', 'conversations', 'reviews',
    'reports', 'service_requests', 'service_request_responses'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()',
      v_table || '_set_updated_at',
      v_table
    );
  END LOOP;
END;
$$;

CREATE VIEW public.provider_directory
WITH (security_barrier = true)
AS
SELECT
  pp.id AS provider_id,
  pp.professional_name,
  pp.description,
  pp.years_experience,
  pp.verification_status,
  pp.availability_status,
  pp.service_mode,
  p.display_name,
  p.avatar_url,
  p.country_id,
  p.region_id,
  p.city_id,
  p.neighborhood_id,
  c.name AS city_name,
  r.name AS region_name,
  co.name AS country_name,
  pp.created_at
FROM public.provider_profiles AS pp
JOIN public.profiles AS p ON p.id = pp.profile_id
LEFT JOIN public.cities AS c ON c.id = p.city_id
LEFT JOIN public.regions AS r ON r.id = p.region_id
LEFT JOIN public.countries AS co ON co.id = p.country_id
WHERE pp.verification_status = 'verified';

CREATE VIEW public.provider_reviews_public
WITH (security_barrier = true)
AS
SELECT
  r.id,
  r.booking_id,
  r.provider_id,
  r.rating,
  r.comment,
  r.created_at
FROM public.reviews AS r
JOIN public.provider_profiles AS pp ON pp.id = r.provider_id
WHERE pp.verification_status = 'verified';

GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO anon;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION private.owns_profile(uuid) TO anon;
GRANT EXECUTE ON FUNCTION private.owns_provider(uuid) TO anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.owns_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.owns_provider(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_conversation_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_request_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_conversation_participant_path(text) TO authenticated;

REVOKE ALL ON FUNCTION public.start_conversation(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_message_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_conversation(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.provider_directory, public.provider_reviews_public TO anon, authenticated;
GRANT SELECT ON public.currencies, public.countries, public.regions, public.cities,
  public.neighborhoods, public.service_categories, public.professions, public.services
  TO anon, authenticated;
GRANT SELECT ON public.provider_profiles, public.provider_professions,
  public.provider_services, public.provider_service_areas, public.provider_availability
  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.currencies, public.countries, public.regions,
  public.cities, public.neighborhoods, public.service_categories, public.professions, public.services
  TO authenticated;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.provider_profiles, public.provider_professions,
  public.provider_services, public.provider_service_areas, public.provider_documents,
  public.provider_availability TO authenticated;
GRANT DELETE ON public.provider_professions, public.provider_services,
  public.provider_service_areas, public.provider_documents, public.provider_availability TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_requests, public.bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_request_responses TO authenticated;
GRANT SELECT, INSERT ON public.service_request_attachments, public.messages, public.reviews TO authenticated;
GRANT SELECT ON public.booking_status_history, public.conversations,
  public.conversation_participants, public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT SELECT ON public.admin_actions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.neighborhoods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_professions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY currencies_read_active
  ON public.currencies FOR SELECT TO anon, authenticated
  USING (is_active OR private.is_admin());
CREATE POLICY currencies_admin_manage
  ON public.currencies FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY countries_read_active
  ON public.countries FOR SELECT TO anon, authenticated
  USING (is_active OR private.is_admin());
CREATE POLICY countries_admin_manage
  ON public.countries FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY regions_read_active
  ON public.regions FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.countries AS c
      WHERE c.id = country_id AND c.is_active
    ))
  );
CREATE POLICY regions_admin_manage
  ON public.regions FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY cities_read_active
  ON public.cities FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.countries AS co
      WHERE co.id = country_id AND co.is_active
    ) AND EXISTS (
      SELECT 1 FROM public.regions AS r
      WHERE r.id = region_id AND r.is_active
    ))
  );
CREATE POLICY cities_admin_manage
  ON public.cities FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY neighborhoods_read_active
  ON public.neighborhoods FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.cities AS c
      WHERE c.id = city_id AND c.is_active
    ))
  );
CREATE POLICY neighborhoods_admin_manage
  ON public.neighborhoods FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY profiles_read_self
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin());
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY profiles_admin_manage
  ON public.profiles FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY service_categories_read_active
  ON public.service_categories FOR SELECT TO anon, authenticated
  USING (is_active OR private.is_admin());
CREATE POLICY service_categories_admin_manage
  ON public.service_categories FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY professions_read_active
  ON public.professions FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.service_categories AS sc
      WHERE sc.id = category_id AND sc.is_active
    ))
  );
CREATE POLICY professions_admin_manage
  ON public.professions FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY services_read_active
  ON public.services FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.professions AS p
      JOIN public.service_categories AS sc ON sc.id = p.category_id
      WHERE p.id = profession_id AND p.is_active AND sc.is_active
    ))
  );
CREATE POLICY services_admin_manage
  ON public.services FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_profiles_read_visible
  ON public.provider_profiles FOR SELECT TO anon, authenticated
  USING (
    verification_status = 'verified'
    OR private.owns_profile(profile_id)
    OR private.is_admin()
  );
CREATE POLICY provider_profiles_insert_self
  ON public.provider_profiles FOR INSERT TO authenticated
  WITH CHECK (
    verification_status = 'pending'
    AND private.owns_profile(profile_id)
  );
CREATE POLICY provider_profiles_update_self
  ON public.provider_profiles FOR UPDATE TO authenticated
  USING (private.owns_provider(id))
  WITH CHECK (private.owns_provider(id));
CREATE POLICY provider_profiles_admin_manage
  ON public.provider_profiles FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_professions_read_visible
  ON public.provider_professions FOR SELECT TO anon, authenticated
  USING (
    private.owns_provider(provider_id)
    OR private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.provider_profiles AS pp
      JOIN public.professions AS p ON p.id = profession_id
      WHERE pp.id = provider_id AND pp.verification_status = 'verified' AND p.is_active
    )
  );
CREATE POLICY provider_professions_insert_self
  ON public.provider_professions FOR INSERT TO authenticated
  WITH CHECK (
    verification_status = 'pending'
    AND private.owns_provider(provider_id)
  );
CREATE POLICY provider_professions_update_self
  ON public.provider_professions FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_professions_delete_self
  ON public.provider_professions FOR DELETE TO authenticated
  USING (private.owns_provider(provider_id));
CREATE POLICY provider_professions_admin_manage
  ON public.provider_professions FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_services_read_visible
  ON public.provider_services FOR SELECT TO anon, authenticated
  USING (
    private.owns_provider(provider_id)
    OR private.is_admin()
    OR (is_active AND EXISTS (
      SELECT 1 FROM public.provider_profiles AS pp
      WHERE pp.id = provider_id AND pp.verification_status = 'verified'
    ) AND EXISTS (
      SELECT 1
      FROM public.services AS s
      JOIN public.professions AS p ON p.id = s.profession_id
      JOIN public.service_categories AS sc ON sc.id = p.category_id
      WHERE s.id = service_id AND s.is_active AND p.is_active AND sc.is_active
    ))
  );
CREATE POLICY provider_services_insert_self
  ON public.provider_services FOR INSERT TO authenticated
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_services_update_self
  ON public.provider_services FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_services_delete_self
  ON public.provider_services FOR DELETE TO authenticated
  USING (private.owns_provider(provider_id));
CREATE POLICY provider_services_admin_manage
  ON public.provider_services FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_service_areas_read_self
  ON public.provider_service_areas FOR SELECT TO authenticated
  USING (private.owns_provider(provider_id) OR private.is_admin());
CREATE POLICY provider_service_areas_read_public
  ON public.provider_service_areas FOR SELECT TO anon, authenticated
  USING (
    private.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.provider_profiles AS pp
      WHERE pp.id = provider_id AND pp.verification_status = 'verified'
    )
  );
CREATE POLICY provider_service_areas_insert_self
  ON public.provider_service_areas FOR INSERT TO authenticated
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_service_areas_update_self
  ON public.provider_service_areas FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_service_areas_delete_self
  ON public.provider_service_areas FOR DELETE TO authenticated
  USING (private.owns_provider(provider_id));
CREATE POLICY provider_service_areas_admin_manage
  ON public.provider_service_areas FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_documents_read_private
  ON public.provider_documents FOR SELECT TO authenticated
  USING (private.owns_provider(provider_id) OR private.is_admin());
CREATE POLICY provider_documents_insert_self
  ON public.provider_documents FOR INSERT TO authenticated
  WITH CHECK (
    verification_status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND private.owns_provider(provider_id)
  );
CREATE POLICY provider_documents_update_self
  ON public.provider_documents FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_documents_admin_manage
  ON public.provider_documents FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY provider_availability_read_visible
  ON public.provider_availability FOR SELECT TO anon, authenticated
  USING (
    private.owns_provider(provider_id)
    OR private.is_admin()
    OR (EXISTS (
      SELECT 1 FROM public.provider_profiles AS pp
      WHERE pp.id = provider_id
        AND pp.verification_status = 'verified'
        AND pp.availability_status = 'available'
    ))
  );
CREATE POLICY provider_availability_insert_self
  ON public.provider_availability FOR INSERT TO authenticated
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_availability_update_self
  ON public.provider_availability FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_availability_delete_self
  ON public.provider_availability FOR DELETE TO authenticated
  USING (private.owns_provider(provider_id));
CREATE POLICY provider_availability_admin_manage
  ON public.provider_availability FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY service_requests_read_related
  ON public.service_requests FOR SELECT TO authenticated
  USING (
    customer_id = private.current_profile_id()
    OR private.can_access_request(id)
    OR private.is_admin()
  );
CREATE POLICY service_requests_insert_customer
  ON public.service_requests FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = private.current_profile_id()
    AND status = 'pending'
  );
CREATE POLICY service_requests_update_customer
  ON public.service_requests FOR UPDATE TO authenticated
  USING (customer_id = private.current_profile_id())
  WITH CHECK (customer_id = private.current_profile_id());
CREATE POLICY service_requests_admin_manage
  ON public.service_requests FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY service_request_responses_read_related
  ON public.service_request_responses FOR SELECT TO authenticated
  USING (
    private.owns_provider(provider_id)
    OR EXISTS (
      SELECT 1 FROM public.service_requests AS sr
      WHERE sr.id = request_id
        AND sr.customer_id = private.current_profile_id()
    )
    OR private.is_admin()
  );
CREATE POLICY service_request_responses_insert_provider
  ON public.service_request_responses FOR INSERT TO authenticated
  WITH CHECK (
    status IN ('accepted', 'declined')
    AND private.owns_provider(provider_id)
    AND private.can_access_request(request_id)
  );
CREATE POLICY service_request_responses_update_provider
  ON public.service_request_responses FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY service_request_responses_admin_manage
  ON public.service_request_responses FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY service_request_attachments_read_related
  ON public.service_request_attachments FOR SELECT TO authenticated
  USING (private.can_access_request(request_id) OR private.is_admin());
CREATE POLICY service_request_attachments_insert_customer
  ON public.service_request_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = private.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.service_requests AS sr
      WHERE sr.id = request_id
        AND sr.customer_id = private.current_profile_id()
        AND sr.status = 'pending'
    )
  );
CREATE POLICY service_request_attachments_admin_manage
  ON public.service_request_attachments FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY bookings_read_participant
  ON public.bookings FOR SELECT TO authenticated
  USING (
    customer_id = private.current_profile_id()
    OR private.owns_provider(provider_id)
    OR private.can_access_booking(id)
    OR private.is_admin()
  );
CREATE POLICY bookings_insert_customer
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (customer_id = private.current_profile_id());
CREATE POLICY bookings_update_participant
  ON public.bookings FOR UPDATE TO authenticated
  USING (private.can_access_booking(id))
  WITH CHECK (private.can_access_booking(id));
CREATE POLICY bookings_admin_manage
  ON public.bookings FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY booking_status_history_read_participant
  ON public.booking_status_history FOR SELECT TO authenticated
  USING (private.can_access_booking(booking_id) OR private.is_admin());
CREATE POLICY booking_status_history_admin_read
  ON public.booking_status_history FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY conversations_read_participant
  ON public.conversations FOR SELECT TO authenticated
  USING (private.is_conversation_participant(id) OR private.is_admin());
CREATE POLICY conversations_admin_manage
  ON public.conversations FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY conversation_participants_read_related
  ON public.conversation_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_conversation_participant(conversation_id) OR private.is_admin());
CREATE POLICY conversation_participants_admin_manage
  ON public.conversation_participants FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY messages_read_participant
  ON public.messages FOR SELECT TO authenticated
  USING (private.is_conversation_participant(conversation_id) OR private.is_admin());
CREATE POLICY messages_insert_participant
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND private.is_conversation_participant(conversation_id)
  );
CREATE POLICY messages_admin_read
  ON public.messages FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY reviews_read_related
  ON public.reviews FOR SELECT TO authenticated
  USING (
    customer_id = private.current_profile_id()
    OR private.owns_provider(provider_id)
    OR private.is_admin()
  );
CREATE POLICY reviews_insert_completed_customer_booking
  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = private.current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.bookings AS b
      WHERE b.id = booking_id
        AND b.customer_id = customer_id
        AND b.provider_id = provider_id
        AND b.status = 'completed'
    )
  );
CREATE POLICY reviews_update_customer
  ON public.reviews FOR UPDATE TO authenticated
  USING (customer_id = private.current_profile_id())
  WITH CHECK (customer_id = private.current_profile_id());
CREATE POLICY reviews_admin_manage
  ON public.reviews FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY notifications_read_self
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin());
CREATE POLICY notifications_admin_manage
  ON public.notifications FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY reports_read_reporter
  ON public.reports FOR SELECT TO authenticated
  USING (reporter_id = private.current_profile_id() OR private.is_admin());
CREATE POLICY reports_insert_reporter
  ON public.reports FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = private.current_profile_id()
    AND status = 'open'
    AND (booking_id IS NULL OR private.can_access_booking(booking_id))
  );
CREATE POLICY reports_admin_manage
  ON public.reports FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

CREATE POLICY admin_actions_admin_read
  ON public.admin_actions FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY favorites_read_self
  ON public.favorites FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin());
CREATE POLICY favorites_insert_self
  ON public.favorites FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (provider_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.provider_profiles AS pp
        WHERE pp.id = provider_id AND pp.verification_status = 'verified'
      ))
      OR (service_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.services AS s
        WHERE s.id = service_id AND s.is_active
      ))
    )
  );
CREATE POLICY favorites_delete_self
  ON public.favorites FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY favorites_admin_manage
  ON public.favorites FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());
