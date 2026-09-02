import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const name = "136_v3_configurable_tenant_workload_limits";
const model = "3.81.0-configurable-tenant-workload-limits";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(source);

  const gate = (
    await client.query(`
      SELECT
        to_regclass('ops.tenant_workload_limits') IS NOT NULL AS limits_table,
        to_regclass('ops.platform_jobs_agency_job_type_created_at_idx') IS NOT NULL AS budget_index,
        (SELECT count(*) = 6 FROM ops.tenant_workload_limits WHERE agency_id IS NULL) AS platform_defaults,
        position(
          'ops.tenant_workload_limits' IN
          pg_get_functiondef('app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure)
        ) > 0 AS configurable_lookup
    `)
  ).rows[0];

  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }

  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256)
       VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [model, checksum],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
