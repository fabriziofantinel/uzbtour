-- BR-019: cancellazione tenant asincrona, a fasi, con lease e piccoli batch.

CREATE OR REPLACE FUNCTION app.request_agency_deletion_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_reason TEXT
)
RETURNS TABLE(job_id UUID,agency_name TEXT,status TEXT,phase TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_name TEXT;v_job UUID;
BEGIN
  SELECT user_row.id INTO v_actor FROM ops.legacy_id_map map
  JOIN iam.users user_row ON user_row.id=map.target_id
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id AND user_row.platform_role='superadmin'
    AND user_row.status='active';
  IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='superadmin access denied'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='deletion reason required'; END IF;
  SELECT name INTO v_name FROM iam.agencies WHERE id=p_agency_id FOR UPDATE;
  IF v_name IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  SELECT deletion.id INTO v_job FROM ops.agency_deletion_jobs deletion
  WHERE deletion.agency_id=p_agency_id AND deletion.status IN('queued','processing','blocked')
  ORDER BY deletion.requested_at DESC LIMIT 1;
  IF v_job IS NULL THEN
    UPDATE iam.agencies SET status='deleting',updated_at=clock_timestamp() WHERE id=p_agency_id;
    INSERT INTO ops.agency_deletion_jobs(agency_id,agency_name_snapshot,requested_by_user_id,
      reason,cursor_state)
    VALUES(p_agency_id,v_name,v_actor,btrim(p_reason),jsonb_build_object('candidateUserIds',
      COALESCE((SELECT jsonb_agg(DISTINCT user_id) FROM (
        SELECT user_id FROM iam.agency_memberships WHERE agency_id=p_agency_id
        UNION SELECT user_id FROM travel.traveler_profiles
          WHERE agency_id=p_agency_id AND user_id IS NOT NULL) candidate),'[]'::jsonb)))
    RETURNING id INTO v_job;
    INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
    VALUES(p_agency_id,v_actor,'agency',p_agency_id::text,'deletion_requested',
      jsonb_build_object('jobId',v_job,'reason',btrim(p_reason),'rule','BR-019'));
  END IF;
  RETURN QUERY SELECT deletion.id,deletion.agency_name_snapshot,deletion.status::text,deletion.phase::text
  FROM ops.agency_deletion_jobs deletion WHERE deletion.id=v_job;
END $$;

CREATE OR REPLACE FUNCTION app.claim_agency_deletion_v3(
  p_job_id UUID,p_agency_id UUID,p_worker_id TEXT,p_lease_seconds INTEGER DEFAULT 600
)
RETURNS TABLE(status TEXT,phase TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NULLIF(btrim(p_worker_id),'') IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid deletion worker lease';
  END IF;
  RETURN QUERY UPDATE ops.agency_deletion_jobs job SET status='processing',
    attempt_count=job.attempt_count+1,locked_at=clock_timestamp(),locked_by=p_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error=NULL
  WHERE job.id=p_job_id AND job.agency_id=p_agency_id AND (
    job.status='queued' OR (job.status='processing' AND job.lease_expires_at<clock_timestamp()))
  RETURNING job.status::text,job.phase::text;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=0 THEN
    RETURN QUERY SELECT job.status::text,job.phase::text FROM ops.agency_deletion_jobs job
    WHERE job.id=p_job_id AND job.agency_id=p_agency_id AND job.status IN('completed','blocked');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.read_agency_deletion_assets_v3(
  p_job_id UUID,p_agency_id UUID,p_worker_id TEXT,p_batch_size INTEGER DEFAULT 100
)
RETURNS TABLE(id UUID,provider TEXT,bucket TEXT,object_key TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  IF p_batch_size NOT BETWEEN 1 AND 200 OR NOT EXISTS(
    SELECT 1 FROM ops.agency_deletion_jobs job WHERE job.id=p_job_id
      AND job.agency_id=p_agency_id AND job.status='processing' AND job.phase='delete_objects'
      AND job.locked_by=p_worker_id AND job.lease_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency deletion lease invalid';
  END IF;
  RETURN QUERY SELECT asset.id,asset.provider::text,asset.bucket,asset.object_key
  FROM ops.media_assets asset WHERE asset.agency_id=p_agency_id AND asset.status<>'deleted'
    AND NOT asset.legal_hold ORDER BY asset.created_at,asset.id LIMIT p_batch_size;
END $$;

CREATE OR REPLACE FUNCTION app.mark_agency_deletion_asset_v3(
  p_job_id UUID,p_agency_id UUID,p_worker_id TEXT,p_asset_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops.agency_deletion_jobs job WHERE job.id=p_job_id
    AND job.agency_id=p_agency_id AND job.status='processing' AND job.phase='delete_objects'
    AND job.locked_by=p_worker_id AND job.lease_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency deletion lease invalid';
  END IF;
  UPDATE ops.media_assets SET status='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=p_asset_id AND agency_id=p_agency_id AND status<>'deleted' AND NOT legal_hold;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.advance_agency_deletion_v3(
  p_job_id UUID,p_agency_id UUID,p_worker_id TEXT,p_batch_size INTEGER DEFAULT 250
)
RETURNS TABLE(status TEXT,phase TEXT,affected INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,content,journey,privacy,ops SET row_security=off AS $$
DECLARE v_job ops.agency_deletion_jobs%ROWTYPE;v_count INTEGER:=0;
BEGIN
  IF p_batch_size NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid batch size'; END IF;
  SELECT * INTO v_job FROM ops.agency_deletion_jobs job WHERE job.id=p_job_id
    AND job.agency_id=p_agency_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'processing' OR v_job.locked_by<>p_worker_id
    OR v_job.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency deletion lease invalid';
  END IF;
  IF v_job.phase='freeze' THEN
    UPDATE iam.agencies SET status='deleting',updated_at=clock_timestamp() WHERE id=p_agency_id;
    UPDATE ops.agency_deletion_jobs SET phase='revoke_access' WHERE id=p_job_id;
  ELSIF v_job.phase='revoke_access' THEN
    UPDATE iam.agency_memberships membership SET status='revoked'
    WHERE membership.agency_id=p_agency_id AND membership.status<>'revoked';
    GET DIAGNOSTICS v_count=ROW_COUNT;
    UPDATE iam.invitations SET used_at=COALESCE(used_at,clock_timestamp()) WHERE agency_id=p_agency_id;
    UPDATE ops.agency_deletion_jobs SET phase='delete_objects' WHERE id=p_job_id;
  ELSIF v_job.phase='delete_objects' THEN
    IF EXISTS(SELECT 1 FROM ops.media_assets WHERE agency_id=p_agency_id AND legal_hold) THEN
      UPDATE ops.agency_deletion_jobs SET status='blocked',last_error='Media asset under legal hold',
        locked_at=NULL,locked_by=NULL,lease_expires_at=NULL WHERE id=p_job_id;
    ELSIF NOT EXISTS(SELECT 1 FROM ops.media_assets asset
      WHERE asset.agency_id=p_agency_id AND asset.status<>'deleted') THEN
      UPDATE ops.agency_deletion_jobs SET phase='delete_facts' WHERE id=p_job_id;
    END IF;
  ELSIF v_job.phase='delete_facts' THEN
    WITH targets AS (SELECT id FROM travel.departures WHERE agency_id=p_agency_id
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    DELETE FROM travel.departures departure USING targets WHERE departure.id=targets.id;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count=0 THEN UPDATE ops.agency_deletion_jobs SET phase='delete_departures' WHERE id=p_job_id; END IF;
  ELSIF v_job.phase='delete_departures' THEN
    WITH targets AS (SELECT id FROM ops.platform_jobs WHERE agency_id=p_agency_id
      AND job_type<>'agency.delete' ORDER BY created_at,id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
    DELETE FROM ops.platform_jobs job USING targets WHERE job.id=targets.id;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count=0 THEN
      DELETE FROM ops.generation_runs WHERE agency_id=p_agency_id;
      DELETE FROM ops.import_jobs WHERE agency_id=p_agency_id;
      DELETE FROM ops.travel_documents WHERE agency_id=p_agency_id;
      DELETE FROM ops.media_assets WHERE agency_id=p_agency_id;
      UPDATE ops.agency_deletion_jobs SET phase='delete_templates' WHERE id=p_job_id;
    END IF;
  ELSIF v_job.phase='delete_templates' THEN
    WITH targets AS (SELECT id FROM travel.trip_templates WHERE agency_id=p_agency_id
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    DELETE FROM travel.trip_templates template USING targets WHERE template.id=targets.id;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count=0 THEN UPDATE ops.agency_deletion_jobs SET phase='delete_memberships' WHERE id=p_job_id; END IF;
  ELSIF v_job.phase='delete_memberships' THEN
    WITH targets AS (SELECT id FROM travel.traveler_profiles WHERE agency_id=p_agency_id
      ORDER BY created_at,id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
    DELETE FROM travel.traveler_profiles traveler USING targets WHERE traveler.id=targets.id;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count=0 THEN
      DELETE FROM iam.invitations WHERE agency_id=p_agency_id;
      DELETE FROM iam.agency_memberships WHERE agency_id=p_agency_id;
      UPDATE ops.agency_deletion_jobs SET phase='close_agency' WHERE id=p_job_id;
    END IF;
  ELSIF v_job.phase='close_agency' THEN
    DELETE FROM ops.platform_jobs WHERE agency_id=p_agency_id;
    UPDATE iam.agencies agency SET status='closed',updated_at=clock_timestamp() WHERE agency.id=p_agency_id;
    DELETE FROM iam.agencies agency WHERE agency.id=p_agency_id AND agency.status='closed';
    DELETE FROM iam.users user_row
    WHERE user_row.platform_role<>'superadmin'
      AND user_row.id IN(SELECT value::uuid FROM jsonb_array_elements_text(
        COALESCE(v_job.cursor_state->'candidateUserIds','[]'::jsonb)))
      AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships membership WHERE membership.user_id=user_row.id)
      AND NOT EXISTS(SELECT 1 FROM travel.traveler_profiles traveler WHERE traveler.user_id=user_row.id)
      AND NOT EXISTS(SELECT 1 FROM iam.impersonation_sessions session
        WHERE session.actor_user_id=user_row.id OR session.target_user_id=user_row.id);
    UPDATE ops.agency_deletion_jobs SET status='completed',phase='completed',completed_at=clock_timestamp(),
      locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=p_job_id;
  END IF;
  RETURN QUERY SELECT job.status::text,job.phase::text,v_count FROM ops.agency_deletion_jobs job WHERE job.id=p_job_id;
END $$;

CREATE OR REPLACE FUNCTION app.release_agency_deletion_v3(
  p_job_id UUID,p_agency_id UUID,p_worker_id TEXT,p_error TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.agency_deletion_jobs SET status='queued',available_at=clock_timestamp()+interval '1 minute',
    last_error=left(p_error,1200),locked_at=NULL,locked_by=NULL,lease_expires_at=NULL
  WHERE id=p_job_id AND agency_id=p_agency_id AND status='processing' AND locked_by=p_worker_id;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app.request_agency_deletion_v3(TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_agency_deletion_v3(UUID,UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agency_deletion_assets_v3(UUID,UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_agency_deletion_asset_v3(UUID,UUID,TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.advance_agency_deletion_v3(UUID,UUID,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.release_agency_deletion_v3(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_agency_deletion_v3(TEXT,UUID,TEXT),
 app.claim_agency_deletion_v3(UUID,UUID,TEXT,INTEGER),
 app.read_agency_deletion_assets_v3(UUID,UUID,TEXT,INTEGER),
 app.mark_agency_deletion_asset_v3(UUID,UUID,TEXT,UUID),
 app.advance_agency_deletion_v3(UUID,UUID,TEXT,INTEGER),
 app.release_agency_deletion_v3(UUID,UUID,TEXT,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('048_v3_async_agency_deletion') ON CONFLICT(version) DO NOTHING;
