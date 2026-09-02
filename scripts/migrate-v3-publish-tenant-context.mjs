import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const name = "072_v3_publish_tenant_context",
  apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query(source);
  const definition =
    (
      await client.query(
        `SELECT pg_get_functiondef('app.publish_import_programme_v3(text,uuid,uuid,jsonb,jsonb,date,date,uuid,text)'::regprocedure) value`,
      )
    ).rows[0]?.value ?? "";
  const gate = {
    publish: await client
      .query(
        `SELECT has_function_privilege('smf_app','app.publish_import_programme_v3(text,uuid,uuid,jsonb,jsonb,date,date,uuid,text)','EXECUTE') value`,
      )
      .then((r) => r.rows[0]?.value === true),
    tenantContext: definition.includes("set_config('app.agency_id',p_agency_id::text,true)"),
  };
  if (Object.values(gate).some((v) => v !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES($1,$2,0) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      ["3.43.0-publish-tenant-context", createHash("sha256").update(source).digest("hex")],
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
