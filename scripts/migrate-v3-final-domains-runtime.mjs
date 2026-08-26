import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const files = [
  ["027_v3_party_privacy_runtime", "3.3.9-runtime-party-privacy"],
  ["028_v3_documents_import_runtime", "3.3.10-runtime-documents-import"],
  ["029_v3_content_localization_runtime", "3.3.11-runtime-content-localization"],
];
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!migrationUrl) throw new Error("Connessione diretta Neon owner non configurata");

const migrations = await Promise.all(files.map(async ([name, model]) => {
  const sql = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
  return { name, model, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}));

const client = new Client(migrationUrl);
let open = false;
try {
  await client.connect();
  const capability = (await client.query(`SELECT current_user role_name,
    has_database_privilege(current_user,current_database(),'CREATE') can_create,
    current_user='smf_app' is_runtime_role`)).rows[0];
  if (!capability || capability.is_runtime_role || !capability.can_create) {
    throw new Error(`Ruolo non autorizzato: ${capability?.role_name ?? "sconosciuto"}`);
  }

  const started = performance.now();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='10min'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-runtime-final-domains',0))");
  for (const migration of migrations) await client.query(migration.sql);

  const gates = (await client.query(`SELECT
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('sync_v3_traveler_profile','sync_v3_travel_party','sync_v3_party_membership','sync_v3_invitation') AND tgenabled='O')=4 party_privacy_triggers,
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('sync_v3_travel_document','sync_v3_itinerary_document','sync_v3_import_job','sync_v3_platform_job','sync_v3_audit_event') AND tgenabled='O')=5 document_import_triggers,
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('sync_v3_useful_information','sync_v3_phrasebook_entry','sync_v3_generated_content') AND tgenabled='O')=3 content_localization_triggers,
    NOT has_table_privilege('smf_app','ops.legacy_id_map','SELECT') identity_map_private,
    NOT has_table_privilege('smf_app','ops.legacy_generated_content_map','SELECT') content_map_private`)).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gates)}`);
  }

  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    for (const migration of migrations) {
      const previous = await client.query(
        "SELECT checksum_sha256 FROM ops.schema_migrations WHERE version=$1",
        [migration.model],
      );
      if (previous.rowCount && previous.rows[0].checksum_sha256 !== migration.checksum) {
        throw new Error(`Checksum differente per ${migration.model}`);
      }
      await client.query(`INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
        VALUES($1,$2,$3)
        ON CONFLICT(version) DO UPDATE
        SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [migration.model, migration.checksum, executionMs]);
    }
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;

  console.log(JSON.stringify({
    status: apply ? "applied" : "dry_run_passed",
    role: capability.role_name,
    executionMs,
    gates,
    migrations: migrations.map(({ name, model, checksum }) => ({ name, model, checksum })),
  }, null, 2));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
