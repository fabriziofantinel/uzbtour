-- SMF Travel - privilegi minimi del ruolo runtime.
-- Il ruolo smf_app viene creato da Neon (password gestita fuori dal repository).
-- Questa migrazione non concede CREATE, TRUNCATE, REFERENCES o privilegi DDL.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smf_app') THEN
    RAISE EXCEPTION 'Il ruolo smf_app deve essere creato in Neon prima della migrazione 013';
  END IF;
END
$$;

-- smf_app deve essere creato direttamente in PostgreSQL con NOSUPERUSER,
-- NOCREATEDB, NOCREATEROLE e NOBYPASSRLS, non tramite Neon API/CLI: quei ruoli
-- possono ereditare neon_superuser e non sono adatti al runtime.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles role
    WHERE role.rolname = 'smf_app'
      AND (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR role.rolbypassrls)
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'smf_app' AND granted_role.rolname = 'neon_superuser'
  ) THEN
    RAISE EXCEPTION 'smf_app possiede privilegi amministrativi o eredita neon_superuser';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO smf_app;

-- Tabelle lette dal runtime Next.js. La lista è intenzionalmente esplicita:
-- le nuove tabelle introdotte da future migrazioni non diventano accessibili
-- finché il relativo privilegio non viene revisionato e aggiunto qui.
GRANT SELECT ON TABLE
  accommodations, agencies, agency_memberships, audit_events, cities, countries,
  departures, generated_content, hotels, impersonation_sessions, import_jobs,
  itinerary_item_documents, itinerary_items, media_assets, party_activity_results,
  party_cash_movements, party_day_notes, party_expenses, party_memberships,
  party_memories, party_photo_contest_entries, party_restaurants, phrasebook_entries,
  places, platform_jobs, platform_schema_migrations, platform_users,
  reference_contents, travel_documents, travel_parties, traveler_profiles,
  traveler_programme_feedback, trip_bingo_completions, trip_cash_movements,
  trip_contest_photos, trip_countries, trip_daily_photo_contests, trip_day_cities,
  trip_day_hotels, trip_day_sites, trip_days, trip_expenses, trip_game_scores,
  trip_mission_completions, trip_notes, trip_photo_contests, trip_photos,
  trip_quiz_attempts, trip_restaurants, trip_template_versions, trip_templates,
  useful_information, user_invitations, visit_sites
TO smf_app;

-- Tabelle mutate dalle API. Nessun accesso in scrittura alle tabelle che il
-- runtime usa esclusivamente come catalogo/compatibilità.
GRANT INSERT, UPDATE, DELETE ON TABLE
  accommodations, agencies, agency_memberships, audit_events, cities, countries,
  departures, generated_content, hotels, impersonation_sessions, import_jobs,
  itinerary_item_documents, itinerary_items, media_assets, party_activity_results,
  party_cash_movements, party_day_notes, party_expenses, party_memberships,
  party_memories, party_photo_contest_entries, party_restaurants, phrasebook_entries,
  platform_jobs, platform_users, reference_contents, travel_documents, travel_parties,
  traveler_profiles, traveler_programme_feedback, trip_bingo_completions,
  trip_cash_movements, trip_contest_photos, trip_countries,
  trip_daily_photo_contests, trip_day_cities, trip_day_hotels, trip_day_sites,
  trip_days, trip_expenses, trip_game_scores, trip_mission_completions, trip_notes,
  trip_photos, trip_quiz_attempts, trip_restaurants, trip_template_versions,
  trip_templates, useful_information, user_invitations, visit_sites
TO smf_app;

-- Solo le tabelle legacy BIGSERIAL e audit_events richiedono sequenze.
GRANT USAGE, SELECT ON SEQUENCE
  audit_events_id_seq, trip_bingo_completions_id_seq, trip_cash_movements_id_seq,
  trip_contest_photos_id_seq, trip_expenses_id_seq, trip_game_scores_id_seq,
  trip_mission_completions_id_seq, trip_photos_id_seq, trip_quiz_attempts_id_seq,
  trip_restaurants_id_seq
TO smf_app;

INSERT INTO platform_schema_migrations (version)
VALUES ('013_runtime_role_grants')
ON CONFLICT (version) DO NOTHING;
