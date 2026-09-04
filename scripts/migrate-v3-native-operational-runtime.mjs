import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const migrations = [
  "168_v3_native_operational_chat",
  "169_v3_native_operational_control",
  "170_v3_native_operational_chat_column_ambiguity_fix",
  "171_v3_communication_audience_scope",
];
const sources = await Promise.all(
  migrations.map(async (name) => ({
    name,
    source: await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  })),
);
const checksum = createHash("sha256")
  .update(sources.map(({ source }) => source).join("\n"))
  .digest("hex");
const client = new Client(url);
let open = false;

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-operational-runtime',0))");
  for (const { source } of sources) await client.query(source);
  const gate = (
    await client.query(`SELECT
      to_regprocedure('app.list_operational_messages_scoped_v3(uuid,uuid,text,uuid,uuid,integer)') IS NOT NULL native_chat_read,
      to_regprocedure('app.send_operational_message_scoped_v3(uuid,uuid,text,uuid,uuid,text,uuid)') IS NOT NULL native_chat_write,
      to_regprocedure('app.list_departure_operations_v3(uuid,uuid)') IS NOT NULL native_operations_read,
      to_regprocedure('app.record_departure_attendance_v3(uuid,uuid,uuid,text,text)') IS NOT NULL native_attendance_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='168_v3_native_operational_chat') chat_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='169_v3_native_operational_control') control_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='170_v3_native_operational_chat_column_ambiguity_fix') chat_ambiguity_fix_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='171_v3_communication_audience_scope') communication_audience_marker`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.116.0-native-operational-runtime", checksum],
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
