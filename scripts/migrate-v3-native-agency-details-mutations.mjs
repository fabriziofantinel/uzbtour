import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "157_v3_native_agency_details_mutations";
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
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-agency-details-mutations',0))",
  );
  await client.query(source);
  const pairs = [
    ["update_platform_agency_branding", "uuid,uuid,text,text", "text,uuid,text,text"],
    ["update_platform_agency_status", "uuid,uuid,text", "text,uuid,text"],
    ["update_platform_agency_owner_contact", "uuid,uuid,text,text", "text,uuid,text,text"],
    ["update_platform_agency_details", "uuid,uuid,jsonb", "text,uuid,jsonb"],
  ];
  for (const [fn, nativeArgs, legacyArgs] of pairs) {
    const gate = (
      await client.query(
        "SELECT has_function_privilege('smf_app',$1,'EXECUTE') native_ready,NOT has_function_privilege('smf_app',$2,'EXECUTE') legacy_revoked",
        [`app.${fn}(${nativeArgs})`, `app.${fn}(${legacyArgs})`],
      )
    ).rows[0];
    if (!gate || gate.native_ready !== true || gate.legacy_revoked !== true)
      throw new Error(`Gate incompleti ${fn}: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.102.0-native-agency-details-mutations", checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", functions: pairs.length }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
