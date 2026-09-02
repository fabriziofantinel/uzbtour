import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "129_v3_api_rate_limits",
  model = "3.74.0-api-rate-limits";
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
    to_regclass('ops.api_rate_limit_buckets') IS NOT NULL AS buckets,
    has_function_privilege('smf_app','app.consume_api_rate_limit_v3(text,text,integer,integer)','EXECUTE') AS runtime_execute,
    NOT has_table_privilege('smf_app','ops.api_rate_limit_buckets','SELECT') AS table_hidden`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
    ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
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
