-- Feedback di programma: lettura shadow e scrittura atomica public + journey.
-- Il contesto tenant deve essere impostato nella medesima transazione.

GRANT USAGE ON SCHEMA app, ref, travel, journey TO smf_app;
GRANT EXECUTE ON FUNCTION app.current_agency_id() TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_user_id(TEXT, UUID) TO smf_app;

GRANT SELECT ON TABLE
  ref.hotels,
  travel.departure_days,
  travel.departure_itinerary_items,
  travel.traveler_profiles,
  travel.party_memberships,
  journey.programme_feedback
TO smf_app;

GRANT INSERT, UPDATE ON TABLE journey.programme_feedback TO smf_app;

REVOKE SELECT ON TABLE ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations (version)
VALUES ('022_v3_programme_feedback_runtime_access')
ON CONFLICT (version) DO NOTHING;
