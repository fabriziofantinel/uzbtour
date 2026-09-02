import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const name = "030_v3_operational_read_cutover";
const model = "3.4.0-operational-read-cutover";
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!migrationUrl) throw new Error("Connessione diretta Neon owner non configurata");
const sql = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(sql).digest("hex");

const client = new Client(migrationUrl);
let open = false;
try {
  await client.connect();
  const capability = (
    await client.query(`SELECT current_user role_name,
    has_database_privilege(current_user,current_database(),'CREATE') can_create,
    current_user='smf_app' is_runtime_role`)
  ).rows[0];
  if (!capability || capability.is_runtime_role || !capability.can_create) {
    throw new Error(`Ruolo non autorizzato: ${capability?.role_name ?? "sconosciuto"}`);
  }
  const started = performance.now();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-operational-read-cutover',0))");
  await client.query(sql);
  const gates = (
    await client.query(`SELECT
    has_table_privilege('smf_app','journey.expenses','SELECT') expenses,
    has_table_privilege('smf_app','journey.cash_movements','SELECT') cash_movements,
    has_table_privilege('smf_app','journey.day_notes','SELECT') day_notes,
    has_table_privilege('smf_app','journey.restaurant_visits','SELECT') restaurants,
    has_table_privilege('smf_app','journey.programme_feedback','SELECT') feedback,
    NOT has_table_privilege('smf_app','ops.legacy_id_map','SELECT') identity_map_private,
    NOT has_table_privilege('smf_app','ops.legacy_generated_content_map','SELECT') content_map_private`)
  ).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gates)}`);
  }
  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    const previous = await client.query("SELECT checksum_sha256 FROM ops.schema_migrations WHERE version=$1", [model]);
    if (previous.rowCount && previous.rows[0].checksum_sha256 !== checksum) {
      throw new Error(`Checksum differente per ${model}`);
    }
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
      VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE
      SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run_passed",
        role: capability.role_name,
        executionMs,
        gates,
        migration: { name, model, checksum },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
