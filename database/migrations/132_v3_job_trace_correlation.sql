CREATE INDEX IF NOT EXISTS platform_jobs_trace_idx
  ON ops.platform_jobs ((payload->>'_traceId'),created_at DESC)
  WHERE payload ? '_traceId';
INSERT INTO public.platform_schema_migrations(version)
VALUES('132_v3_job_trace_correlation') ON CONFLICT(version) DO NOTHING;
