-- SMF Travel - target physical model v3 for independent review
-- PostgreSQL 18 / Neon. Target-state only: not a production migration.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS travel;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS journey;
CREATE SCHEMA IF NOT EXISTS privacy;

CREATE DOMAIN app.currency_code AS VARCHAR(3)
  CHECK (VALUE = upper(VALUE) AND VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN app.locale_code AS VARCHAR(35)
  CHECK (VALUE ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$');
CREATE DOMAIN app.positive_score AS NUMERIC(12,3) CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION app.current_agency_id()
RETURNS UUID LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.agency_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE ops.schema_migrations (
  version TEXT PRIMARY KEY,
  checksum_sha256 CHAR(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  execution_ms INTEGER CHECK (execution_ms IS NULL OR execution_ms >= 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Identity is provider-independent. External subjects are alternate identities,
-- never the domain primary key.
CREATE TABLE iam.users (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  display_name VARCHAR(160) NOT NULL CHECK (btrim(display_name) <> ''),
  email TEXT,
  normalized_email TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  phone TEXT,
  platform_role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (platform_role IN ('superadmin', 'user')),
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'disabled', 'anonymized')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_email)
);

CREATE TABLE iam.user_identities (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE iam.agencies (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  slug VARCHAR(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name VARCHAR(200) NOT NULL CHECK (btrim(name) <> ''),
  legal_name TEXT,
  vat_number VARCHAR(32),
  tax_code VARCHAR(32),
  registered_address TEXT,
  registered_city TEXT,
  registered_postal_code VARCHAR(20),
  registered_province VARCHAR(100),
  registered_country_code VARCHAR(2),
  pec TEXT,
  sdi_code VARCHAR(20),
  phone TEXT,
  email TEXT,
  website TEXT,
  reference_name TEXT NOT NULL CHECK (btrim(reference_name) <> ''),
  reference_email TEXT,
  reference_phone TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'suspended', 'deleting', 'closed')),
  default_locale app.locale_code NOT NULL DEFAULT 'it-IT',
  default_timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  branding JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(branding) = 'object'),
  settings JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE iam.agency_memberships (
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, user_id)
);
CREATE INDEX agency_memberships_user_idx ON iam.agency_memberships (user_id, agency_id)
  WHERE status = 'active';

CREATE TABLE iam.invitations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  invited_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX invitations_active_idx ON iam.invitations (invited_user_id, expires_at DESC)
  WHERE used_at IS NULL;
CREATE INDEX invitations_tenant_idx ON iam.invitations (agency_id, expires_at DESC, id)
  WHERE agency_id IS NOT NULL;

CREATE TABLE iam.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  target_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  user_agent TEXT,
  CHECK (actor_user_id <> target_user_id),
  CHECK (expires_at > started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX impersonation_sessions_active_idx
  ON iam.impersonation_sessions (actor_user_id, expires_at DESC) WHERE ended_at IS NULL;

-- Shared mastered/reference data.
CREATE TABLE ref.countries (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  iso_code VARCHAR(2) NOT NULL UNIQUE CHECK (iso_code = upper(iso_code) AND iso_code ~ '^[A-Z]{2}$'),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL UNIQUE,
  google_url TEXT NOT NULL,
  default_timezone TEXT,
  last_verified_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ref.cities (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  country_id UUID NOT NULL REFERENCES ref.countries(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  google_place_id TEXT,
  location GEOGRAPHY(POINT, 4326),
  timezone TEXT,
  last_verified_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_id, normalized_name)
);
CREATE INDEX cities_country_idx ON ref.cities (country_id, normalized_name);
CREATE INDEX cities_location_gix ON ref.cities USING GIST (location);

CREATE TABLE ref.visit_sites (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  city_id UUID NOT NULL REFERENCES ref.cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  google_place_id TEXT,
  official_url TEXT,
  location GEOGRAPHY(POINT, 4326),
  last_verified_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, normalized_name)
);
CREATE INDEX visit_sites_city_idx ON ref.visit_sites (city_id, normalized_name);
CREATE INDEX visit_sites_location_gix ON ref.visit_sites USING GIST (location);
CREATE INDEX visit_sites_name_trgm_idx ON ref.visit_sites USING GIN (normalized_name gin_trgm_ops);

CREATE TABLE ref.hotels (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  city_id UUID NOT NULL REFERENCES ref.cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  google_place_id TEXT,
  website_url TEXT,
  location GEOGRAPHY(POINT, 4326),
  last_verified_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, normalized_name)
);
CREATE INDEX hotels_city_idx ON ref.hotels (city_id, normalized_name);
CREATE INDEX hotels_location_gix ON ref.hotels USING GIST (location);
CREATE INDEX hotels_name_trgm_idx ON ref.hotels USING GIN (normalized_name gin_trgm_ops);

CREATE TABLE ref.currencies (
  code app.currency_code PRIMARY KEY,
  name TEXT NOT NULL,
  minor_unit SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE ref.reference_contents (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  country_id UUID REFERENCES ref.countries(id) ON DELETE CASCADE,
  city_id UUID REFERENCES ref.cities(id) ON DELETE CASCADE,
  visit_site_id UUID REFERENCES ref.visit_sites(id) ON DELETE CASCADE,
  subject_kind VARCHAR(12) GENERATED ALWAYS AS (
    CASE WHEN country_id IS NOT NULL THEN 'country'
         WHEN city_id IS NOT NULL THEN 'city'
         ELSE 'site' END
  ) STORED,
  content_type VARCHAR(30) NOT NULL CHECK (content_type IN
    ('useful_info','phrasebook','bingo','quiz','mission','game','photo_contest')),
  locale app.locale_code NOT NULL DEFAULT 'it-IT',
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) IN ('object','array')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_review','approved','failed','retired')),
  generation_model TEXT,
  prompt_hash CHAR(64),
  content_hash CHAR(64),
  generated_at TIMESTAMPTZ,
  approved_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(country_id, city_id, visit_site_id) = 1),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CHECK (prompt_hash IS NULL OR prompt_hash ~ '^[0-9a-f]{64}$'),
  CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX reference_country_content_uidx
  ON ref.reference_contents (country_id, content_type, locale) WHERE country_id IS NOT NULL AND status <> 'retired';
CREATE UNIQUE INDEX reference_city_content_uidx
  ON ref.reference_contents (city_id, content_type, locale) WHERE city_id IS NOT NULL AND status <> 'retired';
CREATE UNIQUE INDEX reference_site_content_uidx
  ON ref.reference_contents (visit_site_id, content_type, locale) WHERE visit_site_id IS NOT NULL AND status <> 'retired';
CREATE INDEX reference_content_refresh_idx ON ref.reference_contents (refresh_after, content_type)
  WHERE status IN ('approved','failed');

CREATE TABLE ref.reference_content_sources (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  reference_content_id UUID NOT NULL REFERENCES ref.reference_contents(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  publisher TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  source_hash CHAR(64),
  source_role VARCHAR(16) NOT NULL DEFAULT 'evidence'
    CHECK (source_role IN ('primary','evidence','cross_check')),
  UNIQUE (reference_content_id, source_url),
  CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$')
);

-- Reusable, versioned itinerary product.
CREATE TABLE travel.trip_templates (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  slug VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL CHECK (btrim(title) <> ''),
  primary_country_id UUID REFERENCES ref.countries(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  default_locale app.locale_code NOT NULL DEFAULT 'it-IT',
  default_timezone TEXT NOT NULL DEFAULT 'UTC',
  created_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_id, slug),
  UNIQUE (agency_id, id)
);

CREATE TABLE travel.trip_template_versions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  revision_note TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  published_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES travel.trip_templates(agency_id, id) ON DELETE CASCADE,
  UNIQUE (template_id, version_number),
  UNIQUE (agency_id, template_id, id),
  UNIQUE (agency_id, id),
  CHECK ((status = 'draft' AND published_at IS NULL) OR
         (status IN ('published','archived') AND published_at IS NOT NULL))
);

CREATE TABLE travel.template_days (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  day_number SMALLINT NOT NULL CHECK (day_number > 0),
  day_offset SMALLINT NOT NULL CHECK (day_offset >= 0),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES travel.trip_template_versions(agency_id, id) ON DELETE CASCADE,
  UNIQUE (template_version_id, day_number),
  UNIQUE (template_version_id, day_offset),
  UNIQUE (agency_id, template_version_id, id),
  UNIQUE (agency_id, id),
  CHECK (day_number = day_offset + 1)
);

CREATE TABLE travel.template_day_cities (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  city_id UUID NOT NULL REFERENCES ref.cities(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL CHECK (sort_order >= 0),
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_day_id, city_id),
  UNIQUE (template_day_id, sort_order)
);
CREATE INDEX template_day_cities_tenant_idx ON travel.template_day_cities
  (agency_id, template_version_id, template_day_id, sort_order, city_id);

CREATE TABLE travel.template_day_sites (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  visit_site_id UUID NOT NULL REFERENCES ref.visit_sites(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL CHECK (sort_order >= 0),
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_day_id, visit_site_id),
  UNIQUE (template_day_id, sort_order)
);
CREATE INDEX template_day_sites_tenant_idx ON travel.template_day_sites
  (agency_id, template_version_id, template_day_id, sort_order, visit_site_id);

CREATE TABLE travel.template_day_hotels (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  hotel_id UUID NOT NULL REFERENCES ref.hotels(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL CHECK (sort_order >= 0),
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_day_id, hotel_id),
  UNIQUE (template_day_id, sort_order)
);
CREATE INDEX template_day_hotels_tenant_idx ON travel.template_day_hotels
  (agency_id, template_version_id, template_day_id, sort_order, hotel_id);

CREATE TABLE travel.template_itinerary_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  visit_site_id UUID REFERENCES ref.visit_sites(id) ON DELETE RESTRICT,
  hotel_id UUID REFERENCES ref.hotels(id) ON DELETE RESTRICT,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN
    ('visit','transport','flight','train','hotel','meal','free_time','meeting','other')),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  scheduled_start_local TIME,
  scheduled_end_local TIME,
  source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
  extraction_confidence NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE CASCADE,
  UNIQUE (template_day_id, sort_order),
  UNIQUE (agency_id, template_version_id, id),
  UNIQUE (agency_id, id),
  CHECK (num_nonnulls(visit_site_id, hotel_id) <= 1),
  CHECK ((scheduled_start_local IS NULL AND scheduled_end_local IS NULL) OR
         item_type IN ('transport','flight','train'))
);
CREATE INDEX template_items_day_sort_idx ON travel.template_itinerary_items
  (template_day_id, sort_order, id);

CREATE TABLE travel.template_itinerary_item_translations (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_item_id UUID NOT NULL,
  locale app.locale_code NOT NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_content_hash CHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','stale','retired')),
  translated_by VARCHAR(12) NOT NULL DEFAULT 'human' CHECK (translated_by IN ('human','ai')),
  approved_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id, template_item_id)
    REFERENCES travel.template_itinerary_items(agency_id, template_version_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_item_id, locale),
  UNIQUE (agency_id, template_version_id, template_item_id, locale),
  CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
CREATE INDEX template_item_translations_tenant_idx ON travel.template_itinerary_item_translations
  (agency_id, template_version_id, locale, status, template_item_id);

CREATE TABLE travel.departures (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  code VARCHAR(80) NOT NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  timezone TEXT NOT NULL,
  default_locale app.locale_code NOT NULL DEFAULT 'it-IT',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','open','confirmed','in_progress','completed','cancelled','archived')),
  settings JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES travel.trip_templates(agency_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, template_id, template_version_id)
    REFERENCES travel.trip_template_versions(agency_id, template_id, id) ON DELETE RESTRICT,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id),
  UNIQUE (agency_id, id, template_version_id),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX departures_agency_status_dates_idx ON travel.departures
  (agency_id, status, starts_on, ends_on, id);

CREATE TABLE travel.departure_days (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID NOT NULL,
  service_date DATE NOT NULL,
  FOREIGN KEY (agency_id, departure_id, template_version_id)
    REFERENCES travel.departures(agency_id, id, template_version_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE RESTRICT,
  UNIQUE (departure_id, template_day_id),
  UNIQUE (departure_id, service_date),
  UNIQUE (agency_id, departure_id, template_version_id, id),
  UNIQUE (agency_id, departure_id, id),
  UNIQUE (agency_id, id)
);

-- Materialized effective programme. Agency edits never mutate a published template.
CREATE TABLE travel.departure_itinerary_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  source_template_item_id UUID,
  visit_site_id UUID REFERENCES ref.visit_sites(id) ON DELETE RESTRICT,
  hotel_id UUID REFERENCES ref.hotels(id) ON DELETE RESTRICT,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN
    ('visit','transport','flight','train','hotel','meal','free_time','meeting','other')),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  operational_status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (operational_status IN
    ('planned','confirmed','delayed','rescheduled','cancelled','completed')),
  original_departure_day_id UUID,
  original_scheduled_start_at TIMESTAMPTZ,
  original_scheduled_end_at TIMESTAMPTZ,
  status_reason TEXT NOT NULL DEFAULT '',
  status_changed_at TIMESTAMPTZ,
  replacement_item_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, template_version_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, template_version_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, source_template_item_id)
    REFERENCES travel.template_itinerary_items(agency_id, template_version_id, id)
    ON DELETE SET NULL (source_template_item_id),
  FOREIGN KEY (agency_id, departure_id, original_departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id)
    ON DELETE SET NULL (original_departure_day_id),
  FOREIGN KEY (agency_id, departure_id, replacement_item_id)
    REFERENCES travel.departure_itinerary_items(agency_id, departure_id, id)
    ON DELETE SET NULL (replacement_item_id),
  UNIQUE (departure_day_id, sort_order),
  UNIQUE (agency_id, departure_id, id),
  UNIQUE (agency_id, id),
  CHECK (num_nonnulls(visit_site_id, hotel_id) <= 1),
  CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at),
  CHECK (original_scheduled_end_at IS NULL OR original_scheduled_start_at IS NULL OR
         original_scheduled_end_at >= original_scheduled_start_at),
  CHECK (replacement_item_id IS NULL OR replacement_item_id <> id),
  CHECK ((operational_status IN ('delayed','rescheduled','cancelled') AND status_changed_at IS NOT NULL)
      OR (operational_status NOT IN ('delayed','rescheduled','cancelled'))),
  CHECK ((scheduled_start_at IS NULL AND scheduled_end_at IS NULL) OR
         item_type IN ('transport','flight','train'))
);
CREATE INDEX departure_items_operational_idx ON travel.departure_itinerary_items
  (agency_id, departure_id, operational_status, departure_day_id, sort_order, id);

CREATE TABLE travel.itinerary_disruption_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  itinerary_item_id UUID NOT NULL,
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN
    ('delay','reschedule','cancel','restore','replace','complete','note')),
  previous_state JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(previous_state) = 'object'),
  new_state JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(new_state) = 'object'),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  changed_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  client_operation_id UUID NOT NULL,
  FOREIGN KEY (agency_id, departure_id, itinerary_item_id)
    REFERENCES travel.departure_itinerary_items(agency_id, departure_id, id) ON DELETE CASCADE,
  UNIQUE (departure_id, client_operation_id),
  UNIQUE (agency_id, id)
);
CREATE INDEX itinerary_disruption_tenant_idx ON travel.itinerary_disruption_events
  (agency_id, departure_id, itinerary_item_id, occurred_at DESC, id DESC);

CREATE TABLE travel.departure_itinerary_item_translations (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  itinerary_item_id UUID NOT NULL,
  locale app.locale_code NOT NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_content_hash CHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','stale','retired')),
  translated_by VARCHAR(12) NOT NULL DEFAULT 'human' CHECK (translated_by IN ('human','ai')),
  approved_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, itinerary_item_id)
    REFERENCES travel.departure_itinerary_items(agency_id, departure_id, id) ON DELETE CASCADE,
  PRIMARY KEY (itinerary_item_id, locale),
  UNIQUE (agency_id, departure_id, itinerary_item_id, locale),
  CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
CREATE INDEX departure_item_translations_tenant_idx ON travel.departure_itinerary_item_translations
  (agency_id, departure_id, locale, status, itinerary_item_id);

CREATE TABLE travel.traveler_profiles (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  email TEXT,
  phone TEXT,
  birth_date DATE,
  preferred_locale app.locale_code,
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE travel.travel_parties (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  code VARCHAR(80) NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  preferred_locale app.locale_code,
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','completed','archived')),
  settings JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES travel.departures(agency_id, id) ON DELETE CASCADE,
  UNIQUE (departure_id, code),
  UNIQUE (agency_id, departure_id, id),
  UNIQUE (agency_id, id)
);
CREATE INDEX travel_parties_departure_idx ON travel.travel_parties (departure_id, status, id);

CREATE TABLE travel.party_memberships (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('organizer','member')),
  member_type VARCHAR(24) NOT NULL DEFAULT 'adult'
    CHECK (member_type IN ('adult','dependent_minor')),
  status VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, traveler_id) REFERENCES travel.traveler_profiles(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (party_id, traveler_id),
  UNIQUE (agency_id, departure_id, party_id, traveler_id),
  UNIQUE (agency_id, party_id, traveler_id),
  CHECK (role <> 'organizer' OR member_type = 'adult')
);
CREATE INDEX party_memberships_traveler_active_idx ON travel.party_memberships
  (traveler_id, party_id, agency_id) WHERE status = 'active';

CREATE TABLE travel.traveler_guardianships (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  minor_traveler_id UUID NOT NULL,
  guardian_traveler_id UUID NOT NULL,
  relationship VARCHAR(40) NOT NULL CHECK (btrim(relationship) <> ''),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  effective_from DATE NOT NULL,
  effective_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id, minor_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, guardian_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  PRIMARY KEY (party_id, minor_traveler_id, guardian_traveler_id),
  UNIQUE (agency_id, departure_id, party_id, minor_traveler_id, guardian_traveler_id),
  CHECK (minor_traveler_id <> guardian_traveler_id),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE INDEX traveler_guardianships_tenant_idx ON travel.traveler_guardianships
  (agency_id, departure_id, party_id, minor_traveler_id, status, guardian_traveler_id);

-- Generated and curated experiences. Answer keys stay server-side.
CREATE TABLE content.activities (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  template_day_id UUID,
  source_reference_content_id UUID REFERENCES ref.reference_contents(id) ON DELETE SET NULL,
  activity_type VARCHAR(24) NOT NULL CHECK (activity_type IN
    ('quiz','mission','bingo','word_game','order_game','puzzle','photo_contest')),
  contest_category VARCHAR(12) CHECK (contest_category IN ('free','theme')),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT NOT NULL DEFAULT '',
  availability_rule VARCHAR(24) NOT NULL DEFAULT 'always'
    CHECK (availability_rule IN ('always','relative_day_time','manual')),
  relative_days SMALLINT,
  unlock_local_time TIME,
  max_score app.positive_score,
  max_entries SMALLINT CHECK (max_entries IS NULL OR max_entries > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  source VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','ai')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  config JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES travel.trip_template_versions(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, template_day_id)
    REFERENCES travel.template_days(agency_id, template_version_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, template_version_id, id),
  UNIQUE (agency_id, id),
  CHECK ((availability_rule = 'relative_day_time' AND relative_days IS NOT NULL AND unlock_local_time IS NOT NULL)
      OR (availability_rule <> 'relative_day_time' AND relative_days IS NULL AND unlock_local_time IS NULL)),
  CHECK ((activity_type = 'photo_contest' AND contest_category IS NOT NULL AND max_entries = 3)
      OR (activity_type <> 'photo_contest' AND contest_category IS NULL AND max_entries IS NULL))
);
CREATE UNIQUE INDEX activities_daily_contest_uidx ON content.activities
  (template_day_id, contest_category) WHERE activity_type = 'photo_contest' AND status <> 'archived';
CREATE INDEX activities_runtime_idx ON content.activities
  (agency_id, template_version_id, template_day_id, sort_order, id) WHERE status = 'approved';

CREATE TABLE content.activity_items (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal > 0),
  item_kind VARCHAR(24) NOT NULL CHECK (item_kind IN
    ('question','mission','bingo_cell','word','order_step','puzzle_image','contest_rule')),
  prompt TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  answer_spec JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answer_spec) = 'object'),
  points app.positive_score NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE CASCADE,
  UNIQUE (activity_id, ordinal),
  UNIQUE (agency_id, template_version_id, activity_id, id),
  UNIQUE (agency_id, id)
);

CREATE TABLE content.activity_translations (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  locale app.locale_code NOT NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT NOT NULL DEFAULT '',
  source_content_hash CHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','stale','retired')),
  translated_by VARCHAR(12) NOT NULL DEFAULT 'human' CHECK (translated_by IN ('human','ai')),
  approved_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, locale),
  UNIQUE (agency_id, template_version_id, activity_id, locale),
  CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
CREATE INDEX activity_translations_tenant_idx ON content.activity_translations
  (agency_id, template_version_id, locale, status, activity_id);

CREATE TABLE content.activity_item_translations (
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  activity_item_id UUID NOT NULL,
  locale app.locale_code NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  source_content_hash CHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','stale','retired')),
  translated_by VARCHAR(12) NOT NULL DEFAULT 'human' CHECK (translated_by IN ('human','ai')),
  approved_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, activity_id, activity_item_id)
    REFERENCES content.activity_items(agency_id, template_version_id, activity_id, id) ON DELETE CASCADE,
  PRIMARY KEY (activity_item_id, locale),
  UNIQUE (agency_id, template_version_id, activity_id, activity_item_id, locale),
  CHECK (source_content_hash IS NULL OR source_content_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
CREATE INDEX activity_item_translations_tenant_idx ON content.activity_item_translations
  (agency_id, template_version_id, locale, status, activity_item_id);

-- Object data stays in R2/S3; PostgreSQL stores governed metadata and scope.
CREATE TABLE ops.media_assets (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  departure_id UUID,
  party_id UUID,
  uploaded_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('r2','s3')),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 CHAR(64),
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN
    ('source_document','normalized_document','ticket','voucher','memory','challenge_evidence','contest_entry','other')),
  visibility VARCHAR(20) NOT NULL CHECK (visibility IN ('private','party','departure','agency')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','quarantined','deleted')),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  retention_until DATE,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (agency_id, departure_id) REFERENCES travel.departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  UNIQUE (provider, bucket, object_key),
  UNIQUE (agency_id, departure_id, id),
  UNIQUE (agency_id, departure_id, party_id, id),
  UNIQUE (agency_id, id),
  CHECK (party_id IS NULL OR departure_id IS NOT NULL),
  CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE INDEX media_assets_scope_idx ON ops.media_assets
  (agency_id, departure_id, party_id, created_at DESC, id);
CREATE INDEX media_assets_party_ready_idx ON ops.media_assets (party_id, created_at DESC, id)
  WHERE status = 'ready';

CREATE TABLE ops.media_asset_subjects (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  subject_party_id UUID NOT NULL,
  subject_traveler_id UUID NOT NULL,
  identification_method VARCHAR(16) NOT NULL DEFAULT 'declared'
    CHECK (identification_method IN ('declared','confirmed','assisted')),
  confirmation_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending','confirmed','rejected')),
  confirmed_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, media_asset_id)
    REFERENCES ops.media_assets(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, subject_party_id, subject_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  PRIMARY KEY (media_asset_id, subject_traveler_id),
  UNIQUE (agency_id, departure_id, media_asset_id, subject_traveler_id),
  CHECK ((confirmation_status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK (confirmation_status <> 'confirmed' OR confirmed_by_user_id IS NOT NULL)
);
CREATE INDEX media_asset_subjects_tenant_idx ON ops.media_asset_subjects
  (agency_id, departure_id, subject_party_id, subject_traveler_id, media_asset_id);

CREATE TABLE privacy.consent_records (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  subject_traveler_id UUID NOT NULL,
  decided_by_traveler_id UUID NOT NULL,
  consent_type VARCHAR(40) NOT NULL CHECK (consent_type IN
    ('minor_image_upload','photo_contest','party_sharing','departure_sharing','agency_promotion')),
  consent_scope VARCHAR(20) NOT NULL CHECK (consent_scope IN
    ('party','departure','agency','promotion')),
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('granted','denied','withdrawn')),
  policy_version VARCHAR(40) NOT NULL CHECK (btrim(policy_version) <> ''),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ,
  supersedes_consent_id UUID,
  evidence_asset_id UUID,
  captured_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  capture_method VARCHAR(20) NOT NULL CHECK (capture_method IN
    ('digital','paper_evidence','agency_attestation')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id, subject_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, decided_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, supersedes_consent_id)
    REFERENCES privacy.consent_records(agency_id, departure_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, evidence_asset_id)
    REFERENCES ops.media_assets(agency_id, departure_id, id) ON DELETE RESTRICT,
  UNIQUE (agency_id, departure_id, id),
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK (supersedes_consent_id IS NULL OR supersedes_consent_id <> id),
  CHECK (decision <> 'withdrawn' OR supersedes_consent_id IS NOT NULL)
);
CREATE INDEX consent_records_tenant_subject_idx ON privacy.consent_records
  (agency_id, departure_id, party_id, subject_traveler_id, consent_type, consent_scope,
   effective_at DESC, id DESC);
CREATE UNIQUE INDEX consent_records_successor_uidx ON privacy.consent_records
  (supersedes_consent_id) WHERE supersedes_consent_id IS NOT NULL;

CREATE TABLE ops.travel_documents (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_id UUID,
  departure_id UUID,
  departure_item_id UUID,
  media_asset_id UUID NOT NULL,
  document_type VARCHAR(30) NOT NULL CHECK (document_type IN
    ('accepted_quote','normalized_programme','ticket','voucher','insurance','other')),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  status VARCHAR(20) NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','processing','ready','failed','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES travel.trip_templates(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id) REFERENCES travel.departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_item_id)
    REFERENCES travel.departure_itinerary_items(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, media_asset_id) REFERENCES ops.media_assets(agency_id, id) ON DELETE CASCADE,
  UNIQUE (media_asset_id),
  UNIQUE (agency_id, template_id, id),
  UNIQUE (agency_id, id),
  CHECK (num_nonnulls(template_id, departure_item_id) +
         CASE WHEN departure_id IS NOT NULL AND departure_item_id IS NULL THEN 1 ELSE 0 END = 1),
  CHECK (departure_item_id IS NULL OR departure_id IS NOT NULL)
);

CREATE TABLE ops.import_jobs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  source_document_id UUID NOT NULL,
  normalized_document_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'uploaded' CHECK (status IN
    ('uploaded','queued','extracting','normalizing','generating','ready_for_review','published','failed')),
  extraction_provider TEXT,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES travel.trip_templates(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_id, source_document_id)
    REFERENCES ops.travel_documents(agency_id, template_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, template_id, normalized_document_id)
    REFERENCES ops.travel_documents(agency_id, template_id, id)
    ON DELETE SET NULL (normalized_document_id),
  UNIQUE (source_document_id),
  UNIQUE (agency_id, id),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX import_jobs_status_idx ON ops.import_jobs (agency_id, status, created_at, id);

CREATE TABLE ops.generation_runs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  import_job_id UUID,
  reference_content_id UUID REFERENCES ref.reference_contents(id) ON DELETE SET NULL,
  provider VARCHAR(40) NOT NULL,
  model TEXT NOT NULL,
  prompt_hash CHAR(64) NOT NULL CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  status VARCHAR(20) NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_microunits BIGINT CHECK (cost_microunits IS NULL OR cost_microunits >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, import_job_id) REFERENCES ops.import_jobs(agency_id, id) ON DELETE CASCADE,
  CHECK (num_nonnulls(import_job_id, reference_content_id) = 1)
);
CREATE INDEX generation_runs_tenant_idx ON ops.generation_runs
  (agency_id, status, created_at, id);

CREATE TABLE ops.platform_jobs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  import_job_id UUID,
  job_type VARCHAR(80) NOT NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('database','sqs')),
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','completed','failed','dead_letter')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  external_id TEXT,
  idempotency_key TEXT NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, import_job_id) REFERENCES ops.import_jobs(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, idempotency_key)
);
CREATE INDEX platform_jobs_available_idx ON ops.platform_jobs (provider, available_at, created_at, id)
  WHERE status = 'queued';

CREATE TABLE ops.integration_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID REFERENCES iam.agencies(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','dead_letter')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'processing') =
         (locked_at IS NOT NULL AND locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (lease_expires_at IS NULL OR locked_at IS NULL OR lease_expires_at > locked_at)
);
CREATE INDEX integration_outbox_pending_idx ON ops.integration_outbox (available_at, id)
  WHERE status IN ('pending','failed');
CREATE INDEX integration_outbox_expired_lease_idx ON ops.integration_outbox (lease_expires_at, id)
  WHERE status = 'processing';
CREATE INDEX integration_outbox_tenant_audit_idx ON ops.integration_outbox
  (agency_id, created_at DESC, id) WHERE agency_id IS NOT NULL;

-- Durable lifecycle orchestration. No FK to iam.agencies is deliberate: the
-- job and its evidence must survive final tenant removal.
CREATE TABLE ops.agency_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  agency_name_snapshot TEXT NOT NULL,
  requested_by_user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','blocked','completed','failed')),
  phase VARCHAR(30) NOT NULL DEFAULT 'freeze'
    CHECK (phase IN ('freeze','revoke_access','delete_objects','delete_facts',
                     'delete_departures','delete_templates','delete_memberships',
                     'close_agency','completed')),
  cursor_state JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(cursor_state) = 'object'),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);
CREATE UNIQUE INDEX agency_deletion_one_active_idx ON ops.agency_deletion_jobs (agency_id)
  WHERE status IN ('queued','processing','blocked');
CREATE INDEX agency_deletion_claim_idx ON ops.agency_deletion_jobs (available_at, requested_at, id)
  WHERE status IN ('queued','processing','blocked');

CREATE OR REPLACE FUNCTION app.claim_integration_outbox(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF ops.integration_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, ops
AS $$
BEGIN
  IF btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_batch_size NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 200';
  END IF;
  IF p_lease_seconds NOT BETWEEN 15 AND 900 THEN
    RAISE EXCEPTION 'lease seconds must be between 15 and 900';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM ops.integration_outbox AS o
    WHERE (o.status IN ('pending','failed') AND o.available_at <= clock_timestamp())
       OR (o.status = 'processing' AND o.lease_expires_at <= clock_timestamp())
    ORDER BY o.available_at, o.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE ops.integration_outbox AS o
     SET status = 'processing',
         attempt_count = o.attempt_count + 1,
         locked_at = clock_timestamp(),
         locked_by = p_worker_id,
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         last_error = NULL
    FROM candidates AS c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;
REVOKE ALL ON FUNCTION app.claim_integration_outbox(TEXT, INTEGER, INTEGER) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.complete_integration_outbox(
  p_event_id BIGINT,
  p_worker_id TEXT,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, ops
AS $$
BEGIN
  IF NOT p_succeeded AND btrim(coalesce(p_error, '')) = '' THEN
    RAISE EXCEPTION 'failure reason is required';
  END IF;
  UPDATE ops.integration_outbox
     SET status = CASE WHEN p_succeeded THEN 'completed'
                       WHEN attempt_count >= 10 THEN 'dead_letter'
                       ELSE 'failed' END,
         processed_at = CASE WHEN p_succeeded THEN clock_timestamp() ELSE NULL END,
         available_at = CASE WHEN p_succeeded OR attempt_count >= 10 THEN available_at
                             ELSE coalesce(p_retry_at, clock_timestamp() + interval '1 minute') END,
         last_error = CASE WHEN p_succeeded THEN NULL ELSE p_error END,
         locked_at = NULL,
         locked_by = NULL,
         lease_expires_at = NULL
   WHERE id = p_event_id AND status = 'processing' AND locked_by = p_worker_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION app.complete_integration_outbox(BIGINT, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC;

-- Party/private facts. Redundant scope columns are deliberate and protected by
-- composite FKs, providing both integrity and efficient RLS/index predicates.
CREATE TABLE journey.expense_groups (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  base_currency app.currency_code NOT NULL DEFAULT 'EUR'
    REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by_party_id UUID NOT NULL,
  created_by_traveler_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, created_by_party_id, created_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id)
    ON DELETE RESTRICT,
  UNIQUE (agency_id, departure_id, id),
  UNIQUE (departure_id, client_operation_id)
);
CREATE INDEX expense_groups_tenant_idx ON journey.expense_groups
  (agency_id, departure_id, status, created_at DESC, id);

CREATE TABLE journey.expense_group_parties (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  expense_group_id UUID NOT NULL,
  party_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','left')),
  accepted_by_traveler_id UUID,
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, expense_group_id)
    REFERENCES journey.expense_groups(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, accepted_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id)
    ON DELETE SET NULL (accepted_by_traveler_id),
  PRIMARY KEY (expense_group_id, party_id),
  UNIQUE (agency_id, departure_id, expense_group_id, party_id),
  CHECK ((status = 'active') = (joined_at IS NOT NULL AND left_at IS NULL)),
  CHECK ((status = 'left') = (left_at IS NOT NULL)),
  CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at)
);
CREATE INDEX expense_group_parties_tenant_idx ON journey.expense_group_parties
  (agency_id, departure_id, expense_group_id, status, party_id);

CREATE TABLE journey.expenses (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID,
  expense_group_id UUID,
  label VARCHAR(240) NOT NULL CHECK (btrim(label) <> ''),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency app.currency_code NOT NULL REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  base_currency app.currency_code NOT NULL DEFAULT 'EUR' REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  exchange_rate_to_base NUMERIC(24,12) NOT NULL CHECK (exchange_rate_to_base > 0),
  base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor > 0),
  paid_by_traveler_id UUID,
  paid_by_name TEXT NOT NULL CHECK (btrim(paid_by_name) <> ''),
  allocation_method VARCHAR(20) NOT NULL DEFAULT 'whole_party'
    CHECK (allocation_method IN ('whole_party','equal','fixed','percentage')),
  allocation_status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (allocation_status IN ('draft','allocated')),
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, expense_group_id)
    REFERENCES journey.expense_groups(agency_id, departure_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id)
    ON DELETE SET NULL (departure_day_id),
  FOREIGN KEY (agency_id, party_id, paid_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, party_id, traveler_id)
    ON DELETE SET NULL (paid_by_traveler_id),
  UNIQUE (party_id, client_operation_id),
  UNIQUE (agency_id, departure_id, id),
  CHECK ((currency = base_currency AND exchange_rate_to_base = 1 AND base_amount_minor = amount_minor)
      OR currency <> base_currency),
  CHECK ((allocation_method = 'whole_party' AND expense_group_id IS NULL)
      OR allocation_method <> 'whole_party')
);
CREATE INDEX expenses_scope_idx ON journey.expenses
  (agency_id, party_id, created_at DESC, id);

CREATE TABLE journey.expense_shares (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  expense_id UUID NOT NULL,
  beneficiary_party_id UUID NOT NULL,
  beneficiary_traveler_id UUID NOT NULL,
  share_amount_minor BIGINT NOT NULL CHECK (share_amount_minor > 0),
  share_base_amount_minor BIGINT NOT NULL CHECK (share_base_amount_minor > 0),
  share_basis NUMERIC(18,8) CHECK (share_basis IS NULL OR share_basis > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, expense_id)
    REFERENCES journey.expenses(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, beneficiary_party_id, beneficiary_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id)
    ON DELETE RESTRICT,
  UNIQUE (expense_id, beneficiary_traveler_id),
  UNIQUE (agency_id, departure_id, expense_id, id)
);
CREATE INDEX expense_shares_tenant_idx ON journey.expense_shares
  (agency_id, departure_id, expense_id, beneficiary_party_id, beneficiary_traveler_id);

CREATE TABLE journey.settlements (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  expense_group_id UUID NOT NULL,
  payer_party_id UUID NOT NULL,
  payer_traveler_id UUID NOT NULL,
  receiver_party_id UUID NOT NULL,
  receiver_traveler_id UUID NOT NULL,
  entry_type VARCHAR(12) NOT NULL DEFAULT 'payment' CHECK (entry_type IN ('payment','reversal')),
  reverses_settlement_id UUID,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency app.currency_code NOT NULL REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  base_currency app.currency_code NOT NULL REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  exchange_rate_to_base NUMERIC(24,12) NOT NULL CHECK (exchange_rate_to_base > 0),
  base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor > 0),
  settled_at TIMESTAMPTZ NOT NULL,
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, expense_group_id, payer_party_id)
    REFERENCES journey.expense_group_parties(agency_id, departure_id, expense_group_id, party_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, expense_group_id, receiver_party_id)
    REFERENCES journey.expense_group_parties(agency_id, departure_id, expense_group_id, party_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, payer_party_id, payer_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, receiver_party_id, receiver_traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, expense_group_id, reverses_settlement_id)
    REFERENCES journey.settlements(agency_id, departure_id, expense_group_id, id)
    ON DELETE RESTRICT,
  UNIQUE (expense_group_id, client_operation_id),
  UNIQUE (agency_id, departure_id, expense_group_id, id),
  UNIQUE (reverses_settlement_id),
  CHECK (payer_traveler_id <> receiver_traveler_id),
  CHECK ((entry_type = 'reversal') = (reverses_settlement_id IS NOT NULL)),
  CHECK ((currency = base_currency AND exchange_rate_to_base = 1 AND base_amount_minor = amount_minor)
      OR currency <> base_currency)
);
CREATE INDEX settlements_tenant_idx ON journey.settlements
  (agency_id, departure_id, expense_group_id, settled_at DESC, id);

CREATE TABLE journey.cash_movements (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('withdrawal','exchange')),
  source_amount_minor BIGINT CHECK (source_amount_minor IS NULL OR source_amount_minor > 0),
  source_currency app.currency_code NOT NULL REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  target_amount_minor BIGINT NOT NULL CHECK (target_amount_minor > 0),
  target_currency app.currency_code NOT NULL REFERENCES ref.currencies(code) ON DELETE RESTRICT,
  applied_rate NUMERIC(24,12) CHECK (applied_rate IS NULL OR applied_rate > 0),
  added_by_traveler_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id, added_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, party_id, traveler_id) ON DELETE RESTRICT,
  UNIQUE (party_id, client_operation_id),
  CHECK (source_currency <> target_currency),
  CHECK ((source_amount_minor IS NULL AND applied_rate IS NULL) OR
         (source_amount_minor IS NOT NULL AND applied_rate IS NOT NULL)),
  CHECK (kind <> 'exchange' OR source_amount_minor IS NOT NULL)
);
CREATE INDEX cash_movements_scope_idx ON journey.cash_movements
  (agency_id, party_id, created_at DESC, id);

CREATE TABLE journey.day_notes (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  note_text TEXT NOT NULL DEFAULT '',
  updated_by_traveler_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id, updated_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, party_id, traveler_id) ON DELETE RESTRICT,
  UNIQUE (party_id, departure_day_id),
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX day_notes_scope_idx ON journey.day_notes
  (agency_id, party_id, departure_day_id, updated_at DESC, id);

CREATE TABLE journey.restaurant_visits (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  city_id UUID REFERENCES ref.cities(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  google_url TEXT,
  added_by_traveler_id UUID NOT NULL,
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id, added_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, party_id, traveler_id) ON DELETE RESTRICT,
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX restaurant_visits_scope_idx ON journey.restaurant_visits
  (agency_id, party_id, departure_day_id, created_at DESC, id);

CREATE TABLE journey.memories (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  created_by_traveler_id UUID NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id)
    REFERENCES travel.travel_parties(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, media_asset_id)
    REFERENCES ops.media_assets(agency_id, departure_id, party_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id, created_by_traveler_id)
    REFERENCES travel.party_memberships(agency_id, party_id, traveler_id) ON DELETE RESTRICT,
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX memories_scope_idx ON journey.memories
  (agency_id, party_id, departure_day_id, created_at DESC, id);

CREATE TABLE journey.activity_access_grants (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  departure_day_id UUID,
  activity_id UUID NOT NULL,
  scheduled_available_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ,
  access_token_hash CHAR(64) NOT NULL UNIQUE CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  grant_method VARCHAR(16) NOT NULL CHECK (grant_method IN ('schedule','manual_override')),
  override_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, template_version_id)
    REFERENCES travel.departures(agency_id, id, template_version_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE RESTRICT,
  UNIQUE (agency_id, departure_id, party_id, traveler_id, activity_id, id),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CHECK ((grant_method = 'manual_override') = (override_by_user_id IS NOT NULL)),
  CHECK ((grant_method = 'schedule' AND available_at = scheduled_available_at)
      OR (grant_method = 'manual_override' AND available_at <= scheduled_available_at))
);
CREATE INDEX activity_access_grants_tenant_idx ON journey.activity_access_grants
  (agency_id, departure_id, party_id, traveler_id, activity_id, granted_at DESC, id);
CREATE UNIQUE INDEX activity_access_grants_active_uidx ON journey.activity_access_grants
  (party_id, traveler_id, activity_id) WHERE revoked_at IS NULL;

CREATE TABLE journey.activity_attempts (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  departure_day_id UUID,
  activity_id UUID NOT NULL,
  access_grant_id UUID,
  score app.positive_score NOT NULL DEFAULT 0,
  max_score app.positive_score,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected')),
  answers JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  validated_by_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  client_operation_id UUID NOT NULL,
  client_answered_at TIMESTAMPTZ,
  server_received_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, template_version_id)
    REFERENCES travel.departures(agency_id, id, template_version_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_day_id)
    REFERENCES travel.departure_days(agency_id, departure_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, party_id, traveler_id, activity_id, access_grant_id)
    REFERENCES journey.activity_access_grants
      (agency_id, departure_id, party_id, traveler_id, activity_id, id)
    ON DELETE RESTRICT,
  UNIQUE (party_id, traveler_id, activity_id),
  UNIQUE (party_id, client_operation_id),
  UNIQUE (agency_id, departure_id, party_id, id),
  CHECK (max_score IS NULL OR score <= max_score),
  CHECK ((status = 'draft' AND submitted_at IS NULL AND server_received_at IS NULL)
      OR (status <> 'draft' AND submitted_at IS NOT NULL AND server_received_at IS NOT NULL))
);
CREATE INDEX activity_attempts_ranking_idx ON journey.activity_attempts
  (party_id, score DESC, submitted_at, id) WHERE status = 'approved';

CREATE TABLE journey.activity_evidence (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  activity_item_id UUID,
  media_asset_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id, attempt_id)
    REFERENCES journey.activity_attempts(agency_id, departure_id, party_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, activity_item_id) REFERENCES content.activity_items(agency_id, id)
    ON DELETE SET NULL (activity_item_id),
  FOREIGN KEY (agency_id, departure_id, party_id, media_asset_id)
    REFERENCES ops.media_assets(agency_id, departure_id, party_id, id) ON DELETE CASCADE,
  UNIQUE (attempt_id, media_asset_id),
  UNIQUE (agency_id, id)
);

CREATE TABLE journey.photo_contest_entries (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  participant_slot SMALLINT NOT NULL CHECK (participant_slot BETWEEN 1 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','evaluating','ranked','rejected')),
  is_winner BOOLEAN NOT NULL DEFAULT false,
  client_operation_id UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, template_version_id)
    REFERENCES travel.departures(agency_id, id, template_version_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, party_id, traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, template_version_id, activity_id)
    REFERENCES content.activities(agency_id, template_version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, departure_id, party_id, media_asset_id)
    REFERENCES ops.media_assets(agency_id, departure_id, party_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, traveler_id, activity_id, participant_slot),
  UNIQUE (party_id, client_operation_id),
  UNIQUE (agency_id, party_id, activity_id, id),
  CHECK (NOT is_winner OR status = 'ranked')
);
CREATE UNIQUE INDEX photo_contest_single_winner_idx ON journey.photo_contest_entries
  (party_id, activity_id) WHERE is_winner;

CREATE TABLE journey.photo_contest_judgements (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  activity_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  judge_type VARCHAR(12) NOT NULL CHECK (judge_type IN ('ai','human')),
  judge_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  model TEXT,
  score NUMERIC(8,3) NOT NULL CHECK (score >= 0),
  criteria JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(criteria) = 'object'),
  reason TEXT NOT NULL DEFAULT '',
  judged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id, activity_id, entry_id)
    REFERENCES journey.photo_contest_entries(agency_id, party_id, activity_id, id) ON DELETE CASCADE,
  CHECK ((judge_type = 'human' AND judge_user_id IS NOT NULL AND model IS NULL) OR
         (judge_type = 'ai' AND judge_user_id IS NULL AND model IS NOT NULL))
);
CREATE INDEX photo_contest_judgements_scope_idx ON journey.photo_contest_judgements
  (agency_id, party_id, activity_id, entry_id, judged_at DESC, id);

CREATE TABLE journey.programme_feedback (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  departure_item_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  client_operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id, party_id, traveler_id)
    REFERENCES travel.party_memberships(agency_id, departure_id, party_id, traveler_id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id, departure_item_id)
    REFERENCES travel.departure_itinerary_items(agency_id, departure_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, traveler_id, departure_item_id),
  UNIQUE (traveler_id, client_operation_id)
);
CREATE INDEX programme_feedback_analysis_idx ON journey.programme_feedback
  (agency_id, rating, updated_at DESC, id);

CREATE TABLE ops.audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID REFERENCES iam.agencies(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES iam.users(id) ON DELETE SET NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT NOT NULL,
  action VARCHAR(80) NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(changes) = 'object'),
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON ops.audit_events
  (agency_id, entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX audit_events_request_idx ON ops.audit_events (request_id) WHERE request_id IS NOT NULL;

-- Financial allocations are an aggregate invariant. Partial shares may be built
-- while the expense is draft; switching to allocated is accepted only when the
-- original and base-currency totals reconcile exactly at transaction end.
CREATE OR REPLACE FUNCTION app.validate_expense_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, journey
AS $$
DECLARE
  v_expense_id UUID;
  e journey.expenses%ROWTYPE;
  v_count BIGINT;
  v_amount BIGINT;
  v_base_amount BIGINT;
  v_basis NUMERIC;
  v_min_share BIGINT;
  v_max_share BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    v_expense_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_expense_id := OLD.expense_id;
  ELSE
    v_expense_id := NEW.expense_id;
  END IF;
  SELECT * INTO e FROM journey.expenses WHERE id = v_expense_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), COALESCE(sum(share_amount_minor),0),
         COALESCE(sum(share_base_amount_minor),0), COALESCE(sum(share_basis),0),
         COALESCE(min(share_amount_minor),0), COALESCE(max(share_amount_minor),0)
    INTO v_count, v_amount, v_base_amount, v_basis, v_min_share, v_max_share
    FROM journey.expense_shares WHERE expense_id = v_expense_id;

  IF e.allocation_method = 'whole_party' THEN
    IF v_count <> 0 THEN RAISE EXCEPTION 'whole-party expense cannot have explicit shares'; END IF;
    RETURN NULL;
  END IF;

  IF e.allocation_status = 'allocated' THEN
    IF v_count = 0 OR v_amount <> e.amount_minor OR v_base_amount <> e.base_amount_minor THEN
      RAISE EXCEPTION 'expense shares do not reconcile with expense totals';
    END IF;
    IF e.allocation_method = 'equal' AND v_max_share - v_min_share > 1 THEN
      RAISE EXCEPTION 'equal allocation differs by more than one minor unit';
    END IF;
    IF e.allocation_method = 'percentage' AND abs(v_basis - 100) > 0.00000001 THEN
      RAISE EXCEPTION 'percentage allocation basis must total 100';
    END IF;
    IF e.expense_group_id IS NULL AND EXISTS (
      SELECT 1 FROM journey.expense_shares s
       WHERE s.expense_id = e.id AND s.beneficiary_party_id <> e.party_id
    ) THEN
      RAISE EXCEPTION 'cross-party shares require an expense group';
    END IF;
    IF e.expense_group_id IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM journey.expense_group_parties gp
                   WHERE gp.expense_group_id = e.expense_group_id
                     AND gp.party_id = e.party_id AND gp.status = 'active')
      OR EXISTS (SELECT 1 FROM journey.expense_shares s
                  WHERE s.expense_id = e.id AND NOT EXISTS (
                    SELECT 1 FROM journey.expense_group_parties gp
                     WHERE gp.expense_group_id = e.expense_group_id
                       AND gp.party_id = s.beneficiary_party_id AND gp.status = 'active'))
    ) THEN
      RAISE EXCEPTION 'expense parties must be active participants of the expense group';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_expense_allocation() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER expenses_allocation_gate
AFTER INSERT OR UPDATE ON journey.expenses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION app.validate_expense_allocation();
CREATE CONSTRAINT TRIGGER expense_shares_allocation_gate
AFTER INSERT OR UPDATE OR DELETE ON journey.expense_shares
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION app.validate_expense_allocation();

CREATE OR REPLACE FUNCTION app.protect_consent_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, privacy
AS $$
BEGIN
  RAISE EXCEPTION 'consent records are append-only; insert a superseding decision';
END;
$$;
REVOKE ALL ON FUNCTION app.protect_consent_record() FROM PUBLIC;
CREATE TRIGGER consent_records_append_only
BEFORE UPDATE OR DELETE ON privacy.consent_records
FOR EACH ROW EXECUTE FUNCTION app.protect_consent_record();

CREATE OR REPLACE FUNCTION app.validate_party_member_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel
AS $$
DECLARE v_birth_date DATE; v_starts_on DATE;
BEGIN
  SELECT tp.birth_date, d.starts_on INTO v_birth_date, v_starts_on
    FROM travel.traveler_profiles tp
    JOIN travel.departures d ON d.agency_id = NEW.agency_id AND d.id = NEW.departure_id
   WHERE tp.agency_id = NEW.agency_id AND tp.id = NEW.traveler_id;
  IF NEW.member_type = 'dependent_minor' AND
     (v_birth_date IS NULL OR v_birth_date <= (v_starts_on - INTERVAL '18 years')::date) THEN
    RAISE EXCEPTION 'dependent minor requires a birth date proving age below 18 at departure';
  END IF;
  IF NEW.member_type = 'adult' AND v_birth_date IS NOT NULL
     AND v_birth_date > (v_starts_on - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'traveler below 18 at departure cannot be classified as adult';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_party_member_capacity() FROM PUBLIC;
CREATE TRIGGER party_membership_capacity_gate
BEFORE INSERT OR UPDATE ON travel.party_memberships
FOR EACH ROW EXECUTE FUNCTION app.validate_party_member_capacity();

CREATE OR REPLACE FUNCTION app.validate_guardianship_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM travel.party_memberships pm
                  WHERE pm.agency_id=NEW.agency_id AND pm.departure_id=NEW.departure_id
                    AND pm.party_id=NEW.party_id AND pm.traveler_id=NEW.minor_traveler_id
                    AND pm.member_type='dependent_minor' AND pm.status='active') THEN
    RAISE EXCEPTION 'guardianship subject must be an active dependent minor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM travel.party_memberships pm
                  WHERE pm.agency_id=NEW.agency_id AND pm.departure_id=NEW.departure_id
                    AND pm.party_id=NEW.party_id AND pm.traveler_id=NEW.guardian_traveler_id
                    AND pm.member_type='adult' AND pm.status='active') THEN
    RAISE EXCEPTION 'guardian must be an active adult in the same party';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_guardianship_capacity() FROM PUBLIC;
CREATE TRIGGER guardianship_capacity_gate
BEFORE INSERT OR UPDATE ON travel.traveler_guardianships
FOR EACH ROW EXECUTE FUNCTION app.validate_guardianship_capacity();

CREATE OR REPLACE FUNCTION app.protect_append_only_record()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only; insert a compensating event', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER disruption_events_append_only
BEFORE UPDATE OR DELETE ON travel.itinerary_disruption_events
FOR EACH ROW EXECUTE FUNCTION app.protect_append_only_record();
CREATE TRIGGER settlements_append_only
BEFORE UPDATE OR DELETE ON journey.settlements
FOR EACH ROW EXECUTE FUNCTION app.protect_append_only_record();

CREATE OR REPLACE FUNCTION app.validate_settlement_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, journey
AS $$
DECLARE prior journey.settlements%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journey.expense_group_parties gp
                  WHERE gp.expense_group_id=NEW.expense_group_id
                    AND gp.party_id=NEW.payer_party_id AND gp.status='active')
     OR NOT EXISTS (SELECT 1 FROM journey.expense_group_parties gp
                     WHERE gp.expense_group_id=NEW.expense_group_id
                       AND gp.party_id=NEW.receiver_party_id AND gp.status='active') THEN
    RAISE EXCEPTION 'settlement parties must be active in the expense group';
  END IF;
  IF NEW.entry_type = 'reversal' THEN
    SELECT * INTO prior FROM journey.settlements WHERE id=NEW.reverses_settlement_id;
    IF NOT FOUND OR prior.entry_type <> 'payment'
       OR NEW.payer_party_id <> prior.receiver_party_id
       OR NEW.payer_traveler_id <> prior.receiver_traveler_id
       OR NEW.receiver_party_id <> prior.payer_party_id
       OR NEW.receiver_traveler_id <> prior.payer_traveler_id
       OR NEW.amount_minor <> prior.amount_minor OR NEW.currency <> prior.currency
       OR NEW.base_amount_minor <> prior.base_amount_minor OR NEW.base_currency <> prior.base_currency THEN
      RAISE EXCEPTION 'reversal must exactly compensate the original settlement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_settlement_entry() FROM PUBLIC;
CREATE TRIGGER settlement_entry_gate
BEFORE INSERT ON journey.settlements
FOR EACH ROW EXECUTE FUNCTION app.validate_settlement_entry();

CREATE OR REPLACE FUNCTION app.validate_consent_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, privacy
AS $$
DECLARE v_member_type TEXT;
BEGIN
  SELECT member_type INTO v_member_type
    FROM travel.party_memberships
   WHERE agency_id = NEW.agency_id AND departure_id = NEW.departure_id
     AND party_id = NEW.party_id AND traveler_id = NEW.subject_traveler_id
     AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'consent subject is not an active party member'; END IF;
  IF v_member_type = 'adult' AND NEW.decided_by_traveler_id <> NEW.subject_traveler_id THEN
    RAISE EXCEPTION 'an adult traveler must decide their own consent';
  END IF;
  IF v_member_type = 'dependent_minor' AND NOT EXISTS (
    SELECT 1 FROM travel.traveler_guardianships g
     WHERE g.agency_id = NEW.agency_id AND g.departure_id = NEW.departure_id
       AND g.party_id = NEW.party_id AND g.minor_traveler_id = NEW.subject_traveler_id
       AND g.guardian_traveler_id = NEW.decided_by_traveler_id AND g.status = 'active'
       AND NEW.effective_at::date >= g.effective_from
       AND (g.effective_until IS NULL OR NEW.effective_at::date <= g.effective_until)
  ) THEN
    RAISE EXCEPTION 'minor consent requires an active guardian relationship';
  END IF;
  IF NEW.supersedes_consent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM privacy.consent_records prior
     WHERE prior.id = NEW.supersedes_consent_id AND prior.agency_id = NEW.agency_id
       AND prior.departure_id = NEW.departure_id AND prior.party_id = NEW.party_id
       AND prior.subject_traveler_id = NEW.subject_traveler_id
       AND prior.consent_type = NEW.consent_type AND prior.consent_scope = NEW.consent_scope
       AND prior.effective_at <= NEW.effective_at
  ) THEN
    RAISE EXCEPTION 'superseded consent must match subject, type, scope and chronology';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_consent_actor() FROM PUBLIC;
CREATE TRIGGER consent_records_actor_gate
BEFORE INSERT ON privacy.consent_records
FOR EACH ROW EXECUTE FUNCTION app.validate_consent_actor();

CREATE OR REPLACE FUNCTION app.require_minor_media_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, privacy, ops
AS $$
DECLARE v_member_type TEXT;
BEGIN
  SELECT member_type INTO v_member_type
    FROM travel.party_memberships
   WHERE agency_id = NEW.agency_id AND departure_id = NEW.departure_id
     AND party_id = NEW.subject_party_id AND traveler_id = NEW.subject_traveler_id
     AND status = 'active';
  IF v_member_type = 'dependent_minor' AND NOT EXISTS (
    SELECT 1 FROM privacy.consent_records c
     WHERE c.agency_id = NEW.agency_id AND c.departure_id = NEW.departure_id
       AND c.party_id = NEW.subject_party_id AND c.subject_traveler_id = NEW.subject_traveler_id
       AND c.consent_type = 'minor_image_upload' AND c.decision = 'granted'
       AND c.effective_at <= clock_timestamp()
       AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
       AND NOT EXISTS (SELECT 1 FROM privacy.consent_records later
                        WHERE later.supersedes_consent_id = c.id)
  ) THEN
    RAISE EXCEPTION 'current minor image consent is required before tagging media';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.require_minor_media_consent() FROM PUBLIC;
CREATE TRIGGER media_subject_minor_consent_gate
BEFORE INSERT OR UPDATE ON ops.media_asset_subjects
FOR EACH ROW EXECUTE FUNCTION app.require_minor_media_consent();

CREATE OR REPLACE FUNCTION app.protect_disruption_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_command_owner NAME;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO v_command_owner
    FROM pg_proc p WHERE p.oid =
      'app.record_itinerary_disruption(uuid,uuid,uuid,timestamptz,timestamptz,character varying,text,uuid,uuid,uuid)'::regprocedure;
  IF current_user <> v_command_owner AND
     (NEW.departure_day_id IS DISTINCT FROM OLD.departure_day_id OR
      NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at OR
      NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at OR
      NEW.operational_status IS DISTINCT FROM OLD.operational_status OR
      NEW.replacement_item_id IS DISTINCT FROM OLD.replacement_item_id) THEN
    RAISE EXCEPTION 'operational changes require app.record_itinerary_disruption';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER departure_items_disruption_gate
BEFORE UPDATE ON travel.departure_itinerary_items
FOR EACH ROW EXECUTE FUNCTION app.protect_disruption_fields();

CREATE OR REPLACE FUNCTION app.record_itinerary_disruption(
  p_agency_id UUID,
  p_item_id UUID,
  p_new_day_id UUID,
  p_new_start_at TIMESTAMPTZ,
  p_new_end_at TIMESTAMPTZ,
  p_new_status VARCHAR,
  p_reason TEXT,
  p_replacement_item_id UUID,
  p_actor_user_id UUID,
  p_client_operation_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, travel, ops
SET row_security = off
AS $$
DECLARE i travel.departure_itinerary_items%ROWTYPE; v_event_id BIGINT; v_event_type TEXT;
BEGIN
  IF btrim(p_reason) = '' THEN RAISE EXCEPTION 'disruption reason is required'; END IF;
  IF p_new_status NOT IN ('planned','confirmed','delayed','rescheduled','cancelled','completed') THEN
    RAISE EXCEPTION 'invalid operational status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM iam.users u WHERE u.id = p_actor_user_id AND u.status = 'active'
    AND (u.platform_role = 'superadmin' OR EXISTS (
      SELECT 1 FROM iam.agency_memberships m WHERE m.agency_id = p_agency_id
       AND m.user_id = u.id AND m.status = 'active' AND m.role IN ('owner','admin','editor')))) THEN
    RAISE EXCEPTION 'actor is not authorized to change the operational programme';
  END IF;
  SELECT * INTO i FROM travel.departure_itinerary_items
   WHERE agency_id = p_agency_id AND id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'itinerary item not found'; END IF;
  v_event_type := CASE p_new_status WHEN 'delayed' THEN 'delay' WHEN 'rescheduled' THEN 'reschedule'
                    WHEN 'cancelled' THEN 'cancel' WHEN 'completed' THEN 'complete'
                    ELSE CASE WHEN p_replacement_item_id IS NOT NULL THEN 'replace' ELSE 'restore' END END;
  UPDATE travel.departure_itinerary_items
     SET original_departure_day_id = COALESCE(original_departure_day_id, departure_day_id),
         original_scheduled_start_at = COALESCE(original_scheduled_start_at, scheduled_start_at),
         original_scheduled_end_at = COALESCE(original_scheduled_end_at, scheduled_end_at),
         departure_day_id = COALESCE(p_new_day_id, departure_day_id),
         scheduled_start_at = p_new_start_at, scheduled_end_at = p_new_end_at,
         operational_status = p_new_status, status_reason = p_reason,
         status_changed_at = clock_timestamp(), replacement_item_id = p_replacement_item_id
   WHERE id = p_item_id;
  INSERT INTO travel.itinerary_disruption_events
    (agency_id, departure_id, itinerary_item_id, event_type, previous_state, new_state,
     reason, changed_by_user_id, client_operation_id)
  VALUES (i.agency_id, i.departure_id, i.id, v_event_type,
    jsonb_build_object('day_id',i.departure_day_id,'start_at',i.scheduled_start_at,
      'end_at',i.scheduled_end_at,'status',i.operational_status,'replacement_item_id',i.replacement_item_id),
    jsonb_build_object('day_id',COALESCE(p_new_day_id,i.departure_day_id),'start_at',p_new_start_at,
      'end_at',p_new_end_at,'status',p_new_status,'replacement_item_id',p_replacement_item_id),
    p_reason, p_actor_user_id, p_client_operation_id)
  RETURNING id INTO v_event_id;
  INSERT INTO ops.audit_events (agency_id, actor_user_id, entity_type, entity_id, action, changes)
  VALUES (i.agency_id,p_actor_user_id,'departure_itinerary_item',i.id::text,'disruption_recorded',
          jsonb_build_object('event_id',v_event_id,'status',p_new_status,'reason',p_reason));
  RETURN v_event_id;
END;
$$;
REVOKE ALL ON FUNCTION app.record_itinerary_disruption(UUID,UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,VARCHAR,TEXT,UUID,UUID,UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.issue_activity_access_grant(
  p_agency_id UUID,
  p_departure_id UUID,
  p_party_id UUID,
  p_traveler_id UUID,
  p_activity_id UUID,
  p_access_token_hash CHAR(64),
  p_content_hash CHAR(64),
  p_override_by_user_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, travel, content, journey
SET row_security = off
AS $$
DECLARE
  v_activity_type VARCHAR(24);
  v_availability_rule VARCHAR(24);
  v_relative_days SMALLINT;
  v_unlock_local_time TIME;
  v_version_id UUID;
  v_day_id UUID;
  v_timezone TEXT;
  v_service_date DATE;
  v_available_at TIMESTAMPTZ;
  v_scheduled_available_at TIMESTAMPTZ;
  v_grant_method TEXT := 'schedule';
  v_grant_id UUID;
BEGIN
  IF p_access_token_hash !~ '^[0-9a-f]{64}$' OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid access or content hash';
  END IF;
  SELECT a.activity_type, a.availability_rule, a.relative_days,
         a.unlock_local_time, d.template_version_id, d.timezone,
         dd.id, dd.service_date
    INTO v_activity_type, v_availability_rule, v_relative_days,
         v_unlock_local_time, v_version_id, v_timezone,
         v_day_id, v_service_date
    FROM content.activities a
    JOIN travel.departures d ON d.agency_id = a.agency_id
      AND d.template_version_id = a.template_version_id AND d.id = p_departure_id
    LEFT JOIN travel.departure_days dd ON dd.agency_id = d.agency_id AND dd.departure_id = d.id
      AND dd.template_day_id = a.template_day_id
   WHERE a.agency_id = p_agency_id AND a.id = p_activity_id
     AND a.status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'approved activity not found for departure'; END IF;
  IF v_activity_type <> 'quiz' THEN RAISE EXCEPTION 'access grants are required only for quiz'; END IF;
  IF NOT EXISTS (SELECT 1 FROM travel.party_memberships pm
                  WHERE pm.agency_id = p_agency_id AND pm.departure_id = p_departure_id
                    AND pm.party_id = p_party_id AND pm.traveler_id = p_traveler_id
                    AND pm.status = 'active') THEN
    RAISE EXCEPTION 'traveler is not an active party member';
  END IF;

  IF v_availability_rule = 'always' THEN
    v_available_at := '-infinity'::timestamptz;
  ELSIF v_availability_rule = 'relative_day_time' THEN
    IF v_service_date IS NULL THEN RAISE EXCEPTION 'quiz day is not materialized'; END IF;
    v_available_at := ((v_service_date + v_relative_days) + v_unlock_local_time)
                      AT TIME ZONE v_timezone;
  ELSE
    v_available_at := 'infinity'::timestamptz;
  END IF;
  v_scheduled_available_at := v_available_at;

  IF clock_timestamp() < v_available_at OR v_availability_rule = 'manual' THEN
    IF p_override_by_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM iam.users u WHERE u.id = p_override_by_user_id AND u.status = 'active'
       AND (u.platform_role = 'superadmin' OR EXISTS (
         SELECT 1 FROM iam.agency_memberships am WHERE am.agency_id = p_agency_id
          AND am.user_id = u.id AND am.status = 'active' AND am.role IN ('owner','admin','editor'))
        OR EXISTS (
         SELECT 1 FROM travel.traveler_profiles tp
         JOIN travel.party_memberships pm ON pm.agency_id = tp.agency_id AND pm.traveler_id = tp.id
          WHERE tp.agency_id = p_agency_id AND tp.user_id = u.id
            AND pm.departure_id = p_departure_id AND pm.party_id = p_party_id
            AND pm.role = 'organizer' AND pm.status = 'active'))
    ) THEN
      RAISE EXCEPTION 'quiz is not yet available';
    END IF;
    v_grant_method := 'manual_override';
    v_available_at := clock_timestamp();
  END IF;

  UPDATE journey.activity_access_grants SET revoked_at = clock_timestamp()
   WHERE party_id = p_party_id AND traveler_id = p_traveler_id
     AND activity_id = p_activity_id AND revoked_at IS NULL;
  INSERT INTO journey.activity_access_grants
    (agency_id, departure_id, template_version_id, party_id, traveler_id,
     departure_day_id, activity_id, scheduled_available_at, available_at, access_token_hash, content_hash,
     grant_method, override_by_user_id)
  VALUES (p_agency_id,p_departure_id,v_version_id,p_party_id,p_traveler_id,
          v_day_id,p_activity_id,v_scheduled_available_at,v_available_at,p_access_token_hash,p_content_hash,
          v_grant_method,CASE WHEN v_grant_method='manual_override' THEN p_override_by_user_id END)
  RETURNING id INTO v_grant_id;
  RETURN v_grant_id;
END;
$$;
REVOKE ALL ON FUNCTION app.issue_activity_access_grant(UUID,UUID,UUID,UUID,UUID,CHAR,CHAR,UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.get_unlocked_activity_payload(
  p_access_token_hash CHAR(64), p_locale app.locale_code
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, content, journey
SET row_security = off
AS $$
DECLARE g journey.activity_access_grants%ROWTYPE; v_payload JSONB;
BEGIN
  SELECT * INTO g FROM journey.activity_access_grants
   WHERE access_token_hash = p_access_token_hash
     AND agency_id = app.current_agency_id()
     AND revoked_at IS NULL AND granted_at <= clock_timestamp()
     AND available_at <= clock_timestamp()
     AND (expires_at IS NULL OR expires_at > clock_timestamp());
  IF NOT FOUND THEN RAISE EXCEPTION 'activity grant is missing, expired or not yet available'; END IF;
  SELECT jsonb_build_object(
      'activity_id',a.id,'content_hash',g.content_hash,'locale',p_locale,
      'title',COALESCE(t.title,a.title),'instructions',COALESCE(t.instructions,a.instructions),
      'items',COALESCE(jsonb_agg(jsonb_build_object(
        'id',i.id,'ordinal',i.ordinal,'kind',i.item_kind,
        'prompt',COALESCE(it.prompt,i.prompt),'payload',COALESCE(it.payload,i.payload),
        'points',i.points) ORDER BY i.ordinal),'[]'::jsonb))
    INTO v_payload
    FROM content.activities a
    LEFT JOIN content.activity_translations t ON t.activity_id = a.id
      AND t.locale = p_locale AND t.status = 'approved'
    LEFT JOIN content.activity_items i ON i.activity_id = a.id
    LEFT JOIN content.activity_item_translations it ON it.activity_item_id = i.id
      AND it.locale = p_locale AND it.status = 'approved'
   WHERE a.id = g.activity_id
   GROUP BY a.id,a.title,a.instructions,t.title,t.instructions;
  RETURN v_payload;
END;
$$;
REVOKE ALL ON FUNCTION app.get_unlocked_activity_payload(CHAR,app.locale_code) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.enforce_activity_attempt_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, content, journey
AS $$
DECLARE v_type TEXT; v_received TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'draft' THEN
    NEW.submitted_at := NULL; NEW.server_received_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR OLD.status = 'draft' THEN
    v_received := clock_timestamp();
    NEW.server_received_at := v_received;
    NEW.submitted_at := v_received;
  ELSE
    v_received := NEW.server_received_at;
  END IF;
  SELECT activity_type INTO v_type FROM content.activities
   WHERE agency_id = NEW.agency_id AND id = NEW.activity_id;
  IF v_type = 'quiz' AND (NEW.access_grant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM journey.activity_access_grants g
     WHERE g.id = NEW.access_grant_id AND g.agency_id = NEW.agency_id
       AND g.departure_id = NEW.departure_id AND g.party_id = NEW.party_id
       AND g.traveler_id = NEW.traveler_id AND g.activity_id = NEW.activity_id
       AND g.revoked_at IS NULL AND g.available_at <= v_received AND g.granted_at <= v_received
       AND (g.expires_at IS NULL OR g.expires_at > v_received)
  )) THEN
    RAISE EXCEPTION 'submitted quiz requires a valid server-issued access grant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.enforce_activity_attempt_access() FROM PUBLIC;
CREATE TRIGGER activity_attempt_access_gate
BEFORE INSERT OR UPDATE ON journey.activity_attempts
FOR EACH ROW EXECUTE FUNCTION app.enforce_activity_attempt_access();

-- Aggregate publish rules are enforced in the database, under one advisory
-- transaction lock per version. Child mutations take the same lock, so a
-- concurrent writer cannot slip between validation and status transition.
CREATE OR REPLACE FUNCTION app.assert_template_version_mutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel
AS $$
DECLARE
  v_agency_id UUID;
  v_version_id UUID;
  v_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    v_agency_id := OLD.agency_id;
    v_version_id := OLD.template_version_id;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_version_id::text, 0));
    SELECT status INTO v_status
      FROM travel.trip_template_versions
     WHERE agency_id = v_agency_id AND id = v_version_id;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'template version % is immutable in status %', v_version_id, v_status;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') AND
     (TG_OP = 'INSERT' OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id) THEN
    v_agency_id := NEW.agency_id;
    v_version_id := NEW.template_version_id;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_version_id::text, 0));
    SELECT status INTO v_status
      FROM travel.trip_template_versions
     WHERE agency_id = v_agency_id AND id = v_version_id;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'template version % not found in tenant %', v_version_id, v_agency_id;
    END IF;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'template version % is immutable in status %', v_version_id, v_status;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION app.assert_template_version_mutable() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.validate_template_version_publish(
  p_agency_id UUID,
  p_version_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, travel, content, ref
AS $$
DECLARE
  v_day RECORD;
  v_count INTEGER;
  v_item_count INTEGER;
BEGIN
  IF p_agency_id IS DISTINCT FROM app.current_agency_id() THEN
    RAISE EXCEPTION 'tenant context mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_version_id::text, 0));
  PERFORM 1 FROM travel.trip_template_versions
   WHERE agency_id = p_agency_id AND id = p_version_id AND status = 'draft'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft template version % not found', p_version_id;
  END IF;

  SELECT count(*) INTO v_count FROM travel.template_days
   WHERE agency_id = p_agency_id AND template_version_id = p_version_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'publish gate: at least one programme day is required';
  END IF;

  FOR v_day IN
    SELECT id, day_number FROM travel.template_days
     WHERE agency_id = p_agency_id AND template_version_id = p_version_id
     ORDER BY day_number
  LOOP
    SELECT count(*) INTO v_count FROM content.activities
     WHERE agency_id = p_agency_id AND template_version_id = p_version_id
       AND template_day_id = v_day.id AND activity_type = 'quiz' AND status = 'approved';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'publish gate day %: exactly one approved quiz required', v_day.day_number;
    END IF;
    SELECT count(*) INTO v_item_count
      FROM content.activity_items i JOIN content.activities a ON a.id = i.activity_id
     WHERE a.agency_id = p_agency_id AND a.template_version_id = p_version_id
       AND a.template_day_id = v_day.id AND a.activity_type = 'quiz' AND a.status = 'approved'
       AND i.item_kind = 'question' AND i.answer_spec <> '{}'::jsonb;
    IF v_item_count <> 15 THEN
      RAISE EXCEPTION 'publish gate day %: quiz requires 15 answered questions', v_day.day_number;
    END IF;

    SELECT count(*) INTO v_count FROM content.activities
     WHERE agency_id = p_agency_id AND template_version_id = p_version_id
       AND template_day_id = v_day.id AND activity_type = 'mission' AND status = 'approved';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'publish gate day %: exactly one approved mission set required', v_day.day_number;
    END IF;
    SELECT count(*) INTO v_item_count
      FROM content.activity_items i JOIN content.activities a ON a.id = i.activity_id
     WHERE a.agency_id = p_agency_id AND a.template_version_id = p_version_id
       AND a.template_day_id = v_day.id AND a.activity_type = 'mission' AND a.status = 'approved'
       AND i.item_kind = 'mission';
    IF v_item_count <> 5 THEN
      RAISE EXCEPTION 'publish gate day %: mission set requires 5 missions', v_day.day_number;
    END IF;

    SELECT count(DISTINCT activity_type) INTO v_count FROM content.activities
     WHERE agency_id = p_agency_id AND template_version_id = p_version_id
       AND template_day_id = v_day.id AND status = 'approved'
       AND activity_type IN ('word_game','order_game','puzzle');
    IF v_count <> 3 THEN
      RAISE EXCEPTION 'publish gate day %: three approved game types required', v_day.day_number;
    END IF;

    SELECT count(DISTINCT contest_category) INTO v_count FROM content.activities
     WHERE agency_id = p_agency_id AND template_version_id = p_version_id
       AND template_day_id = v_day.id AND activity_type = 'photo_contest'
       AND status = 'approved' AND contest_category IN ('free','theme') AND max_entries = 3;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'publish gate day %: free and themed photo contests required', v_day.day_number;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM content.activities
   WHERE agency_id = p_agency_id AND template_version_id = p_version_id
     AND template_day_id IS NULL AND activity_type = 'bingo' AND status = 'approved';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'publish gate: exactly one approved trip bingo required';
  END IF;
  SELECT count(*) INTO v_item_count
    FROM content.activity_items i JOIN content.activities a ON a.id = i.activity_id
   WHERE a.agency_id = p_agency_id AND a.template_version_id = p_version_id
     AND a.template_day_id IS NULL AND a.activity_type = 'bingo' AND a.status = 'approved'
     AND i.item_kind = 'bingo_cell';
  IF v_item_count <> 15 THEN
    RAISE EXCEPTION 'publish gate: bingo requires 15 cells';
  END IF;

  IF EXISTS (
    SELECT 1 FROM content.activities a
     LEFT JOIN ref.reference_contents r ON r.id = a.source_reference_content_id
    WHERE a.agency_id = p_agency_id AND a.template_version_id = p_version_id
      AND a.source <> 'manual'
      AND (r.id IS NULL OR r.status <> 'approved' OR r.approved_by_user_id IS NULL
           OR (r.refresh_after IS NOT NULL AND r.refresh_after < clock_timestamp())
           OR NOT EXISTS (SELECT 1 FROM ref.reference_content_sources s
                           WHERE s.reference_content_id = r.id))
  ) THEN
    RAISE EXCEPTION 'publish gate: AI/import content requires approved, fresh and sourced reference content';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app.validate_template_version_publish(UUID, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.enforce_version_publish_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    PERFORM app.validate_template_version_publish(NEW.agency_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.enforce_version_publish_gate() FROM PUBLIC;
CREATE TRIGGER enforce_version_publish_gate
  BEFORE UPDATE OF status ON travel.trip_template_versions
  FOR EACH ROW EXECUTE FUNCTION app.enforce_version_publish_gate();

CREATE OR REPLACE FUNCTION app.publish_trip_template_version(
  p_agency_id UUID,
  p_version_id UUID,
  p_actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, travel, ops
AS $$
BEGIN
  IF p_agency_id IS DISTINCT FROM app.current_agency_id() THEN
    RAISE EXCEPTION 'tenant context mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.users u
     WHERE u.id = p_actor_user_id AND u.status = 'active'
       AND (u.platform_role = 'superadmin' OR EXISTS (
         SELECT 1 FROM iam.agency_memberships m
          WHERE m.agency_id = p_agency_id AND m.user_id = u.id
            AND m.status = 'active' AND m.role IN ('owner','admin','editor')
       ))
  ) THEN
    RAISE EXCEPTION 'actor is not authorized to publish';
  END IF;

  PERFORM app.validate_template_version_publish(p_agency_id, p_version_id);
  UPDATE travel.trip_template_versions
     SET status = 'published', published_at = clock_timestamp(),
         published_by_user_id = p_actor_user_id
   WHERE agency_id = p_agency_id AND id = p_version_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publish transition lost or version is not draft';
  END IF;
  INSERT INTO ops.audit_events
    (agency_id, actor_user_id, entity_type, entity_id, action, changes)
  VALUES
    (p_agency_id, p_actor_user_id, 'trip_template_version', p_version_id::text,
     'published', jsonb_build_object('status','published'));
END;
$$;
REVOKE ALL ON FUNCTION app.publish_trip_template_version(UUID, UUID, UUID) FROM PUBLIC;

DO $$
DECLARE q TEXT;
BEGIN
  FOREACH q IN ARRAY ARRAY[
    'travel.template_days','travel.template_day_cities','travel.template_day_sites',
    'travel.template_day_hotels','travel.template_itinerary_items',
    'travel.template_itinerary_item_translations',
    'content.activities','content.activity_items','content.activity_translations',
    'content.activity_item_translations'
  ] LOOP
    EXECUTE format('CREATE TRIGGER guard_template_version_mutation '
      'BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW '
      'EXECUTE FUNCTION app.assert_template_version_mutable()', q);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.protect_agency_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'closed' THEN
    RAISE EXCEPTION 'BR-019: agency must complete asynchronous deletion before final DELETE';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER protect_agency_delete BEFORE DELETE ON iam.agencies
  FOR EACH ROW EXECUTE FUNCTION app.protect_agency_delete();

CREATE OR REPLACE FUNCTION app.request_agency_deletion(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, ops
SET row_security = off
AS $$
DECLARE
  v_job_id UUID;
  v_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM iam.users
                  WHERE id = p_actor_user_id AND platform_role = 'superadmin'
                    AND status = 'active') THEN
    RAISE EXCEPTION 'only an active superadmin may request agency deletion';
  END IF;
  IF btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'deletion reason is required';
  END IF;

  SELECT name INTO v_name FROM iam.agencies WHERE id = p_agency_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agency not found'; END IF;
  UPDATE iam.agencies SET status = 'deleting' WHERE id = p_agency_id;
  INSERT INTO ops.agency_deletion_jobs
    (agency_id, agency_name_snapshot, requested_by_user_id, reason)
  VALUES (p_agency_id, v_name, p_actor_user_id, p_reason)
  RETURNING id INTO v_job_id;
  INSERT INTO ops.integration_outbox
    (agency_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  VALUES
    (p_agency_id, 'agency.deletion.requested', 'agency', p_agency_id::text,
     jsonb_build_object('job_id',v_job_id,'agency_id',p_agency_id),
     'agency-delete:' || v_job_id::text);
  INSERT INTO ops.audit_events
    (agency_id, actor_user_id, entity_type, entity_id, action, changes)
  VALUES (p_agency_id, p_actor_user_id, 'agency', p_agency_id::text,
          'deletion_requested', jsonb_build_object('job_id',v_job_id,'reason',p_reason));
  RETURN v_job_id;
END;
$$;
REVOKE ALL ON FUNCTION app.request_agency_deletion(UUID, UUID, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION app.request_agency_deletion(UUID, UUID, TEXT) IS
  'Deployment must assign ownership to the narrowly scoped smf_admin_api BYPASSRLS role; runtime roles receive EXECUTE only.';

-- updated_at triggers
DO $$
DECLARE q TEXT;
BEGIN
  FOREACH q IN ARRAY ARRAY[
    'iam.users','iam.agencies','ref.countries','ref.cities','ref.visit_sites','ref.hotels',
    'ref.reference_contents','travel.trip_templates','travel.departures',
    'travel.template_itinerary_item_translations','travel.departure_itinerary_items',
    'travel.departure_itinerary_item_translations','travel.traveler_profiles','travel.travel_parties',
    'content.activities','content.activity_translations','content.activity_item_translations',
    'ops.media_assets','ops.import_jobs','ops.platform_jobs',
    'journey.expense_groups','journey.expenses','journey.expense_shares',
    'journey.day_notes','journey.memories','journey.activity_attempts',
    'journey.programme_feedback'
  ] LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %s '
      'FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', q);
  END LOOP;
END $$;

-- Tenant isolation. Global mastered reference tables are read-only to runtime.
DO $$
DECLARE q TEXT;
BEGIN
  FOREACH q IN ARRAY ARRAY[
    'iam.agency_memberships','iam.invitations',
    'travel.trip_templates','travel.trip_template_versions','travel.template_days',
    'travel.template_day_cities','travel.template_day_sites','travel.template_day_hotels',
    'travel.template_itinerary_items','travel.template_itinerary_item_translations',
    'travel.departures','travel.departure_days','travel.departure_itinerary_items',
    'travel.departure_itinerary_item_translations','travel.itinerary_disruption_events',
    'travel.traveler_profiles','travel.travel_parties','travel.party_memberships',
    'travel.traveler_guardianships','content.activities','content.activity_items',
    'content.activity_translations','content.activity_item_translations',
    'ops.media_assets','ops.media_asset_subjects','ops.travel_documents','ops.import_jobs','ops.generation_runs',
    'ops.platform_jobs','ops.audit_events',
    'privacy.consent_records','journey.expense_groups','journey.expense_group_parties',
    'journey.expenses','journey.expense_shares','journey.settlements',
    'journey.cash_movements','journey.day_notes',
    'journey.restaurant_visits','journey.memories','journey.activity_attempts',
    'journey.activity_access_grants',
    'journey.activity_evidence','journey.photo_contest_entries',
    'journey.photo_contest_judgements','journey.programme_feedback'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', q);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', q);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING '
      '(agency_id = app.current_agency_id()) WITH CHECK '
      '(agency_id = app.current_agency_id())', q);
  END LOOP;
END $$;

ALTER TABLE iam.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.agencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON iam.agencies
  USING (id = app.current_agency_id())
  WITH CHECK (id = app.current_agency_id());

-- Platform identity/session tables are deliberately outside tenant RLS and must
-- not receive direct runtime DML grants. Superadmin cross-tenant commands are
-- exposed only through audited SECURITY DEFINER functions in a separate migration.
-- integration_outbox and agency_deletion_jobs are internal operational queues:
-- PUBLIC and runtime table grants remain revoked; workers use narrowly granted
-- SECURITY DEFINER claim/complete functions over dedicated pooled connections.

INSERT INTO ref.currencies (code, name, minor_unit) VALUES
  ('EUR','Euro',2),('USD','US Dollar',2),('GBP','Pound Sterling',2),('UZS','Uzbekistani Som',0)
ON CONFLICT (code) DO NOTHING;
