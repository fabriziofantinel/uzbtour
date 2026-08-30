-- Install pgcrypto in a dedicated, owner-controlled schema. SECURITY DEFINER
-- functions keep their restricted search_path and reach it through app.digest.
CREATE SCHEMA IF NOT EXISTS extensions;
REVOKE CREATE ON SCHEMA extensions FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION app.digest(p_value TEXT,p_algorithm TEXT)
RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path=pg_catalog
AS 'SELECT extensions.digest($1,$2)';

REVOKE ALL ON FUNCTION app.digest(TEXT,TEXT) FROM PUBLIC;

COMMENT ON FUNCTION app.digest(TEXT,TEXT) IS
  'Schema-qualified bridge to pgcrypto digest for hardened app SECURITY DEFINER functions.';

INSERT INTO public.platform_schema_migrations(version)
VALUES('109_v3_pgcrypto_digest_contract') ON CONFLICT(version) DO NOTHING;
