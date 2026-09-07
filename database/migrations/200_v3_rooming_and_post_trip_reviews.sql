-- Rooming list operative e valutazioni complessive post-viaggio, senza dati documentali sensibili.

CREATE TABLE IF NOT EXISTS travel.rooming_rooms (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  stay_id UUID NOT NULL,
  party_id UUID NOT NULL,
  room_label TEXT NOT NULL CHECK (btrim(room_label)<>''),
  room_type VARCHAR(20) NOT NULL CHECK (room_type IN ('single','double','matrimonial','triple')),
  special_requirements TEXT NOT NULL DEFAULT '' CHECK (length(special_requirements)<=1000),
  created_by UUID NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id,departure_id,stay_id)
    REFERENCES travel.departure_accommodation_stays(agency_id,departure_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,departure_id,party_id)
    REFERENCES travel.travel_parties(agency_id,departure_id,id) ON DELETE CASCADE,
  UNIQUE (agency_id,departure_id,stay_id,party_id,id),
  UNIQUE (stay_id,party_id,room_label)
);

CREATE TABLE IF NOT EXISTS travel.rooming_room_occupants (
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  stay_id UUID NOT NULL,
  party_id UUID NOT NULL,
  room_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id,departure_id,stay_id,party_id,room_id)
    REFERENCES travel.rooming_rooms(agency_id,departure_id,stay_id,party_id,id) ON DELETE CASCADE,
  FOREIGN KEY (agency_id,departure_id,party_id,traveler_id)
    REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE,
  PRIMARY KEY (room_id,traveler_id),
  UNIQUE (stay_id,traveler_id)
);

CREATE INDEX IF NOT EXISTS rooming_rooms_scope_idx
  ON travel.rooming_rooms(agency_id,departure_id,stay_id,party_id,room_label);
CREATE INDEX IF NOT EXISTS rooming_occupants_scope_idx
  ON travel.rooming_room_occupants(agency_id,departure_id,stay_id,party_id,traveler_id);

ALTER TABLE travel.rooming_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.rooming_rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE travel.rooming_room_occupants ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel.rooming_room_occupants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rooming_rooms_tenant ON travel.rooming_rooms;
CREATE POLICY rooming_rooms_tenant ON travel.rooming_rooms
  USING (agency_id=app.current_agency_id()) WITH CHECK (agency_id=app.current_agency_id());
DROP POLICY IF EXISTS rooming_occupants_tenant ON travel.rooming_room_occupants;
CREATE POLICY rooming_occupants_tenant ON travel.rooming_room_occupants
  USING (agency_id=app.current_agency_id()) WITH CHECK (agency_id=app.current_agency_id());

CREATE OR REPLACE FUNCTION app.can_manage_rooming_list_v3(p_actor UUID,p_departure UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,travel SET row_security=off AS $$
  SELECT EXISTS(
    SELECT 1 FROM travel.departures departure
    WHERE departure.id=p_departure AND (
      EXISTS(SELECT 1 FROM iam.agency_memberships membership
        WHERE membership.agency_id=departure.agency_id AND membership.user_id=p_actor
          AND membership.status='active' AND membership.role IN ('owner','admin','editor'))
      OR EXISTS(SELECT 1 FROM travel.departure_staff_assignments assignment
        WHERE assignment.agency_id=departure.agency_id AND assignment.departure_id=departure.id
          AND assignment.user_id=p_actor AND assignment.status='active'
          AND assignment.role IN ('agent','tour_leader','accompagnatore')
          AND (clock_timestamp()<assignment.valid_until OR clock_timestamp()<assignment.test_access_until))
    )
  )
$$;

CREATE OR REPLACE FUNCTION app.save_rooming_list_v3(
  p_actor UUID,p_departure UUID,p_stay UUID,p_party UUID,p_rooms JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE
  v_agency UUID;v_room JSONB;v_room_id UUID;v_capacity INTEGER;v_occupants UUID[];v_occupant UUID;
BEGIN
  IF jsonb_typeof(COALESCE(p_rooms,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_rooms,'[]'::jsonb))>100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid rooming list';
  END IF;
  SELECT departure.agency_id INTO v_agency FROM travel.departures departure
  WHERE departure.id=p_departure AND app.can_manage_rooming_list_v3(p_actor,p_departure);
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='rooming list not authorized';END IF;
  IF NOT EXISTS(SELECT 1 FROM travel.departure_accommodation_stays stay
    WHERE stay.agency_id=v_agency AND stay.departure_id=p_departure AND stay.id=p_stay AND stay.operational_status<>'cancelled')
    OR NOT EXISTS(SELECT 1 FROM travel.travel_parties party
      WHERE party.agency_id=v_agency AND party.departure_id=p_departure AND party.id=p_party AND party.status<>'archived')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='stay or group not available';END IF;

  CREATE TEMP TABLE IF NOT EXISTS rooming_input(room_id UUID,room_label TEXT,room_type TEXT,special_requirements TEXT,occupants UUID[]) ON COMMIT DROP;
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
    INSERT INTO rooming_input VALUES(v_room_id,btrim(v_room->>'label'),v_room->>'type',btrim(COALESCE(v_room->>'specialRequirements','')),v_occupants);
  END LOOP;
  IF EXISTS(SELECT 1 FROM rooming_input GROUP BY lower(room_label) HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM rooming_input,unnest(occupants) occupant GROUP BY occupant HAVING count(*)>1)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate room or traveler assignment';END IF;

  DELETE FROM travel.rooming_rooms WHERE agency_id=v_agency AND departure_id=p_departure AND stay_id=p_stay AND party_id=p_party;
  INSERT INTO travel.rooming_rooms(id,agency_id,departure_id,stay_id,party_id,room_label,room_type,special_requirements,created_by)
  SELECT room_id,v_agency,p_departure,p_stay,p_party,room_label,room_type,special_requirements,p_actor FROM rooming_input;
  FOR v_room_id,v_occupants IN SELECT room_id,occupants FROM rooming_input LOOP
    FOREACH v_occupant IN ARRAY v_occupants LOOP
      INSERT INTO travel.rooming_room_occupants(agency_id,departure_id,stay_id,party_id,room_id,traveler_id)
      VALUES(v_agency,p_departure,p_stay,p_party,v_room_id,v_occupant);
    END LOOP;
  END LOOP;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor,'rooming_list',p_stay::text,'rooming_list_saved',
    jsonb_build_object('departureId',p_departure,'partyId',p_party,'rooms',jsonb_array_length(p_rooms)));
  RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS journey.post_trip_reviews (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  party_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 10),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment)<=2000),
  referral_code VARCHAR(80) NOT NULL,
  client_operation_id UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (agency_id,departure_id,party_id,traveler_id)
    REFERENCES travel.party_memberships(agency_id,departure_id,party_id,traveler_id) ON DELETE CASCADE,
  UNIQUE (departure_id,traveler_id),
  UNIQUE (traveler_id,client_operation_id),
  UNIQUE (agency_id,referral_code)
);
CREATE INDEX IF NOT EXISTS post_trip_reviews_analytics_idx
  ON journey.post_trip_reviews(agency_id,departure_id,submitted_at DESC,rating);
ALTER TABLE journey.post_trip_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.post_trip_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_trip_reviews_tenant ON journey.post_trip_reviews;
CREATE POLICY post_trip_reviews_tenant ON journey.post_trip_reviews
  USING (agency_id=app.current_agency_id()) WITH CHECK (agency_id=app.current_agency_id());

CREATE OR REPLACE FUNCTION app.read_own_post_trip_review_v3(p_actor UUID,p_departure UUID,p_party UUID)
RETURNS TABLE(eligible BOOLEAN,rating INTEGER,comment TEXT,referral_code TEXT,public_review_url TEXT,agency_name TEXT,submitted_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,iam,travel,journey SET row_security=off AS $$
  WITH context AS (
    SELECT departure.agency_id,departure.ends_on,departure.timezone,agency.name,agency.settings,
      profile.id traveler_id
    FROM travel.departures departure
    JOIN iam.agencies agency ON agency.id=departure.agency_id
    JOIN travel.party_memberships membership ON membership.agency_id=departure.agency_id
      AND membership.departure_id=departure.id AND membership.party_id=p_party AND membership.status<>'removed'
    JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
      AND profile.id=membership.traveler_id AND profile.user_id=p_actor
    WHERE departure.id=p_departure
  )
  SELECT (clock_timestamp() AT TIME ZONE context.timezone)::date>=context.ends_on+2,
    review.rating::integer,COALESCE(review.comment,''),review.referral_code,
    NULLIF(context.settings->>'publicReviewUrl',''),context.name,review.submitted_at
  FROM context LEFT JOIN journey.post_trip_reviews review ON review.agency_id=context.agency_id
    AND review.departure_id=p_departure AND review.party_id=p_party AND review.traveler_id=context.traveler_id
$$;

CREATE OR REPLACE FUNCTION app.save_own_post_trip_review_v3(
  p_actor UUID,p_departure UUID,p_party UUID,p_rating INTEGER,p_comment TEXT,p_operation UUID
) RETURNS TABLE(review_id UUID,referral_code TEXT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,journey,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_traveler UUID;v_slug TEXT;v_eligible BOOLEAN;v_code TEXT;v_id UUID;
BEGIN
  SELECT departure.agency_id,profile.id,agency.slug,
    (clock_timestamp() AT TIME ZONE departure.timezone)::date>=departure.ends_on+2
  INTO v_agency,v_traveler,v_slug,v_eligible
  FROM travel.departures departure JOIN iam.agencies agency ON agency.id=departure.agency_id
  JOIN travel.party_memberships membership ON membership.agency_id=departure.agency_id
    AND membership.departure_id=departure.id AND membership.party_id=p_party AND membership.status<>'removed'
  JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
    AND profile.id=membership.traveler_id AND profile.user_id=p_actor
  WHERE departure.id=p_departure;
  IF v_agency IS NULL OR NOT v_eligible THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='post trip review not available';END IF;
  IF p_rating<0 OR p_rating>10 OR length(COALESCE(p_comment,''))>2000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid post trip review';END IF;
  v_code:=upper(left(regexp_replace(v_slug,'[^a-z0-9]','','g'),16)||'-'||left(replace(p_departure::text,'-',''),6)||'-'||left(replace(v_traveler::text,'-',''),6));
  INSERT INTO journey.post_trip_reviews(agency_id,departure_id,party_id,traveler_id,rating,comment,referral_code,client_operation_id)
  VALUES(v_agency,p_departure,p_party,v_traveler,p_rating,btrim(COALESCE(p_comment,'')),v_code,p_operation)
  ON CONFLICT(departure_id,traveler_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,
    client_operation_id=EXCLUDED.client_operation_id,updated_at=clock_timestamp()
  RETURNING id,journey.post_trip_reviews.referral_code INTO v_id,v_code;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor,'post_trip_review',v_id::text,'post_trip_review_saved',
    jsonb_build_object('departureId',p_departure,'rating',p_rating,'hasComment',btrim(COALESCE(p_comment,''))<>''));
  RETURN QUERY SELECT v_id,v_code;
END $$;

CREATE OR REPLACE FUNCTION app.read_agency_post_trip_settings_v3(p_actor UUID,p_agency UUID)
RETURNS TABLE(public_review_url TEXT) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam SET row_security=off AS $$
  SELECT COALESCE(agency.settings->>'publicReviewUrl','')
  FROM iam.agencies agency
  WHERE agency.id=p_agency AND EXISTS(SELECT 1 FROM iam.agency_memberships membership
    JOIN iam.users actor ON actor.id=membership.user_id AND actor.status='active'
    WHERE membership.agency_id=agency.id AND membership.user_id=p_actor
      AND membership.status='active' AND membership.role IN('owner','admin','editor'))
$$;

DROP FUNCTION IF EXISTS app.update_agency_post_trip_settings_v3(UUID,TEXT);
CREATE OR REPLACE FUNCTION app.update_agency_post_trip_settings_v3(p_actor UUID,p_agency UUID,p_public_review_url TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_url TEXT:=NULLIF(btrim(COALESCE(p_public_review_url,'')),'');
BEGIN
  SELECT membership.agency_id INTO v_agency FROM iam.agency_memberships membership
  JOIN iam.users actor ON actor.id=membership.user_id AND actor.status='active'
  WHERE membership.agency_id=p_agency AND membership.user_id=p_actor
    AND membership.status='active' AND membership.role IN('owner','admin','editor') LIMIT 1;
  IF v_agency IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency settings not authorized';END IF;
  IF v_url IS NOT NULL AND v_url!~'^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid public review url';END IF;
  UPDATE iam.agencies SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{publicReviewUrl}',to_jsonb(COALESCE(v_url,'')),true),updated_at=clock_timestamp()
  WHERE id=v_agency;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(v_agency,p_actor,'agency',v_agency::text,'post_trip_settings_updated',jsonb_build_object('publicReviewUrlConfigured',v_url IS NOT NULL));
  RETURN true;
END $$;

ALTER TABLE ops.push_delivery_runs DROP CONSTRAINT IF EXISTS push_delivery_runs_kind_check;
ALTER TABLE ops.push_delivery_runs ADD CONSTRAINT push_delivery_runs_kind_check
  CHECK(kind IN('quiz_unlock','departure_reminder','post_trip_review'));

CREATE OR REPLACE FUNCTION app.claim_due_push_deliveries_v3()
RETURNS TABLE(run_id UUID,departure_id UUID,kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE candidate RECORD;v_run UUID;
BEGIN
  FOR candidate IN
    SELECT departure.agency_id,departure.id AS departure_id,'departure_reminder'::text AS kind,
      'departure_reminder:'||departure.starts_on::text AS event_key
    FROM travel.departures departure
    WHERE departure.status IN('open','confirmed')
      AND (clock_timestamp() AT TIME ZONE departure.timezone)::date=departure.starts_on-1
    UNION ALL
    SELECT departure.agency_id,departure.id,'quiz_unlock',
      'quiz_unlock:'||(clock_timestamp() AT TIME ZONE departure.timezone)::date::text
    FROM travel.departures departure
    WHERE departure.status IN('open','confirmed','in_progress')
      AND (clock_timestamp() AT TIME ZONE departure.timezone)::date BETWEEN departure.starts_on AND departure.ends_on
    UNION ALL
    SELECT departure.agency_id,departure.id,'post_trip_review',
      'post_trip_review:'||departure.ends_on::text
    FROM travel.departures departure
    WHERE departure.status<>'cancelled'
      AND (clock_timestamp() AT TIME ZONE departure.timezone)::date=departure.ends_on+2
  LOOP
    INSERT INTO ops.push_delivery_runs(agency_id,departure_id,event_key,kind)
    VALUES(candidate.agency_id,candidate.departure_id,candidate.event_key,candidate.kind)
    ON CONFLICT ON CONSTRAINT push_delivery_runs_departure_id_event_key_key DO UPDATE SET
      status='claimed',claimed_at=clock_timestamp(),error_message=NULL
      WHERE ops.push_delivery_runs.status='failed' AND ops.push_delivery_runs.claimed_at<clock_timestamp()-interval '15 minutes'
    RETURNING id INTO v_run;
    IF v_run IS NOT NULL THEN RETURN QUERY SELECT v_run,candidate.departure_id,candidate.kind;END IF;
    v_run:=NULL;
  END LOOP;
END $$;

REVOKE ALL ON travel.rooming_rooms,travel.rooming_room_occupants,journey.post_trip_reviews FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON travel.rooming_rooms,travel.rooming_room_occupants TO smf_app;
GRANT SELECT ON journey.post_trip_reviews TO smf_app;
REVOKE ALL ON FUNCTION app.can_manage_rooming_list_v3(UUID,UUID),app.save_rooming_list_v3(UUID,UUID,UUID,UUID,JSONB),
  app.read_own_post_trip_review_v3(UUID,UUID,UUID),app.save_own_post_trip_review_v3(UUID,UUID,UUID,INTEGER,TEXT,UUID),
  app.read_agency_post_trip_settings_v3(UUID,UUID),app.update_agency_post_trip_settings_v3(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_manage_rooming_list_v3(UUID,UUID),app.save_rooming_list_v3(UUID,UUID,UUID,UUID,JSONB),
  app.read_own_post_trip_review_v3(UUID,UUID,UUID),app.save_own_post_trip_review_v3(UUID,UUID,UUID,INTEGER,TEXT,UUID),
  app.read_agency_post_trip_settings_v3(UUID,UUID),app.update_agency_post_trip_settings_v3(UUID,UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('200_v3_rooming_and_post_trip_reviews') ON CONFLICT(version) DO NOTHING;
