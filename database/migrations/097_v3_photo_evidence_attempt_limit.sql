-- Enforces the two-attempt rule for AI-validated mission and bingo photos.
-- The advisory transaction lock makes the limit authoritative under concurrency.

CREATE OR REPLACE FUNCTION app.submit_photo_evidence_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_template_day_id UUID,p_activity_item_id UUID,p_result_id UUID,p_media_asset_id UUID
) RETURNS TABLE(id UUID,status TEXT,score INTEGER,max_score INTEGER,attempt_number INTEGER,attempts_remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey,ops SET row_security=off AS $$
DECLARE
  v_actor UUID;v_traveler UUID;v_activity UUID;v_type TEXT;v_answer JSONB;
  v_attempt_number INTEGER:=0;v_status TEXT;v_saved RECORD;
BEGIN
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor not found';END IF;
  SELECT profile.id,item.activity_id,activity.activity_type
    INTO v_traveler,v_activity,v_type
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
    AND membership.traveler_id=profile.id AND membership.departure_id=p_departure_id
    AND membership.party_id=p_party_id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
  JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
    AND day.template_day_id=p_template_day_id
  JOIN content.activity_items item ON item.agency_id=departure.agency_id
    AND item.template_version_id=departure.template_version_id AND item.id=p_activity_item_id
  JOIN content.activities activity ON activity.agency_id=item.agency_id
    AND activity.template_version_id=item.template_version_id AND activity.id=item.activity_id
    AND activity.template_day_id=p_template_day_id AND activity.status='approved'
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL OR v_type NOT IN('mission','bingo') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='photo evidence is outside traveler scope';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_agency_id::text||':'||p_party_id::text||':'||v_traveler::text||':'||p_activity_item_id::text,0));
  SELECT attempt.answers->p_activity_item_id::text INTO v_answer
  FROM journey.activity_attempts attempt
  WHERE attempt.agency_id=p_agency_id AND attempt.departure_id=p_departure_id
    AND attempt.party_id=p_party_id AND attempt.traveler_id=v_traveler
    AND attempt.activity_id=v_activity FOR UPDATE;
  v_status:=COALESCE(v_answer->>'__status','');
  v_attempt_number:=COALESCE((v_answer#>>'{aiValidation,attemptCount}')::integer,0);
  IF v_status='submitted' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='photo evidence validation pending';
  ELSIF v_status='approved' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='photo evidence already approved';
  ELSIF v_attempt_number>=2 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='photo evidence attempt limit reached';
  END IF;
  v_attempt_number:=v_attempt_number+1;
  SELECT * INTO v_saved FROM app.save_activity_item_result_v3(
    p_actor_legacy_user_id,p_agency_id,p_departure_id,p_party_id,p_template_day_id,
    p_activity_item_id,p_result_id,0,10,'submitted',
    jsonb_build_object('mediaId',p_media_asset_id,'aiValidation',jsonb_build_object(
      'status','queued','attemptCount',v_attempt_number,'attemptsRemaining',2-v_attempt_number)),p_media_asset_id);
  RETURN QUERY SELECT v_saved.id,v_saved.status,v_saved.score,v_saved.max_score,v_attempt_number,2-v_attempt_number;
END $$;

REVOKE ALL ON FUNCTION app.submit_photo_evidence_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.submit_photo_evidence_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('097_v3_photo_evidence_attempt_limit') ON CONFLICT(version) DO NOTHING;
