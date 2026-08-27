-- The application runtime now reads the normalized platform exclusively from
-- IAM/Travel/Ref/Ops/Content/Journey V3. Keep the V2 copies owner-readable for
-- audit and rollback, but remove every direct read path from smf_app.
-- The independent legacy-demo trip_* tables are intentionally out of scope.

REVOKE SELECT ON TABLE
  public.accommodations,
  public.agencies,
  public.agency_memberships,
  public.audit_events,
  public.cities,
  public.countries,
  public.departures,
  public.generated_content,
  public.hotels,
  public.import_jobs,
  public.itinerary_item_documents,
  public.itinerary_items,
  public.media_assets,
  public.party_activity_results,
  public.party_cash_movements,
  public.party_day_notes,
  public.party_expenses,
  public.party_memberships,
  public.party_memories,
  public.party_photo_contest_entries,
  public.party_restaurants,
  public.phrasebook_entries,
  public.platform_jobs,
  public.platform_users,
  public.reference_contents,
  public.travel_documents,
  public.travel_parties,
  public.traveler_profiles,
  public.traveler_programme_feedback,
  public.trip_countries,
  public.trip_day_cities,
  public.trip_day_hotels,
  public.trip_day_sites,
  public.trip_days,
  public.trip_template_versions,
  public.trip_templates,
  public.useful_information,
  public.user_invitations,
  public.visit_sites
FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('053_v3_legacy_normalized_read_retirement') ON CONFLICT(version) DO NOTHING;
