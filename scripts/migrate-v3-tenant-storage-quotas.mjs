import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const name = "137_v3_tenant_storage_quotas";
const model = "3.82.0-tenant-storage-quotas";
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
        to_regclass('ops.tenant_storage_limits') IS NOT NULL AS limits_table,
        to_regclass('ops.media_assets_agency_live_purpose_size_idx') IS NOT NULL AS usage_index,
        (SELECT count(*) = 1 FROM ops.tenant_storage_limits WHERE agency_id IS NULL) AS platform_default,
        has_function_privilege(
          'smf_app',
          'app.assert_tenant_storage_capacity_v3(uuid,bigint,text,uuid)',
          'EXECUTE'
        ) AS runtime_check,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'ops.media_assets'::regclass
            AND tgname = 'enforce_media_asset_storage_quota_v3'
            AND NOT tgisinternal
        ) AS write_backstop
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
