import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "151_v3_native_agency_traveler_impersonation";
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
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-agency-traveler-impersonation',0))",
  );
  await client.query(source);
  const gate = (
    await client.query(`SELECT
    has_function_privilege('smf_app','app.read_agency_impersonation_travelers(uuid)','EXECUTE') read_ready,
    has_function_privilege('smf_app','app.start_agency_traveler_impersonation(uuid,uuid,text,timestamptz,text)','EXECUTE') start_ready,
    NOT has_function_privilege('smf_app','app.read_agency_impersonation_travelers(text)','EXECUTE') old_read_revoked,
    NOT has_function_privilege('smf_app','app.start_agency_traveler_impersonation(text,text,text,timestamptz,text)','EXECUTE') old_start_revoked`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
    ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.96.0-native-agency-traveler-impersonation", checksum],
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
