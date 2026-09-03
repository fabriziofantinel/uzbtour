import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "159_v3_native_agency_owner_lifecycle";
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-agency-owner-lifecycle',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
has_function_privilege('smf_app','app.create_platform_agency_with_owner(uuid,jsonb,text,timestamp with time zone)','EXECUTE') create_native,
has_function_privilege('smf_app','app.provision_platform_agency_agent(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') provision_native,
has_function_privilege('smf_app','app.replace_platform_agency_owner(uuid,uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') replace_native,
NOT has_function_privilege('smf_app','app.create_platform_agency_with_owner(text,jsonb,text,timestamp with time zone)','EXECUTE') create_legacy_revoked,
NOT has_function_privilege('smf_app','app.provision_platform_agency_agent(text,uuid,text,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') provision_legacy_revoked,
NOT has_function_privilege('smf_app','app.replace_platform_agency_owner(text,uuid,text,text,text,text,text,text,timestamp with time zone)','EXECUTE') replace_legacy_revoked`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  const actor = (
    await client.query(
      "SELECT id FROM iam.users WHERE status='active' AND platform_role='superadmin' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!actor) throw new Error("Superadmin di collaudo non disponibile");
  await client.query("SAVEPOINT lifecycle_smoke");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const payload = {
    slug: `native-smoke-${suffix}`,
    name: "Native lifecycle smoke",
    referenceName: "Owner Smoke",
    referenceInitials: "OS",
    referenceUsername: `owner.${suffix}`,
    referenceEmail: `owner.${suffix}@example.invalid`,
    referencePhone: "0000000000",
    branding: { primaryColor: "#247A6B", logoUrl: "" },
  };
  const created = (
    await client.query("SELECT * FROM app.create_platform_agency_with_owner($1::uuid,$2::jsonb,$3,$4)", [
      actor.id,
      JSON.stringify(payload),
      "a".repeat(64),
      new Date(Date.now() + 3600000),
    ])
  ).rows[0];
  if (!created?.agency_id) throw new Error("Smoke creazione agenzia fallito");
  await client.query("SELECT * FROM app.replace_platform_agency_owner($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)", [
    actor.id,
    created.agency_id,
    "Replacement Smoke",
    "RS",
    `replacement.${suffix}`,
    `replacement.${suffix}@example.invalid`,
    "0000000001",
    "b".repeat(64),
    new Date(Date.now() + 3600000),
  ]);
  const ownerCount = Number(
    (
      await client.query(
        "SELECT count(*) count FROM iam.agency_memberships WHERE agency_id=$1 AND role='owner' AND status<>'revoked'",
        [created.agency_id],
      )
    ).rows[0]?.count,
  );
  if (ownerCount !== 1) throw new Error(`Smoke sostituzione responsabile fallito: ${ownerCount}`);
  await client.query("ROLLBACK TO SAVEPOINT lifecycle_smoke");
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.104.0-native-agency-owner-lifecycle", checksum],
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
