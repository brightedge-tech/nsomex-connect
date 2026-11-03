CREATE INDEX IF NOT EXISTS provider_profiles_public_page_idx
  ON public.provider_profiles (created_at DESC, id DESC)
  WHERE verification_status = 'verified';

CREATE OR REPLACE FUNCTION private.provider_is_publicly_visible(p_provider_id uuid)
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
    JOIN public.provider_applications AS application
      ON application.user_id = profile.user_id
      AND application.id = (
        SELECT latest_application.id
        FROM public.provider_applications AS latest_application
        WHERE latest_application.user_id = profile.user_id
        ORDER BY latest_application.created_at DESC, latest_application.id DESC
        LIMIT 1
      )
      AND application.verification_status = 'approved'
    WHERE provider.id = p_provider_id
      AND provider.verification_status = 'verified'
  );
$$;

REVOKE ALL ON FUNCTION private.provider_is_publicly_visible(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.provider_is_publicly_visible(uuid)
  TO anon, authenticated;

REVOKE SELECT ON public.provider_profiles FROM anon;

CREATE TABLE public.provider_portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL
    REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  caption text CHECK (caption IS NULL OR length(caption) <= 500),
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    split_part(storage_path, '/', 1) = provider_id::text
    AND array_length(string_to_array(storage_path, '/'), 1) = 2
    AND split_part(storage_path, '/', 2) <> ''
    AND lower(storage_path) ~ '\.(jpg|jpeg|png|webp)$'
  )
);

CREATE INDEX provider_portfolio_items_provider_page_idx
  ON public.provider_portfolio_items (provider_id, created_at DESC, id DESC)
  WHERE is_published;

ALTER TABLE public.provider_portfolio_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.provider_portfolio_items
  TO authenticated;
GRANT SELECT ON public.provider_portfolio_items TO anon;

COMMENT ON TABLE public.provider_portfolio_items IS
  'Portfolio metadata is immutable after upload. The mobile app supports upload and delete, not metadata editing; replace an item by deleting and uploading it again.';

CREATE POLICY provider_profiles_public_visibility_restrict
  ON public.provider_profiles AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    private.provider_is_publicly_visible(id)
    OR private.owns_profile(profile_id)
    OR private.is_admin()
  );

CREATE POLICY provider_professions_public_visibility_restrict
  ON public.provider_professions AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    private.provider_is_publicly_visible(provider_id)
    OR private.owns_provider(provider_id)
    OR private.is_admin()
  );

CREATE POLICY provider_services_public_visibility_restrict
  ON public.provider_services AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    private.provider_is_publicly_visible(provider_id)
    OR private.owns_provider(provider_id)
    OR private.is_admin()
  );

CREATE POLICY provider_portfolio_items_read_public
  ON public.provider_portfolio_items FOR SELECT TO anon, authenticated
  USING (
    (
      is_published
      AND private.provider_is_publicly_visible(provider_id)
    )
    OR (
      private.owns_provider(provider_id)
      AND private.provider_is_publicly_visible(provider_id)
    )
    OR private.is_admin()
  );

CREATE POLICY provider_portfolio_items_insert_owner
  ON public.provider_portfolio_items FOR INSERT TO authenticated
  WITH CHECK (
    private.owns_provider(provider_id)
    AND private.provider_is_publicly_visible(provider_id)
  );

CREATE POLICY provider_portfolio_items_delete_owner
  ON public.provider_portfolio_items FOR DELETE TO authenticated
  USING (
    (
      private.owns_provider(provider_id)
      AND private.provider_is_publicly_visible(provider_id)
    )
    OR private.is_admin()
  );

CREATE POLICY provider_portfolio_items_admin_manage
  ON public.provider_portfolio_items FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'provider-portfolio',
  'provider-portfolio',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

CREATE POLICY provider_portfolio_objects_read_published
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-portfolio'
    AND EXISTS (
      SELECT 1
      FROM public.provider_portfolio_items AS item
      WHERE item.storage_path = name
        AND item.is_published
        AND private.provider_is_publicly_visible(item.provider_id)
    )
  );

CREATE POLICY provider_portfolio_objects_read_owner
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-portfolio'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

CREATE POLICY provider_portfolio_objects_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-portfolio'
    AND (storage.foldername(name))[1] ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[2] IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

CREATE POLICY provider_portfolio_objects_delete_owner
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-portfolio'
    AND EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

CREATE POLICY provider_portfolio_objects_anon_read_restrict
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id <> 'provider-portfolio')
  WITH CHECK (bucket_id <> 'provider-portfolio');

CREATE POLICY provider_portfolio_objects_read_restrict
  ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'provider-portfolio'
    OR EXISTS (
      SELECT 1
      FROM public.provider_portfolio_items AS item
      WHERE item.storage_path = name
        AND item.is_published
        AND private.provider_is_publicly_visible(item.provider_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

CREATE POLICY provider_portfolio_objects_insert_restrict
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id <> 'provider-portfolio'
    OR (
      (storage.foldername(name))[2] IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.provider_profiles AS provider
        WHERE provider.id::text = (storage.foldername(name))[1]
          AND private.owns_provider(provider.id)
          AND private.provider_is_publicly_visible(provider.id)
      )
    )
  );

CREATE POLICY provider_portfolio_objects_update_restrict
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    bucket_id <> 'provider-portfolio'
    OR EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  )
  WITH CHECK (
    bucket_id <> 'provider-portfolio'
    OR EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

CREATE POLICY provider_portfolio_objects_delete_restrict
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    bucket_id <> 'provider-portfolio'
    OR EXISTS (
      SELECT 1
      FROM public.provider_profiles AS provider
      WHERE provider.id::text = (storage.foldername(name))[1]
        AND private.owns_provider(provider.id)
        AND private.provider_is_publicly_visible(provider.id)
    )
  );

DROP POLICY IF EXISTS provider_service_areas_read_public
  ON public.provider_service_areas;

CREATE POLICY provider_service_areas_read_private
  ON public.provider_service_areas FOR SELECT TO authenticated
  USING (private.owns_provider(provider_id) OR private.is_admin());

REVOKE SELECT ON public.provider_service_areas FROM anon;

CREATE VIEW public.provider_public_service_areas
WITH (security_barrier = true)
AS
SELECT
  area.provider_id,
  area.country_id,
  country.name AS country_name,
  area.region_id,
  region.name AS region_name,
  area.city_id,
  city.name AS city_name
FROM public.provider_service_areas AS area
JOIN public.provider_profiles AS provider
  ON provider.id = area.provider_id
  AND private.provider_is_publicly_visible(provider.id)
JOIN public.countries AS country
  ON country.id = area.country_id
  AND country.is_active
JOIN public.regions AS region
  ON region.id = area.region_id
  AND region.country_id = area.country_id
  AND region.is_active
JOIN public.cities AS city
  ON city.id = area.city_id
  AND city.region_id = area.region_id
  AND city.country_id = area.country_id
  AND city.is_active;

GRANT SELECT ON public.provider_public_service_areas TO anon, authenticated;

CREATE OR REPLACE VIEW public.provider_public_reviews
WITH (security_barrier = true)
AS
SELECT
  review.id,
  review.provider_id,
  review.rating,
  review.comment,
  review.created_at
FROM public.reviews AS review
JOIN public.provider_profiles AS provider
  ON provider.id = review.provider_id
  AND private.provider_is_publicly_visible(provider.id);

GRANT SELECT ON public.provider_public_reviews TO anon, authenticated;
REVOKE SELECT ON public.provider_reviews_public FROM anon, authenticated;

DROP POLICY IF EXISTS provider_availability_read_visible
  ON public.provider_availability;

CREATE POLICY provider_availability_read_visible
  ON public.provider_availability FOR SELECT TO anon, authenticated
  USING (
    private.owns_provider(provider_id)
    OR private.is_admin()
    OR private.provider_is_publicly_visible(provider_id)
  );

CREATE OR REPLACE VIEW public.provider_directory
WITH (security_barrier = true)
AS
SELECT
  provider.id AS provider_id,
  provider.professional_name,
  provider.description,
  provider.years_experience,
  provider.verification_status,
  provider.availability_status,
  provider.service_mode,
  NULL::text AS display_name,
  profile.avatar_url,
  NULL::uuid AS country_id,
  NULL::uuid AS region_id,
  NULL::uuid AS city_id,
  NULL::uuid AS neighborhood_id,
  NULL::text AS city_name,
  NULL::text AS region_name,
  NULL::text AS country_name,
  provider.created_at
FROM public.provider_profiles AS provider
JOIN public.profiles AS profile ON profile.id = provider.profile_id
WHERE private.provider_is_publicly_visible(provider.id);

CREATE OR REPLACE FUNCTION public.search_public_providers(
  p_search text DEFAULT NULL,
  p_profession_id uuid DEFAULT NULL,
  p_country_id uuid DEFAULT NULL,
  p_region_id uuid DEFAULT NULL,
  p_city_id uuid DEFAULT NULL,
  p_service_id uuid DEFAULT NULL,
  p_available_only boolean DEFAULT false,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 20
)
RETURNS TABLE (
  provider_id uuid,
  professional_name text,
  description text,
  years_experience smallint,
  avatar_url text,
  availability_status text,
  service_mode text,
  created_at timestamptz,
  profession_names text[],
  service_area_labels text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search text := nullif(btrim(p_search), '');
BEGIN
  IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50 THEN
    RAISE EXCEPTION 'Page size must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor values must be supplied together'
      USING ERRCODE = '22023';
  END IF;

  IF v_search IS NOT NULL AND length(v_search) > 200 THEN
    RAISE EXCEPTION 'Search text must not exceed 200 characters'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    provider.id,
    provider.professional_name,
    provider.description,
    provider.years_experience,
    profile.avatar_url,
    provider.availability_status,
    provider.service_mode,
    provider.created_at,
    ARRAY(
      SELECT DISTINCT profession.name
      FROM public.provider_professions AS provider_profession
      JOIN public.professions AS profession
        ON profession.id = provider_profession.profession_id
        AND profession.is_active
      WHERE provider_profession.provider_id = provider.id
        AND provider_profession.verification_status = 'verified'
      ORDER BY profession.name
    ),
    ARRAY(
      SELECT area_label
      FROM (
        SELECT DISTINCT concat_ws(
          ', ',
          area.city_name,
          area.region_name,
          area.country_name
        ) AS area_label
        FROM public.provider_public_service_areas AS area
        WHERE area.provider_id = provider.id
      ) AS distinct_areas
      ORDER BY area_label
    )
  FROM public.provider_profiles AS provider
  JOIN public.profiles AS profile
    ON profile.id = provider.profile_id
  WHERE private.provider_is_publicly_visible(provider.id)
    AND (
      NOT coalesce(p_available_only, false)
      OR provider.availability_status = 'available'
    )
    AND (
      p_profession_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.provider_professions AS provider_profession
        JOIN public.professions AS profession
          ON profession.id = provider_profession.profession_id
          AND profession.is_active
        WHERE provider_profession.provider_id = provider.id
          AND provider_profession.profession_id = p_profession_id
          AND provider_profession.verification_status = 'verified'
      )
    )
    AND (
      p_service_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.provider_services AS provider_service
        JOIN public.services AS service
          ON service.id = provider_service.service_id
          AND service.is_active
        WHERE provider_service.provider_id = provider.id
          AND provider_service.service_id = p_service_id
          AND provider_service.is_active
      )
    )
    AND (
      (
        p_country_id IS NULL
        AND p_region_id IS NULL
        AND p_city_id IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.provider_service_areas AS area
        JOIN public.regions AS region
          ON region.id = area.region_id
          AND region.country_id = area.country_id
          AND region.is_active
        JOIN public.cities AS city
          ON city.id = area.city_id
          AND city.region_id = area.region_id
          AND city.country_id = area.country_id
          AND city.is_active
        JOIN public.countries AS country
          ON country.id = area.country_id
          AND country.is_active
        WHERE area.provider_id = provider.id
          AND (p_country_id IS NULL OR area.country_id = p_country_id)
          AND (p_region_id IS NULL OR area.region_id = p_region_id)
          AND (p_city_id IS NULL OR area.city_id = p_city_id)
      )
    )
    AND (
      v_search IS NULL
      OR provider.professional_name ILIKE '%' || v_search || '%'
      OR coalesce(provider.description, '') ILIKE '%' || v_search || '%'
      OR EXISTS (
        SELECT 1
        FROM public.provider_professions AS provider_profession
        JOIN public.professions AS profession
          ON profession.id = provider_profession.profession_id
          AND profession.is_active
        WHERE provider_profession.provider_id = provider.id
          AND provider_profession.verification_status = 'verified'
          AND profession.name ILIKE '%' || v_search || '%'
      )
      OR EXISTS (
        SELECT 1
        FROM public.provider_services AS provider_service
        JOIN public.services AS service
          ON service.id = provider_service.service_id
          AND service.is_active
        WHERE provider_service.provider_id = provider.id
          AND provider_service.is_active
          AND service.name ILIKE '%' || v_search || '%'
      )
    )
    AND (
      p_before_created_at IS NULL
      OR (provider.created_at, provider.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY provider.created_at DESC, provider.id DESC
  LIMIT p_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.search_public_providers(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  boolean,
  timestamptz,
  uuid,
  integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_providers(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  boolean,
  timestamptz,
  uuid,
  integer
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_public_review_summary(
  p_provider_id uuid
)
RETURNS TABLE (review_count bigint, average_rating numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    count(review.id),
    round(avg(review.rating)::numeric, 2)
  FROM public.reviews AS review
  JOIN public.provider_profiles AS provider
    ON provider.id = review.provider_id
  WHERE provider.id = p_provider_id
    AND private.provider_is_publicly_visible(provider.id)
  GROUP BY provider.id;
$$;

REVOKE ALL ON FUNCTION public.provider_public_review_summary(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_public_review_summary(uuid)
  TO anon, authenticated;
