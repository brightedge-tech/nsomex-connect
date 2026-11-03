INSERT INTO public.currencies (code, name, symbol)
VALUES
  ('XAF', 'Central African CFA franc', 'FCFA'),
  ('XOF', 'West African CFA franc', 'CFA'),
  ('NGN', 'Nigerian naira', '₦'),
  ('GHS', 'Ghanaian cedi', 'GH₵'),
  ('KES', 'Kenyan shilling', 'KSh'),
  ('ZAR', 'South African rand', 'R'),
  ('RWF', 'Rwandan franc', 'RF'),
  ('TZS', 'Tanzanian shilling', 'TSh'),
  ('USD', 'United States dollar', '$'),
  ('EUR', 'Euro', '€')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.countries (
  name,
  iso_alpha_2,
  iso_alpha_3,
  phone_country_code,
  default_currency_id
)
SELECT seed.name, seed.iso_alpha_2, seed.iso_alpha_3, seed.phone_country_code, c.id
FROM (
  VALUES
    ('Cameroon', 'CM', 'CMR', '+237', 'XAF'),
    ('Cote d''Ivoire', 'CI', 'CIV', '+225', 'XOF'),
    ('Ghana', 'GH', 'GHA', '+233', 'GHS'),
    ('Kenya', 'KE', 'KEN', '+254', 'KES'),
    ('Nigeria', 'NG', 'NGA', '+234', 'NGN'),
    ('Rwanda', 'RW', 'RWA', '+250', 'RWF'),
    ('Senegal', 'SN', 'SEN', '+221', 'XOF'),
    ('South Africa', 'ZA', 'ZAF', '+27', 'ZAR'),
    ('Tanzania', 'TZ', 'TZA', '+255', 'TZS')
) AS seed(name, iso_alpha_2, iso_alpha_3, phone_country_code, currency_code)
JOIN public.currencies AS c ON c.code = seed.currency_code
ON CONFLICT (iso_alpha_2) DO NOTHING;

INSERT INTO public.service_categories (name, slug, description)
VALUES
  ('Home Services', 'home-services', 'Services for homes and residential properties.'),
  ('Construction', 'construction', 'Construction, building, and renovation professions.'),
  ('Automotive', 'automotive', 'Vehicle maintenance, repair, and related services.'),
  ('Transportation', 'transportation', 'Passenger and goods transportation services.'),
  ('Cleaning', 'cleaning', 'Residential, commercial, and specialist cleaning.'),
  ('Personal Care', 'personal-care', 'Personal care and household assistance.'),
  ('Beauty', 'beauty', 'Hair, grooming, and beauty services.'),
  ('Technology', 'technology', 'Technology support, installation, and repair.'),
  ('Education', 'education', 'Tutoring, instruction, and educational support.'),
  ('Events', 'events', 'Event planning, catering, and creative services.'),
  ('Agriculture', 'agriculture', 'Agricultural and related field services.'),
  ('Business Services', 'business-services', 'Professional and business support services.'),
  ('Delivery', 'delivery', 'Parcel, goods, and food delivery services.'),
  ('Repairs', 'repairs', 'Repair and maintenance across products and property.'),
  ('Healthcare', 'healthcare', 'Healthcare and wellness services.'),
  ('Other', 'other', 'Services that do not fit another category.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.professions (category_id, name, slug, description)
SELECT sc.id, seed.name, seed.slug, seed.description
FROM (
  VALUES
    ('beauty', 'Barber', 'barber', 'Hair cutting and grooming services.'),
    ('business-services', 'Tailor', 'tailor', 'Clothing alteration and tailoring services.'),
    ('construction', 'Carpenter', 'carpenter', 'Woodworking, fittings, and carpentry.'),
    ('cleaning', 'Cleaner', 'cleaner', 'Residential and commercial cleaning services.'),
    ('home-services', 'Plumber', 'plumber', 'Water, pipe, and plumbing services.'),
    ('home-services', 'Electrician', 'electrician', 'Electrical installation and repair.'),
    ('construction', 'Mason', 'mason', 'Masonry and building work.'),
    ('construction', 'Welder', 'welder', 'Metal fabrication and welding.'),
    ('construction', 'Painter', 'painter', 'Building and surface painting services.'),
    ('automotive', 'Mechanic', 'mechanic', 'Vehicle diagnostics, maintenance, and repair.'),
    ('transportation', 'Driver', 'driver', 'Driving and transport services.'),
    ('transportation', 'Taxi Driver', 'taxi-driver', 'Taxi and local passenger transport.'),
    ('delivery', 'Delivery Provider', 'delivery-provider', 'Parcel and goods delivery.'),
    ('beauty', 'Hairdresser', 'hairdresser', 'Hair styling and hair care services.'),
    ('events', 'Photographer', 'photographer', 'Photography for people, products, and events.'),
    ('technology', 'IT Technician', 'it-technician', 'Computer, network, and IT support.'),
    ('repairs', 'Phone Repair Technician', 'phone-repair-technician', 'Mobile phone diagnostics and repair.'),
    ('education', 'Tutor', 'tutor', 'Private and group tutoring.'),
    ('events', 'Caterer', 'caterer', 'Food preparation and event catering.'),
    ('agriculture', 'Agricultural Worker', 'agricultural-worker', 'Agricultural and farm support services.'),
    ('technology', 'Solar Installer', 'solar-installer', 'Solar power system installation and maintenance.'),
    ('home-services', 'Generator Technician', 'generator-technician', 'Generator installation, maintenance, and repair.')
) AS seed(category_slug, name, slug, description)
JOIN public.service_categories AS sc ON sc.slug = seed.category_slug
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO public.services (profession_id, name, slug, description)
SELECT p.id, seed.name, seed.slug, seed.description
FROM (
  VALUES
    ('plumber', 'Leak Repair', 'leak-repair', 'Locate and repair water leaks.'),
    ('plumber', 'Pipe Installation', 'pipe-installation', 'Install or replace plumbing pipes.'),
    ('plumber', 'Drain Cleaning', 'drain-cleaning', 'Clear blocked drains and pipework.'),
    ('plumber', 'Water Tank Installation', 'water-tank-installation', 'Install water storage tanks and connections.'),
    ('electrician', 'Electrical Repairs', 'electrical-repairs', 'Diagnose and repair electrical faults.'),
    ('electrician', 'Wiring Installation', 'wiring-installation', 'Install or replace electrical wiring.'),
    ('electrician', 'Lighting Installation', 'lighting-installation', 'Install interior or exterior lighting.'),
    ('barber', 'Haircut', 'haircut', 'Hair cutting and styling.'),
    ('barber', 'Beard Trim', 'beard-trim', 'Beard trimming and grooming.'),
    ('carpenter', 'Furniture Repair', 'furniture-repair', 'Repair household or office furniture.'),
    ('mechanic', 'Vehicle Diagnostics', 'vehicle-diagnostics', 'Diagnose vehicle faults.'),
    ('mechanic', 'Routine Maintenance', 'routine-maintenance', 'Routine vehicle servicing and maintenance.'),
    ('tutor', 'One-to-One Tutoring', 'one-to-one-tutoring', 'Individual tutoring sessions.')
) AS seed(profession_slug, name, slug, description)
JOIN public.professions AS p ON p.slug = seed.profession_slug
ON CONFLICT (profession_id, slug) DO NOTHING;
