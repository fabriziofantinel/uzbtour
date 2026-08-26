-- Consolidamento runtime dei blocchi media/ricordi, gamification e contest.
-- Le scritture restano compatibili con le API v2 e sono replicate nello stesso
-- commit nel modello v3 mediante trigger SECURITY DEFINER.

CREATE OR REPLACE FUNCTION app.sync_legacy_media_asset()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, iam, travel, ops
SET row_security = off
AS $$
DECLARE r public.media_assets%ROWTYPE; v_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ops.media_assets WHERE agency_id = OLD.agency_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  r := NEW;
  IF r.uploaded_by_user_id IS NOT NULL THEN
    SELECT target_id INTO v_user FROM ops.legacy_id_map
     WHERE source_system='public-v2' AND entity_type='user'
       AND legacy_id=r.uploaded_by_user_id AND agency_id=r.agency_id;
  END IF;
  INSERT INTO ops.media_assets
    (id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,
     original_name,content_type,size_bytes,checksum_sha256,purpose,visibility,status,
     metadata,created_at,updated_at,deleted_at)
  VALUES
    (r.id,r.agency_id,r.departure_id,r.party_id,v_user,
     CASE WHEN r.provider IN ('r2','s3') THEN r.provider ELSE 'r2' END,
     r.bucket,r.object_key,r.original_name,r.content_type,r.size_bytes,r.checksum_sha256,
     CASE r.purpose WHEN 'travel_programme' THEN 'source_document'
       WHEN 'travel_programme_normalized' THEN 'normalized_document'
       WHEN 'ticket' THEN 'ticket' WHEN 'voucher' THEN 'voucher'
       WHEN 'photo' THEN 'memory' WHEN 'memory_photo' THEN 'memory' WHEN 'memory' THEN 'memory'
       WHEN 'challenge' THEN 'challenge_evidence' WHEN 'challenge_evidence' THEN 'challenge_evidence'
       WHEN 'contest' THEN 'contest_entry' WHEN 'contest_entry' THEN 'contest_entry' ELSE 'other' END,
     r.visibility,r.status,
     r.metadata || jsonb_build_object('legacyPurpose',r.purpose,'legacyProvider',r.provider),
     r.created_at,r.updated_at,CASE WHEN r.status='deleted' THEN r.updated_at END)
  ON CONFLICT (id) DO UPDATE SET
    departure_id=EXCLUDED.departure_id,party_id=EXCLUDED.party_id,
    uploaded_by_user_id=EXCLUDED.uploaded_by_user_id,provider=EXCLUDED.provider,
    bucket=EXCLUDED.bucket,object_key=EXCLUDED.object_key,original_name=EXCLUDED.original_name,
    content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,
    checksum_sha256=EXCLUDED.checksum_sha256,purpose=EXCLUDED.purpose,
    visibility=EXCLUDED.visibility,status=EXCLUDED.status,metadata=EXCLUDED.metadata,
    updated_at=EXCLUDED.updated_at,deleted_at=EXCLUDED.deleted_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_media_asset ON public.media_assets;
CREATE TRIGGER sync_v3_media_asset AFTER INSERT OR UPDATE OR DELETE ON public.media_assets
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_media_asset();

CREATE OR REPLACE FUNCTION app.sync_legacy_memory()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, travel, journey, ops
SET row_security = off
AS $$
DECLARE r public.party_memories%ROWTYPE; v_departure UUID; v_day UUID; v_actor UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM journey.memories WHERE agency_id=OLD.agency_id AND id=OLD.id;
    RETURN OLD;
  END IF;
  r := NEW;
  SELECT p.departure_id INTO v_departure FROM travel.travel_parties p
   WHERE p.agency_id=r.agency_id AND p.id=r.party_id;
  SELECT d.id INTO v_day FROM travel.departure_days d
   WHERE d.agency_id=r.agency_id AND d.departure_id=v_departure AND d.template_day_id=r.trip_day_id;
  SELECT t.id INTO v_actor FROM public.traveler_profiles legacy_actor
   JOIN travel.traveler_profiles t ON t.id=legacy_actor.id AND t.agency_id=legacy_actor.agency_id
   WHERE legacy_actor.agency_id=r.agency_id AND legacy_actor.user_id=r.created_by_user_id;
  IF v_departure IS NULL OR v_day IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'v3 memory scope is incomplete for legacy memory %',r.id;
  END IF;
  INSERT INTO journey.memories
    (id,agency_id,departure_id,party_id,departure_day_id,media_asset_id,
     created_by_traveler_id,caption,comment,client_operation_id,created_at,updated_at)
  VALUES (r.id,r.agency_id,v_departure,r.party_id,v_day,r.media_asset_id,v_actor,
          r.caption,r.comment,r.id,r.created_at,r.updated_at)
  ON CONFLICT (id) DO UPDATE SET departure_day_id=EXCLUDED.departure_day_id,
    media_asset_id=EXCLUDED.media_asset_id,created_by_traveler_id=EXCLUDED.created_by_traveler_id,
    caption=EXCLUDED.caption,comment=EXCLUDED.comment,updated_at=EXCLUDED.updated_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_memory ON public.party_memories;
CREATE TRIGGER sync_v3_memory AFTER INSERT OR UPDATE OR DELETE ON public.party_memories
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_memory();

CREATE OR REPLACE FUNCTION app.refresh_legacy_activity_attempt(
  p_agency UUID,p_party UUID,p_traveler UUID,p_activity UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, travel, content, journey, ops
SET row_security = off
AS $$
DECLARE v_departure UUID; v_version UUID; v_day UUID; v_attempt UUID; v_grant UUID;
  v_type TEXT; v_status TEXT; v_answers JSONB; v_score INTEGER; v_max INTEGER;
  v_submitted TIMESTAMPTZ; v_updated TIMESTAMPTZ; v_validator UUID; v_group TEXT;
BEGIN
  SELECT p.departure_id,d.template_version_id INTO v_departure,v_version
    FROM travel.travel_parties p JOIN travel.departures d ON d.id=p.departure_id
   WHERE p.agency_id=p_agency AND p.id=p_party;
  v_group := p_party::text||':'||p_traveler::text||':'||p_activity::text;
  SELECT a.activity_type INTO v_type FROM content.activities a
   WHERE a.agency_id=p_agency AND a.id=p_activity;
  SELECT dd.id,
         sum(r.score)::integer,sum(r.max_score)::integer,
         CASE WHEN bool_and(r.status='approved') THEN 'approved'
              WHEN bool_or(r.status='rejected') THEN 'rejected'
              WHEN bool_and(r.status='draft') THEN 'draft' ELSE 'submitted' END,
         jsonb_object_agg(r.generated_content_id::text,r.result),
         min(r.submitted_at),max(r.updated_at),min(vm.target_id::text)::uuid
    INTO v_day,v_score,v_max,v_status,v_answers,v_submitted,v_updated,v_validator
    FROM public.party_activity_results r
    JOIN ops.legacy_generated_content_map gm ON gm.agency_id=r.agency_id
      AND gm.legacy_generated_content_id=r.generated_content_id
    LEFT JOIN ops.legacy_id_map vm ON vm.source_system='public-v2' AND vm.entity_type='user'
      AND vm.agency_id=r.agency_id AND vm.legacy_id=r.validated_by_user_id
    LEFT JOIN travel.departure_days dd ON dd.agency_id=r.agency_id AND dd.departure_id=v_departure
      AND dd.template_day_id=r.trip_day_id
   WHERE r.agency_id=p_agency AND r.party_id=p_party AND r.traveler_id=p_traveler
     AND gm.activity_id=p_activity
   GROUP BY dd.id;
  IF v_answers IS NULL THEN
    SELECT target_id INTO v_attempt FROM ops.legacy_id_map
     WHERE source_system='public-v2' AND entity_type='activity_attempt' AND legacy_id=v_group;
    IF v_attempt IS NOT NULL THEN DELETE FROM journey.activity_attempts WHERE id=v_attempt; END IF;
    RETURN;
  END IF;
  INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
  VALUES ('public-v2','activity_attempt',v_group,p_agency)
  ON CONFLICT (source_system,entity_type,legacy_id) DO UPDATE SET agency_id=EXCLUDED.agency_id
  RETURNING target_id INTO v_attempt;
  IF v_type='quiz' AND v_status<>'draft' THEN
    SELECT id INTO v_grant FROM journey.activity_access_grants
     WHERE party_id=p_party AND traveler_id=p_traveler AND activity_id=p_activity
       AND revoked_at IS NULL AND available_at<=clock_timestamp()
     ORDER BY granted_at DESC LIMIT 1;
    IF v_grant IS NULL THEN
      v_grant := app.issue_activity_access_grant(p_agency,v_departure,p_party,p_traveler,p_activity,
        encode(digest(v_group||':access','sha256'),'hex'),
        encode(digest(p_activity::text||':'||v_version::text,'sha256'),'hex'),NULL);
    END IF;
  END IF;
  INSERT INTO journey.activity_attempts
    (id,agency_id,departure_id,template_version_id,party_id,traveler_id,departure_day_id,
     activity_id,access_grant_id,score,max_score,status,answers,validated_by_user_id,
     client_operation_id,client_answered_at,server_received_at,submitted_at,updated_at)
  VALUES (v_attempt,p_agency,v_departure,v_version,p_party,p_traveler,v_day,p_activity,v_grant,
          v_score,v_max,v_status,v_answers,v_validator,v_attempt,
          CASE WHEN v_status<>'draft' THEN v_submitted END,
          CASE WHEN v_status<>'draft' THEN v_submitted END,
          CASE WHEN v_status<>'draft' THEN v_submitted END,v_updated)
  ON CONFLICT (id) DO UPDATE SET departure_day_id=EXCLUDED.departure_day_id,
    access_grant_id=EXCLUDED.access_grant_id,score=EXCLUDED.score,max_score=EXCLUDED.max_score,
    status=EXCLUDED.status,answers=EXCLUDED.answers,validated_by_user_id=EXCLUDED.validated_by_user_id,
    client_answered_at=EXCLUDED.client_answered_at,updated_at=EXCLUDED.updated_at;
  DELETE FROM journey.activity_evidence WHERE attempt_id=v_attempt;
  INSERT INTO journey.activity_evidence
    (agency_id,departure_id,party_id,attempt_id,activity_item_id,media_asset_id,created_at)
  SELECT r.agency_id,v_departure,r.party_id,v_attempt,gm.activity_item_id,
         (r.result->>'mediaId')::uuid,r.submitted_at
    FROM public.party_activity_results r
    JOIN ops.legacy_generated_content_map gm ON gm.legacy_generated_content_id=r.generated_content_id
    JOIN ops.media_assets m ON m.id=CASE WHEN r.result->>'mediaId' ~* '^[0-9a-f-]{36}$'
      THEN (r.result->>'mediaId')::uuid END
   WHERE r.agency_id=p_agency AND r.party_id=p_party AND r.traveler_id=p_traveler
     AND gm.activity_id=p_activity AND r.result->>'mediaId' ~* '^[0-9a-f-]{36}$'
  ON CONFLICT (attempt_id,media_asset_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION app.sync_legacy_activity_result()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, ops
SET row_security = off
AS $$
DECLARE r public.party_activity_results%ROWTYPE; v_activity UUID;
BEGIN
  r := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  SELECT activity_id INTO v_activity FROM ops.legacy_generated_content_map
   WHERE agency_id=r.agency_id AND legacy_generated_content_id=r.generated_content_id;
  IF v_activity IS NULL THEN RAISE EXCEPTION 'v3 activity mapping missing for %',r.generated_content_id; END IF;
  PERFORM app.refresh_legacy_activity_attempt(r.agency_id,r.party_id,r.traveler_id,v_activity);
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS sync_v3_activity_result ON public.party_activity_results;
CREATE TRIGGER sync_v3_activity_result AFTER INSERT OR UPDATE OR DELETE ON public.party_activity_results
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_activity_result();

CREATE OR REPLACE FUNCTION app.sync_legacy_contest_entry()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, travel, journey, ops
SET row_security = off
AS $$
DECLARE r public.party_photo_contest_entries%ROWTYPE; v_departure UUID; v_version UUID;
  v_activity UUID; v_judge UUID; v_judgement UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM journey.photo_contest_entries WHERE agency_id=OLD.agency_id AND id=OLD.id;
    RETURN OLD;
  END IF;
  r:=NEW;
  SELECT p.departure_id,d.template_version_id INTO v_departure,v_version
    FROM travel.travel_parties p JOIN travel.departures d ON d.id=p.departure_id
   WHERE p.agency_id=r.agency_id AND p.id=r.party_id;
  SELECT activity_id INTO v_activity FROM ops.legacy_generated_content_map
   WHERE agency_id=r.agency_id AND legacy_generated_content_id=r.generated_content_id;
  IF v_activity IS NULL THEN RAISE EXCEPTION 'v3 contest mapping missing for %',r.generated_content_id; END IF;
  INSERT INTO journey.photo_contest_entries
    (id,agency_id,departure_id,template_version_id,party_id,traveler_id,activity_id,
     media_asset_id,participant_slot,status,is_winner,client_operation_id,submitted_at)
  VALUES (r.id,r.agency_id,v_departure,v_version,r.party_id,r.traveler_id,v_activity,
          r.media_asset_id,r.participant_slot,CASE WHEN r.is_winner THEN 'ranked' ELSE r.status END,
          r.is_winner,r.id,r.submitted_at)
  ON CONFLICT (id) DO UPDATE SET media_asset_id=EXCLUDED.media_asset_id,
    participant_slot=EXCLUDED.participant_slot,status=EXCLUDED.status,is_winner=EXCLUDED.is_winner;
  IF r.score IS NULL THEN
    DELETE FROM journey.photo_contest_judgements WHERE entry_id=r.id;
  ELSE
    IF r.judged_by_user_id IS NOT NULL THEN
      SELECT target_id INTO v_judge FROM ops.legacy_id_map
       WHERE source_system='public-v2' AND entity_type='user'
         AND legacy_id=r.judged_by_user_id AND agency_id=r.agency_id;
    END IF;
    INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id,agency_id)
    VALUES ('public-v2','photo_judgement',r.id::text,r.agency_id)
    ON CONFLICT (source_system,entity_type,legacy_id) DO UPDATE SET agency_id=EXCLUDED.agency_id
    RETURNING target_id INTO v_judgement;
    INSERT INTO journey.photo_contest_judgements
      (id,agency_id,party_id,activity_id,entry_id,judge_type,judge_user_id,model,score,reason,judged_at)
    VALUES (v_judgement,r.agency_id,r.party_id,v_activity,r.id,
      CASE WHEN v_judge IS NULL THEN 'ai' ELSE 'human' END,v_judge,
      CASE WHEN v_judge IS NULL THEN 'legacy-ai-evaluation' END,r.score,r.reason,
      COALESCE(r.judged_at,r.submitted_at))
    ON CONFLICT (id) DO UPDATE SET judge_type=EXCLUDED.judge_type,
      judge_user_id=EXCLUDED.judge_user_id,model=EXCLUDED.model,score=EXCLUDED.score,
      reason=EXCLUDED.reason,judged_at=EXCLUDED.judged_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_v3_contest_entry ON public.party_photo_contest_entries;
CREATE TRIGGER sync_v3_contest_entry AFTER INSERT OR UPDATE OR DELETE ON public.party_photo_contest_entries
FOR EACH ROW EXECUTE FUNCTION app.sync_legacy_contest_entry();

REVOKE ALL ON FUNCTION app.sync_legacy_media_asset() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_memory() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.refresh_legacy_activity_attempt(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_activity_result() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_legacy_contest_entry() FROM PUBLIC;

GRANT USAGE ON SCHEMA content,ops,journey,travel TO smf_app;
GRANT SELECT ON ops.media_assets,journey.memories,journey.activity_attempts,
  journey.activity_evidence,journey.photo_contest_entries,journey.photo_contest_judgements,
  content.activities,content.activity_items,travel.departure_days,travel.traveler_profiles
TO smf_app;
REVOKE SELECT ON ops.legacy_id_map,ops.legacy_generated_content_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('023_v3_traveler_experience_runtime') ON CONFLICT (version) DO NOTHING;
