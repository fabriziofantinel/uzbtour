import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const migrationVersion = "020_v3_journey_journal_runtime_access";
const modelVersion = "3.3.2-runtime-journey-journal";
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!migrationUrl) throw new Error("Connessione diretta Neon owner non configurata");

const migrationSql = await readFile(
  new URL("../database/migrations/020_v3_journey_journal_runtime_access.sql", import.meta.url),
  "utf8",
);
const checksum = createHash("sha256").update(migrationSql).digest("hex");
const client = new Client(migrationUrl);
let transactionOpen = false;

try {
  await client.connect();
  const capability = (
    await client.query(`
    SELECT current_user AS role_name,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
      current_user = 'smf_app' AS is_runtime_role
  `)
  ).rows[0];
  if (!capability || capability.is_runtime_role || !capability.can_create) {
    throw new Error(`Ruolo non autorizzato: ${capability?.role_name ?? "sconosciuto"}`);
  }

  const startedAt = performance.now();
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-runtime-journey-journal', 0))");
  await client.query(migrationSql);

  const grants = (
    await client.query(`
    SELECT
      has_schema_privilege('smf_app', 'journey', 'USAGE') AS journey_usage,
      has_table_privilege('smf_app', 'journey.cash_movements', 'SELECT,INSERT,UPDATE,DELETE') AS cash_dml,
      has_table_privilege('smf_app', 'journey.day_notes', 'SELECT,INSERT,UPDATE,DELETE') AS notes_dml,
      has_table_privilege('smf_app', 'journey.restaurant_visits', 'SELECT,INSERT,UPDATE,DELETE') AS restaurants_dml,
      has_table_privilege('smf_app', 'ops.legacy_id_map', 'SELECT') AS can_map_ids
  `)
  ).rows[0];
  if (!grants || Object.values(grants).some((value) => value !== true)) {
    throw new Error(`Privilegi runtime incompleti: ${JSON.stringify(grants)}`);
  }

  const executionMs = Math.round(performance.now() - startedAt);
  if (apply) {
    const previous = await client.query("SELECT checksum_sha256 FROM ops.schema_migrations WHERE version = $1", [
      modelVersion,
    ]);
    if (previous.rowCount > 0 && previous.rows[0].checksum_sha256 !== checksum) {
      throw new Error(`Checksum differente per ${modelVersion}: applicazione interrotta`);
    }
    await client.query(
      `INSERT INTO ops.schema_migrations (version, checksum_sha256, execution_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE SET execution_ms = EXCLUDED.execution_ms,
         applied_at = clock_timestamp()`,
      [modelVersion, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  transactionOpen = false;

  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run_passed",
        migrationVersion,
        modelVersion,
        checksum,
        executionMs,
        role: capability.role_name,
        grants,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
