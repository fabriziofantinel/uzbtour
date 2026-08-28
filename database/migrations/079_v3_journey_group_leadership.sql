-- Formalizza il capogruppo e l'adesione del gruppo alla competizione di viaggio.
-- Il ruolo organizer resta la fonte di verita' per il capogruppo.

ALTER TABLE travel.travel_parties
  ADD COLUMN IF NOT EXISTS participates_in_trip_games BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.travel_parties
  ADD COLUMN IF NOT EXISTS participates_in_trip_games BOOLEAN NOT NULL DEFAULT false;

WITH ranked AS (
  SELECT party_id,traveler_id,
    row_number() OVER(PARTITION BY party_id ORDER BY joined_at,traveler_id) AS position
  FROM travel.party_memberships
  WHERE role='organizer' AND status<>'removed'
)
UPDATE travel.party_memberships membership
SET role='member'
FROM ranked
WHERE membership.party_id=ranked.party_id
  AND membership.traveler_id=ranked.traveler_id
  AND ranked.position>1;

WITH candidates AS (
  SELECT membership.party_id,membership.traveler_id,
    row_number() OVER(PARTITION BY membership.party_id ORDER BY membership.joined_at,membership.traveler_id) AS position
  FROM travel.party_memberships membership
  WHERE membership.status<>'removed' AND membership.member_type='adult'
    AND NOT EXISTS(SELECT 1 FROM travel.party_memberships leader
      WHERE leader.party_id=membership.party_id AND leader.role='organizer' AND leader.status<>'removed')
)
UPDATE travel.party_memberships membership
SET role='organizer'
FROM candidates
WHERE membership.party_id=candidates.party_id
  AND membership.traveler_id=candidates.traveler_id
  AND candidates.position=1;

UPDATE public.party_memberships legacy
SET role='member'
FROM travel.party_memberships membership
WHERE legacy.party_id=membership.party_id
  AND legacy.traveler_id=membership.traveler_id
  AND legacy.role<>membership.role;

CREATE UNIQUE INDEX IF NOT EXISTS party_memberships_single_organizer_uidx
  ON travel.party_memberships(party_id)
  WHERE role='organizer' AND status<>'removed';

CREATE INDEX IF NOT EXISTS travel_parties_trip_games_idx
  ON travel.travel_parties(agency_id,departure_id,id)
  WHERE participates_in_trip_games;

DROP FUNCTION app.read_journey_management(TEXT,UUID);
CREATE FUNCTION app.read_journey_management(p_actor_legacy_user_id TEXT,p_departure_id UUID)
RETURNS TABLE(
  departure_id UUID,agency_id UUID,title TEXT,code TEXT,starts_on DATE,ends_on DATE,
  departure_status TEXT,agency_name TEXT,destination_country TEXT,
  party_id UUID,party_name TEXT,party_code TEXT,party_status TEXT,
  party_participates_in_trip_games BOOLEAN,
  traveler_id UUID,traveler_name TEXT,traveler_username TEXT,traveler_email TEXT,traveler_phone TEXT,
  membership_role TEXT,membership_status TEXT,user_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,ref,ops SET row_security=off AS $$
  SELECT departure.id,departure.agency_id,departure.title,departure.code,
    departure.starts_on,departure.ends_on,departure.status,agency.name,
    COALESCE(country.name,''),party.id,party.name,party.code,party.status,
    COALESCE(party.participates_in_trip_games,false),
    traveler.id,traveler.display_name,COALESCE(users.username,''),COALESCE(traveler.email,''),
    COALESCE(traveler.phone,''),membership.role,membership.status,users.status
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

CREATE OR REPLACE FUNCTION app.update_journey_party_competition(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,p_enabled BOOLEAN
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  UPDATE travel.travel_parties
  SET participates_in_trip_games=p_enabled,updated_at=clock_timestamp()
  WHERE id=p_party_id AND agency_id=p_agency_id AND departure_id=p_departure_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found';
  END IF;
  UPDATE public.travel_parties
  SET participates_in_trip_games=p_enabled,updated_at=clock_timestamp()
  WHERE id=p_party_id AND agency_id=p_agency_id AND departure_id=p_departure_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'travel_party',p_party_id::text,'competition_settings_updated',
    jsonb_build_object('departureId',p_departure_id,'participatesInTripGames',p_enabled));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.set_journey_party_leader(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,p_traveler_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops,public SET row_security=off AS $$
DECLARE v_actor UUID;v_member_type TEXT;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  PERFORM 1 FROM travel.travel_parties party
  WHERE party.id=p_party_id AND party.agency_id=p_agency_id AND party.departure_id=p_departure_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='journey group not found';
  END IF;
  SELECT membership.member_type INTO v_member_type
  FROM travel.party_memberships membership
  WHERE membership.agency_id=p_agency_id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.traveler_id=p_traveler_id
    AND membership.status<>'removed'
  FOR UPDATE;
  IF v_member_type IS NULL OR v_member_type<>'adult' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='group leader must be an adult group member';
  END IF;
  UPDATE travel.party_memberships SET role='member'
  WHERE party_id=p_party_id AND role='organizer' AND traveler_id<>p_traveler_id AND status<>'removed';
  UPDATE travel.party_memberships SET role='organizer'
  WHERE party_id=p_party_id AND traveler_id=p_traveler_id AND status<>'removed';
  UPDATE public.party_memberships legacy SET role=membership.role
  FROM travel.party_memberships membership
  WHERE legacy.party_id=membership.party_id AND legacy.traveler_id=membership.traveler_id
    AND membership.party_id=p_party_id;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'travel_party',p_party_id::text,'leader_updated',
    jsonb_build_object('departureId',p_departure_id,'travelerId',p_traveler_id));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.read_journey_management(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_journey_party_competition(TEXT,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.set_journey_party_leader(TEXT,UUID,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_journey_management(TEXT,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.update_journey_party_competition(TEXT,UUID,UUID,UUID,BOOLEAN) TO smf_app;
GRANT EXECUTE ON FUNCTION app.set_journey_party_leader(TEXT,UUID,UUID,UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('079_v3_journey_group_leadership') ON CONFLICT(version) DO NOTHING;
