import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name = "060_v3_agency_owner_management",
  model = "3.31.0-agency-owner-management";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex"),
  client = new Client(url);
let open = false;
let gates;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const started = performance.now();
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-agency-owner-management',0))");
  await client.query(source);
  gates = (
    await client.query(`SELECT
    has_function_privilege('smf_app','app.is_username_available(text,text)','EXECUTE') username_check,
    has_function_privilege('smf_app','app.update_platform_agency_owner_contact(text,uuid,text,text)','EXECUTE') contact_update,
    has_function_privilege('smf_app','app.replace_platform_agency_owner(text,uuid,text,text,text,text,text,text,timestamptz)','EXECUTE') owner_replace`)
  ).rows[0];
  if (!gates.username_check || !gates.contact_update || !gates.owner_replace)
    throw new Error("Contratti runtime owner incompleti");
  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
    VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gates, executionMs }, null, 2));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
