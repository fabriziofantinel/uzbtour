-- consolidation-approval: move traveler journey scope reads to native IAM UUIDs

CREATE OR REPLACE FUNCTION app.list_user_journeys_v3(p_actor_user_id UUID)
RETURNS TABLE(
  departure_id TEXT,agency_id TEXT,template_version_id TEXT,title TEXT,code TEXT,
  starts_on TEXT,ends_on TEXT,timezone TEXT,status TEXT,party_id TEXT,party_name TEXT,
  destination_country TEXT,agency_name TEXT,agency_branding JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ref,travel SET row_security=off AS $$
  SELECT departure.id::text,departure.agency_id::text,departure.template_version_id::text,
    departure.title,departure.code,departure.starts_on::text,departure.ends_on::text,
    departure.timezone,departure.status,party.id::text,party.name,country.name,agency.name,agency.branding
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.status='active'
  JOIN travel.travel_parties party ON party.agency_id=membership.agency_id
    AND party.departure_id=membership.departure_id AND party.id=membership.party_id
  JOIN travel.departures departure ON departure.agency_id=party.agency_id AND departure.id=party.departure_id
  JOIN travel.trip_templates template ON template.agency_id=departure.agency_id AND template.id=departure.template_id
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  WHERE profile.user_id=p_actor_user_id AND departure.status NOT IN('cancelled','archived')
  ORDER BY CASE WHEN CURRENT_DATE BETWEEN departure.starts_on AND departure.ends_on THEN 0
      WHEN departure.starts_on>=CURRENT_DATE THEN 1 ELSE 2 END,
    CASE WHEN departure.starts_on>=CURRENT_DATE THEN departure.starts_on END,
    departure.starts_on DESC
$$;

REVOKE ALL ON FUNCTION app.list_user_journeys_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_user_journeys_v3(UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('149_v3_native_traveler_journey_scope') ON CONFLICT(version) DO NOTHING;
