import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "200_v3_rooming_and_post_trip_reviews";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-rooming-post-trip',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
    to_regclass('travel.rooming_rooms') IS NOT NULL rooming_rooms,
    to_regclass('travel.rooming_room_occupants') IS NOT NULL rooming_occupants,
    to_regclass('journey.post_trip_reviews') IS NOT NULL post_trip_reviews,
    to_regprocedure('app.save_rooming_list_v3(uuid,uuid,uuid,uuid,jsonb)') IS NOT NULL rooming_write,
    to_regprocedure('app.save_own_post_trip_review_v3(uuid,uuid,uuid,integer,text,uuid)') IS NOT NULL review_write,
    to_regprocedure('app.update_agency_post_trip_settings_v3(uuid,uuid,text)') IS NOT NULL review_settings_write,
    pg_get_functiondef('app.claim_due_push_deliveries_v3()'::regprocedure) LIKE '%post_trip_review%' post_trip_push`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
      ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.126.0-rooming-post-trip", checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
