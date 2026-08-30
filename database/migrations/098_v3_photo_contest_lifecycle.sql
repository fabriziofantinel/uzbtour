-- Photo contest lifecycle: editable two-photo draft, AI selection and 06:00 local close.
ALTER TABLE journey.photo_contest_entries
  DROP CONSTRAINT IF EXISTS photo_contest_entries_status_check;
UPDATE journey.photo_contest_entries SET status='draft' WHERE status='submitted';
ALTER TABLE journey.photo_contest_entries
  ADD CONSTRAINT photo_contest_entries_status_check
  CHECK(status IN('draft','evaluating','selected','ranked','rejected')) NOT VALID;
ALTER TABLE journey.photo_contest_entries VALIDATE CONSTRAINT photo_contest_entries_status_check;
ALTER TABLE journey.photo_contest_entries
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION app.upsert_photo_contest_draft_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_template_day_id UUID,p_activity_item_id UUID,p_media_asset_id UUID,
  p_client_operation_id UUID,p_participant_slot SMALLINT DEFAULT NULL)
RETURNS TABLE(id UUID,participant_slot SMALLINT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_traveler UUID;v_version UUID;v_activity UUID;v_slot SMALLINT;v_id UUID;v_existing RECORD;v_service_date DATE;v_timezone TEXT;
BEGIN
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  SELECT profile.id,departure.template_version_id,item.activity_id,day.service_date,departure.timezone INTO v_traveler,v_version,v_activity,v_service_date,v_timezone
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id
    AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
  JOIN content.activity_items item ON item.agency_id=departure.agency_id AND item.template_version_id=departure.template_version_id
    AND item.id=p_activity_item_id
  JOIN content.activities activity ON activity.agency_id=item.agency_id AND activity.template_version_id=item.template_version_id
    AND activity.id=item.activity_id AND activity.template_day_id=p_template_day_id
    AND activity.activity_type='photo_contest' AND activity.status='approved'
  JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
    AND day.template_day_id=activity.template_day_id
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL OR NOT EXISTS(SELECT 1 FROM ops.media_assets asset WHERE asset.agency_id=p_agency_id
    AND asset.departure_id=p_departure_id AND asset.party_id=p_party_id AND asset.id=p_media_asset_id
    AND asset.uploaded_by_user_id=v_actor AND asset.status='ready') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contest draft is outside traveler scope';END IF;
  IF clock_timestamp()>=((v_service_date+1)+time '06:00') AT TIME ZONE v_timezone THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='contest is closed';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_party_id::text||':'||v_traveler::text||':'||v_activity::text,0));
  IF p_participant_slot IS NOT NULL THEN
    SELECT entry.* INTO v_existing FROM journey.photo_contest_entries entry WHERE entry.party_id=p_party_id
      AND entry.traveler_id=v_traveler AND entry.activity_id=v_activity AND entry.participant_slot=p_participant_slot FOR UPDATE;
    IF v_existing.id IS NULL OR v_existing.status<>'draft' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='contest photo is no longer editable';END IF;
    UPDATE journey.photo_contest_entries SET media_asset_id=p_media_asset_id,client_operation_id=p_client_operation_id,
      submitted_at=clock_timestamp() WHERE journey.photo_contest_entries.id=v_existing.id RETURNING journey.photo_contest_entries.id INTO v_id;
    v_slot:=p_participant_slot;
  ELSE
    SELECT candidate INTO v_slot FROM generate_series(1,2) candidate WHERE NOT EXISTS(
      SELECT 1 FROM journey.photo_contest_entries entry WHERE entry.party_id=p_party_id
        AND entry.traveler_id=v_traveler AND entry.activity_id=v_activity AND entry.participant_slot=candidate)
      ORDER BY candidate LIMIT 1;
    IF v_slot IS NULL THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='contest draft limit reached';END IF;
    INSERT INTO journey.photo_contest_entries(agency_id,departure_id,template_version_id,party_id,traveler_id,
      activity_id,media_asset_id,participant_slot,status,client_operation_id)
    VALUES(p_agency_id,p_departure_id,v_version,p_party_id,v_traveler,v_activity,p_media_asset_id,v_slot,'draft',p_client_operation_id)
    RETURNING journey.photo_contest_entries.id INTO v_id;
  END IF;
  RETURN QUERY SELECT v_id,v_slot,'draft'::text;
END $$;

CREATE OR REPLACE FUNCTION app.confirm_photo_contest_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,p_activity_item_id UUID)
RETURNS TABLE(activity_id UUID,entry_ids UUID[])
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,content,journey SET row_security=off AS $$
DECLARE v_actor UUID;v_traveler UUID;v_activity UUID;v_entries UUID[];v_service_date DATE;v_timezone TEXT;
BEGIN
  v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
  SELECT profile.id,item.activity_id,day.service_date,departure.timezone INTO v_traveler,v_activity,v_service_date,v_timezone
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id
    AND membership.departure_id=p_departure_id AND membership.party_id=p_party_id AND membership.status='active'
  JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
  JOIN content.activity_items item ON item.agency_id=departure.agency_id AND item.template_version_id=departure.template_version_id
    AND item.id=p_activity_item_id
  JOIN content.activities activity ON activity.agency_id=item.agency_id AND activity.id=item.activity_id
    AND activity.activity_type='photo_contest' AND activity.status='approved'
  JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
    AND day.template_day_id=activity.template_day_id
  WHERE profile.agency_id=p_agency_id AND profile.user_id=v_actor;
  IF v_traveler IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contest is outside traveler scope';END IF;
  IF clock_timestamp()>((v_service_date+1)+time '06:00') AT TIME ZONE v_timezone THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='contest is closed';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_party_id::text||':'||v_traveler::text||':'||v_activity::text,0));
  SELECT array_agg(entry.id ORDER BY entry.participant_slot) INTO v_entries FROM journey.photo_contest_entries entry
  WHERE entry.party_id=p_party_id AND entry.traveler_id=v_traveler AND entry.activity_id=v_activity AND entry.status='draft';
  IF COALESCE(cardinality(v_entries),0)<>2 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='exactly two contest photos are required';END IF;
  UPDATE journey.photo_contest_entries SET status='evaluating',confirmed_at=clock_timestamp() WHERE id=ANY(v_entries);
  RETURN QUERY SELECT v_activity,v_entries;
END $$;

-- Compatibility bridge for an already running frontend during coordinated rollout.
CREATE OR REPLACE FUNCTION app.add_photo_contest_entry_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_departure_id UUID,p_party_id UUID,
  p_template_day_id UUID,p_activity_item_id UUID,p_media_asset_id UUID,p_client_operation_id UUID)
RETURNS TABLE(id UUID,participant_slot SMALLINT,status TEXT)
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,app SET row_security=off AS $$
  SELECT * FROM app.upsert_photo_contest_draft_v3(p_actor_legacy_user_id,p_agency_id,p_departure_id,p_party_id,
    p_template_day_id,p_activity_item_id,p_media_asset_id,p_client_operation_id,NULL)
$$;

CREATE OR REPLACE FUNCTION app.complete_photo_contest_evaluation_v3(
  p_agency_id UUID,p_entry_ids UUID[],p_model TEXT,p_evaluations JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,journey SET row_security=off AS $$
DECLARE v_scope RECORD;v_count INTEGER;v_best UUID;
BEGIN
  IF cardinality(p_entry_ids)<>2 OR jsonb_typeof(p_evaluations)<>'array' OR jsonb_array_length(p_evaluations)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid contest evaluation';END IF;
  PERFORM 1 FROM journey.photo_contest_entries WHERE agency_id=p_agency_id AND id=ANY(p_entry_ids) FOR UPDATE;
  SELECT min(party_id::text)::uuid party_id,min(traveler_id::text)::uuid traveler_id,min(activity_id::text)::uuid activity_id,
    count(*)::int count_rows,count(DISTINCT party_id)::int parties,count(DISTINCT traveler_id)::int travelers,
    count(DISTINCT activity_id)::int activities INTO v_scope
  FROM journey.photo_contest_entries WHERE agency_id=p_agency_id AND id=ANY(p_entry_ids) AND status='evaluating';
  IF v_scope.count_rows<>2 OR v_scope.parties<>1 OR v_scope.travelers<>1 OR v_scope.activities<>1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='contest evaluation is no longer available';END IF;
  INSERT INTO journey.photo_contest_judgements(agency_id,party_id,activity_id,entry_id,judge_type,model,score,criteria,reason)
  SELECT p_agency_id,v_scope.party_id,v_scope.activity_id,(value->>'entryId')::uuid,'ai',p_model,
    (value->>'total')::numeric,value-'entryId'-'total'-'reason',left(COALESCE(value->>'reason',''),500)
  FROM jsonb_array_elements(p_evaluations) value
  WHERE (value->>'entryId')::uuid=ANY(p_entry_ids) AND (value->>'total')::numeric BETWEEN 0 AND 100;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>2 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='incomplete contest evaluation';END IF;
  SELECT entry.id INTO v_best FROM journey.photo_contest_entries entry
  JOIN journey.photo_contest_judgements judged ON judged.entry_id=entry.id AND judged.agency_id=entry.agency_id
  WHERE entry.id=ANY(p_entry_ids) ORDER BY judged.score DESC,entry.participant_slot,entry.id LIMIT 1;
  UPDATE journey.photo_contest_entries SET status=CASE WHEN id=v_best THEN 'selected' ELSE 'rejected' END,
    evaluated_at=clock_timestamp(),is_winner=false WHERE id=ANY(p_entry_ids);
  RETURN v_best;
END $$;

CREATE OR REPLACE FUNCTION app.close_due_photo_contests_v3()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,travel,content,journey SET row_security=off AS $$
DECLARE candidate RECORD;v_winner UUID;v_closed INTEGER:=0;v_rows INTEGER:=0;
BEGIN
  FOR candidate IN SELECT DISTINCT entry.agency_id,entry.departure_id,entry.party_id,entry.activity_id
    FROM journey.photo_contest_entries entry
    JOIN content.activities activity ON activity.id=entry.activity_id AND activity.agency_id=entry.agency_id
    JOIN travel.departure_days day ON day.agency_id=entry.agency_id AND day.departure_id=entry.departure_id
      AND day.template_day_id=activity.template_day_id
    JOIN travel.departures departure ON departure.agency_id=entry.agency_id AND departure.id=entry.departure_id
    WHERE entry.status='selected' AND clock_timestamp()>=((day.service_date+1)+time '06:00') AT TIME ZONE departure.timezone
  LOOP
    SELECT entry.id INTO v_winner FROM journey.photo_contest_entries entry
    JOIN LATERAL(SELECT score FROM journey.photo_contest_judgements judged WHERE judged.entry_id=entry.id
      ORDER BY judged.judged_at DESC,judged.id DESC LIMIT 1) score ON true
    WHERE entry.agency_id=candidate.agency_id AND entry.departure_id=candidate.departure_id
      AND entry.party_id=candidate.party_id AND entry.activity_id=candidate.activity_id AND entry.status='selected'
    ORDER BY score.score DESC,entry.evaluated_at,entry.id LIMIT 1;
    UPDATE journey.photo_contest_entries SET is_winner=false WHERE agency_id=candidate.agency_id
      AND departure_id=candidate.departure_id AND party_id=candidate.party_id AND activity_id=candidate.activity_id;
    UPDATE journey.photo_contest_entries SET status='ranked',is_winner=(id=v_winner)
    WHERE agency_id=candidate.agency_id AND departure_id=candidate.departure_id
      AND party_id=candidate.party_id AND activity_id=candidate.activity_id AND status='selected';
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_closed:=v_closed+v_rows;
  END LOOP;
  RETURN v_closed;
END $$;

-- The shared queue producer also accepts tightly scoped traveler-owned AI jobs.
CREATE OR REPLACE FUNCTION app.enqueue_platform_job_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_job_type TEXT,p_provider TEXT,
  p_payload JSONB,p_idempotency_key TEXT,p_available_at TIMESTAMPTZ)
RETURNS TABLE(id UUID,provider TEXT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_import UUID;v_actor UUID;
BEGIN
  IF p_provider NOT IN('database','sqs') OR jsonb_typeof(p_payload)<>'object'
    OR NULLIF(btrim(p_job_type),'') IS NULL OR NULLIF(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid platform job';END IF;
  IF p_job_type IN('photo-evidence.validate','photo-contest.evaluate') THEN
    v_actor:=app.resolve_legacy_user_id(p_actor_legacy_user_id,p_agency_id);
    IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM travel.party_memberships membership
      JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
      WHERE membership.agency_id=p_agency_id AND membership.departure_id=(p_payload->>'departureId')::uuid
        AND membership.party_id=(p_payload->>'partyId')::uuid AND membership.status='active' AND profile.user_id=v_actor) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler job is outside actor scope';END IF;
  ELSE
    PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  END IF;
  IF p_payload->>'importId' ~* '^[0-9a-f-]{36}$' THEN SELECT import_job.id INTO v_import FROM ops.import_jobs import_job
    WHERE import_job.agency_id=p_agency_id AND import_job.id=(p_payload->>'importId')::uuid;END IF;
  RETURN QUERY INSERT INTO ops.platform_jobs(agency_id,import_job_id,job_type,provider,status,payload,idempotency_key,available_at)
  VALUES(p_agency_id,v_import,btrim(p_job_type),p_provider,'queued',p_payload,btrim(p_idempotency_key),COALESCE(p_available_at,clock_timestamp()))
  ON CONFLICT(agency_id,idempotency_key) DO UPDATE SET
    status=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN 'queued' ELSE ops.platform_jobs.status END,
    error_message=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN NULL ELSE ops.platform_jobs.error_message END,
    available_at=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN EXCLUDED.available_at ELSE ops.platform_jobs.available_at END,
    updated_at=clock_timestamp()
  RETURNING ops.platform_jobs.id,ops.platform_jobs.provider::text,ops.platform_jobs.status::text;
END $$;

REVOKE ALL ON FUNCTION app.upsert_photo_contest_draft_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID,SMALLINT),
  app.confirm_photo_contest_v3(TEXT,UUID,UUID,UUID,UUID),app.complete_photo_contest_evaluation_v3(UUID,UUID[],TEXT,JSONB),
  app.close_due_photo_contests_v3() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.upsert_photo_contest_draft_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID,SMALLINT),
  app.confirm_photo_contest_v3(TEXT,UUID,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.add_photo_contest_entry_v3(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('098_v3_photo_contest_lifecycle') ON CONFLICT(version) DO NOTHING;
