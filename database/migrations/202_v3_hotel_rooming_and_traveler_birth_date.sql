-- Rooming list unica per hotel e data di nascita obbligatoria per i viaggiatori.

UPDATE travel.traveler_profiles
SET birth_date=DATE '2000-01-01',updated_at=clock_timestamp()
WHERE birth_date IS NULL;

UPDATE public.traveler_profiles
SET birth_date=DATE '2000-01-01',updated_at=clock_timestamp()
WHERE birth_date IS NULL;

ALTER TABLE travel.traveler_profiles ALTER COLUMN birth_date SET NOT NULL;
ALTER TABLE public.traveler_profiles ALTER COLUMN birth_date SET NOT NULL;

CREATE OR REPLACE FUNCTION app.save_rooming_list_v3(
  p_actor UUID,p_departure UUID,p_stay UUID,p_party UUID,p_rooms JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE
  v_agency UUID;v_hotel_id UUID;v_hotel_name TEXT;v_room JSONB;v_room_id UUID;
  v_capacity INTEGER;v_occupants UUID[];v_occupant UUID;v_night_count INTEGER;
BEGIN
  IF jsonb_typeof(COALESCE(p_rooms,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_rooms,'[]'::jsonb))>100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid rooming list';
  END IF;
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure
  WHERE departure.id=p_departure AND app.can_manage_rooming_list_v3(p_actor,p_departure);
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='rooming list not authorized';END IF;

  SELECT stay.hotel_id,lower(regexp_replace(btrim(stay.name_snapshot),'\s+',' ','g'))
  INTO v_hotel_id,v_hotel_name
  FROM travel.departure_accommodation_stays stay
  WHERE stay.agency_id=v_agency AND stay.departure_id=p_departure AND stay.id=p_stay
    AND stay.operational_status<>'cancelled';
  IF v_hotel_name IS NULL OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party
    WHERE party.agency_id=v_agency AND party.departure_id=p_departure AND party.id=p_party AND party.status<>'archived')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='hotel or group not available';END IF;

  CREATE TEMP TABLE IF NOT EXISTS rooming_input(
    room_id UUID,room_label TEXT,room_type TEXT,special_requirements TEXT,occupants UUID[]
  ) ON COMMIT DROP;
  DELETE FROM rooming_input;
  FOR v_room IN SELECT value FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) LOOP
    BEGIN v_room_id:=COALESCE(NULLIF(v_room->>'id','')::uuid,uuidv7());
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid room id';END;
    IF COALESCE(btrim(v_room->>'label'),'')='' OR length(v_room->>'label')>120
      OR COALESCE(v_room->>'type','') NOT IN('single','double','matrimonial','triple')
      OR length(COALESCE(v_room->>'specialRequirements',''))>1000
      OR jsonb_typeof(COALESCE(v_room->'occupantIds','[]'::jsonb))<>'array'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid room data';END IF;
    v_capacity:=CASE v_room->>'type' WHEN 'single' THEN 1 WHEN 'triple' THEN 3 ELSE 2 END;
    SELECT COALESCE(array_agg(value::uuid),'{}'::uuid[]) INTO v_occupants
      FROM jsonb_array_elements_text(COALESCE(v_room->'occupantIds','[]'::jsonb));
    IF cardinality(v_occupants)>v_capacity OR cardinality(v_occupants)<>cardinality(ARRAY(SELECT DISTINCT unnest(v_occupants))) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='room capacity exceeded or traveler duplicated';
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(v_occupants) occupant
      WHERE NOT EXISTS(SELECT 1 FROM travel.party_memberships membership
        WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure
          AND membership.party_id=p_party AND membership.traveler_id=occupant AND membership.status<>'removed'))
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='traveler outside selected group';END IF;
    IF EXISTS(SELECT 1 FROM travel.party_memberships membership
      WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure AND membership.party_id=p_party
        AND membership.traveler_id=ANY(v_occupants) AND membership.member_type='dependent_minor')
      AND NOT EXISTS(SELECT 1 FROM travel.party_memberships membership
        WHERE membership.agency_id=v_agency AND membership.departure_id=p_departure AND membership.party_id=p_party
          AND membership.traveler_id=ANY(v_occupants) AND membership.member_type='adult')
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='minor without adult in room';END IF;
    INSERT INTO rooming_input VALUES(
      v_room_id,btrim(v_room->>'label'),v_room->>'type',
      btrim(COALESCE(v_room->>'specialRequirements','')),v_occupants
    );
  END LOOP;
  IF EXISTS(SELECT 1 FROM rooming_input GROUP BY lower(room_label) HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM rooming_input,unnest(occupants) occupant GROUP BY occupant HAVING count(*)>1)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate room or traveler assignment';END IF;

  SELECT count(*) INTO v_night_count
  FROM travel.departure_accommodation_stays stay
  WHERE stay.agency_id=v_agency AND stay.departure_id=p_departure AND stay.operational_status<>'cancelled'
    AND ((v_hotel_id IS NOT NULL AND stay.hotel_id=v_hotel_id)
      OR (v_hotel_id IS NULL AND stay.hotel_id IS NULL
        AND lower(regexp_replace(btrim(stay.name_snapshot),'\s+',' ','g'))=v_hotel_name));

  DELETE FROM travel.rooming_rooms room
  USING travel.departure_accommodation_stays stay
  WHERE room.agency_id=v_agency AND room.departure_id=p_departure AND room.party_id=p_party
    AND stay.agency_id=room.agency_id AND stay.departure_id=room.departure_id AND stay.id=room.stay_id
    AND ((v_hotel_id IS NOT NULL AND stay.hotel_id=v_hotel_id)
      OR (v_hotel_id IS NULL AND stay.hotel_id IS NULL
        AND lower(regexp_replace(btrim(stay.name_snapshot),'\s+',' ','g'))=v_hotel_name));
  INSERT INTO travel.rooming_rooms(
    id,agency_id,departure_id,stay_id,party_id,room_label,room_type,special_requirements,created_by
  )
  SELECT room_id,v_agency,p_departure,p_stay,p_party,room_label,room_type,special_requirements,p_actor
  FROM rooming_input;
  FOR v_room_id,v_occupants IN SELECT room_id,occupants FROM rooming_input LOOP
    FOREACH v_occupant IN ARRAY v_occupants LOOP
      INSERT INTO travel.rooming_room_occupants(
        agency_id,departure_id,stay_id,party_id,room_id,traveler_id
      ) VALUES(v_agency,p_departure,p_stay,p_party,v_room_id,v_occupant);
    END LOOP;
  END LOOP;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor,'rooming_list',p_stay::text,'rooming_list_saved',
    jsonb_build_object('departureId',p_departure,'partyId',p_party,
      'rooms',jsonb_array_length(p_rooms),'hotelNights',v_night_count));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.save_rooming_list_v3(UUID,UUID,UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_rooming_list_v3(UUID,UUID,UUID,UUID,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('202_v3_hotel_rooming_and_traveler_birth_date') ON CONFLICT(version) DO NOTHING;
