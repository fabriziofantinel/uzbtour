-- Scritture definitive per job, documenti normalizzati e ciclo di vita import.

CREATE OR REPLACE FUNCTION app.require_agency_editor(
  p_actor_legacy_user_id TEXT,p_agency_id UUID
)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  SELECT actor.id INTO v_actor
  FROM ops.legacy_id_map map
  JOIN iam.users actor ON actor.id=map.target_id AND actor.status='active'
  LEFT JOIN iam.agency_memberships membership
    ON membership.user_id=actor.id AND membership.agency_id=p_agency_id
   AND membership.status='active' AND membership.role IN('owner','admin','editor')
  WHERE map.source_system='public-v2' AND map.entity_type='user'
    AND map.legacy_id=p_actor_legacy_user_id
    AND (actor.platform_role='superadmin' OR membership.user_id IS NOT NULL)
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='agency editor access denied';
  END IF;
  RETURN v_actor;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_import_agency(p_import_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
  SELECT agency_id FROM ops.import_jobs WHERE id=p_import_id
$$;

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
    NOT EXISTS(SELECT 1 FROM travel.trip_templates
      WHERE id=p_template_id AND agency_id=p_agency_id) THEN
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
  FROM ops.import_jobs import_job WHERE import_job.id=v_import;
END $$;

CREATE OR REPLACE FUNCTION app.enqueue_platform_job_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_job_type TEXT,p_provider TEXT,
  p_payload JSONB,p_idempotency_key TEXT,p_available_at TIMESTAMPTZ
)
RETURNS TABLE(id UUID,provider TEXT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
DECLARE v_import UUID;
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  IF p_provider NOT IN('database','sqs') OR jsonb_typeof(p_payload)<>'object'
    OR NULLIF(btrim(p_job_type),'') IS NULL OR NULLIF(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid platform job';
  END IF;
  IF p_payload->>'importId' ~* '^[0-9a-f-]{36}$' THEN
    SELECT import_job.id INTO v_import FROM ops.import_jobs import_job
    WHERE import_job.agency_id=p_agency_id AND import_job.id=(p_payload->>'importId')::uuid;
  END IF;
  RETURN QUERY
  INSERT INTO ops.platform_jobs(agency_id,import_job_id,job_type,provider,status,payload,
    idempotency_key,available_at)
  VALUES(p_agency_id,v_import,btrim(p_job_type),p_provider,'queued',p_payload,
    btrim(p_idempotency_key),COALESCE(p_available_at,clock_timestamp()))
  ON CONFLICT(agency_id,idempotency_key) DO UPDATE SET
    status=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN 'queued'
      ELSE ops.platform_jobs.status END,
    error_message=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN NULL
      ELSE ops.platform_jobs.error_message END,
    available_at=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter')
      THEN EXCLUDED.available_at ELSE ops.platform_jobs.available_at END,
    updated_at=clock_timestamp()
  RETURNING ops.platform_jobs.id,ops.platform_jobs.provider::text,ops.platform_jobs.status::text;
END $$;

CREATE OR REPLACE FUNCTION app.fail_platform_job_dispatch_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_job_id UUID,p_error TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  UPDATE ops.platform_jobs SET status='failed',error_message=left(p_error,1200),
    locked_at=NULL,updated_at=clock_timestamp()
  WHERE id=p_job_id AND agency_id=p_agency_id AND status='queued';
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count=1;
END $$;

CREATE OR REPLACE FUNCTION app.claim_platform_job_v3(
  p_job_id UUID,p_agency_id UUID,p_job_type TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.platform_jobs SET status='processing',locked_at=clock_timestamp(),
    attempt_count=attempt_count+1,error_message=NULL,updated_at=clock_timestamp()
  WHERE id=p_job_id AND agency_id=p_agency_id AND job_type=p_job_type
    AND (status IN('queued','failed') OR
      (status='processing' AND locked_at<clock_timestamp()-interval '10 minutes'));
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.complete_platform_job_v3(p_job_id UUID,p_agency_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.platform_jobs SET status='completed',completed_at=clock_timestamp(),
    locked_at=NULL,error_message=NULL,updated_at=clock_timestamp()
  WHERE id=p_job_id AND agency_id=p_agency_id AND status='processing';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.fail_platform_job_v3(
  p_job_id UUID,p_agency_id UUID,p_error TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.platform_jobs SET status='failed',error_message=left(p_error,1200),
    locked_at=NULL,updated_at=clock_timestamp()
  WHERE id=p_job_id AND agency_id=p_agency_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.claim_import_job_v3(
  p_import_id UUID,p_expected_job_id UUID DEFAULT NULL,p_expected_agency_id UUID DEFAULT NULL
)
RETURNS TABLE(
  id UUID,agency_id UUID,template_id UUID,document_id UUID,provider TEXT,bucket TEXT,
  object_key TEXT,original_name TEXT,content_type TEXT,size_bytes BIGINT,
  uploaded_by_user_id UUID,status TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_job UUID;v_agency UUID;
BEGIN
  SELECT import_job.agency_id INTO v_agency FROM ops.import_jobs import_job
  WHERE import_job.id=p_import_id FOR UPDATE;
  IF v_agency IS NULL OR (p_expected_agency_id IS NOT NULL AND p_expected_agency_id<>v_agency) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='import job not found';
  END IF;
  SELECT job.id INTO v_job
  FROM ops.platform_jobs job
  WHERE job.agency_id=v_agency AND job.job_type='travel-programme.import'
    AND (job.import_job_id=p_import_id OR job.payload->>'importId'=p_import_id::text)
    AND (p_expected_job_id IS NULL OR job.id=p_expected_job_id)
    AND (job.status IN('queued','failed') OR
      (job.status='processing' AND job.locked_at<clock_timestamp()-interval '10 minutes'))
  ORDER BY job.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='import job not claimable';
  END IF;
  UPDATE ops.platform_jobs SET status='processing',locked_at=clock_timestamp(),
    attempt_count=attempt_count+1,error_message=NULL,updated_at=clock_timestamp()
  WHERE ops.platform_jobs.id=v_job;
  UPDATE ops.import_jobs SET status='extracting',attempt_count=attempt_count+1,
    error_message=NULL,started_at=clock_timestamp(),completed_at=NULL,updated_at=clock_timestamp()
  WHERE ops.import_jobs.id=p_import_id;
  RETURN QUERY
  SELECT import_job.id,import_job.agency_id,import_job.template_id,
    import_job.source_document_id,asset.provider::text,asset.bucket,asset.object_key,
    asset.original_name,asset.content_type,asset.size_bytes,asset.uploaded_by_user_id,
    import_job.status::text
  FROM ops.import_jobs import_job
  JOIN ops.travel_documents document ON document.id=import_job.source_document_id
    AND document.agency_id=import_job.agency_id
  JOIN ops.media_assets asset ON asset.id=document.media_asset_id
    AND asset.agency_id=document.agency_id
  WHERE import_job.id=p_import_id;
END $$;

CREATE OR REPLACE FUNCTION app.register_normalized_import_document_v3(
  p_import_id UUID,p_agency_id UUID,p_template_id UUID,p_uploaded_by_user_id UUID,
  p_provider TEXT,p_bucket TEXT,p_object_key TEXT,p_original_name TEXT,p_content_type TEXT,
  p_size_bytes BIGINT,p_checksum_sha256 TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_media UUID;v_document UUID;
BEGIN
  IF p_provider NOT IN('r2','s3') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported normalized document provider';
  END IF;
  INSERT INTO ops.media_assets(agency_id,uploaded_by_user_id,provider,bucket,object_key,
    original_name,content_type,size_bytes,checksum_sha256,purpose,visibility,status,metadata)
  VALUES(p_agency_id,p_uploaded_by_user_id,p_provider,p_bucket,p_object_key,p_original_name,
    p_content_type,p_size_bytes,p_checksum_sha256,'normalized_document','agency','ready',
    jsonb_build_object('format','smf-travel-canonical-v1','sourceImportId',p_import_id))
  ON CONFLICT(provider,bucket,object_key) DO UPDATE SET original_name=EXCLUDED.original_name,
    content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,
    checksum_sha256=EXCLUDED.checksum_sha256,status='ready',metadata=EXCLUDED.metadata,
    deleted_at=NULL,updated_at=clock_timestamp()
  RETURNING id INTO v_media;
  INSERT INTO ops.travel_documents(agency_id,template_id,media_asset_id,document_type,title,status)
  VALUES(p_agency_id,p_template_id,v_media,'normalized_programme',p_original_name,'ready')
  ON CONFLICT(media_asset_id) DO UPDATE SET title=EXCLUDED.title,status='ready'
  RETURNING id INTO v_document;
  UPDATE ops.import_jobs SET normalized_document_id=v_document,updated_at=clock_timestamp()
  WHERE id=p_import_id AND agency_id=p_agency_id AND template_id=p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='import not found'; END IF;
  RETURN v_document;
END $$;

CREATE OR REPLACE FUNCTION app.set_import_generating_v3(p_import_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  UPDATE ops.import_jobs SET status='generating',updated_at=clock_timestamp()
  WHERE id=p_import_id AND status IN('extracting','normalizing');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.complete_import_v3(
  p_import_id UUID,p_draft JSONB,p_model TEXT,p_provider TEXT,p_usage JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_source UUID;v_normalized UUID;
BEGIN
  IF jsonb_typeof(p_draft)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid import result';
  END IF;
  UPDATE ops.import_jobs SET status='ready_for_review',
    result=p_draft||jsonb_build_object('legacyAiProvider',p_model),
    extraction_provider=p_provider,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=p_import_id AND status IN('extracting','normalizing','generating')
  RETURNING agency_id,source_document_id,normalized_document_id
  INTO v_agency,v_source,v_normalized;
  IF v_agency IS NULL THEN RETURN false; END IF;
  UPDATE ops.travel_documents SET status='ready'
  WHERE agency_id=v_agency AND id IN(v_source,v_normalized);
  UPDATE ops.platform_jobs SET status='completed',completed_at=clock_timestamp(),locked_at=NULL,
    payload=payload||jsonb_build_object('usage',COALESCE(p_usage,'{}'::jsonb)),updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND job_type='travel-programme.import'
    AND (import_job_id=p_import_id OR payload->>'importId'=p_import_id::text);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.fail_import_v3(p_import_id UUID,p_error TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_agency UUID;v_source UUID;v_normalized UUID;
BEGIN
  UPDATE ops.import_jobs SET status='failed',error_message=left(p_error,1200),
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=p_import_id
  RETURNING agency_id,source_document_id,normalized_document_id
  INTO v_agency,v_source,v_normalized;
  IF v_agency IS NULL THEN RETURN false; END IF;
  UPDATE ops.travel_documents SET status='failed'
  WHERE agency_id=v_agency AND id IN(v_source,v_normalized);
  UPDATE ops.platform_jobs SET status='failed',error_message=left(p_error,1200),locked_at=NULL,
    updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND job_type='travel-programme.import'
    AND (import_job_id=p_import_id OR payload->>'importId'=p_import_id::text);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.save_import_draft_v3(
  p_actor_legacy_user_id TEXT,p_import_id UUID,p_agency_id UUID,p_draft JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_actor UUID;
BEGIN
  v_actor:=app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
  UPDATE ops.import_jobs SET result=p_draft||jsonb_strip_nulls(jsonb_build_object(
    'legacyAiProvider',result->>'legacyAiProvider')),updated_at=clock_timestamp()
  WHERE id=p_import_id AND agency_id=p_agency_id AND status='ready_for_review';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO ops.audit_events(agency_id,actor_user_id,entity_type,entity_id,action,changes)
  VALUES(p_agency_id,v_actor,'import_job',p_import_id::text,'review_saved','{}');
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.delete_import_draft_v3(
  p_actor_legacy_user_id TEXT,p_import_id UUID,p_agency_id UUID,
  p_document_ids UUID[],p_media_asset_ids UUID[]
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id);
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

REVOKE ALL ON FUNCTION app.require_agency_editor(TEXT,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_import_agency(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_import_document_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_platform_job_dispatch_v3(TEXT,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_platform_job_v3(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_platform_job_v3(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_platform_job_v3(UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_import_job_v3(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_normalized_import_document_v3(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.set_import_generating_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_import_v3(UUID,JSONB,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_import_v3(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_import_draft_v3(TEXT,UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.delete_import_draft_v3(TEXT,UUID,UUID,UUID[],UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.require_agency_editor(TEXT,UUID),app.resolve_import_agency(UUID),
 app.register_import_document_v3(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT),
 app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ),
 app.fail_platform_job_dispatch_v3(TEXT,UUID,UUID,TEXT),app.claim_import_job_v3(UUID,UUID,UUID),
 app.claim_platform_job_v3(UUID,UUID,TEXT),app.complete_platform_job_v3(UUID,UUID),
 app.fail_platform_job_v3(UUID,UUID,TEXT),
 app.register_normalized_import_document_v3(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT),
 app.set_import_generating_v3(UUID),app.complete_import_v3(UUID,JSONB,TEXT,TEXT,JSONB),
 app.fail_import_v3(UUID,TEXT),app.save_import_draft_v3(TEXT,UUID,UUID,JSONB),
 app.delete_import_draft_v3(TEXT,UUID,UUID,UUID[],UUID[]) TO smf_app;
REVOKE SELECT ON ops.legacy_id_map FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('044_v3_ops_import_write_cutover') ON CONFLICT(version) DO NOTHING;
