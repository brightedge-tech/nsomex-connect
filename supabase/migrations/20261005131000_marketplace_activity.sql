CREATE TABLE public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(btrim(description)) > 0 AND length(description) <= 10000),
  requested_date date,
  requested_time time,
  time_zone text,
  location text CHECK (location IS NULL OR length(location) <= 2000),
  country_id uuid NOT NULL,
  region_id uuid NOT NULL,
  city_id uuid NOT NULL,
  neighborhood_id uuid,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  budget_min numeric(12, 2) CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max numeric(12, 2) CHECK (budget_max IS NULL OR budget_max >= 0),
  currency_id uuid REFERENCES public.currencies (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'in_progress', 'completed', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (region_id, country_id)
    REFERENCES public.regions (id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (city_id, region_id, country_id)
    REFERENCES public.cities (id, region_id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (neighborhood_id, city_id)
    REFERENCES public.neighborhoods (id, city_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK ((budget_min IS NULL AND budget_max IS NULL AND currency_id IS NULL)
    OR currency_id IS NOT NULL),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  CHECK (requested_time IS NULL OR requested_date IS NOT NULL),
  CHECK (time_zone IS NULL OR length(btrim(time_zone)) > 0)
);

CREATE TABLE public.service_request_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE RESTRICT,
  status text NOT NULL
    CHECK (status IN ('accepted', 'declined', 'withdrawn')),
  response_message text CHECK (response_message IS NULL OR length(response_message) <= 5000),
  proposed_price numeric(12, 2) CHECK (proposed_price IS NULL OR proposed_price >= 0),
  currency_id uuid REFERENCES public.currencies (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((proposed_price IS NULL) = (currency_id IS NULL)),
  UNIQUE (request_id, provider_id)
);

CREATE TABLE public.service_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests (id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  object_path text NOT NULL UNIQUE CHECK (length(btrim(object_path)) > 0),
  content_type text NOT NULL CHECK (length(btrim(content_type)) > 0),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.service_requests (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE RESTRICT,
  agreed_price numeric(12, 2) NOT NULL CHECK (agreed_price >= 0),
  currency_id uuid NOT NULL REFERENCES public.currencies (id) ON DELETE RESTRICT,
  scheduled_date date,
  scheduled_time time,
  time_zone text,
  customer_location text CHECK (customer_location IS NULL OR length(customer_location) <= 2000),
  country_id uuid NOT NULL,
  region_id uuid NOT NULL,
  city_id uuid NOT NULL,
  neighborhood_id uuid,
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'provider_on_way', 'arrived', 'in_progress',
      'completed', 'cancelled', 'disputed')),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (region_id, country_id)
    REFERENCES public.regions (id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (city_id, region_id, country_id)
    REFERENCES public.cities (id, region_id, country_id) ON DELETE RESTRICT,
  FOREIGN KEY (neighborhood_id, city_id)
    REFERENCES public.neighborhoods (id, city_id) ON DELETE RESTRICT,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL),
  CHECK (time_zone IS NULL OR length(btrim(time_zone)) > 0),
  CHECK (started_at IS NULL OR status IN ('in_progress', 'completed', 'disputed')),
  CHECK (completed_at IS NULL OR status IN ('completed', 'disputed')),
  CHECK (cancelled_at IS NULL OR status = 'cancelled')
);

CREATE UNIQUE INDEX bookings_one_per_request
  ON public.bookings (request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE public.booking_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE RESTRICT,
  old_status text,
  new_status text NOT NULL
    CHECK (new_status IN ('pending', 'accepted', 'provider_on_way', 'arrived', 'in_progress',
      'completed', 'cancelled', 'disputed')),
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings (id) ON DELETE RESTRICT,
  request_id uuid REFERENCES public.service_requests (id) ON DELETE RESTRICT,
  provider_id uuid REFERENCES public.provider_profiles (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (booking_id IS NOT NULL OR request_id IS NOT NULL),
  CHECK (request_id IS NULL OR provider_id IS NOT NULL)
);

CREATE UNIQUE INDEX conversations_one_per_booking
  ON public.conversations (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX conversations_one_per_request_provider
  ON public.conversations (request_id, provider_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_participants_user_recent
  ON public.conversation_participants (user_id, joined_at DESC, conversation_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  message_text text CHECK (message_text IS NULL OR length(btrim(message_text)) > 0),
  attachment_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (message_text IS NOT NULL OR attachment_url IS NOT NULL)
);

CREATE INDEX messages_conversation_page
  ON public.messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX messages_unread_by_conversation
  ON public.messages (conversation_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX messages_sender_recent
  ON public.messages (sender_id, created_at DESC, id DESC);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles (id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR length(comment) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('booking_request', 'booking_accepted', 'booking_declined', 'provider_on_way',
      'provider_arrived', 'booking_completed', 'new_message', 'verification_update', 'review_reminder')),
  title text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 200),
  message text NOT NULL CHECK (length(btrim(message)) > 0 AND length(message) <= 5000),
  related_entity_type text
    CHECK (related_entity_type IS NULL OR related_entity_type IN
      ('service_request', 'booking', 'conversation', 'message', 'provider_document', 'review')),
  related_entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  reported_user_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 200),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reported_user_id IS NOT NULL OR booking_id IS NOT NULL),
  CHECK (reported_user_id IS NULL OR reported_user_id <> reporter_id)
);

CREATE TABLE public.admin_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(btrim(action)) > 0 AND length(action) <= 200),
  target_type text NOT NULL CHECK (length(btrim(target_type)) > 0 AND length(target_type) <= 100),
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.provider_profiles (id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((provider_id IS NOT NULL) <> (service_id IS NOT NULL))
);

CREATE UNIQUE INDEX favorites_one_provider_per_user
  ON public.favorites (user_id, provider_id)
  WHERE provider_id IS NOT NULL;

CREATE UNIQUE INDEX favorites_one_service_per_user
  ON public.favorites (user_id, service_id)
  WHERE service_id IS NOT NULL;

CREATE INDEX favorites_provider_fk
  ON public.favorites (provider_id)
  WHERE provider_id IS NOT NULL;

CREATE INDEX favorites_service_fk
  ON public.favorites (service_id)
  WHERE service_id IS NOT NULL;

CREATE INDEX service_requests_customer_recent
  ON public.service_requests (customer_id, created_at DESC, id DESC);

CREATE INDEX service_requests_service_city_status
  ON public.service_requests (service_id, city_id, status, created_at DESC, id DESC);

CREATE INDEX service_requests_city_status_recent
  ON public.service_requests (city_id, status, created_at DESC, id DESC);

CREATE INDEX service_requests_neighborhood_fk
  ON public.service_requests (neighborhood_id, city_id)
  WHERE neighborhood_id IS NOT NULL;

CREATE INDEX service_requests_region_country_fk
  ON public.service_requests (region_id, country_id);

CREATE INDEX service_requests_country_region_fk
  ON public.service_requests (country_id, region_id);

CREATE INDEX service_requests_currency_fk
  ON public.service_requests (currency_id)
  WHERE currency_id IS NOT NULL;

CREATE INDEX service_request_attachments_request
  ON public.service_request_attachments (request_id, created_at);

CREATE INDEX service_request_responses_customer_recent
  ON public.service_request_responses (request_id, created_at DESC, id DESC);

CREATE INDEX service_request_responses_provider_recent
  ON public.service_request_responses (provider_id, created_at DESC, id DESC);

CREATE INDEX service_request_responses_currency_fk
  ON public.service_request_responses (currency_id)
  WHERE currency_id IS NOT NULL;

CREATE INDEX service_request_attachments_uploaded_by
  ON public.service_request_attachments (uploaded_by, created_at DESC);

CREATE INDEX bookings_customer_recent
  ON public.bookings (customer_id, created_at DESC, id DESC);

CREATE INDEX bookings_provider_recent
  ON public.bookings (provider_id, created_at DESC, id DESC);

CREATE INDEX bookings_customer_status_recent
  ON public.bookings (customer_id, status, created_at DESC, id DESC);

CREATE INDEX bookings_provider_status_recent
  ON public.bookings (provider_id, status, created_at DESC, id DESC);

CREATE INDEX bookings_service_recent
  ON public.bookings (service_id, created_at DESC, id DESC);

CREATE INDEX bookings_city_status_scheduled
  ON public.bookings (city_id, status, scheduled_date, id);

CREATE INDEX bookings_neighborhood_fk
  ON public.bookings (neighborhood_id, city_id)
  WHERE neighborhood_id IS NOT NULL;

CREATE INDEX bookings_region_country_fk
  ON public.bookings (region_id, country_id);

CREATE INDEX bookings_country_region_fk
  ON public.bookings (country_id, region_id);

CREATE INDEX bookings_currency_fk
  ON public.bookings (currency_id);

CREATE INDEX booking_status_history_booking_recent
  ON public.booking_status_history (booking_id, changed_at DESC, id DESC);

CREATE INDEX booking_status_history_actor_recent
  ON public.booking_status_history (actor_user_id, changed_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX conversations_request
  ON public.conversations (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX conversations_created_by
  ON public.conversations (created_by, created_at DESC);

CREATE INDEX conversations_provider_recent
  ON public.conversations (provider_id, updated_at DESC, id DESC)
  WHERE provider_id IS NOT NULL;

CREATE INDEX reviews_provider_recent
  ON public.reviews (provider_id, created_at DESC, id DESC);

CREATE INDEX reviews_customer_recent
  ON public.reviews (customer_id, created_at DESC, id DESC);

CREATE INDEX notifications_user_recent
  ON public.notifications (user_id, created_at DESC, id DESC);

CREATE INDEX notifications_unread_recent
  ON public.notifications (user_id, created_at DESC, id DESC)
  WHERE NOT is_read;

CREATE INDEX reports_open_recent
  ON public.reports (status, created_at DESC, id DESC)
  WHERE status IN ('open', 'investigating');

CREATE INDEX reports_reporter_recent
  ON public.reports (reporter_id, created_at DESC, id DESC);

CREATE INDEX reports_reported_user_recent
  ON public.reports (reported_user_id, created_at DESC, id DESC)
  WHERE reported_user_id IS NOT NULL;

CREATE INDEX reports_booking
  ON public.reports (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX admin_actions_admin_recent
  ON public.admin_actions (admin_user_id, created_at DESC, id DESC);

CREATE INDEX favorites_user_recent
  ON public.favorites (user_id, created_at DESC, id DESC);
