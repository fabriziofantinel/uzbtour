CREATE OR REPLACE FUNCTION app.register_import_document_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_template_id UUID,p_provider TEXT,
  p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(id UUID,document_id UUID,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_media UUID;v_document UUID;v_import UUID;
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  IF p_provider NOT IN('r2','s3') OR p_size_bytes<=0 OR NOT EXISTS(
    SELECT 1 FROM travel.trip_templates template
    WHERE template.id=p_template_id AND template.agency_id=p_agency_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid source document';
  END IF;
  INSERT INTO ops.media_assets(agency_id,uploaded_by_user_id,provider,bucket,object_key,
    original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_agency_id,p_actor_user_id,p_provider,p_bucket,p_object_key,p_original_name,p_content_type,
    p_size_bytes,'source_document','agency','ready')
  ON CONFLICT(provider,bucket,object_key) DO UPDATE SET updated_at=clock_timestamp()
  RETURNING ops.media_assets.id INTO v_media;
  INSERT INTO ops.travel_documents(agency_id,template_id,media_asset_id,document_type,title,status)
  VALUES(p_agency_id,p_template_id,v_media,'accepted_quote',p_original_name,'processing')
  ON CONFLICT(media_asset_id) DO UPDATE SET status='processing'
  RETURNING ops.travel_documents.id INTO v_document;
  INSERT INTO ops.import_jobs(agency_id,template_id,source_document_id,status,created_by_user_id)
  VALUES(p_agency_id,p_template_id,v_document,'queued',p_actor_user_id)
  ON CONFLICT(source_document_id) DO UPDATE SET updated_at=clock_timestamp()
  RETURNING ops.import_jobs.id INTO v_import;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_user_id,'import_job',v_import::text,'queued',
    jsonb_build_object('objectKey',p_object_key,'originalName',p_original_name));
  RETURN QUERY SELECT job.id,job.source_document_id,job.status::text,job.created_at
  FROM ops.import_jobs job WHERE job.id=v_import;
END $$;

CREATE OR REPLACE FUNCTION app.save_import_draft_v3(
  p_actor_user_id UUID,p_import_id UUID,p_agency_id UUID,p_draft JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  UPDATE ops.import_jobs SET result=p_draft||jsonb_strip_nulls(jsonb_build_object(
    'legacyAiProvider',result->>'legacyAiProvider')),updated_at=clock_timestamp()
  WHERE id=p_import_id AND agency_id=p_agency_id AND status='ready_for_review';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,p_actor_user_id,'import_job',p_import_id::text,'review_saved','{}');
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.delete_import_draft_v3(
  p_actor_user_id UUID,p_import_id UUID,p_agency_id UUID,p_document_ids UUID[],p_media_asset_ids UUID[]
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  DELETE FROM ops.audit_events WHERE agency_id=p_agency_id
    AND entity_type='import_job' AND entity_id=p_import_id::text;
  DELETE FROM ops.platform_jobs WHERE agency_id=p_agency_id
    AND (import_job_id=p_import_id OR payload->>'importId'=p_import_id::text);
  DELETE FROM ops.import_jobs WHERE id=p_import_id AND agency_id=p_agency_id
    AND status IN('ready_for_review','failed');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RETURN false; END IF;
  DELETE FROM ops.travel_documents WHERE agency_id=p_agency_id AND id=ANY(p_document_ids);
  DELETE FROM ops.media_assets WHERE agency_id=p_agency_id AND id=ANY(p_media_asset_ids);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.register_import_document_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
  app.save_import_draft_v3(TEXT,UUID,UUID,JSONB),app.delete_import_draft_v3(TEXT,UUID,UUID,UUID[],UUID[]) FROM smf_app;
REVOKE ALL ON FUNCTION app.register_import_document_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
  app.save_import_draft_v3(UUID,UUID,UUID,JSONB),app.delete_import_draft_v3(UUID,UUID,UUID,UUID[],UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_import_document_v3(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
  app.save_import_draft_v3(UUID,UUID,UUID,JSONB),app.delete_import_draft_v3(UUID,UUID,UUID,UUID[],UUID[]) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('161_v3_native_import_draft_lifecycle') ON CONFLICT(version) DO NOTHING;
