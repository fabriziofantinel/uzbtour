CREATE OR REPLACE FUNCTION app.enqueue_platform_job_v3(
  p_actor_legacy_user_id TEXT,p_agency_id UUID,p_job_type TEXT,p_provider TEXT,
  p_payload JSONB,p_idempotency_key TEXT,p_available_at TIMESTAMPTZ)
RETURNS TABLE(id UUID,provider TEXT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,ops SET row_security=off AS $$
DECLARE v_import UUID;v_actor UUID;v_limit INTEGER;v_active INTEGER;
BEGIN
  IF p_provider NOT IN('database','sqs') OR jsonb_typeof(p_payload)<>'object'
    OR NULLIF(btrim(p_job_type),'') IS NULL OR NULLIF(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid platform job';END IF;
  IF p_job_type IN('photo-evidence.validate','photo-contest.evaluate') THEN
    SELECT map.target_id INTO v_actor FROM ops.legacy_id_map map
    JOIN travel.traveler_profiles profile ON profile.user_id=map.target_id AND profile.agency_id=p_agency_id
    JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
      AND membership.traveler_id=profile.id AND membership.departure_id=(p_payload->>'departureId')::uuid
      AND membership.party_id=(p_payload->>'partyId')::uuid AND membership.status='active'
    WHERE map.source_system='public-v2' AND map.entity_type='user' AND map.legacy_id=p_actor_legacy_user_id LIMIT 1;
    IF v_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler job is outside actor scope';END IF;
  ELSE PERFORM app.require_agency_editor(p_actor_legacy_user_id,p_agency_id); END IF;

  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs job WHERE job.agency_id=p_agency_id
    AND job.idempotency_key=btrim(p_idempotency_key)) THEN
    v_limit:=CASE p_job_type WHEN 'travel-programme.import' THEN 2 WHEN 'travel-reference.enrich' THEN 3
      WHEN 'agency.delete' THEN 1 WHEN 'photo-evidence.validate' THEN 20
      WHEN 'photo-contest.evaluate' THEN 10 ELSE 5 END;
    SELECT count(*) INTO v_active FROM ops.platform_jobs job WHERE job.agency_id=p_agency_id
      AND job.job_type=p_job_type AND job.status IN('queued','processing');
    IF v_active>=v_limit THEN RAISE EXCEPTION USING ERRCODE='53300',
      MESSAGE='tenant workload quota exceeded',DETAIL=format('job_type=%s limit=%s',p_job_type,v_limit);END IF;
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
REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('131_v3_tenant_workload_quotas') ON CONFLICT(version) DO NOTHING;
