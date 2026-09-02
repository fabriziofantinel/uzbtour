import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(
    new URL("../database/migrations/103_v3_kpi_change_content_governance.sql", import.meta.url),
    "utf8",
  ),
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
      `SELECT (SELECT count(*)=6 FROM ops.analytics_kpi_definitions WHERE version=1) kpi_ok,to_regclass('ops.traveler_change_notices') IS NOT NULL notices_ok,to_regclass('ops.traveler_change_notice_receipts') IS NOT NULL receipts_ok,has_function_privilege('smf_app','app.acknowledge_traveler_change_notice_v3(text,uuid,uuid)','EXECUTE') receipt_function_ok,has_function_privilege('smf_app','app.publish_traveler_change_notice_v3(text,uuid,uuid,text,text,text,text,jsonb,jsonb)','EXECUTE') publish_function_ok,EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='travel' AND table_name='template_useful_information' AND column_name='review_status') governance_ok`,
    )
  ).rows[0];
  if (!gate || Object.values(gate).some((v) => v !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
