import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL non configurata");

const sql = neon(databaseUrl);

await sql`
  CREATE TABLE IF NOT EXISTS platform_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const migrationVersion = "001_multitenant_foundation";
const alreadyApplied = await sql`
  SELECT 1 FROM platform_schema_migrations WHERE version = ${migrationVersion} LIMIT 1
`;

if (alreadyApplied.length > 0) {
  console.log(`${migrationVersion}: già applicata`);
}

await sql`
  CREATE TABLE IF NOT EXISTS platform_users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
    initials TEXT NOT NULL DEFAULT '',
    email TEXT,
    phone TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'legacy',
    auth_subject TEXT,
    platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('superadmin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (auth_provider, auth_subject)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS agencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended', 'closed')),
    default_locale TEXT NOT NULL DEFAULT 'it-IT',
    default_timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
    branding JSONB NOT NULL DEFAULT '{}'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    legal_name TEXT,
    vat_number TEXT,
    tax_code TEXT,
    registered_address TEXT,
    registered_city TEXT,
    registered_postal_code TEXT,
    registered_province TEXT,
    registered_country TEXT,
    pec TEXT,
    sdi_code TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    reference_name TEXT NOT NULL DEFAULT '',
    reference_email TEXT NOT NULL DEFAULT '',
    reference_phone TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS agency_memberships (
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agency_id, user_id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
    destination_country TEXT,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    default_locale TEXT NOT NULL DEFAULT 'it-IT',
    default_timezone TEXT NOT NULL DEFAULT 'UTC',
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agency_id, slug),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    revision_note TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ,
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
    UNIQUE (template_id, version_number),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    day_number SMALLINT NOT NULL CHECK (day_number > 0),
    day_offset SMALLINT NOT NULL CHECK (day_offset >= 0),
    label TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_date DATE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (agency_id, template_version_id)
      REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE,
    UNIQUE (template_version_id, day_number),
    UNIQUE (template_version_id, day_offset),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    place_type TEXT NOT NULL DEFAULT 'attraction'
      CHECK (place_type IN ('city', 'attraction', 'hotel', 'restaurant', 'airport', 'station', 'other')),
    city TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    information_url TEXT,
    map_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS itinerary_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    trip_day_id UUID NOT NULL,
    place_id UUID,
    item_type TEXT NOT NULL CHECK (item_type IN (
      'visit', 'transport', 'flight', 'train', 'hotel', 'meal', 'free_time', 'meeting', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TIME,
    ends_at TIME,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
    extraction_confidence NUMERIC(4,3)
      CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, place_id) REFERENCES places(agency_id, id) ON DELETE SET NULL (place_id),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS accommodations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    trip_day_id UUID NOT NULL,
    place_id UUID,
    name TEXT NOT NULL,
    information_url TEXT,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, place_id) REFERENCES places(agency_id, id) ON DELETE SET NULL (place_id),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS departures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL CHECK (ends_on >= starts_on),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'open', 'confirmed', 'in_progress', 'completed', 'cancelled', 'archived')),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (agency_id, template_version_id)
      REFERENCES trip_template_versions(agency_id, id) ON DELETE RESTRICT,
    UNIQUE (agency_id, code),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS departure_item_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    departure_id UUID NOT NULL,
    itinerary_item_id UUID,
    operation TEXT NOT NULL CHECK (operation IN ('add', 'update', 'remove')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT NOT NULL DEFAULT '',
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS travel_parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    departure_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'completed', 'archived')),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    UNIQUE (departure_id, code),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS traveler_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    birth_date DATE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agency_id, user_id),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS party_memberships (
    agency_id UUID NOT NULL,
    party_id UUID NOT NULL,
    traveler_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('organizer', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
    PRIMARY KEY (party_id, traveler_id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS useful_information (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    phone TEXT,
    url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (agency_id, template_version_id)
      REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS phrasebook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    language_code TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    term TEXT NOT NULL,
    pronunciation TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (agency_id, template_version_id)
      REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS generated_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    trip_day_id UUID,
    content_type TEXT NOT NULL CHECK (content_type IN (
      'quiz_question', 'mission', 'bingo_item', 'word_game', 'order_game', 'photo_contest'
    )),
    title TEXT NOT NULL DEFAULT '',
    content JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, template_version_id)
      REFERENCES trip_template_versions(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    departure_id UUID,
    party_id UUID,
    uploaded_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    provider TEXT NOT NULL CHECK (provider IN ('vercel_blob', 'r2', 's3')),
    bucket TEXT NOT NULL DEFAULT '',
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    checksum_sha256 TEXT,
    purpose TEXT NOT NULL DEFAULT 'photo',
    visibility TEXT NOT NULL DEFAULT 'party'
      CHECK (visibility IN ('private', 'party', 'departure', 'agency')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    UNIQUE (provider, bucket, object_key),
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS travel_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    template_id UUID,
    departure_id UUID,
    media_asset_id UUID NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'programme',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded'
      CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
    UNIQUE (agency_id, id)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    template_id UUID NOT NULL,
    document_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, template_id) REFERENCES trip_templates(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, document_id) REFERENCES travel_documents(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS platform_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'database' CHECK (provider IN ('database', 'sqs')),
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
    payload JSONB NOT NULL,
    external_id TEXT,
    idempotency_key TEXT NOT NULL,
    attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agency_id, idempotency_key)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    actor_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    departure_id UUID,
    party_id UUID,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE
  )
`;

await sql`CREATE INDEX IF NOT EXISTS agency_memberships_user_idx ON agency_memberships (user_id, agency_id)`;
await sql`CREATE INDEX IF NOT EXISTS trip_templates_agency_status_idx ON trip_templates (agency_id, status, updated_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS departures_agency_dates_idx ON departures (agency_id, starts_on, ends_on)`;
await sql`CREATE INDEX IF NOT EXISTS travel_parties_departure_idx ON travel_parties (departure_id, status)`;
await sql`CREATE INDEX IF NOT EXISTS itinerary_items_day_sort_idx ON itinerary_items (trip_day_id, sort_order)`;
await sql`CREATE INDEX IF NOT EXISTS generated_content_day_type_idx ON generated_content (trip_day_id, content_type, sort_order)`;
await sql`CREATE INDEX IF NOT EXISTS media_assets_scope_idx ON media_assets (agency_id, departure_id, party_id, created_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs (agency_id, status, created_at)`;
await sql`CREATE INDEX IF NOT EXISTS platform_jobs_available_idx ON platform_jobs (status, available_at, created_at)`;
await sql`CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (agency_id, entity_type, entity_id, created_at DESC)`;

await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${migrationVersion})
  ON CONFLICT (version) DO NOTHING
`;

if (alreadyApplied.length === 0) console.log(`${migrationVersion}: applicata`);

const adminImportMigration = "002_admin_import_flow";
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS travel_documents_media_asset_unique
  ON travel_documents (media_asset_id)
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_document_unique
  ON import_jobs (document_id)
`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${adminImportMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${adminImportMigration}: verificata`);

const neonAuthMigration = "003_neon_auth_identity";
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS platform_users_normalized_email_unique
  ON platform_users (LOWER(email))
  WHERE email IS NOT NULL
`;
await sql`
  CREATE INDEX IF NOT EXISTS platform_users_auth_subject_idx
  ON platform_users (auth_provider, auth_subject)
`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${neonAuthMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${neonAuthMigration}: verificata`);

const superadminMigration = "004_superadmin_agency_registry";
await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS phone TEXT`;
await sql`
  ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'user'
  CHECK (platform_role IN ('superadmin', 'user'))
`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS legal_name TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS vat_number TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS tax_code TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS registered_address TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS registered_city TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS registered_postal_code TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS registered_province TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS registered_country TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS pec TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS sdi_code TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS phone TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS email TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS website TEXT`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS reference_name TEXT NOT NULL DEFAULT ''`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS reference_email TEXT NOT NULL DEFAULT ''`;
await sql`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS reference_phone TEXT NOT NULL DEFAULT ''`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${superadminMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${superadminMigration}: verificata`);

const impersonationMigration = "005_superadmin_impersonation";
await sql`
  CREATE TABLE IF NOT EXISTS impersonation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    target_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    user_agent TEXT,
    CHECK (actor_user_id <> target_user_id)
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS impersonation_sessions_active_idx
  ON impersonation_sessions (actor_user_id, expires_at DESC)
  WHERE ended_at IS NULL
`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${impersonationMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${impersonationMigration}: verificata`);

const travelCatalogMigration = "006_shared_travel_catalog";
await sql`
  CREATE TABLE IF NOT EXISTS countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    iso_code TEXT,
    google_url TEXT NOT NULL,
    last_verified_at TIMESTAMPTZ,
    content_refresh_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id UUID NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    google_url TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    last_verified_at TIMESTAMPTZ,
    content_refresh_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (country_id, normalized_name)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS visit_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    google_url TEXT NOT NULL,
    official_url TEXT,
    last_verified_at TIMESTAMPTZ,
    content_refresh_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, normalized_name)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS hotels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    google_url TEXT NOT NULL,
    website_url TEXT,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, normalized_name)
  )
`;
await sql`ALTER TABLE trip_templates ADD COLUMN IF NOT EXISTS starts_on DATE`;
await sql`ALTER TABLE trip_templates ADD COLUMN IF NOT EXISTS ends_on DATE`;
await sql`ALTER TABLE trip_templates ADD COLUMN IF NOT EXISTS primary_country_id UUID REFERENCES countries(id) ON DELETE SET NULL`;
await sql`
  CREATE TABLE IF NOT EXISTS trip_countries (
    template_id UUID NOT NULL REFERENCES trip_templates(id) ON DELETE CASCADE,
    country_id UUID NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    PRIMARY KEY (template_id, country_id)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS trip_day_cities (
    trip_day_id UUID NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    PRIMARY KEY (trip_day_id, city_id)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS trip_day_sites (
    trip_day_id UUID NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES visit_sites(id) ON DELETE RESTRICT,
    PRIMARY KEY (trip_day_id, site_id)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS trip_day_hotels (
    trip_day_id UUID NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
    hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
    PRIMARY KEY (trip_day_id, hotel_id)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS reference_contents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('country', 'city', 'site')),
    entity_id UUID NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN (
      'useful_info', 'phrasebook', 'bingo', 'quiz', 'mission', 'game', 'photo_contest'
    )),
    locale TEXT NOT NULL DEFAULT 'it-IT',
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'archived')),
    model TEXT,
    refreshed_at TIMESTAMPTZ,
    refresh_after TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, content_type, locale)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS user_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS user_invitations_active_idx ON user_invitations (user_id, expires_at DESC) WHERE used_at IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS reference_contents_refresh_idx ON reference_contents (status, refresh_after)`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${travelCatalogMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${travelCatalogMigration}: verificata`);

const travelerExperienceMigration = "007_traveler_experience";
await sql`ALTER TABLE phrasebook_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ai'))`;
await sql`
  CREATE TABLE IF NOT EXISTS party_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    departure_id UUID NOT NULL,
    party_id UUID NOT NULL,
    trip_day_id UUID,
    label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency IN ('EUR', 'USD', 'UZS', 'GBP')),
    paid_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    paid_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE SET NULL (trip_day_id)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_expenses_scope_idx ON party_expenses (party_id, created_at DESC)`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${travelerExperienceMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${travelerExperienceMigration}: verificata`);

const familyActivityIsolationMigration = "008_family_activity_isolation";
await sql`
  CREATE TABLE IF NOT EXISTS party_activity_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    party_id UUID NOT NULL,
    traveler_id UUID NOT NULL,
    trip_day_id UUID,
    generated_content_id UUID NOT NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('quiz', 'mission', 'bingo', 'word_game', 'order_game', 'puzzle')),
    score NUMERIC(12,2) NOT NULL DEFAULT 0,
    max_score NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    validated_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (generated_content_id) REFERENCES generated_content(id) ON DELETE CASCADE,
    UNIQUE (party_id, traveler_id, generated_content_id)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_activity_ranking_idx ON party_activity_results (party_id, activity_type, score DESC, submitted_at)`;
await sql`
  CREATE TABLE IF NOT EXISTS party_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    party_id UUID NOT NULL,
    trip_day_id UUID,
    media_asset_id UUID NOT NULL,
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    caption TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_memories_scope_idx ON party_memories (party_id, trip_day_id, created_at DESC)`;
await sql`
  CREATE TABLE IF NOT EXISTS party_photo_contest_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    party_id UUID NOT NULL,
    traveler_id UUID NOT NULL,
    generated_content_id UUID NOT NULL,
    media_asset_id UUID NOT NULL,
    participant_slot SMALLINT NOT NULL CHECK (participant_slot BETWEEN 1 AND 3),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'evaluating', 'ranked', 'rejected')),
    score NUMERIC(8,3),
    reason TEXT NOT NULL DEFAULT '',
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    judged_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    judged_at TIMESTAMPTZ,
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (generated_content_id) REFERENCES generated_content(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
    UNIQUE (party_id, traveler_id, generated_content_id, participant_slot)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_photo_contest_ranking_idx ON party_photo_contest_entries (party_id, generated_content_id, score DESC, submitted_at)`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${familyActivityIsolationMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${familyActivityIsolationMigration}: verificata`);

const familyJournalMigration = "009_family_journal";
await sql`
  CREATE TABLE IF NOT EXISTS party_day_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agency_id UUID NOT NULL,
    party_id UUID NOT NULL, trip_day_id UUID NOT NULL,
    text TEXT NOT NULL DEFAULT '', updated_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    updated_by_name TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    UNIQUE (party_id, trip_day_id)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS party_restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agency_id UUID NOT NULL,
    party_id UUID NOT NULL, trip_day_id UUID NOT NULL, name TEXT NOT NULL,
    added_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    added_by_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_restaurants_scope_idx ON party_restaurants (party_id, trip_day_id, created_at DESC)`;
await sql`
  CREATE TABLE IF NOT EXISTS party_cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agency_id UUID NOT NULL,
    party_id UUID NOT NULL, trip_day_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('withdrawal', 'exchange')),
    euro_amount NUMERIC(18,2), local_amount NUMERIC(18,2) NOT NULL CHECK (local_amount > 0),
    local_currency TEXT NOT NULL DEFAULT 'UZS', fee_euro NUMERIC(18,2),
    added_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    added_by_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE
  )
`;
await sql`CREATE INDEX IF NOT EXISTS party_cash_scope_idx ON party_cash_movements (party_id, trip_day_id, created_at DESC)`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${familyJournalMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${familyJournalMigration}: verificata`);

const programmeFeedbackMigration = "010_programme_tickets_feedback";
await sql`
  CREATE TABLE IF NOT EXISTS itinerary_item_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    departure_id UUID NOT NULL,
    itinerary_item_id UUID NOT NULL,
    media_asset_id UUID NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'ticket' CHECK (document_type IN ('ticket', 'voucher', 'other')),
    title TEXT NOT NULL,
    created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
    UNIQUE (agency_id, media_asset_id)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS itinerary_item_documents_scope_idx ON itinerary_item_documents (departure_id, itinerary_item_id, created_at)`;
await sql`
  CREATE TABLE IF NOT EXISTS traveler_programme_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    departure_id UUID NOT NULL,
    party_id UUID NOT NULL,
    traveler_id UUID NOT NULL,
    trip_day_id UUID NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('itinerary_item', 'hotel')),
    itinerary_item_id UUID,
    hotel_id UUID,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
    FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
    CHECK (
      (target_type = 'itinerary_item' AND itinerary_item_id IS NOT NULL AND hotel_id IS NULL)
      OR (target_type = 'hotel' AND hotel_id IS NOT NULL AND itinerary_item_id IS NULL)
    )
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS traveler_programme_item_feedback_uidx
  ON traveler_programme_feedback (departure_id, party_id, traveler_id, itinerary_item_id)
  WHERE itinerary_item_id IS NOT NULL
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS traveler_programme_hotel_feedback_uidx
  ON traveler_programme_feedback (departure_id, party_id, traveler_id, trip_day_id, hotel_id)
  WHERE hotel_id IS NOT NULL
`;
await sql`CREATE INDEX IF NOT EXISTS traveler_programme_feedback_analysis_idx ON traveler_programme_feedback (agency_id, target_type, rating, updated_at DESC)`;
await sql`
  INSERT INTO platform_schema_migrations (version) VALUES (${programmeFeedbackMigration})
  ON CONFLICT (version) DO NOTHING
`;
console.log(`${programmeFeedbackMigration}: verificata`);
