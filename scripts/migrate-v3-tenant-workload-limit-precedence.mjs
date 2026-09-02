import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const name = "138_v3_tenant_workload_limit_precedence";
const model = "3.83.0-tenant-workload-limit-precedence";
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
      SELECT position(
        '(limits.agency_id = p_agency_id) DESC NULLS LAST,' IN
        pg_get_functiondef(
          'app.enqueue_platform_job_v3(text,uuid,text,text,jsonb,text,timestamptz)'::regprocedure
        )
      ) > 0 AS tenant_override_first
    `)
  ).rows[0];
  if (gate?.tenant_override_first !== true) throw new Error(`Gate incompleto: ${JSON.stringify(gate)}`);

  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version, checksum_sha256)
       VALUES($1, $2)
       ON CONFLICT(version) DO UPDATE
       SET applied_at=clock_timestamp(), checksum_sha256=EXCLUDED.checksum_sha256`,
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
