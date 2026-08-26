-- Seconda tranche runtime v3: movimenti di cassa, note e locali.
-- Le policy RLS tenant sono già FORCE e richiedono app.agency_id nella
-- medesima transazione che esegue ogni lettura o scrittura.

GRANT USAGE ON SCHEMA app, ref, travel, ops, journey TO smf_app;
GRANT EXECUTE ON FUNCTION app.current_agency_id() TO smf_app;

GRANT SELECT ON TABLE
  ref.currencies,
  travel.departure_days,
  travel.traveler_profiles,
  travel.travel_parties,
  travel.party_memberships,
  ops.legacy_id_map,
  journey.cash_movements,
  journey.day_notes,
  journey.restaurant_visits
TO smf_app;

GRANT INSERT, UPDATE, DELETE ON TABLE
  journey.cash_movements,
  journey.day_notes,
  journey.restaurant_visits
TO smf_app;

INSERT INTO public.platform_schema_migrations (version)
VALUES ('020_v3_journey_journal_runtime_access')
ON CONFLICT (version) DO NOTHING;
