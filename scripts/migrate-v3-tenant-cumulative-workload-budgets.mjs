import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "133_v3_tenant_cumulative_workload_budgets";
const model = "3.78.0-tenant-cumulative-workload-budgets";
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
    await client.query(`SELECT
      position('window=daily' in pg_get_functiondef('app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure))>0 daily_budget,
      position('window=monthly' in pg_get_functiondef('app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure))>0 monthly_budget,
      position('idempotency_key' in pg_get_functiondef('app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure))>0 idempotent`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate budget incompleto: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [model, checksum],
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
