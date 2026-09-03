CREATE OR REPLACE FUNCTION app.request_agency_deletion_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_reason TEXT
)
RETURNS TABLE(job_id UUID,agency_name TEXT,status TEXT,phase TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE v_name TEXT;v_job UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM iam.users WHERE id=p_actor_user_id AND platform_role='superadmin' AND status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='superadmin access denied';
  END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='deletion reason required'; END IF;
  SELECT name INTO v_name FROM iam.agencies WHERE id=p_agency_id FOR UPDATE;
  IF v_name IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='agency not found'; END IF;
  SELECT deletion.id INTO v_job FROM ops.agency_deletion_jobs deletion
  WHERE deletion.agency_id=p_agency_id AND deletion.status IN('queued','processing','blocked')
  ORDER BY deletion.requested_at DESC LIMIT 1;
  IF v_job IS NULL THEN
    UPDATE iam.agencies SET status='deleting',updated_at=clock_timestamp() WHERE id=p_agency_id;
    INSERT INTO ops.agency_deletion_jobs(agency_id,agency_name_snapshot,requested_by_user_id,reason,cursor_state)
    VALUES(p_agency_id,v_name,p_actor_user_id,btrim(p_reason),jsonb_build_object('candidateUserIds',
      COALESCE((SELECT jsonb_agg(DISTINCT user_id) FROM (
        SELECT user_id FROM iam.agency_memberships WHERE agency_id=p_agency_id
        UNION SELECT user_id FROM travel.traveler_profiles
          WHERE agency_id=p_agency_id AND user_id IS NOT NULL) candidate),'[]'::jsonb)))
    RETURNING id INTO v_job;
    INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
    VALUES(p_agency_id,p_actor_user_id,'agency',p_agency_id::text,'deletion_requested',
      jsonb_build_object('jobId',v_job,'reason',btrim(p_reason),'rule','BR-019'));
  END IF;
  RETURN QUERY SELECT deletion.id,deletion.agency_name_snapshot,deletion.status::text,deletion.phase::text
  FROM ops.agency_deletion_jobs deletion WHERE deletion.id=v_job;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_trip_deletion_target_v3(
  p_actor_user_id UUID,p_template_id UUID
)
RETURNS TABLE(id UUID,agency_id UUID,title TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel SET row_security=off AS $$
DECLARE v_agency_id UUID;
BEGIN
  SELECT template.agency_id INTO v_agency_id FROM travel.trip_templates template WHERE template.id=p_template_id;
  IF v_agency_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='trip template not found'; END IF;
  PERFORM app.require_agency_editor_v3(p_actor_user_id,v_agency_id);
  RETURN QUERY SELECT template.id,template.agency_id,template.title::text
  FROM travel.trip_templates template WHERE template.id=p_template_id AND template.agency_id=v_agency_id;
END $$;

CREATE OR REPLACE FUNCTION app.read_trip_deletion_assets_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_template_id UUID
)
RETURNS TABLE(id UUID,provider TEXT,bucket TEXT,object_key TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  IF NOT EXISTS(SELECT 1 FROM travel.trip_templates template
    WHERE template.id=p_template_id AND template.agency_id=p_agency_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='trip template not found';
  END IF;
  RETURN QUERY
  SELECT DISTINCT asset.id,asset.provider::text,asset.bucket,asset.object_key
  FROM ops.media_assets asset
  LEFT JOIN ops.travel_documents document ON document.media_asset_id=asset.id AND document.agency_id=asset.agency_id
  WHERE asset.agency_id=p_agency_id AND (document.template_id=p_template_id OR asset.departure_id IN(
    SELECT departure.id FROM travel.departures departure
    WHERE departure.agency_id=p_agency_id AND departure.template_id=p_template_id));
END $$;

CREATE OR REPLACE FUNCTION app.delete_trip_template_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_template_id UUID,p_media_asset_ids UUID[]
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,content,journey,privacy,ops SET row_security=off AS $$
DECLARE v_title TEXT;
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  SELECT title INTO v_title FROM travel.trip_templates
  WHERE id=p_template_id AND agency_id=p_agency_id FOR UPDATE;
  IF v_title IS NULL THEN RETURN false; END IF;
  DELETE FROM ops.platform_jobs job WHERE job.agency_id=p_agency_id AND (
    job.import_job_id IN(SELECT id FROM ops.import_jobs WHERE agency_id=p_agency_id AND template_id=p_template_id)
    OR job.payload->>'templateId'=p_template_id::text);
  DELETE FROM ops.generation_runs run WHERE run.agency_id=p_agency_id
    AND run.import_job_id IN(SELECT id FROM ops.import_jobs WHERE agency_id=p_agency_id AND template_id=p_template_id);
  DELETE FROM ops.import_jobs WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM ops.travel_documents WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM travel.departures WHERE agency_id=p_agency_id AND template_id=p_template_id;
  DELETE FROM travel.trip_templates WHERE agency_id=p_agency_id AND id=p_template_id;
  DELETE FROM ops.media_assets WHERE agency_id=p_agency_id
    AND id=ANY(COALESCE(p_media_asset_ids,ARRAY[]::uuid[]));
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_user_id,'trip_template',p_template_id::text,'deleted',
    jsonb_build_object('title',v_title,'deletedAssets',cardinality(COALESCE(p_media_asset_ids,ARRAY[]::uuid[])),'source','travel-v3'));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.request_agency_deletion_v3(TEXT,UUID,TEXT),
  app.resolve_trip_deletion_target_v3(TEXT,UUID),app.read_trip_deletion_assets_v3(TEXT,UUID,UUID),
  app.delete_trip_template_v3(TEXT,UUID,UUID,UUID[]) FROM smf_app;
REVOKE ALL ON FUNCTION app.request_agency_deletion_v3(UUID,UUID,TEXT),
  app.resolve_trip_deletion_target_v3(UUID,UUID),app.read_trip_deletion_assets_v3(UUID,UUID,UUID),
  app.delete_trip_template_v3(UUID,UUID,UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_agency_deletion_v3(UUID,UUID,TEXT),
  app.resolve_trip_deletion_target_v3(UUID,UUID),app.read_trip_deletion_assets_v3(UUID,UUID,UUID),
  app.delete_trip_template_v3(UUID,UUID,UUID,UUID[]) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('160_v3_native_deletion_lifecycle') ON CONFLICT(version) DO NOTHING;
