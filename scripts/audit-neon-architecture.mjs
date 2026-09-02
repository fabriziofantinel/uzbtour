import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_DIRECT_URL, DATABASE_URL_UNPOOLED o DATABASE_URL non configurata");
}

const endpoint = new URL(databaseUrl);
const sql = neon(databaseUrl);

const [
  version,
  database,
  extensions,
  tables,
  indexes,
  foreignKeysWithoutLeadingIndex,
  settings,
  runtimeRole,
  runtimePrivileges,
  integrity,
  cache,
  migrations,
] = await Promise.all([
  sql`SELECT version() AS version`,
  sql`
    SELECT current_database() AS database_name,
      pg_database_size(current_database())::bigint AS database_bytes,
      current_setting('TimeZone') AS timezone
  `,
  sql`
    SELECT extname, extversion
    FROM pg_extension
    ORDER BY extname
  `,
  sql`
    SELECT relname AS table_name,
      n_live_tup::bigint AS estimated_rows,
      n_dead_tup::bigint AS dead_rows,
      seq_scan::bigint,
      idx_scan::bigint,
      pg_total_relation_size(relid)::bigint AS total_bytes,
      pg_indexes_size(relid)::bigint AS index_bytes,
      last_autovacuum::text,
      last_autoanalyze::text
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC, relname
  `,
  sql`
    SELECT schemaname, relname AS table_name, indexrelname AS index_name,
      idx_scan::bigint, pg_relation_size(indexrelid)::bigint AS index_bytes
    FROM pg_stat_user_indexes
    ORDER BY pg_relation_size(indexrelid) DESC, indexrelname
  `,
  sql`
    WITH foreign_keys AS (
      SELECT c.oid AS constraint_oid, c.conrelid, c.conname,
        c.conkey, n.nspname, t.relname AS table_name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
    )
    SELECT fk.table_name, fk.conname AS constraint_name,
      pg_get_constraintdef(fk.constraint_oid) AS definition
    FROM foreign_keys fk
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND i.indisvalid
        AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
    )
    ORDER BY fk.table_name, fk.conname
  `,
  sql`
    SELECT name, setting, unit
    FROM pg_settings
    WHERE name IN (
      'max_connections', 'statement_timeout', 'idle_in_transaction_session_timeout',
      'lock_timeout', 'default_transaction_isolation', 'track_io_timing'
    )
    ORDER BY name
  `,
  sql`
    SELECT current_user AS role_name, role.rolsuper, role.rolcreatedb,
      role.rolcreaterole, role.rolbypassrls,
      EXISTS (
        SELECT 1
        FROM pg_auth_members membership
        JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
        WHERE membership.member = role.oid AND granted_role.rolname = 'neon_superuser'
      ) AS inherits_neon_superuser
    FROM pg_roles role
    WHERE role.rolname = current_user
  `,
  sql`
    SELECT
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
      has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public
  `,
  sql`
    SELECT
      (SELECT count(*)::int FROM pg_constraint
        WHERE NOT convalidated AND connamespace = 'public'::regnamespace) AS unvalidated_constraints,
      (SELECT count(*)::int FROM pg_index WHERE NOT indisvalid OR NOT indisready) AS invalid_indexes
  `,
  sql`
    SELECT COALESCE(
      round(100 * sum(heap_blks_hit)::numeric /
        NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2), 100
    ) AS table_cache_hit_percent
    FROM pg_statio_user_tables
  `,
  sql`
    SELECT version, applied_at::text
    FROM platform_schema_migrations
    ORDER BY applied_at, version
  `,
]);

const queryStats = extensions.some((extension) => extension.extname === "pg_stat_statements")
  ? await sql`
      SELECT calls::bigint, round(mean_exec_time::numeric, 3) AS mean_ms,
        round(total_exec_time::numeric, 3) AS total_ms, rows::bigint,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY total_exec_time DESC
      LIMIT 20
    `
  : [];

console.log(
  JSON.stringify(
    {
      endpoint: {
        host: endpoint.hostname,
        pooledHost: endpoint.hostname.includes("-pooler"),
        sslMode: endpoint.searchParams.get("sslmode"),
      },
      postgres: version[0],
      database: database[0],
      runtimeRole: runtimeRole[0],
      runtimePrivileges: runtimePrivileges[0],
      integrity: integrity[0],
      cache: cache[0],
      extensions,
      settings,
      migrations,
      queryStats,
      tables,
      indexes,
      foreignKeysWithoutLeadingIndex,
    },
    null,
    2,
  ),
);
