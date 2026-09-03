CREATE TABLE IF NOT EXISTS ops.application_error_events (
  error_id UUID PRIMARY KEY,
  environment VARCHAR(32) NOT NULL,
  deployment_id TEXT,
  error_type VARCHAR(160) NOT NULL,
  fingerprint CHAR(64) NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
  digest TEXT,
  trace_id UUID,
  layer VARCHAR(40),
  route_path TEXT,
  http_method VARCHAR(12),
  context JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(context)='object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS application_error_fingerprint_period_idx
  ON ops.application_error_events(fingerprint,occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_error_environment_period_idx
  ON ops.application_error_events(environment,occurred_at DESC);
CREATE INDEX IF NOT EXISTS application_error_trace_idx
  ON ops.application_error_events(trace_id) WHERE trace_id IS NOT NULL;

REVOKE ALL ON ops.application_error_events FROM PUBLIC,smf_app;

CREATE OR REPLACE FUNCTION app.record_application_error_v3(
  p_error_id UUID,p_environment TEXT,p_deployment_id TEXT,p_error_type TEXT,
  p_fingerprint TEXT,p_digest TEXT,p_trace_id UUID,p_layer TEXT,p_route_path TEXT,
  p_http_method TEXT,p_context JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
BEGIN
  IF p_environment='' OR p_error_type='' OR p_fingerprint!~'^[0-9a-f]{64}$'
    OR jsonb_typeof(COALESCE(p_context,'{}'::jsonb))<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid application error telemetry';
  END IF;
  INSERT INTO ops.application_error_events(
    error_id,environment,deployment_id,error_type,fingerprint,digest,trace_id,
    layer,route_path,http_method,context
  ) VALUES(
    p_error_id,left(p_environment,32),left(p_deployment_id,200),left(p_error_type,160),
    p_fingerprint,left(p_digest,200),p_trace_id,left(p_layer,40),left(p_route_path,500),
    left(upper(p_http_method),12),COALESCE(p_context,'{}'::jsonb)
  ) ON CONFLICT(error_id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION app.record_application_error_v3(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_application_error_v3(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,JSONB) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('145_v3_application_error_collector') ON CONFLICT(version) DO NOTHING;
