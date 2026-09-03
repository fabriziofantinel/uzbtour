import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "148_v3_native_media_registration";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-media-registration',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      has_function_privilege('smf_app','app.require_agency_editor_v3(uuid,uuid)','EXECUTE') editor,
      has_function_privilege('smf_app','app.resolve_traveler_context_v3(uuid,uuid,uuid,uuid)','EXECUTE') traveler_context,
      has_function_privilege('smf_app','app.register_memory_upload_v3(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') memory,
      has_function_privilege('smf_app','app.register_ticket_upload_v3(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)','EXECUTE') ticket,
      has_function_privilege('smf_app','app.register_departure_day_document_v3(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint,text)','EXECUTE') day_document,
      position('legacy_id_map' in pg_get_functiondef('app.register_memory_upload_v3(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint)'::regprocedure))=0 memory_native,
      position('p_actor_legacy' in pg_get_functiondef('app.register_departure_day_document_v3(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure))=0 day_document_native`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.93.0-native-media-registration", checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
