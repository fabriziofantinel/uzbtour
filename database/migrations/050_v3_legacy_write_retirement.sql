-- Retire the V2-to-V3 shadow-write bridge after all platform mutation paths
-- have moved to the normalized schemas. Legacy demo trip_* tables are not in
-- scope and retain their independent permissions.

DROP TRIGGER IF EXISTS sync_v3_media_asset ON public.media_assets;
DROP TRIGGER IF EXISTS sync_v3_memory ON public.party_memories;
DROP TRIGGER IF EXISTS sync_v3_activity_result ON public.party_activity_results;
DROP TRIGGER IF EXISTS sync_v3_contest_entry ON public.party_photo_contest_entries;
DROP TRIGGER IF EXISTS sync_v3_platform_user ON public.platform_users;
DROP TRIGGER IF EXISTS sync_v3_agency ON public.agencies;
DROP TRIGGER IF EXISTS sync_v3_agency_membership ON public.agency_memberships;
DROP TRIGGER IF EXISTS sync_v3_country ON public.countries;
DROP TRIGGER IF EXISTS sync_v3_city ON public.cities;
DROP TRIGGER IF EXISTS sync_v3_visit_site ON public.visit_sites;
DROP TRIGGER IF EXISTS sync_v3_hotel ON public.hotels;
DROP TRIGGER IF EXISTS sync_v3_reference_content ON public.reference_contents;
DROP TRIGGER IF EXISTS sync_v3_traveler_profile ON public.traveler_profiles;
DROP TRIGGER IF EXISTS sync_v3_travel_party ON public.travel_parties;
DROP TRIGGER IF EXISTS sync_v3_party_membership ON public.party_memberships;
DROP TRIGGER IF EXISTS sync_v3_invitation ON public.user_invitations;
DROP TRIGGER IF EXISTS sync_v3_travel_document ON public.travel_documents;
DROP TRIGGER IF EXISTS sync_v3_itinerary_document ON public.itinerary_item_documents;
DROP TRIGGER IF EXISTS sync_v3_import_job ON public.import_jobs;
DROP TRIGGER IF EXISTS sync_v3_platform_job ON public.platform_jobs;
DROP TRIGGER IF EXISTS sync_v3_audit_event ON public.audit_events;
DROP TRIGGER IF EXISTS sync_v3_useful_information ON public.useful_information;
DROP TRIGGER IF EXISTS sync_v3_phrasebook_entry ON public.phrasebook_entries;
DROP TRIGGER IF EXISTS sync_v3_generated_content ON public.generated_content;
DROP TRIGGER IF EXISTS sync_v3_accommodation_stay ON public.accommodations;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trip_templates','trip_template_versions','trip_countries','trip_days',
    'trip_day_cities','trip_day_sites','trip_day_hotels','itinerary_items','departures'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_v3_travel_row ON public.%I',table_name);
  END LOOP;
END $$;

REVOKE INSERT,UPDATE,DELETE ON TABLE
  public.accommodations,public.agencies,public.agency_memberships,public.audit_events,
  public.cities,public.countries,public.departures,public.generated_content,public.hotels,
  public.import_jobs,public.itinerary_item_documents,public.itinerary_items,public.media_assets,
  public.party_activity_results,public.party_cash_movements,public.party_day_notes,
  public.party_expenses,public.party_memberships,public.party_memories,
  public.party_photo_contest_entries,public.party_restaurants,public.phrasebook_entries,
  public.platform_jobs,public.platform_users,public.reference_contents,public.travel_documents,
  public.travel_parties,public.traveler_profiles,public.traveler_programme_feedback,
  public.trip_countries,public.trip_day_cities,public.trip_day_hotels,public.trip_day_sites,
  public.trip_days,public.trip_template_versions,public.trip_templates,
  public.useful_information,public.user_invitations,public.visit_sites
FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('050_v3_legacy_write_retirement') ON CONFLICT(version) DO NOTHING;
