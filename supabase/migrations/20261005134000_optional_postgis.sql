DO $$
DECLARE
  v_postgis_schema text;
  v_table text;
BEGIN
  SELECT n.nspname
  INTO v_postgis_schema
  FROM pg_extension AS e
  JOIN pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis';

  IF v_postgis_schema IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'
    ) THEN
      RAISE NOTICE 'PostGIS is unavailable; latitude/longitude columns remain ready for a later spatial migration.';
      RETURN;
    END IF;

    CREATE SCHEMA IF NOT EXISTS extensions;
    EXECUTE 'CREATE EXTENSION postgis WITH SCHEMA extensions';
    v_postgis_schema := 'extensions';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'profiles',
    'cities',
    'neighborhoods',
    'provider_service_areas',
    'service_requests',
    'bookings'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS geo_point %I.geography(Point,4326)
       GENERATED ALWAYS AS (
         CASE
           WHEN latitude IS NULL OR longitude IS NULL THEN NULL
           ELSE %I.ST_SetSRID(
             %I.ST_MakePoint(longitude, latitude),
             4326
           )::%I.geography
         END
       ) STORED',
      v_table,
      v_postgis_schema,
      v_postgis_schema,
      v_postgis_schema,
      v_postgis_schema
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I USING gist (geo_point)',
      v_table || '_geo_point_gist',
      v_table
    );
  END LOOP;
END;
$$;
