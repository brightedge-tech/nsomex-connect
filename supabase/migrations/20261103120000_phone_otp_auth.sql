ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

UPDATE public.profiles AS profile
SET email = lower(coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'email'), ''),
      nullif(btrim(auth_user.email), '')
    )),
    phone = CASE
      WHEN profile.phone IS NOT NULL
        OR auth_user.phone IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.profiles AS other_profile
          WHERE other_profile.phone = auth_user.phone
            AND other_profile.user_id <> profile.user_id
        )
      THEN coalesce(profile.phone, nullif(auth_user.phone, ''))
      ELSE profile.phone
    END,
    display_name = coalesce(
      profile.display_name,
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), '')
    )
FROM auth.users AS auth_user
WHERE auth_user.id = profile.user_id;

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name text := nullif(btrim(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_first_name text;
BEGIN
  v_first_name := nullif(split_part(coalesce(v_full_name, ''), ' ', 1), '');

  INSERT INTO public.profiles (
    user_id,
    first_name,
    last_name,
    display_name,
    phone,
    email,
    role
  )
  VALUES (
    NEW.id,
    v_first_name,
    nullif(btrim(substr(coalesce(v_full_name, ''), length(coalesce(v_first_name, '')) + 1)), ''),
    v_full_name,
    nullif(NEW.phone, ''),
    lower(coalesce(
      nullif(btrim(NEW.raw_user_meta_data ->> 'email'), ''),
      nullif(btrim(NEW.email), '')
    )),
    'customer'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change a profile role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
