import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "131_v3_tenant_workload_quotas",
  model = "3.76.0-tenant-workload-quotas",
  source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  checksum = createHash("sha256").update(source).digest("hex"),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(source);
  const gate = (
    await client.query(
      `SELECT position('tenant workload quota exceeded' in pg_get_functiondef('app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure))>0 quota_enforced`,
    )
  ).rows[0];
  if (!gate?.quota_enforced) throw new Error("Gate quota incompleto");
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
