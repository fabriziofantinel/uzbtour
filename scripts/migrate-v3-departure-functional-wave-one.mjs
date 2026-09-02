import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "134_v3_departure_communications_insurance_experience";
const model = "3.79.0-departure-functional-wave-one";
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
      to_regclass('ops.traveler_change_notice_recipients') IS NOT NULL recipients,
      to_regclass('ops.change_notice_reminders') IS NOT NULL reminders,
      to_regclass('travel.departure_insurance_policies') IS NOT NULL insurance,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='travel' AND table_name='departures' AND column_name='experience_profile') experience_profile,
      position('v_profile' in pg_get_functiondef('app.validate_template_version_publish(uuid,uuid)'::regprocedure))>0 profile_gate,
      has_function_privilege('smf_app','app.publish_departure_communication_v3(text,uuid,text,text,text,boolean,timestamptz,uuid[],uuid)','EXECUTE') communications_api`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate onda funzionale incompleto: ${JSON.stringify(gate)}`);
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
