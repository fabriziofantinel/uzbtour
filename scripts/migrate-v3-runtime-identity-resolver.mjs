import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const migrationVersion = "021_v3_runtime_identity_resolver";
const modelVersion = "3.3.3-runtime-identity-resolver";
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!migrationUrl) throw new Error("Connessione diretta Neon owner non configurata");

const migrationSql = await readFile(
  new URL("../database/migrations/021_v3_runtime_identity_resolver.sql", import.meta.url),
  "utf8",
);
const checksum = createHash("sha256").update(migrationSql).digest("hex");
const client = new Client(migrationUrl);
let transactionOpen = false;

try {
  await client.connect();
  const startedAt = performance.now();
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-runtime-identity', 0))");
  await client.query(migrationSql);

  const grants = (await client.query(`
    SELECT
      has_function_privilege('smf_app', 'app.resolve_legacy_user_id(text,uuid)', 'EXECUTE') AS resolver_execute,
      NOT has_table_privilege('smf_app', 'ops.legacy_id_map', 'SELECT') AS map_is_private
  `)).rows[0];
  if (!grants || Object.values(grants).some((value) => value !== true)) {
    throw new Error(`Gate resolver identità non superato: ${JSON.stringify(grants)}`);
  }

  const executionMs = Math.round(performance.now() - startedAt);
  if (apply) {
    const previous = await client.query(
      "SELECT checksum_sha256 FROM ops.schema_migrations WHERE version = $1",
      [modelVersion],
    );
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
  console.log(JSON.stringify({
    status: apply ? "applied" : "dry_run_passed",
    migrationVersion, modelVersion, checksum, executionMs, grants,
  }, null, 2));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
