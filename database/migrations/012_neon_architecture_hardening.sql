-- SMF Travel - hardening compatibile con lo schema corrente.
-- Eseguire con DATABASE_DIRECT_URL su un branch Neon, fuori da una transazione
-- globale: CREATE INDEX CONCURRENTLY non può essere eseguito in transaction block.

SET lock_timeout = '3s';
SET statement_timeout = '15min';

-- Le query runtime partono dall'identità Neon e dalle appartenenze attive.
CREATE INDEX CONCURRENTLY IF NOT EXISTS traveler_profiles_user_idx
  ON traveler_profiles (user_id, agency_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS party_memberships_traveler_active_idx
  ON party_memberships (traveler_id, party_id, agency_id)
  WHERE status = 'active';

-- Elenchi agenzia e selezione del viaggio corrente/futuro.
CREATE INDEX CONCURRENTLY IF NOT EXISTS departures_agency_status_dates_idx
  ON departures (agency_id, status, starts_on, ends_on, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS departures_template_idx
  ON departures (agency_id, template_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS departures_template_version_idx
  ON departures (agency_id, template_version_id);

-- Caricamento del programma viaggiatore.
CREATE INDEX CONCURRENTLY IF NOT EXISTS accommodations_day_sort_idx
  ON accommodations (trip_day_id, sort_order, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS useful_information_version_sort_idx
  ON useful_information (agency_id, template_version_id, sort_order, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS phrasebook_version_sort_idx
  ON phrasebook_entries (agency_id, template_version_id, sort_order, language_code, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_content_runtime_idx
  ON generated_content (agency_id, template_version_id, trip_day_id, sort_order, id)
  WHERE status = 'approved';

CREATE INDEX CONCURRENTLY IF NOT EXISTS party_cash_recent_idx
  ON party_cash_movements (party_id, created_at DESC, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS media_assets_party_ready_idx
  ON media_assets (party_id, created_at DESC, id)
  WHERE status = 'ready';

-- FK non coperte da un indice con le stesse colonne iniziali.
CREATE INDEX CONCURRENTLY IF NOT EXISTS departure_item_overrides_departure_idx
  ON departure_item_overrides (departure_id, created_at, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS departure_item_overrides_item_idx
  ON departure_item_overrides (itinerary_item_id)
  WHERE itinerary_item_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS travel_documents_template_idx
  ON travel_documents (template_id)
  WHERE template_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS travel_documents_departure_idx
  ON travel_documents (departure_id)
  WHERE departure_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS import_jobs_template_idx
  ON import_jobs (template_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS cities_country_idx
  ON cities (country_id, normalized_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS visit_sites_city_idx
  ON visit_sites (city_id, normalized_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS hotels_city_idx
  ON hotels (city_id, normalized_name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trip_countries_country_idx
  ON trip_countries (country_id, template_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trip_day_cities_city_idx
  ON trip_day_cities (city_id, trip_day_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trip_day_sites_site_idx
  ON trip_day_sites (site_id, trip_day_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS trip_day_hotels_hotel_idx
  ON trip_day_hotels (hotel_id, trip_day_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS party_activity_content_idx
  ON party_activity_results (generated_content_id, party_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS party_memories_media_idx
  ON party_memories (media_asset_id, party_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS photo_contest_media_idx
  ON party_photo_contest_entries (media_asset_id, party_id);

-- Finché importId resta nel payload JSONB, questo indice evita scansioni della coda.
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_jobs_import_id_idx
  ON platform_jobs ((payload->>'importId'))
  WHERE job_type = 'travel-programme.import';

-- Il catalogo condiviso necessita coordinate puntuali: le coordinate della città
-- non devono essere riutilizzate come se fossero quelle di un monumento/hotel.
ALTER TABLE visit_sites ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE visit_sites ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE visit_sites
  ADD CONSTRAINT visit_sites_latitude_check
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90) NOT VALID;
ALTER TABLE visit_sites
  ADD CONSTRAINT visit_sites_longitude_check
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180) NOT VALID;
ALTER TABLE hotels
  ADD CONSTRAINT hotels_latitude_check
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90) NOT VALID;
ALTER TABLE hotels
  ADD CONSTRAINT hotels_longitude_check
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180) NOT VALID;

-- Orari precisi solo per prenotazioni/trasporti. Le attività ordinarie continuano
-- a essere ordinate con sort_order e non sono obbligate ad avere un orario.
ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;
ALTER TABLE itinerary_items
  ADD CONSTRAINT itinerary_items_scheduled_range_check
  CHECK (
    scheduled_end_at IS NULL OR scheduled_start_at IS NULL
    OR scheduled_end_at >= scheduled_start_at
  ) NOT VALID;

-- Idempotenza per retry e sincronizzazione mobile. L'app può popolare questa
-- colonna gradualmente senza cambiare il contratto delle righe esistenti.
ALTER TABLE party_expenses ADD COLUMN IF NOT EXISTS client_operation_id UUID;
ALTER TABLE party_cash_movements ADD COLUMN IF NOT EXISTS client_operation_id UUID;
ALTER TABLE traveler_programme_feedback ADD COLUMN IF NOT EXISTS client_operation_id UUID;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS party_expenses_operation_uidx
  ON party_expenses (party_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS party_cash_operation_uidx
  ON party_cash_movements (party_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feedback_operation_uidx
  ON traveler_programme_feedback (traveler_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

-- Cambio applicato immutabile: i consuntivi non devono dipendere dal tasso live.
ALTER TABLE party_expenses ADD COLUMN IF NOT EXISTS base_currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE party_expenses ADD COLUMN IF NOT EXISTS exchange_rate_to_base NUMERIC(24,12);
ALTER TABLE party_expenses ADD COLUMN IF NOT EXISTS base_amount NUMERIC(20,4);
ALTER TABLE party_expenses
  ADD CONSTRAINT party_expenses_exchange_rate_check
  CHECK (exchange_rate_to_base IS NULL OR exchange_rate_to_base > 0) NOT VALID;

-- I vincoli NOT VALID proteggono subito le nuove scritture. La validazione va
-- eseguita dopo il controllo dei dati storici e non richiede un lungo lock esclusivo.
ALTER TABLE visit_sites VALIDATE CONSTRAINT visit_sites_latitude_check;
ALTER TABLE visit_sites VALIDATE CONSTRAINT visit_sites_longitude_check;
ALTER TABLE hotels VALIDATE CONSTRAINT hotels_latitude_check;
ALTER TABLE hotels VALIDATE CONSTRAINT hotels_longitude_check;
ALTER TABLE itinerary_items VALIDATE CONSTRAINT itinerary_items_scheduled_range_check;
ALTER TABLE party_expenses VALIDATE CONSTRAINT party_expenses_exchange_rate_check;

INSERT INTO platform_schema_migrations (version)
VALUES ('012_neon_architecture_hardening')
ON CONFLICT (version) DO NOTHING;
