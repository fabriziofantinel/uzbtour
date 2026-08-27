-- Qualify the trip template scope check because RETURNS TABLE exposes an `id`
-- output variable that otherwise conflicts with travel.trip_templates.id.

CREATE OR REPLACE FUNCTION app.register_import_document_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_template_id UUID,p_provider TEXT,
  p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,p_content_type TEXT,p_size_bytes BIGINT
)
RETURNS TABLE(id UUID,document_id UUID,status TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_actor UUID;v_media UUID;v_document UUID;v_import UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF p_provider NOT IN('r2','s3') OR p_size_bytes<=0 OR
    NOT EXISTS(
      SELECT 1
      FROM travel.trip_templates AS trip_template
      WHERE trip_template.id=p_template_id
        AND trip_template.agency_id=p_agency_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid source document';
  END IF;
  INSERT INTO ops.media_assets(agency_id,uploaded_by_user_id,provider,bucket,object_key,
    original_name,content_type,size_bytes,purpose,visibility,status)
  VALUES(p_agency_id,v_actor,p_provider,p_bucket,p_object_key,p_original_name,p_content_type,
    p_size_bytes,'source_document','agency','ready')
  ON CONFLICT(provider,bucket,object_key) DO UPDATE SET updated_at=clock_timestamp()
  RETURNING ops.media_assets.id INTO v_media;
  INSERT INTO ops.travel_documents(agency_id,template_id,media_asset_id,document_type,title,status)
  VALUES(p_agency_id,p_template_id,v_media,'accepted_quote',p_original_name,'processing')
  ON CONFLICT(media_asset_id) DO UPDATE SET status='processing'
  RETURNING ops.travel_documents.id INTO v_document;
  INSERT INTO ops.import_jobs(agency_id,template_id,source_document_id,status,created_by_user_id)
  VALUES(p_agency_id,p_template_id,v_document,'queued',v_actor)
  ON CONFLICT(source_document_id) DO UPDATE SET updated_at=clock_timestamp()
  RETURNING ops.import_jobs.id INTO v_import;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'import_job',v_import::text,'queued',
    jsonb_build_object('objectKey',p_object_key,'originalName',p_original_name));
  RETURN QUERY SELECT import_job.id,import_job.source_document_id,import_job.status::text,import_job.created_at
  FROM ops.import_jobs AS import_job WHERE import_job.id=v_import;
END $$;

REVOKE ALL ON FUNCTION app.register_import_document_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_import_document_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('064_v3_import_document_template_scope_fix') ON CONFLICT(version) DO NOTHING;
