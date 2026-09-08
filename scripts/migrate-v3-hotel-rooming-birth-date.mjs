import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "202_v3_hotel_rooming_and_traveler_birth_date";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-hotel-rooming-birth-date',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      NOT EXISTS(SELECT 1 FROM travel.traveler_profiles WHERE birth_date IS NULL) AS travel_birth_dates,
      NOT EXISTS(SELECT 1 FROM public.traveler_profiles WHERE birth_date IS NULL) AS legacy_birth_dates,
      (SELECT is_nullable='NO' FROM information_schema.columns
        WHERE table_schema='travel' AND table_name='traveler_profiles' AND column_name='birth_date') AS birth_date_required,
      pg_get_functiondef('app.save_rooming_list_v3(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
        LIKE '%hotelNights%' AS hotel_rooming_write`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.128.0-hotel-rooming-birth-date", checksum],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
