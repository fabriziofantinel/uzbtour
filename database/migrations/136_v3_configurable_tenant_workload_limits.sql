CREATE TABLE IF NOT EXISTS ops.tenant_workload_limits (
  agency_id UUID REFERENCES iam.agencies(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (btrim(job_type) <> ''),
  active_limit INTEGER NOT NULL CHECK (active_limit > 0),
  daily_limit INTEGER NOT NULL CHECK (daily_limit > 0),
  monthly_limit INTEGER NOT NULL CHECK (monthly_limit > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by UUID REFERENCES iam.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_workload_limits_platform_job_type_uq
  ON ops.tenant_workload_limits(job_type)
  WHERE agency_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_workload_limits_agency_job_type_uq
  ON ops.tenant_workload_limits(agency_id, job_type)
  WHERE agency_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS platform_jobs_agency_job_type_created_at_idx
  ON ops.platform_jobs(agency_id, job_type, created_at DESC);

REVOKE ALL ON TABLE ops.tenant_workload_limits FROM PUBLIC, smf_app;

INSERT INTO ops.tenant_workload_limits(
  agency_id,
  job_type,
  active_limit,
  daily_limit,
  monthly_limit
)
VALUES
  (NULL, 'travel-programme.import', 2, 10, 100),
  (NULL, 'travel-reference.enrich', 3, 20, 300),
  (NULL, 'agency.delete', 1, 3, 20),
  (NULL, 'photo-evidence.validate', 20, 200, 3000),
  (NULL, 'photo-contest.evaluate', 10, 100, 1500),
  (NULL, '*', 5, 100, 2000)
ON CONFLICT (job_type) WHERE agency_id IS NULL DO UPDATE
SET active_limit = EXCLUDED.active_limit,
    daily_limit = EXCLUDED.daily_limit,
    monthly_limit = EXCLUDED.monthly_limit,
    updated_at = clock_timestamp();

CREATE OR REPLACE FUNCTION app.enqueue_platform_job_v3(
  p_actor_legacy_user_id TEXT,
  p_agency_id UUID,
  p_job_type TEXT,
  p_provider TEXT,
  p_payload JSONB,
  p_idempotency_key TEXT,
  p_available_at TIMESTAMPTZ
)
RETURNS TABLE(id UUID, provider TEXT, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, travel, ops
SET row_security = off
AS $$
DECLARE
  v_import UUID;
  v_actor UUID;
  v_active_limit INTEGER;
  v_active INTEGER;
  v_daily_limit INTEGER;
  v_monthly_limit INTEGER;
  v_daily INTEGER;
  v_monthly INTEGER;
BEGIN
  IF p_provider NOT IN ('database', 'sqs')
    OR jsonb_typeof(p_payload) <> 'object'
    OR NULLIF(btrim(p_job_type), '') IS NULL
    OR NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid platform job';
  END IF;

  IF p_job_type IN ('photo-evidence.validate', 'photo-contest.evaluate') THEN
    SELECT map.target_id
    INTO v_actor
    FROM ops.legacy_id_map map
    JOIN travel.traveler_profiles profile
      ON profile.user_id = map.target_id
      AND profile.agency_id = p_agency_id
    JOIN travel.party_memberships membership
      ON membership.agency_id = profile.agency_id
      AND membership.traveler_id = profile.id
      AND membership.departure_id = (p_payload ->> 'departureId')::uuid
      AND membership.party_id = (p_payload ->> 'partyId')::uuid
      AND membership.status = 'active'
    WHERE map.source_system = 'public-v2'
      AND map.entity_type = 'user'
      AND map.legacy_id = p_actor_legacy_user_id
    LIMIT 1;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'traveler job is outside actor scope';
    END IF;
  ELSE
    PERFORM app.require_agency_editor(p_actor_legacy_user_id, p_agency_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM ops.platform_jobs job
    WHERE job.agency_id = p_agency_id
      AND job.idempotency_key = btrim(p_idempotency_key)
  ) THEN
    SELECT limits.active_limit, limits.daily_limit, limits.monthly_limit
    INTO v_active_limit, v_daily_limit, v_monthly_limit
    FROM ops.tenant_workload_limits limits
    WHERE (limits.agency_id = p_agency_id OR limits.agency_id IS NULL)
      AND (limits.job_type = p_job_type OR limits.job_type = '*')
    ORDER BY
      (limits.agency_id = p_agency_id) DESC,
      (limits.job_type = p_job_type) DESC
    LIMIT 1;

    v_active_limit := COALESCE(v_active_limit, 5);
    v_daily_limit := COALESCE(v_daily_limit, 100);
    v_monthly_limit := COALESCE(v_monthly_limit, 2000);

    SELECT
      count(*) FILTER (WHERE job.status IN ('queued', 'processing')),
      count(*) FILTER (
        WHERE job.created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      ),
      count(*) FILTER (
        WHERE job.created_at >= date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
    INTO v_active, v_daily, v_monthly
    FROM ops.platform_jobs job
    WHERE job.agency_id = p_agency_id
      AND job.job_type = p_job_type;

    IF v_active >= v_active_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '53300',
        MESSAGE = 'tenant workload quota exceeded',
        DETAIL = format('window=active job_type=%s used=%s limit=%s', p_job_type, v_active, v_active_limit);
    END IF;
    IF v_daily >= v_daily_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '53300',
        MESSAGE = 'tenant cumulative workload budget exceeded',
        DETAIL = format('window=daily job_type=%s used=%s limit=%s', p_job_type, v_daily, v_daily_limit);
    END IF;
    IF v_monthly >= v_monthly_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '53300',
        MESSAGE = 'tenant cumulative workload budget exceeded',
        DETAIL = format('window=monthly job_type=%s used=%s limit=%s', p_job_type, v_monthly, v_monthly_limit);
    END IF;
  END IF;

  IF p_payload ->> 'importId' ~* '^[0-9a-f-]{36}$' THEN
    SELECT import_job.id
    INTO v_import
    FROM ops.import_jobs import_job
    WHERE import_job.agency_id = p_agency_id
      AND import_job.id = (p_payload ->> 'importId')::uuid;
  END IF;

  RETURN QUERY
  INSERT INTO ops.platform_jobs(
    agency_id,
    import_job_id,
    job_type,
    provider,
    status,
    payload,
    idempotency_key,
    available_at
  )
  VALUES (
    p_agency_id,
    v_import,
    btrim(p_job_type),
    p_provider,
    'queued',
    p_payload,
    btrim(p_idempotency_key),
    COALESCE(p_available_at, clock_timestamp())
  )
  ON CONFLICT (agency_id, idempotency_key) DO UPDATE
  SET status = CASE
        WHEN ops.platform_jobs.status IN ('failed', 'dead_letter') THEN 'queued'
        ELSE ops.platform_jobs.status
      END,
      error_message = CASE
        WHEN ops.platform_jobs.status IN ('failed', 'dead_letter') THEN NULL
        ELSE ops.platform_jobs.error_message
      END,
      available_at = CASE
        WHEN ops.platform_jobs.status IN ('failed', 'dead_letter') THEN EXCLUDED.available_at
        ELSE ops.platform_jobs.available_at
      END,
      updated_at = clock_timestamp()
  RETURNING ops.platform_jobs.id, ops.platform_jobs.provider::text, ops.platform_jobs.status::text;
END
$$;

REVOKE ALL ON FUNCTION app.enqueue_platform_job_v3(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_platform_job_v3(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES ('136_v3_configurable_tenant_workload_limits')
ON CONFLICT (version) DO NOTHING;
