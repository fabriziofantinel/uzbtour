import { createHash } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl) throw new Error("Connessione Neon del branch di verifica non configurata");

const client = new Client(databaseUrl);

try {
  await client.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");

  const [database, connections, integrity, cardinalities, repositoryLedger] = await Promise.all([
    client.query(`
      SELECT
        now() AT TIME ZONE 'UTC' AS observed_at_utc,
        pg_database_size(current_database())::bigint AS database_bytes,
        current_setting('max_connections')::int AS max_connections
    `),
    client.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE state = 'active')::int AS active,
        count(*) FILTER (WHERE state = 'idle')::int AS idle,
        count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
    `),
    client.query(`
      SELECT
        (SELECT count(*)::int
           FROM information_schema.tables
          WHERE table_schema IN ('iam','ref','travel','content','ops','journey','privacy')) AS table_count,
        (SELECT count(*)::int
           FROM pg_constraint
          WHERE NOT convalidated
            AND connamespace IN (
              'iam'::regnamespace, 'ref'::regnamespace, 'travel'::regnamespace,
              'content'::regnamespace, 'ops'::regnamespace,
              'journey'::regnamespace, 'privacy'::regnamespace
            )) AS unvalidated_constraints,
        (SELECT count(*)::int
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN ('iam','ref','travel','content','ops','journey','privacy')
            AND (NOT i.indisvalid OR NOT i.indisready)) AS invalid_indexes
    `),
    client.query(`
      SELECT
        (SELECT count(*)::int FROM iam.agencies) AS agencies,
        (SELECT count(*)::int FROM travel.departures) AS departures,
        (SELECT count(*)::int FROM ops.platform_jobs) AS platform_jobs,
        (SELECT count(*)::int FROM ops.media_assets) AS media_assets
    `),
    client.query(`SELECT to_regclass('ops.repository_migrations') IS NOT NULL AS present`),
  ]);

  const migrationMarkers = repositoryLedger.rows[0].present
    ? await client.query(`
        SELECT version, applied_at AT TIME ZONE 'UTC' AS applied_at_utc
        FROM ops.repository_migrations
        ORDER BY applied_at DESC, version DESC
        LIMIT 5
      `)
    : { rows: [] };

  const counts = cardinalities.rows[0];
  const cardinalityChecksum = createHash("sha256").update(JSON.stringify(counts)).digest("hex");

  console.log(
    JSON.stringify({
      status: "captured",
      restorePointUtc: process.env.RESTORE_POINT_UTC ?? null,
      database: database.rows[0],
      connections: connections.rows[0],
      integrity: integrity.rows[0],
      cardinalities: counts,
      cardinalityChecksum,
      repositoryMigrationLedgerPresent: repositoryLedger.rows[0].present,
      recentRepositoryMigrations: migrationMarkers.rows,
    }),
  );

  await client.query("ROLLBACK");
} finally {
  await client.end().catch(() => undefined);
}
