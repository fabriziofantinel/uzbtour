import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "155_v3_native_agency_agent_mutations";
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-agency-agent-mutations',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
    has_function_privilege('smf_app','app.require_agency_owner_v3(uuid,uuid)','EXECUTE') owner_native_ready,
    has_function_privilege('smf_app','app.provision_agency_agent_v3(uuid,uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') provision_native_ready,
    has_function_privilege('smf_app','app.remove_agency_agent_v3(uuid,uuid,text)','EXECUTE') remove_native_ready,
    NOT has_function_privilege('smf_app','app.require_agency_owner_v3(text,uuid)','EXECUTE') owner_legacy_revoked,
    NOT has_function_privilege('smf_app','app.provision_agency_agent_v3(text,uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') provision_legacy_revoked,
    NOT has_function_privilege('smf_app','app.remove_agency_agent_v3(text,uuid,text)','EXECUTE') remove_legacy_revoked`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
      ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.100.0-native-agency-agent-mutations", checksum],
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
