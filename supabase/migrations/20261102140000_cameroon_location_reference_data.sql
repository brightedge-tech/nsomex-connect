DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.countries
    WHERE iso_alpha_2 = 'CM'
      AND is_active
  ) THEN
    RAISE EXCEPTION
      'Active Cameroon country reference is missing. Apply the reference seed migration first.';
  END IF;
END;
$$;

INSERT INTO public.regions (country_id, name, slug)
SELECT country.id, seed.name, seed.slug
FROM public.countries AS country
CROSS JOIN (
  VALUES
    ('Adamawa', 'adamawa'),
    ('Centre', 'centre'),
    ('East', 'east'),
    ('Far North', 'far-north'),
    ('Littoral', 'littoral'),
    ('North', 'north'),
    ('Northwest', 'northwest'),
    ('South', 'south'),
    ('Southwest', 'southwest'),
    ('West', 'west')
) AS seed(name, slug)
WHERE country.iso_alpha_2 = 'CM'
ON CONFLICT (country_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true,
    updated_at = now();

INSERT INTO public.cities (country_id, region_id, name, slug)
SELECT country.id, region.id, seed.name, seed.slug
FROM (
  VALUES
    ('adamawa', 'Ngaoundéré', 'ngaoundere'),
    ('adamawa', 'Meiganga', 'meiganga'),
    ('adamawa', 'Tibati', 'tibati'),
    ('adamawa', 'Tignère', 'tignere'),
    ('adamawa', 'Banyo', 'banyo'),
    ('adamawa', 'Bankim', 'bankim'),
    ('adamawa', 'Djohong', 'djohong'),
    ('adamawa', 'Kontcha', 'kontcha'),
    ('adamawa', 'Mbe', 'mbe'),
    ('centre', 'Yaoundé', 'yaounde'),
    ('centre', 'Mbalmayo', 'mbalmayo'),
    ('centre', 'Bafia', 'bafia'),
    ('centre', 'Obala', 'obala'),
    ('centre', 'Mfou', 'mfou'),
    ('centre', 'Nanga-Eboko', 'nanga-eboko'),
    ('centre', 'Akonolinga', 'akonolinga'),
    ('centre', 'Monatélé', 'monatele'),
    ('centre', 'Ntui', 'ntui'),
    ('centre', 'Eseka', 'eseka'),
    ('centre', 'Ayos', 'ayos'),
    ('centre', 'Mbandjock', 'mbandjock'),
    ('centre', 'Sa''a', 'saa'),
    ('east', 'Bertoua', 'bertoua'),
    ('east', 'Batouri', 'batouri'),
    ('east', 'Abong-Mbang', 'abong-mbang'),
    ('east', 'Yokadouma', 'yokadouma'),
    ('east', 'Lomié', 'lomie'),
    ('east', 'Doumé', 'doume'),
    ('east', 'Garoua-Boulaï', 'garoua-boulai'),
    ('east', 'Bélabo', 'belabo'),
    ('east', 'Ketté', 'kette'),
    ('far-north', 'Maroua', 'maroua'),
    ('far-north', 'Kousseri', 'kousseri'),
    ('far-north', 'Mokolo', 'mokolo'),
    ('far-north', 'Yagoua', 'yagoua'),
    ('far-north', 'Kaélé', 'kaele'),
    ('far-north', 'Mora', 'mora'),
    ('far-north', 'Maga', 'maga'),
    ('far-north', 'Bogo', 'bogo'),
    ('far-north', 'Waza', 'waza'),
    ('far-north', 'Mindif', 'mindif'),
    ('far-north', 'Méri', 'meri'),
    ('littoral', 'Douala', 'douala'),
    ('littoral', 'Nkongsamba', 'nkongsamba'),
    ('littoral', 'Édéa', 'edea'),
    ('littoral', 'Mbanga', 'mbanga'),
    ('littoral', 'Loum', 'loum'),
    ('littoral', 'Manjo', 'manjo'),
    ('littoral', 'Melong', 'melong'),
    ('littoral', 'Yabassi', 'yabassi'),
    ('littoral', 'Dibombari', 'dibombari'),
    ('littoral', 'Penja', 'penja'),
    ('north', 'Garoua', 'garoua'),
    ('north', 'Guider', 'guider'),
    ('north', 'Figuil', 'figuil'),
    ('north', 'Poli', 'poli'),
    ('north', 'Rey-Bouba', 'rey-bouba'),
    ('north', 'Tcholliré', 'tchollire'),
    ('north', 'Pitoa', 'pitoa'),
    ('north', 'Lagdo', 'lagdo'),
    ('north', 'Bibemi', 'bibemi'),
    ('north', 'Mayo-Oulo', 'mayo-oulo'),
    ('northwest', 'Bamenda', 'bamenda'),
    ('northwest', 'Kumbo', 'kumbo'),
    ('northwest', 'Wum', 'wum'),
    ('northwest', 'Ndop', 'ndop'),
    ('northwest', 'Fundong', 'fundong'),
    ('northwest', 'Bali', 'bali'),
    ('northwest', 'Batibo', 'batibo'),
    ('northwest', 'Mbengwi', 'mbengwi'),
    ('northwest', 'Nkambe', 'nkambe'),
    ('northwest', 'Bafut', 'bafut'),
    ('northwest', 'Babessi', 'babessi'),
    ('south', 'Ebolowa', 'ebolowa'),
    ('south', 'Kribi', 'kribi'),
    ('south', 'Sangmélima', 'sangmelima'),
    ('south', 'Ambam', 'ambam'),
    ('south', 'Djoum', 'djoum'),
    ('south', 'Meyomessala', 'meyomessala'),
    ('south', 'Mintom', 'mintom'),
    ('south', 'Campo', 'campo'),
    ('south', 'Lolodorf', 'lolodorf'),
    ('south', 'Akom II', 'akom-ii'),
    ('south', 'Bipindi', 'bipindi'),
    ('southwest', 'Buea', 'buea'),
    ('southwest', 'Limbe', 'limbe'),
    ('southwest', 'Kumba', 'kumba'),
    ('southwest', 'Mamfe', 'mamfe'),
    ('southwest', 'Tiko', 'tiko'),
    ('southwest', 'Muyuka', 'muyuka'),
    ('southwest', 'Ekona', 'ekona'),
    ('southwest', 'Mundemba', 'mundemba'),
    ('southwest', 'Eyumojock', 'eyumojock'),
    ('southwest', 'Fontem', 'fontem'),
    ('southwest', 'Tombel', 'tombel'),
    ('west', 'Bafoussam', 'bafoussam'),
    ('west', 'Dschang', 'dschang'),
    ('west', 'Mbouda', 'mbouda'),
    ('west', 'Foumban', 'foumban'),
    ('west', 'Bangangté', 'bangangte'),
    ('west', 'Bafang', 'bafang'),
    ('west', 'Baham', 'baham'),
    ('west', 'Bandjoun', 'bandjoun'),
    ('west', 'Foumbot', 'foumbot'),
    ('west', 'Koutaba', 'koutaba'),
    ('west', 'Penka-Michel', 'penka-michel')
) AS seed(region_slug, name, slug)
JOIN public.countries AS country
  ON country.iso_alpha_2 = 'CM'
JOIN public.regions AS region
  ON region.country_id = country.id
 AND region.slug = seed.region_slug
ON CONFLICT (region_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true,
    updated_at = now();
