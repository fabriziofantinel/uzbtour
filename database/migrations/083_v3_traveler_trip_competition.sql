-- Sposta l'adesione alle classifiche di viaggio dal gruppo al singolo viaggiatore.

ALTER TABLE travel.party_memberships
  ADD COLUMN IF NOT EXISTS participates_in_trip_games BOOLEAN NOT NULL DEFAULT false;

UPDATE travel.party_memberships membership
SET participates_in_trip_games = true
FROM travel.travel_parties party
WHERE party.id = membership.party_id
  AND party.agency_id = membership.agency_id
  AND party.departure_id = membership.departure_id
  AND party.participates_in_trip_games
  AND membership.status <> 'removed';

CREATE INDEX IF NOT EXISTS party_memberships_trip_games_idx
  ON travel.party_memberships(agency_id,departure_id,party_id,traveler_id)
  WHERE participates_in_trip_games AND status <> 'removed';

DROP FUNCTION app.read_journey_management(TEXT,UUID);
CREATE FUNCTION app.read_journey_management(p_actor_legacy_user_id TEXT,p_departure_id UUID)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT,
  traveler_participates_in_trip_games BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops SET row_security=off AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    traveler.id,traveler.display_name,COALESCE(users.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status,
    COALESCE(membership.participates_in_trip_games,false)
  FROM travel.departures departure
  JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
  LEFT JOIN ref.countries country ON country.id=template.primary_country_id
  JOIN iam.agency_memberships actor_membership ON actor_membership.agency_id=departure.agency_id
    AND actor_membership.status='active' AND actor_membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map actor_map ON actor_map.target_id=actor_membership.user_id
    AND actor_map.source_system='public-v2' AND actor_map.entity_type='user'
    AND actor_map.legacy_id=p_actor_legacy_user_id
  JOIN iam.users actor ON actor.id=actor_membership.user_id AND actor.status='active'
  LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id
  LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id AND membership.status<>'removed'
  LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id AND traveler.agency_id=departure.agency_id
  LEFT JOIN iam.users users ON users.id=traveler.user_id
  WHERE departure.id=p_departure_id
  ORDER BY party.name,membership.role,traveler.display_name
$$;

CREATE OR REPLACE FUNCTION app.update_journey_traveler_competition(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_traveler_id UUID,p_enabled BOOLEAN
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  UPDATE travel.party_memberships
  SET participates_in_trip_games=p_enabled
  WHERE agency_id=p_agency_id AND departure_id=p_departure_id
    AND party_id=p_party_id AND traveler_id=p_traveler_id AND status<>'removed';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey traveler membership not found';
  END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'traveler_profile',p_traveler_id::text,'trip_competition_settings_updated',
    jsonb_build_object('departureId',p_departure_id,'partyId',p_party_id,'participatesInTripGames',p_enabled));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_journey_traveler_competition(TEXT,UUID,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.update_journey_traveler_competition(TEXT,UUID,UUID,UUID,UUID,BOOLEAN) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('083_v3_traveler_trip_competition') ON CONFLICT(version) DO NOTHING;
