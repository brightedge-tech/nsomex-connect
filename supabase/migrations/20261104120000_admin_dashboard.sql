ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_status_reason text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check,
  ADD CONSTRAINT profiles_account_status_check
    CHECK (account_status IN ('active', 'suspended')),
  DROP CONSTRAINT IF EXISTS profiles_account_status_reason_check,
  ADD CONSTRAINT profiles_account_status_reason_check
    CHECK (
      account_status_reason IS NULL
      OR length(btrim(account_status_reason)) BETWEEN 1 AND 2000
    );

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_suspension_reason_check,
  ADD CONSTRAINT provider_profiles_suspension_reason_check
    CHECK (
      suspension_reason IS NULL
      OR length(btrim(suspension_reason)) BETWEEN 1 AND 2000
    );

CREATE OR REPLACE FUNCTION private.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile.id
  FROM public.profiles AS profile
  WHERE profile.user_id = auth.uid()
    AND profile.account_status = 'active'
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
    FROM public.profiles AS profile
    WHERE profile.id = p_profile_id
      AND profile.user_id = auth.uid()
      AND profile.account_status = 'active'
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
    FROM public.provider_profiles AS provider
    JOIN public.profiles AS profile
      ON profile.id = provider.profile_id
    WHERE provider.id = p_provider_id
      AND profile.user_id = auth.uid()
      AND profile.account_status = 'active'
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
    AND profile.account_status = 'active'
  JOIN public.provider_applications AS application
    ON application.user_id = profile.user_id
    AND application.verification_status = 'approved'
  WHERE provider.verification_status = 'verified';

  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'An active, approved, and verified provider profile is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_provider_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only an administrator can change a profile role'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.account_status_reason IS DISTINCT FROM OLD.account_status_reason THEN
      RAISE EXCEPTION 'Only an administrator can change account status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_profile_role();

CREATE OR REPLACE FUNCTION private.guard_provider_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT private.is_admin()
     AND (
       NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
     ) THEN
    RAISE EXCEPTION 'Only an administrator can change provider verification or suspension'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_profiles_guard_verification
  ON public.provider_profiles;
CREATE TRIGGER provider_profiles_guard_verification
  BEFORE UPDATE OF verification_status, suspension_reason
  ON public.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_provider_verification();

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS TABLE (
  total_customers bigint,
  total_providers bigint,
  pending_applications bigint,
  verified_providers bigint,
  rejected_applications bigint,
  active_service_listings bigint,
  total_requests bigint,
  active_bookings bigint,
  completed_bookings bigint,
  cancelled_bookings bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT count(*)
      FROM public.profiles AS profile
      WHERE profile.role = 'customer'
    ),
    (SELECT count(*) FROM public.provider_profiles),
    (
      SELECT count(*)
      FROM public.provider_applications AS application
      WHERE application.verification_status IN ('pending', 'requires_documents')
    ),
    (
      SELECT count(*)
      FROM public.provider_profiles AS provider
      WHERE provider.verification_status = 'verified'
    ),
    (
      SELECT count(*)
      FROM public.provider_applications AS application
      WHERE application.verification_status = 'rejected'
    ),
    (
      SELECT count(*)
      FROM public.provider_services AS provider_service
      JOIN public.services AS service
        ON service.id = provider_service.service_id
        AND service.is_active
      JOIN public.provider_profiles AS provider
        ON provider.id = provider_service.provider_id
        AND provider.verification_status = 'verified'
      JOIN public.profiles AS profile
        ON profile.id = provider.profile_id
        AND profile.account_status = 'active'
      WHERE provider_service.is_active
    ),
    (SELECT count(*) FROM public.service_requests),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.status IN (
        'pending', 'accepted', 'provider_on_way', 'arrived',
        'in_progress', 'provider_completed'
      )
    ),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.status = 'completed'
    ),
    (
      SELECT count(*)
      FROM public.bookings AS booking
      WHERE booking.status = 'cancelled'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_summary()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_accounts(
  p_kind text,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  provider_id uuid,
  user_id uuid,
  display_name text,
  professional_name text,
  phone text,
  email text,
  account_status text,
  account_status_reason text,
  provider_status text,
  suspension_reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search text := nullif(btrim(p_search), '');
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('customers', 'providers') THEN
    RAISE EXCEPTION 'Invalid account type'
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

  IF p_kind = 'customers' THEN
    RETURN QUERY
    SELECT
      profile.id,
      profile.id,
      NULL::uuid,
      profile.user_id,
      coalesce(
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '')
      ),
      NULL::text,
      profile.phone,
      profile.email,
      profile.account_status,
      profile.account_status_reason,
      NULL::text,
      NULL::text,
      profile.created_at
    FROM public.profiles AS profile
    WHERE profile.role = 'customer'
      AND (p_status IS NULL OR profile.account_status = p_status)
      AND (
        v_search IS NULL
        OR coalesce(profile.display_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(profile.first_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(profile.last_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(profile.phone, '') ILIKE '%' || v_search || '%'
        OR coalesce(profile.email, '') ILIKE '%' || v_search || '%'
      )
      AND (
        p_before_created_at IS NULL
        OR (profile.created_at, profile.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY profile.created_at DESC, profile.id DESC
    LIMIT p_page_size;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    provider.id,
    profile.id,
    provider.id,
    profile.user_id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '')
    ),
    provider.professional_name,
    profile.phone,
    profile.email,
    profile.account_status,
    profile.account_status_reason,
    provider.verification_status,
    provider.suspension_reason,
    provider.created_at
  FROM public.provider_profiles AS provider
  JOIN public.profiles AS profile ON profile.id = provider.profile_id
  WHERE (p_status IS NULL OR provider.verification_status = p_status)
    AND (
      v_search IS NULL
      OR coalesce(provider.professional_name, '') ILIKE '%' || v_search || '%'
      OR coalesce(profile.display_name, '') ILIKE '%' || v_search || '%'
      OR coalesce(profile.first_name, '') ILIKE '%' || v_search || '%'
      OR coalesce(profile.last_name, '') ILIKE '%' || v_search || '%'
      OR coalesce(profile.phone, '') ILIKE '%' || v_search || '%'
      OR coalesce(profile.email, '') ILIKE '%' || v_search || '%'
    )
    AND (
      p_before_created_at IS NULL
      OR (provider.created_at, provider.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY provider.created_at DESC, provider.id DESC
  LIMIT p_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_accounts(
  text, text, text, timestamptz, uuid, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts(
  text, text, text, timestamptz, uuid, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_customer_status(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid := private.current_profile_id();
  v_customer public.profiles%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid customer status update'
      USING ERRCODE = '22023';
  END IF;
  IF p_status = 'suspended' AND (v_reason IS NULL OR length(v_reason) > 2000) THEN
    RAISE EXCEPTION 'A reason is required to suspend an account'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
  INTO v_customer
  FROM public.profiles AS profile
  WHERE profile.user_id = p_user_id
    AND profile.role = 'customer'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_customer.account_status = p_status
     AND v_customer.account_status_reason IS NOT DISTINCT FROM
       CASE WHEN p_status = 'suspended' THEN v_reason ELSE NULL END THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET account_status = p_status,
      account_status_reason = CASE WHEN p_status = 'suspended' THEN v_reason ELSE NULL END
  WHERE id = v_customer.id;

  INSERT INTO public.admin_actions (
    admin_user_id, action, target_type, target_id, metadata
  )
  VALUES (
    v_admin_id,
    CASE p_status WHEN 'suspended' THEN 'customer.suspended' ELSE 'customer.reactivated' END,
    'profile',
    v_customer.id,
    jsonb_build_object(
      'previous_status', v_customer.account_status,
      'new_status', p_status,
      'reason', CASE WHEN p_status = 'suspended' THEN v_reason ELSE NULL END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_customer_status(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_status(uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_provider_suspension(
  p_provider_id uuid,
  p_suspend boolean,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid := private.current_profile_id();
  v_provider public.provider_profiles%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_action text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;
  IF p_provider_id IS NULL OR p_suspend IS NULL THEN
    RAISE EXCEPTION 'Invalid provider status update'
      USING ERRCODE = '22023';
  END IF;
  IF p_suspend AND (v_reason IS NULL OR length(v_reason) > 2000) THEN
    RAISE EXCEPTION 'A reason is required to suspend a provider'
      USING ERRCODE = '22023';
  END IF;

  SELECT provider.*
  INTO v_provider
  FROM public.provider_profiles AS provider
  WHERE provider.id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_suspend THEN
    IF v_provider.verification_status = 'suspended' THEN
      RETURN;
    END IF;
    IF v_provider.verification_status <> 'verified' THEN
      RAISE EXCEPTION 'Only verified providers can be suspended'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.provider_profiles
    SET verification_status = 'suspended',
        suspension_reason = v_reason
    WHERE id = p_provider_id;
    v_action := 'provider.suspended';
  ELSE
    IF v_provider.verification_status <> 'suspended' THEN
      RAISE EXCEPTION 'Only suspended providers can be reactivated'
        USING ERRCODE = '23514';
    END IF;
    UPDATE public.provider_profiles
    SET verification_status = 'verified',
        suspension_reason = NULL
    WHERE id = p_provider_id;
    v_action := 'provider.reactivated';
  END IF;

  INSERT INTO public.admin_actions (
    admin_user_id, action, target_type, target_id, metadata
  )
  VALUES (
    v_admin_id,
    v_action,
    'provider_profile',
    p_provider_id,
    jsonb_build_object(
      'previous_status', v_provider.verification_status,
      'new_status', CASE WHEN p_suspend THEN 'suspended' ELSE 'verified' END,
      'reason', CASE WHEN p_suspend THEN v_reason ELSE v_provider.suspension_reason END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_provider_suspension(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_suspension(uuid, boolean, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_catalog_item(
  p_entity text,
  p_id uuid,
  p_parent_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid := private.current_profile_id();
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_old jsonb;
  v_new jsonb;
  v_action text;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;
  IF p_entity IS NULL OR p_entity NOT IN ('category', 'profession', 'service')
     OR p_name IS NULL OR length(btrim(p_name)) = 0
     OR p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Catalog name, valid slug, entity, and active state are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_entity = 'category' AND p_parent_id IS NOT NULL
     OR p_entity IN ('profession', 'service') AND p_parent_id IS NULL THEN
    RAISE EXCEPTION 'A valid parent is required for this catalog item'
      USING ERRCODE = '22023';
  END IF;

  IF p_entity = 'category' THEN
    IF p_id IS NOT NULL THEN
      SELECT to_jsonb(item) INTO v_old
      FROM public.service_categories AS item WHERE item.id = p_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002'; END IF;
      UPDATE public.service_categories AS item
      SET name = btrim(p_name), slug = p_slug, description = p_description,
          is_active = p_is_active, updated_at = now()
      WHERE item.id = p_id
      RETURNING to_jsonb(item) INTO v_new;
      v_action := 'catalog.category_updated';
    ELSE
      INSERT INTO public.service_categories (id, name, slug, description, is_active)
      VALUES (v_id, btrim(p_name), p_slug, p_description, p_is_active)
      RETURNING to_jsonb(service_categories) INTO v_new;
      v_action := 'catalog.category_created';
    END IF;
  ELSIF p_entity = 'profession' THEN
    IF p_id IS NOT NULL THEN
      SELECT to_jsonb(item) INTO v_old
      FROM public.professions AS item WHERE item.id = p_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Profession not found' USING ERRCODE = 'P0002'; END IF;
      UPDATE public.professions AS item
      SET category_id = p_parent_id, name = btrim(p_name), slug = p_slug,
          description = p_description, is_active = p_is_active, updated_at = now()
      WHERE item.id = p_id
      RETURNING to_jsonb(item) INTO v_new;
      v_action := 'catalog.profession_updated';
    ELSE
      INSERT INTO public.professions (id, category_id, name, slug, description, is_active)
      VALUES (v_id, p_parent_id, btrim(p_name), p_slug, p_description, p_is_active)
      RETURNING to_jsonb(professions) INTO v_new;
      v_action := 'catalog.profession_created';
    END IF;
  ELSE
    IF p_id IS NOT NULL THEN
      SELECT to_jsonb(item) INTO v_old
      FROM public.services AS item WHERE item.id = p_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002'; END IF;
      UPDATE public.services AS item
      SET profession_id = p_parent_id, name = btrim(p_name), slug = p_slug,
          description = p_description, is_active = p_is_active, updated_at = now()
      WHERE item.id = p_id
      RETURNING to_jsonb(item) INTO v_new;
      v_action := 'catalog.service_updated';
    ELSE
      INSERT INTO public.services (id, profession_id, name, slug, description, is_active)
      VALUES (v_id, p_parent_id, btrim(p_name), p_slug, p_description, p_is_active)
      RETURNING to_jsonb(services) INTO v_new;
      v_action := 'catalog.service_created';
    END IF;
  END IF;

  INSERT INTO public.admin_actions (
    admin_user_id, action, target_type, target_id, metadata
  )
  VALUES (
    v_admin_id,
    v_action,
    p_entity,
    v_id,
    jsonb_build_object('before', v_old, 'after', v_new)
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_catalog_item(
  text, uuid, uuid, text, text, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_catalog_item(
  text, uuid, uuid, text, text, text, boolean
) TO authenticated;

GRANT EXECUTE ON FUNCTION private.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.owns_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.owns_provider(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_verified_provider_id() TO authenticated;
