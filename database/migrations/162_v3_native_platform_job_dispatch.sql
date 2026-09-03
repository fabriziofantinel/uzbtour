CREATE OR REPLACE FUNCTION app.enqueue_platform_job_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_job_type TEXT,p_provider TEXT,p_payload JSONB,
  p_idempotency_key TEXT,p_available_at TIMESTAMPTZ
)
RETURNS TABLE(id UUID,provider TEXT,status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,travel,ops SET row_security=off AS $$
DECLARE v_import UUID;v_active_limit INTEGER;v_active INTEGER;v_daily_limit INTEGER;
  v_monthly_limit INTEGER;v_daily INTEGER;v_monthly INTEGER;
BEGIN
  IF p_provider NOT IN('database','sqs') OR jsonb_typeof(p_payload)<>'object'
    OR NULLIF(btrim(p_job_type),'') IS NULL OR NULLIF(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid platform job';
  END IF;
  IF p_job_type IN('photo-evidence.validate','photo-contest.evaluate') THEN
    IF NOT EXISTS(SELECT 1 FROM travel.traveler_profiles profile
      JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id
        AND membership.traveler_id=profile.id
        AND membership.departure_id=(p_payload->>'departureId')::uuid
        AND membership.party_id=(p_payload->>'partyId')::uuid AND membership.status='active'
      WHERE profile.user_id=p_actor_user_id AND profile.agency_id=p_agency_id) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler job is outside actor scope';
    END IF;
  ELSE
    PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ops.platform_jobs job
    WHERE job.agency_id=p_agency_id AND job.idempotency_key=btrim(p_idempotency_key)) THEN
    SELECT limits.active_limit,limits.daily_limit,limits.monthly_limit
    INTO v_active_limit,v_daily_limit,v_monthly_limit FROM ops.tenant_workload_limits limits
    WHERE (limits.agency_id=p_agency_id OR limits.agency_id IS NULL)
      AND (limits.job_type=p_job_type OR limits.job_type='*')
    ORDER BY (limits.agency_id=p_agency_id) DESC,(limits.job_type=p_job_type) DESC LIMIT 1;
    v_active_limit:=COALESCE(v_active_limit,5);v_daily_limit:=COALESCE(v_daily_limit,100);
    v_monthly_limit:=COALESCE(v_monthly_limit,2000);
    SELECT count(*) FILTER(WHERE job.status IN('queued','processing')),
      count(*) FILTER(WHERE job.created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
      count(*) FILTER(WHERE job.created_at>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    INTO v_active,v_daily,v_monthly FROM ops.platform_jobs job
    WHERE job.agency_id=p_agency_id AND job.job_type=p_job_type;
    IF v_active>=v_active_limit THEN RAISE EXCEPTION USING ERRCODE='53300',MESSAGE='tenant workload quota exceeded',
      DETAIL=format('window=active job_type=%s used=%s limit=%s',p_job_type,v_active,v_active_limit); END IF;
    IF v_daily>=v_daily_limit THEN RAISE EXCEPTION USING ERRCODE='53300',MESSAGE='tenant cumulative workload budget exceeded',
      DETAIL=format('window=daily job_type=%s used=%s limit=%s',p_job_type,v_daily,v_daily_limit); END IF;
    IF v_monthly>=v_monthly_limit THEN RAISE EXCEPTION USING ERRCODE='53300',MESSAGE='tenant cumulative workload budget exceeded',
      DETAIL=format('window=monthly job_type=%s used=%s limit=%s',p_job_type,v_monthly,v_monthly_limit); END IF;
  END IF;
  IF p_payload->>'importId' ~* '^[0-9a-f-]{36}$' THEN SELECT job.id INTO v_import FROM ops.import_jobs job
    WHERE job.agency_id=p_agency_id AND job.id=(p_payload->>'importId')::uuid; END IF;
  RETURN QUERY INSERT INTO ops.platform_jobs(agency_id,import_job_id,job_type,provider,status,payload,idempotency_key,available_at)
  VALUES(p_agency_id,v_import,btrim(p_job_type),p_provider,'queued',p_payload,btrim(p_idempotency_key),
    COALESCE(p_available_at,clock_timestamp()))
  ON CONFLICT(agency_id,idempotency_key) DO UPDATE SET
    status=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN 'queued' ELSE ops.platform_jobs.status END,
    error_message=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN NULL ELSE ops.platform_jobs.error_message END,
    available_at=CASE WHEN ops.platform_jobs.status IN('failed','dead_letter') THEN EXCLUDED.available_at ELSE ops.platform_jobs.available_at END,
    updated_at=clock_timestamp()
  RETURNING ops.platform_jobs.id,ops.platform_jobs.provider::text,ops.platform_jobs.status::text;
END $$;

CREATE OR REPLACE FUNCTION app.fail_platform_job_dispatch_v3(
  p_actor_user_id UUID,p_agency_id UUID,p_job_id UUID,p_error TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,ops SET row_security=off AS $$
DECLARE v_count INTEGER;
BEGIN
  PERFORM app.require_agency_editor_v3(p_actor_user_id,p_agency_id);
  UPDATE ops.platform_jobs SET status='failed',error_message=left(p_error,1200),locked_at=NULL,updated_at=clock_timestamp()
  WHERE id=p_job_id AND agency_id=p_agency_id AND status='queued';
  GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count=1;
END $$;

REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(TEXT,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ),
  app.fail_platform_job_dispatch_v3(TEXT,UUID,UUID,TEXT) FROM smf_app;
REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(UUID,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ),
  app.fail_platform_job_dispatch_v3(UUID,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_platform_job_v3(UUID,UUID,TEXT,TEXT,JSONB,TEXT,TIMESTAMPTZ),
  app.fail_platform_job_dispatch_v3(UUID,UUID,UUID,TEXT) TO smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('162_v3_native_platform_job_dispatch') ON CONFLICT(version) DO NOTHING;
