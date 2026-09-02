CREATE OR REPLACE FUNCTION app.read_traveler_destination_profile_v3(
  p_actor_legacy TEXT,p_departure_id UUID
) RETURNS TABLE(currency_code TEXT,time_zone TEXT,profile_version INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ref,travel,ops SET row_security=off AS $$
  SELECT NULLIF(candidate.profile->>'currencyCode',''),
    COALESCE(NULLIF(candidate.profile->'timeZones'->>0,''),departure.timezone),candidate.version
  FROM ops.legacy_id_map map
  JOIN travel.traveler_profiles traveler ON traveler.user_id=map.target_id
  JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id
    AND membership.traveler_id=traveler.id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id
    AND departure.id=membership.departure_id AND departure.id=p_departure_id
  JOIN travel.trip_templates template ON template.agency_id=departure.agency_id AND template.id=departure.template_id
  JOIN ref.country_verified_profiles candidate ON candidate.country_id=template.primary_country_id
    AND candidate.status='verified' AND candidate.refresh_after>clock_timestamp()
  JOIN ref.country_profile_agency_reviews review ON review.agency_id=departure.agency_id
    AND review.country_id=candidate.country_id AND review.profile_version=candidate.version AND review.status='approved'
  WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.read_traveler_destination_profile_v3(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_traveler_destination_profile_v3(TEXT,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('130_v3_traveler_destination_profile') ON CONFLICT(version) DO NOTHING;
