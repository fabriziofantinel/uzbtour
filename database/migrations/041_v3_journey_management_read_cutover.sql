-- Lettura amministrativa di viaggio, famiglie e viaggiatori da Travel/IAM V3.

CREATE OR REPLACE FUNCTION app.read_journey_management(
  p_actor_legacy_user_id TEXT,
  p_departure_id UUID
)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,
  traveler_id UUID,traveler_name TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ref,ops
SET row_security=off
AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    traveler.id,traveler.display_name,COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id
    AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  JOIN iam.agency_memberships actor_membership
    ON actor_membership.agency_id=departure.agency_id
    AND actor_membership.status='active'
    AND actor_membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor_membership.user_id
    AND actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
  JOIN iam.users actor ON actor.id=actor_membership.user_id AND actor.status='active'
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id
    AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id
    AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users users ON users.id=traveler.user_id
  WHERE departure.id=p_departure_id
  ORDER BY party.name,membership.role,traveler.display_name
$$;

REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('041_v3_journey_management_read_cutover') ON CONFLICT(version) DO NOTHING;
