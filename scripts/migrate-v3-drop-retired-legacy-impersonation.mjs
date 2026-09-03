import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "167_v3_drop_retired_legacy_impersonation";
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
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-drop-retired-legacy-impersonation',0))",
  );
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      count(*)::integer legacy_signatures,
      count(*) FILTER(WHERE has_function_privilege('smf_app',procedure.oid,'EXECUTE'))::integer executable_legacy_signatures,
      to_regprocedure('app.start_impersonation_v3(uuid,uuid,text,timestamp with time zone,text)') IS NOT NULL native_start,
      to_regprocedure('app.resolve_impersonation_v3(uuid,text)') IS NOT NULL native_resolve,
      to_regprocedure('app.end_impersonation_v3(uuid,text)') IS NOT NULL native_end
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='app'
      AND pg_get_function_identity_arguments(procedure.oid)~'p_actor_legacy'`)
  ).rows[0];
  if (
    gate?.legacy_signatures !== 50 ||
    gate?.executable_legacy_signatures !== 50 ||
    !gate?.native_start ||
    !gate?.native_resolve ||
    !gate?.native_end
  ) {
    throw new Error(`Superficie impersonificazione inattesa: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.112.0-drop-retired-legacy-impersonation", checksum],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
