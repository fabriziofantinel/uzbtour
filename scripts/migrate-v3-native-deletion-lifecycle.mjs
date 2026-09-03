import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "160_v3_native_deletion_lifecycle";
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-deletion-lifecycle',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
has_function_privilege('smf_app','app.request_agency_deletion_v3(uuid,uuid,text)','EXECUTE') request_native,
has_function_privilege('smf_app','app.resolve_trip_deletion_target_v3(uuid,uuid)','EXECUTE') resolve_native,
has_function_privilege('smf_app','app.read_trip_deletion_assets_v3(uuid,uuid,uuid)','EXECUTE') assets_native,
has_function_privilege('smf_app','app.delete_trip_template_v3(uuid,uuid,uuid,uuid[])','EXECUTE') delete_native,
NOT has_function_privilege('smf_app','app.request_agency_deletion_v3(text,uuid,text)','EXECUTE') request_legacy_revoked,
NOT has_function_privilege('smf_app','app.resolve_trip_deletion_target_v3(text,uuid)','EXECUTE') resolve_legacy_revoked,
NOT has_function_privilege('smf_app','app.read_trip_deletion_assets_v3(text,uuid,uuid)','EXECUTE') assets_legacy_revoked,
NOT has_function_privilege('smf_app','app.delete_trip_template_v3(text,uuid,uuid,uuid[])','EXECUTE') delete_legacy_revoked`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  const actor = (
    await client.query(
      "SELECT id FROM iam.users WHERE status='active' AND platform_role='superadmin' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  const target = (
    await client.query(
      "SELECT template.id,template.agency_id FROM travel.trip_templates template JOIN iam.agencies agency ON agency.id=template.agency_id WHERE agency.status IN('trial','active','suspended') ORDER BY template.created_at LIMIT 1",
    )
  ).rows[0];
  if (actor && target) {
    const resolved = (
      await client.query("SELECT * FROM app.resolve_trip_deletion_target_v3($1::uuid,$2::uuid)", [actor.id, target.id])
    ).rows[0];
    if (!resolved || resolved.agency_id !== target.agency_id) throw new Error("Smoke risoluzione viaggio fallito");
    await client.query("SELECT * FROM app.read_trip_deletion_assets_v3($1::uuid,$2::uuid,$3::uuid)", [
      actor.id,
      target.agency_id,
      target.id,
    ]);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
      ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.105.0-native-deletion-lifecycle", checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate, read_smoke: Boolean(actor && target) }),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
