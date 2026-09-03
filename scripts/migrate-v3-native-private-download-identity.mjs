import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "147_v3_native_private_download_identity";
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
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-private-download-identity',0))",
  );
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      has_function_privilege('smf_app','app.resolve_impersonation_v3(uuid,text)','EXECUTE') impersonation,
      has_function_privilege('smf_app','app.resolve_memory_download_v3(uuid,uuid)','EXECUTE') memory_download,
      has_function_privilege('smf_app','app.resolve_travel_document_download_v3(uuid,uuid)','EXECUTE') document_download,
      position('legacy_id_map' in pg_get_functiondef('app.resolve_memory_download_v3(uuid,uuid)'::regprocedure))=0 memory_native,
      position('legacy_id_map' in pg_get_functiondef('app.resolve_travel_document_download_v3(uuid,uuid)'::regprocedure))=0 document_native`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.92.0-native-private-download-identity", checksum],
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
