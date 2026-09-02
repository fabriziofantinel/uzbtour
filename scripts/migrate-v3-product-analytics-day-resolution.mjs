import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(
    new URL("../database/migrations/108_v3_product_analytics_day_resolution.sql", import.meta.url),
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
      `SELECT has_function_privilege('smf_app','app.record_product_analytics_event_v3(text,uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE') function_ok,pg_get_functiondef('app.record_product_analytics_event_v3(text,uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure) LIKE '%template_day_id=p_day%' template_day_resolution`,
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
