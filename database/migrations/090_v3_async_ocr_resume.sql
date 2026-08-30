CREATE OR REPLACE FUNCTION app.mark_import_ocr_pending_v3(p_import_id UUID,p_textract_job_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_agency UUID;
BEGIN
  IF NULLIF(btrim(p_textract_job_id),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid textract job id';
  END IF;
  UPDATE ops.import_jobs SET status='extracting',extraction_provider='amazon-textract',
    updated_at=clock_timestamp() WHERE id=p_import_id AND status='extracting'
    RETURNING agency_id INTO v_agency;
  IF v_agency IS NULL THEN RETURN false; END IF;
  UPDATE ops.platform_jobs SET external_id=p_textract_job_id,
    payload=payload||jsonb_build_object('ocrStatus','pending'),locked_at=NULL,
    updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND job_type='travel-programme.import'
    AND (import_job_id=p_import_id OR payload->>'importId'=p_import_id::text)
    AND status='processing';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION app.resume_import_ocr_v3(p_import_id UUID,p_textract_job_id TEXT)
RETURNS TABLE(id UUID,agency_id UUID,template_id UUID,document_id UUID,provider TEXT,bucket TEXT,
  object_key TEXT,original_name TEXT,content_type TEXT,size_bytes BIGINT,
  uploaded_by_user_id UUID,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE v_agency UUID;
BEGIN
  SELECT import_job.agency_id INTO v_agency FROM ops.import_jobs import_job
  WHERE import_job.id=p_import_id AND import_job.status='extracting' FOR UPDATE;
  IF v_agency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ocr import not found';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs job
    WHERE job.agency_id=v_agency AND job.job_type='travel-programme.import'
      AND (job.import_job_id=p_import_id OR job.payload->>'importId'=p_import_id::text)
      AND job.status='processing' AND job.external_id=p_textract_job_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ocr completion does not match import';
  END IF;
  UPDATE ops.platform_jobs SET locked_at=clock_timestamp(),
    payload=payload||jsonb_build_object('ocrStatus','completed'),updated_at=clock_timestamp()
  WHERE agency_id=v_agency AND job_type='travel-programme.import'
    AND (import_job_id=p_import_id OR payload->>'importId'=p_import_id::text)
    AND external_id=p_textract_job_id;
  RETURN QUERY SELECT import_job.id,import_job.agency_id,import_job.template_id,
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

REVOKE ALL ON FUNCTION app.mark_import_ocr_pending_v3(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resume_import_ocr_v3(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_import_ocr_pending_v3(UUID,TEXT),
  app.resume_import_ocr_v3(UUID,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('090_v3_async_ocr_resume') ON CONFLICT(version) DO NOTHING;
