import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name = "056_v3_agency_access_and_responsibility",
  model = "3.28.0-agency-access-and-responsibility";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex"),
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
  await client.query("SET LOCAL statement_timeout='90s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-agency-access-responsibility',0))");
  await client.query(source);
  const contract = (
    await client.query(`SELECT
    to_regprocedure('app.read_username_login_state(text)') IS NOT NULL login_state,
    to_regprocedure('app.create_platform_agency_with_owner(text,jsonb,text,timestamptz)') IS NOT NULL agency_owner_create,
    to_regprocedure('app.replace_platform_agency_owner(text,uuid,text,text,text,text,text,text,timestamptz)') IS NOT NULL owner_replace,
    to_regprocedure('app.update_platform_agency_status(text,uuid,text)') IS NOT NULL status_update,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='iam'
      AND indexname='agency_memberships_single_owner_uidx') owner_unique`)
  ).rows[0];
  if (!contract || Object.values(contract).some((value) => !value))
    throw new Error("Contratto accesso agenzia incompleto");
  const executionMs = Math.round(performance.now() - started);
  if (apply) {
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
        role: role.role_name,
        executionMs,
        gates: contract,
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
