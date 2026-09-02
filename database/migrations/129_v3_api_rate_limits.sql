CREATE TABLE IF NOT EXISTS ops.api_rate_limit_buckets (
  scope TEXT NOT NULL CHECK(scope ~ '^[a-z0-9_.:-]{1,80}$'),
  key_hash CHAR(64) NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK(request_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(scope,key_hash,bucket_started_at)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_expiry_idx
  ON ops.api_rate_limit_buckets(expires_at);

ALTER TABLE ops.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.api_rate_limit_buckets FROM PUBLIC,smf_app;

CREATE OR REPLACE FUNCTION app.consume_api_rate_limit_v3(
  p_scope TEXT,p_key_hash TEXT,p_limit INTEGER,p_window_seconds INTEGER
) RETURNS TABLE(allowed BOOLEAN,remaining INTEGER,retry_after_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,ops SET row_security=off AS $$
DECLARE
  v_now TIMESTAMPTZ:=clock_timestamp();
  v_bucket TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_scope IS NULL OR p_scope !~ '^[a-z0-9_.:-]{1,80}$'
    OR p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$'
    OR p_limit NOT BETWEEN 1 AND 10000 OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid rate limit policy';
  END IF;
  v_bucket:=to_timestamp(floor(extract(epoch FROM v_now)/p_window_seconds)*p_window_seconds);
  INSERT INTO ops.api_rate_limit_buckets(scope,key_hash,bucket_started_at,request_count,expires_at)
  VALUES(p_scope,p_key_hash,v_bucket,1,v_bucket+make_interval(secs=>p_window_seconds*2))
  ON CONFLICT(scope,key_hash,bucket_started_at) DO UPDATE SET
    request_count=ops.api_rate_limit_buckets.request_count+1,
    expires_at=EXCLUDED.expires_at
  RETURNING request_count INTO v_count;
  DELETE FROM ops.api_rate_limit_buckets
   WHERE scope=p_scope AND key_hash=p_key_hash AND expires_at<v_now;
  RETURN QUERY SELECT v_count<=p_limit,greatest(p_limit-v_count,0),
    CASE WHEN v_count<=p_limit THEN 0
      ELSE greatest(1,ceil(extract(epoch FROM (v_bucket+make_interval(secs=>p_window_seconds)-v_now)))::INTEGER)
    END;
END $$;

REVOKE ALL ON FUNCTION app.consume_api_rate_limit_v3(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_api_rate_limit_v3(TEXT,TEXT,INTEGER,INTEGER) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('129_v3_api_rate_limits') ON CONFLICT(version) DO NOTHING;
