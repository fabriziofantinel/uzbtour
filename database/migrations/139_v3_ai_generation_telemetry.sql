CREATE TABLE IF NOT EXISTS ops.ai_model_prices (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  model_id TEXT NOT NULL,
  region TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  input_cost_microusd_per_million BIGINT NOT NULL CHECK (input_cost_microusd_per_million>=0),
  output_cost_microusd_per_million BIGINT NOT NULL CHECK (output_cost_microusd_per_million>=0),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_until>valid_from),
  UNIQUE(model_id,region,valid_from)
);

REVOKE ALL ON ops.ai_model_prices FROM PUBLIC,smf_app;

ALTER TABLE ops.generation_runs
  ADD COLUMN IF NOT EXISTS platform_job_id UUID,
  ADD COLUMN IF NOT EXISTS operation TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS invocation_count INTEGER NOT NULL DEFAULT 1 CHECK(invocation_count>0);

DO $migration$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='ops.generation_runs'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'
  LOOP
    EXECUTE format('ALTER TABLE ops.generation_runs DROP CONSTRAINT %I',constraint_row.conname);
  END LOOP;
END
$migration$;

ALTER TABLE ops.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_platform_job_fk,
  ADD CONSTRAINT generation_runs_platform_job_fk
    FOREIGN KEY(platform_job_id) REFERENCES ops.platform_jobs(id) ON DELETE CASCADE,
  ADD CONSTRAINT generation_runs_single_parent_ck
    CHECK(num_nonnulls(import_job_id,reference_content_id,platform_job_id)=1);

CREATE INDEX IF NOT EXISTS generation_runs_platform_job_idx
  ON ops.generation_runs(agency_id,platform_job_id,created_at);

CREATE OR REPLACE FUNCTION app.record_ai_generation_v3(
  p_agency UUID,p_platform_job UUID,p_provider TEXT,p_model TEXT,p_operation TEXT,
  p_region TEXT,p_prompt_hash TEXT,p_status TEXT,p_input_tokens INTEGER,
  p_output_tokens INTEGER,p_invocation_count INTEGER,p_error TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,ops SET row_security=off AS $$
DECLARE v_id UUID;v_cost BIGINT;
BEGIN
  IF p_prompt_hash!~'^[0-9a-f]{64}$' OR p_status NOT IN('completed','failed')
    OR p_input_tokens<0 OR p_output_tokens<0 OR p_invocation_count<1 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid AI generation telemetry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ops.platform_jobs job
    WHERE job.id=p_platform_job AND job.agency_id=p_agency
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='AI generation job does not belong to agency';
  END IF;
  SELECT round((p_input_tokens*price.input_cost_microusd_per_million+
    p_output_tokens*price.output_cost_microusd_per_million)::numeric/1000000)::bigint
  INTO v_cost FROM ops.ai_model_prices price
  WHERE price.model_id=p_model AND price.region=p_region AND price.valid_from<=clock_timestamp()
    AND (price.valid_until IS NULL OR price.valid_until>clock_timestamp())
  ORDER BY price.valid_from DESC LIMIT 1;
  INSERT INTO ops.generation_runs(agency_id,platform_job_id,provider,model,prompt_hash,status,
    input_tokens,output_tokens,cost_microunits,started_at,completed_at,error_message,
    operation,region,invocation_count)
  VALUES(p_agency,p_platform_job,p_provider,p_model,p_prompt_hash,p_status,p_input_tokens,
    p_output_tokens,v_cost,clock_timestamp(),clock_timestamp(),left(p_error,1200),
    p_operation,p_region,p_invocation_count) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.record_ai_generation_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_ai_generation_v3(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('139_v3_ai_generation_telemetry') ON CONFLICT(version) DO NOTHING;
