import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";
const name = "048_v3_async_agency_deletion",
  model = "3.20.0-async-agency-deletion",
  apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  checksum = createHash("sha256").update(source).digest("hex"),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if (!role || role.runtime) throw new Error("Ruolo owner richiesto");
  const started = performance.now();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-agency-deletion',0))");
  await client.query(source);
  const gates = (
    await client.query(
      `SELECT has_function_privilege('smf_app','app.request_agency_deletion_v3(text,uuid,text)','EXECUTE') request,has_function_privilege('smf_app','app.claim_agency_deletion_v3(uuid,uuid,text,integer)','EXECUTE') claim,has_function_privilege('smf_app','app.advance_agency_deletion_v3(uuid,uuid,text,integer)','EXECUTE') advance,has_function_privilege('smf_app','app.release_agency_deletion_v3(uuid,uuid,text,text)','EXECUTE') release`,
    )
  ).rows[0];
  if (!gates || Object.values(gates).some((v) => v !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gates)}`);
  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run_passed",
        role: role.role_name,
        executionMs,
        gates,
        migration: { name, model, checksum },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
