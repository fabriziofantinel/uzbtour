import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const name = "078_v3_operational_programme_full_edit";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
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
    has_function_privilege('smf_app','app.update_departure_programme_day_v3(text,uuid,uuid,text,text,text,text,jsonb,jsonb)','EXECUTE') AS can_update,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='travel.departure_itinerary_items'::regclass AND conname='departure_items_timed_type_check') AS timed_types_ready`)
  ).rows[0];
  if (!gate?.can_update || !gate?.timed_types_ready) throw new Error("Contratto di modifica programma non disponibile");
  if (apply) {
    await client.query(
      "INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES($1,$2,0) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()",
      ["3.48.0-operational-programme-full-edit", createHash("sha256").update(source).digest("hex")],
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
