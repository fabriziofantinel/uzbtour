-- Privilegi minimi necessari al primo cutover delle letture operative v3.

GRANT USAGE ON SCHEMA app,ref,travel,journey TO smf_app;
GRANT EXECUTE ON FUNCTION app.current_agency_id() TO smf_app;
GRANT EXECUTE ON FUNCTION app.resolve_legacy_user_id(TEXT,UUID) TO smf_app;

GRANT SELECT ON TABLE
  ref.currencies,
  travel.departure_days,
  travel.departure_itinerary_items,
  travel.traveler_profiles,
  journey.expenses,
  journey.cash_movements,
  journey.day_notes,
  journey.restaurant_visits,
  journey.programme_feedback
TO smf_app;

REVOKE SELECT ON TABLE ops.legacy_id_map,ops.legacy_generated_content_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('030_v3_operational_read_cutover')
ON CONFLICT(version) DO NOTHING;
