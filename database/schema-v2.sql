-- SMF Travel - schema target v2 (greenfield / riferimento architetturale)
-- PostgreSQL 16+ compatibile con Neon. Non applicare direttamente al database
-- corrente: usare il piano expand-migrate-contract descritto nell'audit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE DOMAIN currency_code AS VARCHAR(3)
  CHECK (VALUE = upper(VALUE) AND VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN locale_code AS VARCHAR(35)
  CHECK (VALUE ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$');
CREATE DOMAIN timezone_name AS TEXT
  CHECK (char_length(VALUE) BETWEEN 1 AND 100);
CREATE DOMAIN positive_score AS NUMERIC(12,3)
  CHECK (VALUE >= 0);

CREATE TABLE platform_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum_sha256 CHAR(64) NOT NULL,
  execution_ms INTEGER CHECK (execution_ms IS NULL OR execution_ms >= 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE platform_users (
  id TEXT PRIMARY KEY,
  display_name VARCHAR(160) NOT NULL CHECK (btrim(display_name) <> ''),
  initials VARCHAR(8) NOT NULL DEFAULT '',
  email TEXT,
  normalized_email TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  phone TEXT,
  auth_provider VARCHAR(32) NOT NULL,
  auth_subject TEXT,
  platform_role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (platform_role IN ('superadmin', 'user')),
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_subject),
  UNIQUE (normalized_email)
);

CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(80) NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name VARCHAR(200) NOT NULL CHECK (btrim(name) <> ''),
  status VARCHAR(20) NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'suspended', 'closed')),
  default_locale locale_code NOT NULL DEFAULT 'it-IT',
  default_timezone timezone_name NOT NULL DEFAULT 'Europe/Rome',
  branding JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(branding) = 'object'),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  legal_name TEXT,
  vat_number VARCHAR(32),
  tax_code VARCHAR(32),
  registered_address TEXT,
  registered_city TEXT,
  registered_postal_code VARCHAR(20),
  registered_province VARCHAR(100),
  registered_country CHAR(2),
  pec TEXT,
  sdi_code VARCHAR(20),
  phone TEXT,
  email TEXT,
  website TEXT,
  reference_name TEXT NOT NULL,
  reference_email TEXT,
  reference_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agency_memberships (
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, user_id)
);
CREATE INDEX agency_memberships_user_idx ON agency_memberships (user_id, agency_id);

CREATE TABLE impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  user_agent TEXT,
  CHECK (actor_user_id <> target_user_id),
  CHECK (expires_at > started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX impersonation_sessions_active_idx
  ON impersonation_sessions (actor_user_id, expires_at DESC) WHERE ended_at IS NULL;

CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX user_invitations_active_idx
  ON user_invitations (user_id, expires_at DESC) WHERE used_at IS NULL;

-- Catalogo globale condiviso: niente duplicazione per agenzia. Le modifiche
-- editoriali specifiche dell'agenzia vivono negli override, non nel catalogo.
CREATE TABLE countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_code CHAR(2) UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  google_url TEXT NOT NULL,
  default_timezone timezone_name,
  last_verified_at TIMESTAMPTZ,
  content_refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326),
  timezone timezone_name,
  last_verified_at TIMESTAMPTZ,
  content_refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_id, normalized_name)
);
CREATE INDEX cities_location_gix ON cities USING GIST (location);

CREATE TABLE visit_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  official_url TEXT,
  location GEOGRAPHY(POINT, 4326),
  last_verified_at TIMESTAMPTZ,
  content_refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, normalized_name)
);
CREATE INDEX visit_sites_location_gix ON visit_sites USING GIST (location);
CREATE INDEX visit_sites_name_trgm_idx ON visit_sites USING GIN (normalized_name gin_trgm_ops);

CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  google_url TEXT NOT NULL,
  website_url TEXT,
  location GEOGRAPHY(POINT, 4326),
  last_verified_at TIMESTAMPTZ,
  content_refresh_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, normalized_name)
);
CREATE INDEX hotels_location_gix ON hotels USING GIST (location);
CREATE INDEX hotels_name_trgm_idx ON hotels USING GIN (normalized_name gin_trgm_ops);

CREATE TABLE reference_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('country', 'city', 'site')),
  entity_id UUID NOT NULL,
  content_type VARCHAR(30) NOT NULL CHECK (content_type IN (
    'useful_info', 'phrasebook', 'bingo', 'quiz', 'mission', 'game', 'photo_contest'
  )),
  locale locale_code NOT NULL DEFAULT 'it-IT',
  content JSONB NOT NULL CHECK (jsonb_typeof(content) IN ('object', 'array')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed', 'archived')),
  model TEXT,
  refreshed_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  error_message TEXT,
  content_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, content_type, locale)
);
CREATE INDEX reference_contents_refresh_idx
  ON reference_contents (refresh_after, entity_type, content_type)
  WHERE status IN ('ready', 'failed');

CREATE TABLE trip_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  slug VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL CHECK (btrim(title) <> ''),
  primary_country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  default_locale locale_code NOT NULL DEFAULT 'it-IT',
  default_timezone timezone_name NOT NULL DEFAULT 'UTC',
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_id, slug),
  UNIQUE (agency_id, id)
);
CREATE INDEX trip_templates_agency_status_idx
  ON trip_templates (agency_id, status, updated_at DESC, id);

CREATE TABLE trip_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  revision_note TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
  UNIQUE (template_id, version_number),
  UNIQUE (agency_id, template_id, id),
  UNIQUE (agency_id, id),
  CHECK ((status = 'published') = (published_at IS NOT NULL) OR status = 'archived')
);

CREATE TABLE trip_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  day_number SMALLINT NOT NULL CHECK (day_number > 0),
  day_offset SMALLINT NOT NULL CHECK (day_offset >= 0),
  label TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  city_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE,
  UNIQUE (template_version_id, day_number),
  UNIQUE (template_version_id, day_offset),
  UNIQUE (agency_id, id)
);

CREATE TABLE trip_countries (
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, country_id)
);
CREATE INDEX trip_countries_country_idx ON trip_countries (country_id, template_id);

CREATE TABLE trip_day_cities (
  agency_id UUID NOT NULL,
  trip_day_id UUID NOT NULL,
  city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (trip_day_id, city_id)
);
CREATE INDEX trip_day_cities_city_idx ON trip_day_cities (city_id, trip_day_id);

CREATE TABLE trip_day_sites (
  agency_id UUID NOT NULL,
  trip_day_id UUID NOT NULL,
  site_id UUID NOT NULL REFERENCES visit_sites(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (trip_day_id, site_id)
);
CREATE INDEX trip_day_sites_site_idx ON trip_day_sites (site_id, trip_day_id);

CREATE TABLE trip_day_hotels (
  agency_id UUID NOT NULL,
  trip_day_id UUID NOT NULL,
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (trip_day_id, hotel_id)
);
CREATE INDEX trip_day_hotels_hotel_idx ON trip_day_hotels (hotel_id, trip_day_id);

CREATE TABLE itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  trip_day_id UUID NOT NULL,
  visit_site_id UUID REFERENCES visit_sites(id) ON DELETE SET NULL,
  hotel_id UUID REFERENCES hotels(id) ON DELETE SET NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN (
    'visit', 'transport', 'flight', 'train', 'hotel', 'meal', 'free_time', 'meeting', 'other'
  )),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
  extraction_confidence NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, id),
  CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at)
);
CREATE INDEX itinerary_items_day_sort_idx ON itinerary_items (trip_day_id, sort_order, id);

CREATE TABLE useful_information (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  phone TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX useful_information_version_sort_idx
  ON useful_information (agency_id, template_version_id, sort_order, id);

CREATE TABLE phrasebook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  language_code VARCHAR(12) NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  term TEXT NOT NULL,
  pronunciation TEXT NOT NULL DEFAULT '',
  translation TEXT NOT NULL,
  source VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX phrasebook_version_sort_idx
  ON phrasebook_entries (agency_id, template_version_id, sort_order, language_code, id);

CREATE TABLE generated_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  trip_day_id UUID,
  source_reference_content_id UUID REFERENCES reference_contents(id) ON DELETE SET NULL,
  content_type VARCHAR(30) NOT NULL CHECK (content_type IN (
    'quiz_question', 'mission', 'bingo_item', 'word_game', 'order_game', 'puzzle', 'photo_contest'
  )),
  title TEXT NOT NULL DEFAULT '',
  content JSONB NOT NULL CHECK (jsonb_typeof(content) IN ('object', 'array')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  source VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_version_id)
    REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, id)
);
CREATE INDEX generated_content_runtime_idx
  ON generated_content (agency_id, template_version_id, trip_day_id, sort_order, id)
  WHERE status = 'approved';

CREATE TABLE departures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  template_id UUID NOT NULL,
  template_version_id UUID NOT NULL,
  code VARCHAR(80) NOT NULL,
  title TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  timezone timezone_name NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'open', 'confirmed', 'in_progress', 'completed', 'cancelled', 'archived'
  )),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (agency_id, template_id, template_version_id)
    REFERENCES trip_template_versions(agency_id, template_id, id) ON DELETE RESTRICT,
  UNIQUE (agency_id, code),
  UNIQUE (agency_id, id),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX departures_agency_status_dates_idx
  ON departures (agency_id, status, starts_on, ends_on, id);

-- Mappa esplicita partenza-giorno: impedisce che spese/feedback di una partenza
-- puntino a un giorno appartenente a un'altra versione del viaggio.
CREATE TABLE departure_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  trip_day_id UUID NOT NULL,
  service_date DATE NOT NULL,
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE RESTRICT,
  UNIQUE (departure_id, trip_day_id),
  UNIQUE (departure_id, service_date),
  UNIQUE (agency_id, id)
);

CREATE TABLE departure_item_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  itinerary_item_id UUID,
  operation VARCHAR(12) NOT NULL CHECK (operation IN ('add', 'update', 'remove')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  reason TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
  CHECK ((operation = 'add' AND itinerary_item_id IS NULL) OR operation <> 'add')
);
CREATE INDEX departure_item_overrides_departure_idx
  ON departure_item_overrides (departure_id, created_at, id);

CREATE TABLE travel_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  code VARCHAR(80) NOT NULL,
  name TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'completed', 'archived')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  UNIQUE (departure_id, code),
  UNIQUE (agency_id, id)
);
CREATE INDEX travel_parties_departure_idx ON travel_parties (departure_id, status, id);

CREATE TABLE traveler_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  email TEXT,
  phone TEXT,
  birth_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id),
  UNIQUE (agency_id, id)
);
CREATE INDEX traveler_profiles_user_idx
  ON traveler_profiles (user_id, agency_id) WHERE user_id IS NOT NULL;

CREATE TABLE party_memberships (
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('organizer', 'member')),
  status VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
  PRIMARY KEY (party_id, traveler_id)
);
CREATE INDEX party_memberships_traveler_active_idx
  ON party_memberships (traveler_id, party_id, agency_id) WHERE status = 'active';

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  departure_id UUID,
  party_id UUID,
  uploaded_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('r2', 's3')),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 CHAR(64),
  purpose VARCHAR(30) NOT NULL,
  visibility VARCHAR(20) NOT NULL CHECK (visibility IN ('private', 'party', 'departure', 'agency')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  UNIQUE (provider, bucket, object_key),
  UNIQUE (agency_id, id),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE INDEX media_assets_scope_idx
  ON media_assets (agency_id, departure_id, party_id, created_at DESC, id);
CREATE INDEX media_assets_party_ready_idx
  ON media_assets (party_id, created_at DESC, id) WHERE status = 'ready';

CREATE TABLE travel_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  template_id UUID,
  departure_id UUID,
  media_asset_id UUID NOT NULL,
  document_type VARCHAR(30) NOT NULL,
  title TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
  UNIQUE (media_asset_id),
  UNIQUE (agency_id, id),
  CHECK (template_id IS NOT NULL OR departure_id IS NOT NULL)
);

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  template_id UUID NOT NULL,
  document_id UUID NOT NULL,
  normalized_document_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'queued', 'extracting', 'generating', 'ready_for_review', 'published', 'failed'
  )),
  extraction_provider TEXT,
  ai_provider TEXT,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, document_id) REFERENCES travel_documents(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, normalized_document_id) REFERENCES travel_documents(agency_id, id) ON DELETE SET NULL,
  UNIQUE (document_id),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX import_jobs_status_idx ON import_jobs (agency_id, status, created_at, id);

CREATE TABLE platform_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  import_job_id UUID REFERENCES import_jobs(id) ON DELETE CASCADE,
  job_type VARCHAR(80) NOT NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('database', 'sqs')),
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
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
  UNIQUE (agency_id, idempotency_key)
);
CREATE INDEX platform_jobs_available_idx
  ON platform_jobs (provider, available_at, created_at, id)
  WHERE status = 'queued';

-- Outbox transazionale per cancellazioni R2/S3 e altri side effect esterni.
CREATE TABLE integration_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX integration_outbox_pending_idx
  ON integration_outbox (available_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE currencies (
  code currency_code PRIMARY KEY,
  name TEXT NOT NULL,
  minor_unit SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO currencies (code, name, minor_unit) VALUES
  ('EUR', 'Euro', 2), ('USD', 'US Dollar', 2), ('GBP', 'Pound Sterling', 2),
  ('UZS', 'Uzbekistani Som', 0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE party_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID,
  label VARCHAR(240) NOT NULL CHECK (btrim(label) <> ''),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency currency_code NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  base_currency currency_code NOT NULL DEFAULT 'EUR' REFERENCES currencies(code) ON DELETE RESTRICT,
  exchange_rate_to_base NUMERIC(24,12) CHECK (exchange_rate_to_base IS NULL OR exchange_rate_to_base > 0),
  base_amount_minor BIGINT CHECK (base_amount_minor IS NULL OR base_amount_minor > 0),
  paid_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  paid_by_name TEXT NOT NULL,
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE SET NULL,
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX party_expenses_scope_idx ON party_expenses (party_id, created_at DESC, id);

CREATE TABLE party_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('withdrawal', 'exchange')),
  source_amount_minor BIGINT CHECK (source_amount_minor IS NULL OR source_amount_minor > 0),
  source_currency currency_code NOT NULL DEFAULT 'EUR' REFERENCES currencies(code) ON DELETE RESTRICT,
  target_amount_minor BIGINT NOT NULL CHECK (target_amount_minor > 0),
  target_currency currency_code NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  applied_rate NUMERIC(24,12) CHECK (applied_rate IS NULL OR applied_rate > 0),
  added_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  added_by_name TEXT NOT NULL,
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, client_operation_id),
  CHECK (source_currency <> target_currency)
);
CREATE INDEX party_cash_scope_idx ON party_cash_movements (party_id, created_at DESC, id);

CREATE TABLE party_day_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  note_text TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by_name TEXT NOT NULL DEFAULT '',
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, departure_day_id),
  UNIQUE (party_id, client_operation_id)
);

CREATE TABLE party_restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  visit_site_id UUID REFERENCES visit_sites(id) ON DELETE SET NULL,
  added_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  added_by_name TEXT NOT NULL,
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX party_restaurants_scope_idx
  ON party_restaurants (party_id, departure_day_id, created_at DESC, id);

CREATE TABLE party_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  caption TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, client_operation_id)
);
CREATE INDEX party_memories_scope_idx
  ON party_memories (party_id, departure_day_id, created_at DESC, id);
CREATE INDEX party_memories_media_idx ON party_memories (media_asset_id, party_id);

CREATE TABLE party_activity_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  departure_day_id UUID,
  generated_content_id UUID NOT NULL,
  activity_type VARCHAR(24) NOT NULL CHECK (activity_type IN (
    'quiz', 'mission', 'bingo', 'word_game', 'order_game', 'puzzle'
  )),
  score positive_score NOT NULL DEFAULT 0,
  max_score positive_score,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  evidence_media_asset_id UUID,
  validated_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  client_operation_id UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, generated_content_id) REFERENCES generated_content(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, evidence_media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE SET NULL,
  UNIQUE (party_id, traveler_id, generated_content_id),
  UNIQUE (party_id, client_operation_id),
  CHECK (max_score IS NULL OR score <= max_score)
);
CREATE INDEX party_activity_ranking_idx
  ON party_activity_results (party_id, activity_type, score DESC, submitted_at, id)
  WHERE status = 'approved';

CREATE TABLE party_photo_contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  generated_content_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  participant_slot SMALLINT NOT NULL CHECK (participant_slot BETWEEN 1 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'evaluating', 'ranked', 'rejected')),
  score NUMERIC(8,3) CHECK (score IS NULL OR score >= 0),
  reason TEXT NOT NULL DEFAULT '',
  is_winner BOOLEAN NOT NULL DEFAULT false,
  judged_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  client_operation_id UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  judged_at TIMESTAMPTZ,
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, generated_content_id) REFERENCES generated_content(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
  UNIQUE (party_id, traveler_id, generated_content_id, participant_slot),
  UNIQUE (party_id, client_operation_id),
  CHECK (judged_at IS NULL OR judged_at >= submitted_at)
);
CREATE INDEX party_photo_contest_ranking_idx
  ON party_photo_contest_entries (party_id, generated_content_id, score DESC, submitted_at, id)
  WHERE status = 'ranked';
CREATE UNIQUE INDEX party_photo_contest_single_winner_idx
  ON party_photo_contest_entries (party_id, generated_content_id)
  WHERE is_winner;

CREATE TABLE itinerary_item_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  itinerary_item_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  document_type VARCHAR(20) NOT NULL DEFAULT 'ticket'
    CHECK (document_type IN ('ticket', 'voucher', 'other')),
  title TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
  UNIQUE (agency_id, media_asset_id)
);
CREATE INDEX itinerary_item_documents_scope_idx
  ON itinerary_item_documents (departure_id, itinerary_item_id, created_at, id);

CREATE TABLE traveler_programme_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  departure_day_id UUID NOT NULL,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('itinerary_item', 'hotel')),
  itinerary_item_id UUID,
  hotel_id UUID,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  client_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, departure_day_id) REFERENCES departure_days(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
  UNIQUE (traveler_id, client_operation_id),
  CHECK (
    (target_type = 'itinerary_item' AND itinerary_item_id IS NOT NULL AND hotel_id IS NULL)
    OR (target_type = 'hotel' AND hotel_id IS NOT NULL AND itinerary_item_id IS NULL)
  )
);
CREATE UNIQUE INDEX traveler_programme_item_feedback_uidx
  ON traveler_programme_feedback (departure_id, party_id, traveler_id, itinerary_item_id)
  WHERE itinerary_item_id IS NOT NULL;
CREATE UNIQUE INDEX traveler_programme_hotel_feedback_uidx
  ON traveler_programme_feedback (departure_id, party_id, traveler_id, departure_day_id, hotel_id)
  WHERE hotel_id IS NOT NULL;
CREATE INDEX traveler_programme_feedback_analysis_idx
  ON traveler_programme_feedback (agency_id, target_type, rating, updated_at DESC, id);

-- Eventi append-only: BIGINT è più compatto e sequenziale di UUID per volumi elevati.
CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  departure_id UUID,
  party_id UUID,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT NOT NULL,
  action VARCHAR(80) NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx
  ON audit_events (agency_id, entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX audit_events_request_idx
  ON audit_events (request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_row_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform_users', 'agencies', 'countries', 'cities', 'visit_sites', 'hotels',
    'reference_contents', 'trip_templates', 'generated_content', 'departures',
    'travel_parties', 'traveler_profiles', 'media_assets', 'import_jobs', 'platform_jobs',
    'party_expenses', 'party_day_notes', 'party_memories', 'party_activity_results',
    'traveler_programme_feedback'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION set_row_updated_at()', table_name, table_name);
  END LOOP;
END;
$$;

-- Il ruolo runtime deve essere creato nel pannello Neon senza BYPASSRLS e senza
-- ownership delle tabelle. Password/connection string non appartengono al DDL.
-- Prima di abilitare RLS, il DAL dovrà impostare app.agency_id e app.user_id
-- all'interno della stessa transazione HTTP per ogni operazione.
CREATE OR REPLACE FUNCTION current_agency_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.agency_id', true), '')::uuid
$$;

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_day_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_day_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_day_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE useful_information ENABLE ROW LEVEL SECURITY;
ALTER TABLE phrasebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE departures ENABLE ROW LEVEL SECURITY;
ALTER TABLE departure_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE departure_item_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE traveler_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_day_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_activity_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_photo_contest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_item_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE traveler_programme_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON agencies
  USING (id = current_agency_id())
  WITH CHECK (id = current_agency_id());

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agency_memberships', 'trip_templates', 'trip_template_versions',
    'trip_days', 'trip_countries', 'trip_day_cities', 'trip_day_sites', 'trip_day_hotels',
    'itinerary_items', 'useful_information', 'phrasebook_entries', 'generated_content',
    'departures', 'departure_days', 'departure_item_overrides', 'travel_parties',
    'traveler_profiles', 'party_memberships', 'media_assets', 'travel_documents',
    'import_jobs', 'platform_jobs', 'integration_outbox',
    'party_expenses', 'party_cash_movements',
    'party_day_notes', 'party_restaurants', 'party_memories', 'party_activity_results',
    'party_photo_contest_entries', 'itinerary_item_documents',
    'traveler_programme_feedback', 'audit_events'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (agency_id = current_agency_id()) '
      'WITH CHECK (agency_id = current_agency_id())', table_name
    );
  END LOOP;
END;
$$;
