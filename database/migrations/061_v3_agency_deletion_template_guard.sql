-- Allow cascade cleanup only while an agency is in the governed BR-019 deletion workflow.

CREATE OR REPLACE FUNCTION app.assert_template_version_mutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops AS $$
DECLARE v_agency UUID;v_version UUID;v_status TEXT;v_job UUID;
BEGIN
  IF pg_trigger_depth()>1 AND current_setting('app.legacy_sync',true)='on' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_agency:=CASE WHEN TG_OP='DELETE' THEN OLD.agency_id ELSE NEW.agency_id END;
  v_version:=CASE WHEN TG_OP='DELETE' THEN OLD.template_version_id ELSE NEW.template_version_id END;
  IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM iam.agencies agency
    WHERE agency.id=v_agency AND agency.status='deleting') THEN
    RETURN OLD;
  END IF;
  v_job:=NULLIF(current_setting('app.materialization_job_id',true),'')::uuid;
  IF v_job IS NOT NULL AND EXISTS(
    SELECT 1 FROM ops.platform_jobs job
    JOIN travel.trip_template_versions version ON version.id=v_version AND version.agency_id=v_agency
    WHERE job.id=v_job AND job.agency_id=v_agency AND job.job_type='travel-reference.enrich'
      AND job.status='processing' AND job.payload->>'templateId'=version.template_id::text
  ) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text,0));
  SELECT status INTO v_status FROM travel.trip_template_versions WHERE agency_id=v_agency AND id=v_version;
  IF v_status IS NULL THEN RAISE EXCEPTION 'template version % not found in tenant %',v_version,v_agency; END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'template version % is immutable in status %',v_version,v_status; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

REVOKE ALL ON FUNCTION app.assert_template_version_mutable() FROM PUBLIC;

INSERT INTO public.platform_schema_migrations(version)
VALUES('061_v3_agency_deletion_template_guard') ON CONFLICT(version) DO NOTHING;
