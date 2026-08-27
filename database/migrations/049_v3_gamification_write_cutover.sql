-- Gamification runtime write cutover.
-- All writes are authorized and aggregated atomically inside SECURITY DEFINER
-- functions; the runtime role never receives broad table mutation privileges.

CREATE OR REPLACE FUNCTION app.save_activity_item_result_v3(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_departure_id UUID,
  p_party_id UUID,
  p_template_day_id UUID,
  p_activity_item_id UUID,
  p_result_id UUID,
  p_score INTEGER,
  p_max_score INTEGER,
  p_status TEXT,
  p_result JSONB,
  p_media_asset_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID,status TEXT,score INTEGER,max_score INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey,ops
SET row_security=off AS $$
DECLARE
  v_actor UUID;
  v_traveler UUID;
  v_version UUID;
  v_day UUID;
  v_activity UUID;
  v_activity_type TEXT;
  v_attempt UUID;
  v_grant UUID;
  v_answers JSONB;
  v_answer JSONB;
  v_total INTEGER;
  v_max INTEGER;
BEGIN
  IF p_score < 0 OR p_max_score < 0 OR p_score > p_max_score
     OR p_status NOT IN ('submitted','approved','rejected')
     OR jsonb_typeof(COALESCE(p_result,'{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid activity result';
  END IF;
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor not found'; END IF;
  SELECT profile.id,departure.template_version_id,day.id,item.activity_id,activity.activity_type
    INTO v_traveler,v_version,v_day,v_activity,v_activity_type
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership
    ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id
   AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id
   AND membership.status='active'
  JOIN travel.departures departure
    ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
  JOIN travel.departure_days day
    ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
   AND day.template_day_id=p_template_day_id
  JOIN content.activity_items item
    ON item.agency_id=departure.agency_id AND item.template_version_id=departure.template_version_id
   AND item.id=p_activity_item_id
  JOIN content.activities activity
    ON activity.agency_id=item.agency_id AND activity.template_version_id=item.template_version_id
   AND activity.id=item.activity_id AND activity.template_day_id=p_template_day_id
   AND activity.status='approved'
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='activity is outside traveler scope';
  END IF;

  IF p_media_asset_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM ops.media_assets asset
    WHERE asset.agency_id=p_agency_id AND asset.departure_id=p_departure_id
      AND asset.party_id=p_party_id AND asset.id=p_media_asset_id
      AND asset.uploaded_by_user_id=v_actor AND asset.status='ready') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='evidence media is outside traveler scope';
  END IF;

  IF v_activity_type='quiz' THEN
    SELECT grant_row.id INTO v_grant
    FROM journey.activity_access_grants grant_row
    WHERE grant_row.agency_id=p_agency_id AND grant_row.departure_id=p_departure_id
      AND grant_row.party_id=p_party_id AND grant_row.traveler_id=v_traveler
      AND grant_row.activity_id=v_activity AND grant_row.revoked_at IS NULL
      AND grant_row.available_at<=clock_timestamp() AND grant_row.granted_at<=clock_timestamp()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at>clock_timestamp())
    ORDER BY grant_row.granted_at DESC LIMIT 1;
    IF v_grant IS NULL THEN
      v_grant:=app.issue_activity_access_grant(
        p_agency_id,p_departure_id,p_party_id,v_traveler,v_activity,
        encode(digest(p_party_id::text||':'||v_traveler::text||':'||v_activity::text||':'||clock_timestamp()::text,'sha256'),'hex'),
        encode(digest(v_activity::text||':'||v_version::text,'sha256'),'hex'),v_actor);
    END IF;
  END IF;

  SELECT attempt.id,attempt.answers INTO v_attempt,v_answers
  FROM journey.activity_attempts attempt
  WHERE attempt.party_id=p_party_id AND attempt.traveler_id=v_traveler
    AND attempt.activity_id=v_activity FOR UPDATE;
  v_answer:=COALESCE(p_result,'{}'::jsonb)||jsonb_build_object(
    '__resultId',p_result_id,'__score',p_score,'__maxScore',p_max_score,
    '__status',p_status,'__submittedAt',clock_timestamp(),'__updatedAt',clock_timestamp());
  v_answers:=jsonb_set(COALESCE(v_answers,'{}'::jsonb),ARRAY[p_activity_item_id::text],v_answer,true);
  SELECT COALESCE(sum((value->>'__score')::integer),0),
         COALESCE(sum((value->>'__maxScore')::integer),0)
    INTO v_total,v_max FROM jsonb_each(v_answers);
  IF v_attempt IS NULL THEN
    INSERT INTO journey.activity_attempts(
      agency_id,departure_id,template_version_id,party_id,traveler_id,departure_day_id,
      activity_id,access_grant_id,score,max_score,status,answers,client_operation_id,
      client_answered_at,server_received_at,submitted_at)
    VALUES(p_agency_id,p_departure_id,v_version,p_party_id,v_traveler,v_day,
      v_activity,v_grant,v_total,v_max,p_status,v_answers,p_result_id,clock_timestamp(),
      clock_timestamp(),clock_timestamp()) RETURNING journey.activity_attempts.id INTO v_attempt;
  ELSE
    UPDATE journey.activity_attempts attempt SET answers=v_answers,score=v_total,max_score=v_max,
      status=CASE WHEN p_status='rejected' THEN 'rejected'
        WHEN attempt.status='approved' OR p_status='approved' THEN 'approved' ELSE 'submitted' END,
      access_grant_id=COALESCE(attempt.access_grant_id,v_grant),client_answered_at=clock_timestamp(),
      server_received_at=clock_timestamp(),submitted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE attempt.id=v_attempt;
  END IF;
  IF p_media_asset_id IS NOT NULL THEN
    INSERT INTO journey.activity_evidence(agency_id,departure_id,party_id,attempt_id,
      activity_item_id,media_asset_id)
    VALUES(p_agency_id,p_departure_id,p_party_id,v_attempt,p_activity_item_id,p_media_asset_id)
    ON CONFLICT(attempt_id,media_asset_id) DO UPDATE SET activity_item_id=EXCLUDED.activity_item_id;
  END IF;
  RETURN QUERY SELECT p_result_id,p_status,v_total,v_max;
END $$;

CREATE OR REPLACE FUNCTION app.add_photo_contest_entry_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_template_day_id UUID,p_activity_item_id UUID,p_media_asset_id UUID,p_client_operation_id UUID)
RETURNS TABLE(id UUID,participant_slot SMALLINT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey,ops
SET row_security=off AS $$
DECLARE v_actor UUID;v_traveler UUID;v_version UUID;v_activity UUID;v_slot SMALLINT;v_id UUID;
BEGIN
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  SELECT profile.id,departure.template_version_id,item.activity_id
    INTO v_traveler,v_version,v_activity
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id
    AND departure.id=membership.departure_id
  JOIN content.activity_items item ON item.agency_id=departure.agency_id
    AND item.template_version_id=departure.template_version_id AND item.id=p_activity_item_id
  JOIN content.activities activity ON activity.agency_id=item.agency_id
    AND activity.template_version_id=item.template_version_id AND activity.id=item.activity_id
    AND activity.template_day_id=p_template_day_id AND activity.activity_type='photo_contest'
    AND activity.status='approved'
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL OR NOT EXISTS(SELECT 1 FROM ops.media_assets asset
    WHERE asset.agency_id=p_agency_id AND asset.departure_id=p_departure_id
      AND asset.party_id=p_party_id AND asset.id=p_media_asset_id
      AND asset.uploaded_by_user_id=v_actor AND asset.status='ready') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contest entry is outside traveler scope';
  END IF;
  SELECT candidate INTO v_slot FROM generate_series(1,3) candidate
  WHERE NOT EXISTS(SELECT 1 FROM journey.photo_contest_entries entry
    WHERE entry.party_id=p_party_id AND entry.traveler_id=v_traveler
      AND entry.activity_id=v_activity AND entry.participant_slot=candidate)
  ORDER BY candidate LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='contest entry limit reached'; END IF;
  INSERT INTO journey.photo_contest_entries(agency_id,departure_id,template_version_id,
    party_id,traveler_id,activity_id,media_asset_id,participant_slot,client_operation_id)
  VALUES(p_agency_id,p_departure_id,v_version,p_party_id,v_traveler,v_activity,
    p_media_asset_id,v_slot,p_client_operation_id) RETURNING journey.photo_contest_entries.id INTO v_id;
  RETURN QUERY SELECT v_id,v_slot,'submitted'::text;
END $$;

CREATE OR REPLACE FUNCTION app.review_activity_evidence_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_party_id UUID,p_result_id UUID,p_approved BOOLEAN)
RETURNS TABLE(id UUID,status TEXT,score INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,content,journey
SET row_security=off AS $$
DECLARE v_actor UUID;v_attempt UUID;v_key TEXT;v_answers JSONB;v_answer JSONB;v_total INTEGER;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  SELECT attempt.id,answer.key,attempt.answers INTO v_attempt,v_key,v_answers
  FROM journey.activity_attempts attempt
  JOIN content.activities activity ON activity.id=attempt.activity_id AND activity.agency_id=attempt.agency_id
  CROSS JOIN LATERAL jsonb_each(attempt.answers) answer
  WHERE attempt.agency_id=p_agency_id AND attempt.party_id=p_party_id
    AND answer.value->>'__resultId'=p_result_id::text
    AND activity.activity_type IN('mission','bingo')
    AND answer.value->>'__status'='submitted' FOR UPDATE OF attempt;
  IF v_attempt IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='evidence not available'; END IF;
  v_answer:=(v_answers->v_key)||jsonb_build_object('__status',CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    '__score',CASE WHEN p_approved THEN 10 ELSE 0 END,'__updatedAt',clock_timestamp());
  v_answers:=jsonb_set(v_answers,ARRAY[v_key],v_answer,false);
  SELECT COALESCE(sum((value->>'__score')::integer),0) INTO v_total FROM jsonb_each(v_answers);
  UPDATE journey.activity_attempts attempt SET answers=v_answers,score=v_total,
    status=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    validated_by_user_id=v_actor,updated_at=clock_timestamp() WHERE attempt.id=v_attempt;
  RETURN QUERY SELECT p_result_id,CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    CASE WHEN p_approved THEN 10 ELSE 0 END;
END $$;

REVOKE ALL ON FUNCTION app.save_activity_item_result_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,INTEGER,INTEGER,TEXT,JSONB,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_activity_evidence_v3(TEXT,UUID,UUID,UUID,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.save_activity_item_result_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,INTEGER,INTEGER,TEXT,JSONB,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.review_activity_evidence_v3(TEXT,UUID,UUID,UUID,BOOLEAN) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('049_v3_gamification_write_cutover') ON CONFLICT(version) DO NOTHING;
