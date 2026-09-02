import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "128_v3_agency_country_profile_review",
  model = "3.73.0-agency-country-profile-review",
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
      `SELECT to_regclass('ref.country_profile_agency_reviews') IS NOT NULL agency_reviews,has_function_privilege('smf_app','app.review_country_profile_v3(text,uuid,uuid,boolean)','EXECUTE') owner_review_ready,has_function_privilege('smf_app','app.read_country_profiles_for_review_v3(text)','EXECUTE') owner_list_ready,NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='review_country_profile_v3' AND pg_get_function_identity_arguments(p.oid)='p_actor_legacy text, p_country_id uuid, p_approve boolean') legacy_superadmin_review_removed`,
    )
  ).rows[0];
  if (!gate || Object.values(gate).some((v) => v !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
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
