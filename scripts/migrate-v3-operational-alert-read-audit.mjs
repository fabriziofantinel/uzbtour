import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "144_v3_operational_alert_read_audit";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      to_regprocedure('app.is_departure_operator_v3(uuid,uuid)') IS NOT NULL operator_native,
      to_regprocedure('app.list_operational_alerts_v3(uuid,uuid)') IS NOT NULL alerts_native,
      has_function_privilege('smf_app','app.list_operational_alerts_v3(uuid,uuid)','EXECUTE') alerts_executable,
      position('sensitive_data_read' in pg_get_functiondef('app.list_operational_alerts_v3(uuid,uuid)'::regprocedure)) > 0 read_audited,
      position('valid_from' in pg_get_functiondef('app.is_departure_operator_v3(uuid,uuid)'::regprocedure)) > 0 temporal_scope`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.89.0-operational-alert-read-audit", checksum],
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
