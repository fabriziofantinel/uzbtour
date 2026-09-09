import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "204_v3_country_information_lifecycle";
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-country-information-lifecycle',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      to_regprocedure('app.read_verified_country_profile_v3(uuid,uuid,uuid)') IS NOT NULL AS global_cache_available,
      to_regprocedure('app.read_country_profiles_for_review_v3(uuid)') IS NOT NULL AS agency_review_available,
      to_regprocedure('app.save_country_profile_override_v3(uuid,uuid,uuid,jsonb)') IS NOT NULL AS agency_edit_available,
      to_regprocedure('app.read_traveler_destination_profile_v3(uuid,uuid)') IS NOT NULL AS traveler_profile_available,
      EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='country_profile_agency_reviews_status_check'
          AND pg_get_constraintdef(oid) LIKE '%review_required%'
      ) AS refresh_review_available`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true)) {
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.130.0-country-information-lifecycle", checksum],
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
