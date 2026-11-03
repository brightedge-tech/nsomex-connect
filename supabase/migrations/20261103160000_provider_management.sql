ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS image_path text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.provider_services'::regclass
      AND conname = 'provider_services_title_check'
  ) THEN
    ALTER TABLE public.provider_services
      ADD CONSTRAINT provider_services_title_check
      CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.provider_services'::regclass
      AND conname = 'provider_services_image_path_check'
  ) THEN
    ALTER TABLE public.provider_services
      ADD CONSTRAINT provider_services_image_path_check
      CHECK (
        image_path IS NULL
        OR (
          split_part(image_path, '/', 1) = provider_id::text
          AND split_part(image_path, '/', 2) = service_id::text
          AND split_part(image_path, '/', 3) <> ''
          AND array_length(string_to_array(image_path, '/'), 1) = 3
          AND lower(image_path) ~ '\.(jpg|jpeg|png|webp)$'
        )
      );
  END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS public.provider_availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL
    REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_available boolean NOT NULL DEFAULT false,
  start_time time,
  end_time time,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, exception_date),
  CHECK (
    (is_available AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    OR (NOT is_available AND start_time IS NULL AND end_time IS NULL)
  )
);

ALTER TABLE public.provider_availability_exceptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.provider_availability_exceptions TO authenticated;
GRANT SELECT ON public.provider_availability_exceptions TO anon;

DROP POLICY IF EXISTS provider_availability_exceptions_read_visible
  ON public.provider_availability_exceptions;
DROP POLICY IF EXISTS provider_availability_exceptions_insert_owner
  ON public.provider_availability_exceptions;
DROP POLICY IF EXISTS provider_availability_exceptions_update_owner
  ON public.provider_availability_exceptions;
DROP POLICY IF EXISTS provider_availability_exceptions_delete_owner
  ON public.provider_availability_exceptions;
DROP POLICY IF EXISTS provider_availability_exceptions_admin_manage
  ON public.provider_availability_exceptions;

CREATE POLICY provider_availability_exceptions_read_visible
  ON public.provider_availability_exceptions FOR SELECT TO anon, authenticated
  USING (
    private.owns_provider(provider_id)
    OR private.is_admin()
    OR private.provider_is_publicly_visible(provider_id)
  );
CREATE POLICY provider_availability_exceptions_insert_owner
  ON public.provider_availability_exceptions FOR INSERT TO authenticated
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_availability_exceptions_update_owner
  ON public.provider_availability_exceptions FOR UPDATE TO authenticated
  USING (private.owns_provider(provider_id))
  WITH CHECK (private.owns_provider(provider_id));
CREATE POLICY provider_availability_exceptions_delete_owner
  ON public.provider_availability_exceptions FOR DELETE TO authenticated
  USING (private.owns_provider(provider_id));
CREATE POLICY provider_availability_exceptions_admin_manage
  ON public.provider_availability_exceptions FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP TRIGGER IF EXISTS provider_availability_exceptions_set_updated_at
  ON public.provider_availability_exceptions;
CREATE TRIGGER provider_availability_exceptions_set_updated_at
  BEFORE UPDATE ON public.provider_availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE OR REPLACE FUNCTION private.prevent_provider_availability_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.provider_id::text || ':' || NEW.day_of_week::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.provider_availability AS existing
    WHERE existing.provider_id = NEW.provider_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.id IS DISTINCT FROM NEW.id
      AND NEW.start_time < existing.end_time
      AND existing.start_time < NEW.end_time
  ) THEN
    RAISE EXCEPTION 'Provider availability intervals cannot overlap'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_provider_availability_overlap()
  FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.provider_availability AS left_slot
    JOIN public.provider_availability AS right_slot
      ON right_slot.provider_id = left_slot.provider_id
      AND right_slot.day_of_week = left_slot.day_of_week
      AND right_slot.id > left_slot.id
      AND left_slot.start_time < right_slot.end_time
      AND right_slot.start_time < left_slot.end_time
  ) THEN
    RAISE EXCEPTION
      'Resolve overlapping provider_availability rows before applying provider management migration';
  END IF;
END;
$migration$;

DROP TRIGGER IF EXISTS provider_availability_prevent_overlap
  ON public.provider_availability;
CREATE TRIGGER provider_availability_prevent_overlap
  BEFORE INSERT OR UPDATE OF provider_id, day_of_week, start_time, end_time
  ON public.provider_availability
  FOR EACH ROW EXECUTE FUNCTION private.prevent_provider_availability_overlap();

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
      AND (
        sr.requested_date IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.provider_availability_exceptions AS exception
          WHERE exception.provider_id = provider.id
            AND exception.exception_date = sr.requested_date
            AND exception.is_available
            AND (
              sr.requested_time IS NULL
              OR (
                sr.requested_time >= exception.start_time
                AND sr.requested_time < exception.end_time
              )
            )
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM public.provider_availability_exceptions AS exception
            WHERE exception.provider_id = provider.id
              AND exception.exception_date = sr.requested_date
          )
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public.provider_availability AS configured_hours
              WHERE configured_hours.provider_id = provider.id
            )
            OR EXISTS (
              SELECT 1
              FROM public.provider_availability AS available_hours
              WHERE available_hours.provider_id = provider.id
                AND available_hours.is_available
                AND available_hours.day_of_week =
                  extract(dow FROM sr.requested_date)::smallint
                AND (
                  sr.requested_time IS NULL
                  OR (
                    sr.requested_time >= available_hours.start_time
                    AND sr.requested_time < available_hours.end_time
                  )
                )
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.provider_matches_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.provider_services.title IS
  'Provider-specific public service title; when null, the service catalog name is used.';
COMMENT ON COLUMN public.provider_services.image_path IS
  'Optional public service image path in service-images, scoped to provider_id/service_id.';
COMMENT ON TABLE public.provider_availability_exceptions IS
  'One date override per provider. An available override replaces weekly hours for that date.';

DROP POLICY IF EXISTS service_images_owner_delete ON storage.objects;
CREATE POLICY service_images_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-images'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      JOIN public.provider_services AS provider_service
        ON provider_service.provider_id = provider.id
        AND provider_service.service_id::text = (storage.foldername(name))[2]
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
    )
  );
