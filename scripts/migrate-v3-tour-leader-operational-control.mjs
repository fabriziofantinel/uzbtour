import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "135_v3_tour_leader_operational_control",
  model = "3.80.0-tour-leader-operational-control",
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
      `SELECT to_regclass('travel.departure_staff_assignments') IS NOT NULL staff,to_regclass('journey.departure_attendance') IS NOT NULL attendance,to_regclass('privacy.traveler_operational_alerts') IS NOT NULL alerts,has_function_privilege('smf_app','app.list_operational_messages_scoped_v3(text,uuid,text,uuid,uuid,integer)','EXECUTE') chat_scopes,has_function_privilege('smf_app','app.list_operational_alerts_v3(text,uuid)','EXECUTE') alert_scope`,
    )
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256)VALUES($1,$2)ON CONFLICT(version)DO UPDATE SET applied_at=clock_timestamp()`,
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
