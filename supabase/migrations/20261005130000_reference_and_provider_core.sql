CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  symbol text NOT NULL CHECK (length(btrim(symbol)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  iso_alpha_2 text NOT NULL UNIQUE CHECK (iso_alpha_2 ~ '^[A-Z]{2}$'),
  iso_alpha_3 text UNIQUE CHECK (iso_alpha_3 IS NULL OR iso_alpha_3 ~ '^[A-Z]{3}$'),
  phone_country_code text NOT NULL CHECK (phone_country_code ~ '^\+[1-9][0-9]{0,3}$'),
  default_currency_id uuid NOT NULL REFERENCES public.currencies (id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, slug),
  UNIQUE (id, country_id)
);

CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries (id) ON DELETE RESTRICT,
  region_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (region_id, country_id)
    REFERENCES public.regions (id, country_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  UNIQUE (region_id, slug),
  UNIQUE (id, country_id),
  UNIQUE (id, region_id, country_id)
);

CREATE TABLE public.neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL,
  region_id uuid NOT NULL,
  city_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (city_id, region_id, country_id)
    REFERENCES public.cities (id, region_id, country_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  UNIQUE (city_id, slug),
  UNIQUE (id, city_id)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  first_name text CHECK (first_name IS NULL OR length(btrim(first_name)) > 0),
  last_name text CHECK (last_name IS NULL OR length(btrim(last_name)) > 0),
  display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) > 0),
  phone text UNIQUE CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{1,14}$'),
  avatar_url text,
  role text NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'provider', 'admin')),
  country_id uuid REFERENCES public.countries (id) ON DELETE RESTRICT,
  region_id uuid,
  city_id uuid,
  neighborhood_id uuid,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  bio text CHECK (bio IS NULL OR length(bio) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (region_id, country_id)
    REFERENCES public.regions (id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (city_id, region_id, country_id)
    REFERENCES public.cities (id, region_id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (neighborhood_id, city_id)
    REFERENCES public.neighborhoods (id, city_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (
    (region_id IS NULL OR country_id IS NOT NULL)
    AND (city_id IS NULL OR region_id IS NOT NULL)
    AND (neighborhood_id IS NULL OR city_id IS NOT NULL)
  )
);

CREATE TABLE public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

CREATE TABLE public.professions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.service_categories (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug),
  UNIQUE (id, category_id)
);

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profession_id uuid NOT NULL REFERENCES public.professions (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profession_id, slug),
  UNIQUE (id, profession_id)
);

CREATE TABLE public.provider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE RESTRICT,
  professional_name text NOT NULL CHECK (length(btrim(professional_name)) > 0),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  years_experience smallint NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 100),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'under_review', 'verified', 'rejected', 'suspended')),
  availability_status text NOT NULL DEFAULT 'unavailable'
    CHECK (availability_status IN ('available', 'unavailable', 'busy')),
  service_mode text NOT NULL DEFAULT 'both'
    CHECK (service_mode IN ('customer_location', 'provider_location', 'both')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_professions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  profession_id uuid NOT NULL REFERENCES public.professions (id) ON DELETE RESTRICT,
  years_experience smallint NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 100),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'under_review', 'verified', 'rejected', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, profession_id)
);

CREATE TABLE public.provider_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE RESTRICT,
  price numeric(12, 2) CHECK (price IS NULL OR price >= 0),
  currency_id uuid REFERENCES public.currencies (id) ON DELETE RESTRICT,
  price_type text NOT NULL DEFAULT 'negotiable'
    CHECK (price_type IN ('fixed', 'starting_from', 'hourly', 'negotiable')),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  estimated_duration_minutes integer
    CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes BETWEEN 1 AND 10080),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((price IS NULL) = (currency_id IS NULL)),
  CHECK (price_type <> 'fixed' OR price IS NOT NULL)
);

CREATE UNIQUE INDEX provider_services_one_active_service
  ON public.provider_services (provider_id, service_id)
  WHERE is_active;

CREATE TABLE public.provider_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES public.countries (id) ON DELETE RESTRICT,
  region_id uuid NOT NULL,
  city_id uuid NOT NULL,
  neighborhood_id uuid,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  radius_km numeric(8, 2) CHECK (radius_km IS NULL OR radius_km > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (region_id, country_id)
    REFERENCES public.regions (id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (city_id, region_id, country_id)
    REFERENCES public.cities (id, region_id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (neighborhood_id, city_id)
    REFERENCES public.neighborhoods (id, city_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (neighborhood_id IS NULL OR latitude IS NULL),
  UNIQUE NULLS NOT DISTINCT (provider_id, city_id, neighborhood_id)
);

CREATE INDEX provider_service_areas_city_provider
  ON public.provider_service_areas (city_id, provider_id);

CREATE INDEX provider_service_areas_country_region
  ON public.provider_service_areas (country_id, region_id);

CREATE INDEX provider_service_areas_neighborhood_fk
  ON public.provider_service_areas (neighborhood_id, city_id)
  WHERE neighborhood_id IS NOT NULL;

CREATE TABLE public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  document_type text NOT NULL
    CHECK (document_type IN ('identity', 'certificate', 'license', 'business_registration', 'other')),
  document_url text NOT NULL CHECK (length(btrim(document_url)) > 0),
  document_number text,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (verification_status = 'pending' AND reviewed_at IS NULL)
    OR (verification_status <> 'pending' AND reviewed_at IS NOT NULL)
  ),
  CHECK (verification_status <> 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE INDEX provider_documents_provider_status
  ON public.provider_documents (provider_id, verification_status);

CREATE TABLE public.provider_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (provider_id, day_of_week, start_time)
);

CREATE INDEX provider_availability_lookup
  ON public.provider_availability (provider_id, day_of_week, start_time)
  WHERE is_available;

CREATE INDEX profiles_location_lookup
  ON public.profiles (country_id, region_id, city_id, neighborhood_id);

CREATE INDEX profiles_role_created
  ON public.profiles (role, created_at DESC);

CREATE INDEX countries_active_name
  ON public.countries (name)
  WHERE is_active;

CREATE INDEX countries_default_currency
  ON public.countries (default_currency_id);

CREATE INDEX regions_country_active
  ON public.regions (country_id, name)
  WHERE is_active;

CREATE INDEX cities_country_region_fk
  ON public.cities (country_id, region_id);

CREATE INDEX cities_country_region_active
  ON public.cities (country_id, region_id, name)
  WHERE is_active;

CREATE INDEX neighborhoods_region_country_fk
  ON public.neighborhoods (region_id, country_id);

CREATE INDEX neighborhoods_country_fk
  ON public.neighborhoods (country_id);

CREATE INDEX neighborhoods_city_active
  ON public.neighborhoods (city_id, name)
  WHERE is_active;

CREATE INDEX profiles_region_fk
  ON public.profiles (region_id, country_id)
  WHERE region_id IS NOT NULL;

CREATE INDEX profiles_city_id_lookup
  ON public.profiles (city_id, id)
  WHERE city_id IS NOT NULL;

CREATE INDEX profiles_neighborhood_fk
  ON public.profiles (neighborhood_id, city_id)
  WHERE neighborhood_id IS NOT NULL;

CREATE INDEX professions_category_active
  ON public.professions (category_id, name)
  WHERE is_active;

CREATE INDEX services_profession_active
  ON public.services (profession_id, name)
  WHERE is_active;

CREATE INDEX provider_profiles_public_lookup
  ON public.provider_profiles (availability_status, created_at DESC)
  WHERE verification_status = 'verified';

CREATE INDEX provider_professions_profession_provider
  ON public.provider_professions (profession_id, provider_id);

CREATE INDEX provider_services_service_provider
  ON public.provider_services (service_id, provider_id)
  WHERE is_active;

CREATE INDEX provider_services_provider_created
  ON public.provider_services (provider_id, created_at DESC)
  WHERE is_active;

CREATE INDEX provider_services_provider_fk
  ON public.provider_services (provider_id);

CREATE INDEX provider_services_service_fk
  ON public.provider_services (service_id);

CREATE INDEX provider_services_currency_fk
  ON public.provider_services (currency_id)
  WHERE currency_id IS NOT NULL;

CREATE INDEX provider_documents_reviewer
  ON public.provider_documents (reviewed_by)
  WHERE reviewed_by IS NOT NULL;
