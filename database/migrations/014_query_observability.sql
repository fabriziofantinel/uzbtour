-- SMF Travel - statistiche aggregate delle query PostgreSQL.
-- Neon supporta pg_stat_statements e mantiene il preload necessario.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

INSERT INTO platform_schema_migrations (version)
VALUES ('014_query_observability')
ON CONFLICT (version) DO NOTHING;
