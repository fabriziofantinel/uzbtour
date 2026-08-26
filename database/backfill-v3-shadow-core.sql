-- SMF Travel v3 - shadow backfill, core/master/travel scope.
-- Re-runnable and non-destructive: source public tables remain authoritative.

CREATE TABLE IF NOT EXISTS ops.legacy_id_map (
  source_system VARCHAR(32) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  legacy_id TEXT NOT NULL,
  target_id UUID NOT NULL DEFAULT uuidv7(),
  agency_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_system, entity_type, legacy_id),
  UNIQUE (entity_type, target_id)
);
CREATE INDEX IF NOT EXISTS legacy_id_map_agency_idx
  ON ops.legacy_id_map (agency_id, entity_type, legacy_id)
  WHERE agency_id IS NOT NULL;
ALTER TABLE ops.legacy_id_map ENABLE ROW LEVEL SECURITY;

-- A template can span multiple countries; primary_country_id remains a display default.
CREATE TABLE IF NOT EXISTS travel.template_countries (
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  country_id UUID NOT NULL REFERENCES ref.countries(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL CHECK (sort_order >= 0),
  FOREIGN KEY (agency_id, template_id)
    REFERENCES travel.trip_templates(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, country_id),
  UNIQUE (template_id, sort_order)
);
CREATE INDEX IF NOT EXISTS template_countries_tenant_idx
  ON travel.template_countries (agency_id, template_id, sort_order, country_id);
ALTER TABLE travel.template_countries ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'travel' AND tablename = 'template_countries'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON travel.template_countries
      USING (agency_id = app.current_agency_id())
      WITH CHECK (agency_id = app.current_agency_id());
  END IF;
END $$;

-- Historical rows include already-published versions. The runtime role has no
-- access to v3 yet; owner disables only mutation guards inside this transaction.
-- A rollback restores trigger state automatically.
ALTER TABLE travel.template_days DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_cities DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_sites DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_hotels DISABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_itinerary_items DISABLE TRIGGER guard_template_version_mutation;

-- Text identity keys become UUIDs once and remain stable across every rerun.
INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id)
SELECT 'public-v2', 'user', id
FROM public.platform_users
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

INSERT INTO iam.users
  (id, display_name, email, phone, platform_role, status, created_at, updated_at)
SELECT m.target_id, u.display_name, u.email, u.phone, u.platform_role, u.status,
       u.created_at, u.updated_at
FROM public.platform_users u
JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user' AND m.legacy_id = u.id
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  platform_role = EXCLUDED.platform_role,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

INSERT INTO iam.user_identities (user_id, provider, subject, created_at)
SELECT m.target_id, u.auth_provider, u.auth_subject, u.created_at
FROM public.platform_users u
JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user' AND m.legacy_id = u.id
WHERE NULLIF(btrim(u.auth_subject), '') IS NOT NULL
ON CONFLICT (provider, subject) DO UPDATE SET user_id = EXCLUDED.user_id;

INSERT INTO iam.agencies
  (id, slug, name, legal_name, vat_number, tax_code, registered_address,
   registered_city, registered_postal_code, registered_province,
   registered_country_code, pec, sdi_code, phone, email, website,
   reference_name, reference_email, reference_phone, status, default_locale,
   default_timezone, branding, settings, created_at, updated_at)
SELECT id, slug, name, legal_name, vat_number, tax_code, registered_address,
       registered_city, registered_postal_code, registered_province,
       NULLIF(upper(left(btrim(registered_country), 2)), ''), pec, sdi_code,
       phone, email, website,
       COALESCE(NULLIF(btrim(reference_name), ''), 'Referente da completare'),
       NULLIF(reference_email, ''),
       NULLIF(reference_phone, ''), status, default_locale, default_timezone,
       branding, settings, created_at, updated_at
FROM public.agencies
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug, name = EXCLUDED.name, legal_name = EXCLUDED.legal_name,
  vat_number = EXCLUDED.vat_number, tax_code = EXCLUDED.tax_code,
  registered_address = EXCLUDED.registered_address,
  registered_city = EXCLUDED.registered_city,
  registered_postal_code = EXCLUDED.registered_postal_code,
  registered_province = EXCLUDED.registered_province,
  registered_country_code = EXCLUDED.registered_country_code,
  pec = EXCLUDED.pec, sdi_code = EXCLUDED.sdi_code, phone = EXCLUDED.phone,
  email = EXCLUDED.email, website = EXCLUDED.website,
  reference_name = EXCLUDED.reference_name,
  reference_email = EXCLUDED.reference_email,
  reference_phone = EXCLUDED.reference_phone, status = EXCLUDED.status,
  default_locale = EXCLUDED.default_locale,
  default_timezone = EXCLUDED.default_timezone, branding = EXCLUDED.branding,
  settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at;

INSERT INTO iam.agency_memberships (agency_id, user_id, role, status, created_at)
SELECT am.agency_id, m.target_id, am.role, 'active', am.created_at
FROM public.agency_memberships am
JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user' AND m.legacy_id = am.user_id
ON CONFLICT (agency_id, user_id) DO UPDATE SET
  role = EXCLUDED.role, status = EXCLUDED.status;

INSERT INTO ref.countries
  (id, iso_code, name, normalized_name, google_url, default_timezone,
   last_verified_at, refresh_after, created_at, updated_at)
SELECT id,
       COALESCE(
         NULLIF(upper(iso_code), ''),
         CASE normalized_name WHEN 'uzbekistan' THEN 'UZ' WHEN 'vietnam' THEN 'VN' END
       ),
       name, normalized_name, google_url, NULL, last_verified_at,
       content_refresh_after, created_at, updated_at
FROM public.countries
ON CONFLICT (id) DO UPDATE SET
  iso_code = EXCLUDED.iso_code, name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name, google_url = EXCLUDED.google_url,
  last_verified_at = EXCLUDED.last_verified_at,
  refresh_after = EXCLUDED.refresh_after, updated_at = EXCLUDED.updated_at;

INSERT INTO ref.cities
  (id, country_id, name, normalized_name, google_url, location, timezone,
   last_verified_at, refresh_after, created_at, updated_at)
SELECT id, country_id, name, normalized_name, google_url,
       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,
       NULL, last_verified_at, content_refresh_after, created_at, updated_at
FROM public.cities
ON CONFLICT (id) DO UPDATE SET
  country_id = EXCLUDED.country_id, name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name, google_url = EXCLUDED.google_url,
  location = EXCLUDED.location, last_verified_at = EXCLUDED.last_verified_at,
  refresh_after = EXCLUDED.refresh_after, updated_at = EXCLUDED.updated_at;

INSERT INTO ref.visit_sites
  (id, city_id, name, normalized_name, google_url, official_url, location,
   last_verified_at, refresh_after, created_at, updated_at)
SELECT id, city_id, name, normalized_name, google_url, official_url,
       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,
       last_verified_at, content_refresh_after, created_at, updated_at
FROM public.visit_sites
ON CONFLICT (id) DO UPDATE SET
  city_id = EXCLUDED.city_id, name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name, google_url = EXCLUDED.google_url,
  official_url = EXCLUDED.official_url, location = EXCLUDED.location,
  last_verified_at = EXCLUDED.last_verified_at,
  refresh_after = EXCLUDED.refresh_after, updated_at = EXCLUDED.updated_at;

INSERT INTO ref.hotels
  (id, city_id, name, normalized_name, google_url, website_url, location,
   last_verified_at, created_at, updated_at)
SELECT id, city_id, name, normalized_name, google_url, website_url,
       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,
       last_verified_at, created_at, updated_at
FROM public.hotels
ON CONFLICT (id) DO UPDATE SET
  city_id = EXCLUDED.city_id, name = EXCLUDED.name,
  normalized_name = EXCLUDED.normalized_name, google_url = EXCLUDED.google_url,
  website_url = EXCLUDED.website_url, location = EXCLUDED.location,
  last_verified_at = EXCLUDED.last_verified_at, updated_at = EXCLUDED.updated_at;

INSERT INTO ref.reference_contents
  (id, country_id, city_id, visit_site_id, content_type, locale, content, status,
   generation_model, content_hash, generated_at, approved_at, refresh_after,
   error_message, created_at, updated_at)
SELECT rc.id,
       CASE WHEN rc.entity_type = 'country' THEN rc.entity_id END,
       CASE WHEN rc.entity_type = 'city' THEN rc.entity_id END,
       CASE WHEN rc.entity_type = 'site' THEN rc.entity_id END,
       rc.content_type, rc.locale, rc.content,
       CASE rc.status WHEN 'ready' THEN 'approved' WHEN 'pending' THEN 'draft'
            WHEN 'failed' THEN 'failed' ELSE 'retired' END,
       rc.model, NULL,
       rc.refreshed_at,
       CASE WHEN rc.status = 'ready'
            THEN COALESCE(rc.refreshed_at, rc.updated_at, rc.created_at) END,
       rc.refresh_after, rc.error_message, rc.created_at, rc.updated_at
FROM public.reference_contents rc
WHERE rc.entity_type IN ('country', 'city', 'site')
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content, status = EXCLUDED.status,
  generation_model = EXCLUDED.generation_model,
  content_hash = EXCLUDED.content_hash, generated_at = EXCLUDED.generated_at,
  approved_at = EXCLUDED.approved_at, refresh_after = EXCLUDED.refresh_after,
  error_message = EXCLUDED.error_message, updated_at = EXCLUDED.updated_at;

INSERT INTO travel.trip_templates
  (id, agency_id, slug, title, primary_country_id, description, status,
   default_locale, default_timezone, created_by_user_id, created_at, updated_at)
SELECT t.id, t.agency_id, t.slug, t.title, t.primary_country_id, t.description,
       t.status, t.default_locale, t.default_timezone, m.target_id,
       t.created_at, t.updated_at
FROM public.trip_templates t
LEFT JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user'
 AND m.legacy_id = t.created_by_user_id
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug, title = EXCLUDED.title,
  primary_country_id = EXCLUDED.primary_country_id,
  description = EXCLUDED.description, status = EXCLUDED.status,
  default_locale = EXCLUDED.default_locale,
  default_timezone = EXCLUDED.default_timezone,
  created_by_user_id = EXCLUDED.created_by_user_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO travel.trip_template_versions
  (id, agency_id, template_id, version_number, status, revision_note,
   published_at, published_by_user_id, created_by_user_id, created_at)
SELECT v.id, v.agency_id, v.template_id, v.version_number, v.status,
       v.revision_note, v.published_at,
       CASE WHEN v.status IN ('published','archived') THEN m.target_id END,
       m.target_id, v.created_at
FROM public.trip_template_versions v
LEFT JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user'
 AND m.legacy_id = v.created_by_user_id
ON CONFLICT (id) DO UPDATE SET
  version_number = EXCLUDED.version_number, status = EXCLUDED.status,
  revision_note = EXCLUDED.revision_note, published_at = EXCLUDED.published_at,
  published_by_user_id = EXCLUDED.published_by_user_id,
  created_by_user_id = EXCLUDED.created_by_user_id;

WITH country_set AS (
  SELECT t.agency_id, t.id AS template_id, t.primary_country_id AS country_id, 0 AS priority
  FROM public.trip_templates t
  WHERE t.primary_country_id IS NOT NULL
  UNION
  SELECT t.agency_id, tc.template_id, tc.country_id, 1 AS priority
  FROM public.trip_countries tc
  JOIN public.trip_templates t ON t.id = tc.template_id
), ranked AS (
  SELECT agency_id, template_id, country_id,
         row_number() OVER (
           PARTITION BY template_id ORDER BY min(priority), country_id
         )::smallint - 1 AS sort_order
  FROM country_set
  GROUP BY agency_id, template_id, country_id
)
INSERT INTO travel.template_countries (agency_id, template_id, country_id, sort_order)
SELECT agency_id, template_id, country_id, sort_order FROM ranked
ON CONFLICT (template_id, country_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO travel.template_days
  (id, agency_id, template_version_id, day_number, day_offset, title,
   description, metadata)
SELECT id, agency_id, template_version_id, day_number, day_offset, title,
       description,
       metadata || jsonb_strip_nulls(jsonb_build_object(
         'legacyLabel', NULLIF(label, ''), 'legacyCity', NULLIF(city, ''),
         'sourceDate', source_date
       ))
FROM public.trip_days
ON CONFLICT (id) DO UPDATE SET
  day_number = EXCLUDED.day_number, day_offset = EXCLUDED.day_offset,
  title = EXCLUDED.title, description = EXCLUDED.description,
  metadata = EXCLUDED.metadata;

INSERT INTO travel.template_day_cities
  (agency_id, template_version_id, template_day_id, city_id, sort_order)
SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.city_id,
       row_number() OVER (PARTITION BY x.trip_day_id ORDER BY x.city_id)::smallint - 1
FROM public.trip_day_cities x
JOIN public.trip_days d ON d.id = x.trip_day_id
ON CONFLICT (template_day_id, city_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO travel.template_day_sites
  (agency_id, template_version_id, template_day_id, visit_site_id, sort_order)
SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.site_id,
       row_number() OVER (PARTITION BY x.trip_day_id ORDER BY x.site_id)::smallint - 1
FROM public.trip_day_sites x
JOIN public.trip_days d ON d.id = x.trip_day_id
ON CONFLICT (template_day_id, visit_site_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO travel.template_day_hotels
  (agency_id, template_version_id, template_day_id, hotel_id, sort_order)
SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.hotel_id,
       row_number() OVER (PARTITION BY x.trip_day_id ORDER BY x.hotel_id)::smallint - 1
FROM public.trip_day_hotels x
JOIN public.trip_days d ON d.id = x.trip_day_id
ON CONFLICT (template_day_id, hotel_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO travel.template_itinerary_items
  (id, agency_id, template_version_id, template_day_id, item_type, title,
   description, notes, sort_order, scheduled_start_local, scheduled_end_local,
   source_page, extraction_confidence, metadata)
SELECT i.id, i.agency_id, d.template_version_id, i.trip_day_id, i.item_type,
       i.title, i.description,
       COALESCE(NULLIF(i.metadata->>'notes', ''), NULLIF(i.metadata->>'note', ''), ''),
       i.sort_order,
       CASE WHEN i.item_type IN ('transport','flight','train') THEN i.starts_at END,
       CASE WHEN i.item_type IN ('transport','flight','train') THEN i.ends_at END,
       i.source_page, i.extraction_confidence, i.metadata
FROM public.itinerary_items i
JOIN public.trip_days d ON d.id = i.trip_day_id
ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type, title = EXCLUDED.title,
  description = EXCLUDED.description, notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  scheduled_start_local = EXCLUDED.scheduled_start_local,
  scheduled_end_local = EXCLUDED.scheduled_end_local,
  source_page = EXCLUDED.source_page,
  extraction_confidence = EXCLUDED.extraction_confidence,
  metadata = EXCLUDED.metadata;

INSERT INTO travel.departures
  (id, agency_id, template_id, template_version_id, code, title, starts_on,
   ends_on, timezone, default_locale, status, settings, published_at,
   created_at, updated_at)
SELECT d.id, d.agency_id, d.template_id, d.template_version_id, d.code, d.title,
       d.starts_on, d.ends_on, d.timezone, t.default_locale, d.status,
       d.settings, d.published_at, d.created_at, d.updated_at
FROM public.departures d
JOIN public.trip_templates t ON t.id = d.template_id
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code, title = EXCLUDED.title, starts_on = EXCLUDED.starts_on,
  ends_on = EXCLUDED.ends_on, timezone = EXCLUDED.timezone,
  default_locale = EXCLUDED.default_locale, status = EXCLUDED.status,
  settings = EXCLUDED.settings, published_at = EXCLUDED.published_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id, agency_id)
SELECT 'public-v2', 'departure_day', d.id::text || ':' || td.id::text, d.agency_id
FROM public.departures d
JOIN public.trip_days td ON td.template_version_id = d.template_version_id
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

INSERT INTO travel.departure_days
  (id, agency_id, departure_id, template_version_id, template_day_id, service_date)
SELECT m.target_id, d.agency_id, d.id, d.template_version_id, td.id,
       d.starts_on + td.day_offset
FROM public.departures d
JOIN public.trip_days td ON td.template_version_id = d.template_version_id
JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'departure_day'
 AND m.legacy_id = d.id::text || ':' || td.id::text
ON CONFLICT (id) DO UPDATE SET service_date = EXCLUDED.service_date;

INSERT INTO ops.legacy_id_map (source_system, entity_type, legacy_id, agency_id)
SELECT 'public-v2', 'departure_item', d.id::text || ':' || i.id::text, d.agency_id
FROM public.departures d
JOIN public.trip_days td ON td.template_version_id = d.template_version_id
JOIN public.itinerary_items i ON i.trip_day_id = td.id
ON CONFLICT (source_system, entity_type, legacy_id) DO NOTHING;

INSERT INTO travel.departure_itinerary_items
  (id, agency_id, departure_id, template_version_id, departure_day_id,
   source_template_item_id, item_type, title, description, notes, sort_order,
   scheduled_start_at, scheduled_end_at, metadata, created_at, updated_at)
SELECT mi.target_id, d.agency_id, d.id, d.template_version_id, dd.id, i.id,
       i.item_type, i.title, i.description,
       COALESCE(NULLIF(i.metadata->>'notes', ''), NULLIF(i.metadata->>'note', ''), ''),
       i.sort_order,
       CASE WHEN i.item_type IN ('transport','flight','train') THEN
         COALESCE(i.scheduled_start_at,
                  CASE WHEN i.starts_at IS NOT NULL
                       THEN (dd.service_date + i.starts_at) AT TIME ZONE d.timezone END)
       END,
       CASE WHEN i.item_type IN ('transport','flight','train') THEN
         COALESCE(i.scheduled_end_at,
                  CASE WHEN i.ends_at IS NOT NULL THEN
                    (dd.service_date + i.ends_at +
                      CASE WHEN i.starts_at IS NOT NULL AND i.ends_at < i.starts_at
                           THEN interval '1 day' ELSE interval '0' END)
                    AT TIME ZONE d.timezone END)
       END,
       i.metadata, d.created_at, d.updated_at
FROM public.departures d
JOIN public.trip_days td ON td.template_version_id = d.template_version_id
JOIN public.itinerary_items i ON i.trip_day_id = td.id
JOIN travel.departure_days dd
  ON dd.departure_id = d.id AND dd.template_day_id = td.id
JOIN ops.legacy_id_map mi
  ON mi.source_system = 'public-v2' AND mi.entity_type = 'departure_item'
 AND mi.legacy_id = d.id::text || ':' || i.id::text
ON CONFLICT (id) DO UPDATE SET
  departure_day_id = EXCLUDED.departure_day_id,
  item_type = EXCLUDED.item_type, title = EXCLUDED.title,
  description = EXCLUDED.description, notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  scheduled_start_at = EXCLUDED.scheduled_start_at,
  scheduled_end_at = EXCLUDED.scheduled_end_at,
  metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at;

INSERT INTO travel.traveler_profiles
  (id, agency_id, user_id, display_name, email, phone, birth_date, metadata,
   created_at, updated_at)
SELECT p.id, p.agency_id, m.target_id, p.display_name, p.email, p.phone,
       p.birth_date, p.metadata, p.created_at, p.updated_at
FROM public.traveler_profiles p
LEFT JOIN ops.legacy_id_map m
  ON m.source_system = 'public-v2' AND m.entity_type = 'user' AND m.legacy_id = p.user_id
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name,
  email = EXCLUDED.email, phone = EXCLUDED.phone,
  birth_date = EXCLUDED.birth_date, metadata = EXCLUDED.metadata,
  updated_at = EXCLUDED.updated_at;

INSERT INTO travel.travel_parties
  (id, agency_id, departure_id, code, name, status, settings, created_at, updated_at)
SELECT id, agency_id, departure_id, code, name, status, settings, created_at, updated_at
FROM public.travel_parties
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code, name = EXCLUDED.name, status = EXCLUDED.status,
  settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at;

INSERT INTO travel.party_memberships
  (agency_id, departure_id, party_id, traveler_id, role, member_type, status, joined_at)
SELECT pm.agency_id, p.departure_id, pm.party_id, pm.traveler_id, pm.role,
       CASE WHEN pm.role <> 'organizer' AND tp.birth_date IS NOT NULL
                  AND tp.birth_date > (d.starts_on - interval '18 years')::date
            THEN 'dependent_minor' ELSE 'adult' END,
       pm.status, pm.joined_at
FROM public.party_memberships pm
JOIN public.travel_parties p ON p.id = pm.party_id
JOIN public.traveler_profiles tp ON tp.id = pm.traveler_id
JOIN public.departures d ON d.id = p.departure_id
ON CONFLICT (party_id, traveler_id) DO UPDATE SET
  role = EXCLUDED.role, member_type = EXCLUDED.member_type,
  status = EXCLUDED.status;

ALTER TABLE travel.template_days ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_cities ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_sites ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_day_hotels ENABLE TRIGGER guard_template_version_mutation;
ALTER TABLE travel.template_itinerary_items ENABLE TRIGGER guard_template_version_mutation;
