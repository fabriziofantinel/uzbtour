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
  "172_v3_document_audience_scope",
  "173_v3_group_experience_and_insurance_audience",
  "174_v3_agency_staff_and_day_assignments",
  "175_v3_departure_presence_register",
  "176_v3_staff_document_audience",
  "177_v3_staff_chat_scope",
  "178_v3_staff_communication_audience",
  "179_v3_staff_day_programme_authorization",
  "180_v3_staff_programme_day_write",
  "181_v3_selected_staff_communications",
  "182_v3_selected_staff_chat_documents",
  "183_v3_clear_departure_presence_fix",
  "184_v3_staff_past_trip_test_access",
  "185_v3_staff_trip_presentation",
  "186_v3_staff_dashboard_details",
  "187_v3_staff_journey_management_read",
  "188_v3_staff_personal_trip_documents",
  "189_v3_role_parity_impersonation_country_overrides",
  "190_v3_staff_collaboration_permissions",
  "191_v3_staff_communication_lifecycle",
  "192_v3_staff_recipient_integrity",
  "193_v3_guide_chat_boundary",
  "194_v3_hide_revoked_agency_staff",
  "195_v3_staff_temporal_access_fix",
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
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='183_v3_clear_departure_presence_fix') clear_presence_fix_marker,
      to_regprocedure('app.list_selected_staff_messages_v3(uuid,uuid,text,uuid,integer)') IS NOT NULL selected_staff_chat_read,
      to_regprocedure('app.send_selected_staff_message_v3(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL selected_staff_chat_write,
      to_regprocedure('app.register_selected_staff_day_document_v3(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,bigint,text,uuid[])') IS NOT NULL selected_staff_document_write,
      to_regprocedure('app.publish_selected_staff_communication_v3(uuid,uuid,text,text,text,text,boolean,timestamp with time zone,uuid,uuid[])') IS NOT NULL selected_staff_communication_write,
      to_regprocedure('app.list_operational_messages_scoped_v3(uuid,uuid,text,uuid,uuid,integer)') IS NOT NULL native_chat_read,
      to_regprocedure('app.send_operational_message_scoped_v3(uuid,uuid,text,uuid,uuid,text,uuid)') IS NOT NULL native_chat_write,
      to_regprocedure('app.list_departure_operations_v3(uuid,uuid)') IS NOT NULL native_operations_read,
      to_regprocedure('app.record_departure_attendance_v3(uuid,uuid,uuid,text,text)') IS NOT NULL native_attendance_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='168_v3_native_operational_chat') chat_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='169_v3_native_operational_control') control_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='170_v3_native_operational_chat_column_ambiguity_fix') chat_ambiguity_fix_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='171_v3_communication_audience_scope') communication_audience_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='172_v3_document_audience_scope') document_audience_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='173_v3_group_experience_and_insurance_audience') group_experience_insurance_marker,
      to_regprocedure('app.read_agency_staff_v3(uuid,uuid)') IS NOT NULL agency_staff_read,
      to_regprocedure('app.provision_agency_staff_v3(uuid,uuid,text,text,text,text,text,text,text,timestamp with time zone)') IS NOT NULL agency_staff_write,
      to_regprocedure('app.assign_departure_staff_days_v3(uuid,uuid,uuid,text,uuid[])') IS NOT NULL staff_day_assignment_write,
      to_regprocedure('app.set_departure_presence_v3(uuid,uuid,uuid,boolean)') IS NOT NULL presence_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='174_v3_agency_staff_and_day_assignments') staff_day_assignment_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='175_v3_departure_presence_register') presence_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='176_v3_staff_document_audience') staff_document_marker,
      to_regprocedure('app.send_staff_operational_message_v3(uuid,uuid,text,text,uuid)') IS NOT NULL staff_chat_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='177_v3_staff_chat_scope') staff_chat_marker,
      to_regprocedure('app.publish_staff_departure_communication_v3(uuid,uuid,text,text,text,text,boolean,timestamp with time zone,uuid)') IS NOT NULL staff_communication_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='178_v3_staff_communication_audience') staff_communication_marker,
      to_regprocedure('app.can_edit_departure_day_v3(uuid,uuid,uuid)') IS NOT NULL staff_day_programme_authorization,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='179_v3_staff_day_programme_authorization') staff_day_programme_marker,
      to_regprocedure('app.update_departure_programme_day_staff_v3(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)') IS NOT NULL staff_programme_write,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='180_v3_staff_programme_day_write') staff_programme_write_marker,
      to_regprocedure('app.read_staff_journey_management_v3(uuid,uuid)') IS NOT NULL staff_journey_management_read,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='187_v3_staff_journey_management_read') staff_journey_management_marker,
      to_regprocedure('app.list_staff_personal_trip_documents_v3(uuid,uuid)') IS NOT NULL staff_personal_documents_read,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='188_v3_staff_personal_trip_documents') staff_personal_documents_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='189_v3_role_parity_impersonation_country_overrides') role_parity_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='190_v3_staff_collaboration_permissions') staff_collaboration_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='191_v3_staff_communication_lifecycle') staff_communication_lifecycle_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='192_v3_staff_recipient_integrity') staff_recipient_integrity_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='193_v3_guide_chat_boundary') guide_chat_boundary_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='194_v3_hide_revoked_agency_staff') hide_revoked_staff_marker,
      EXISTS(SELECT 1 FROM public.platform_schema_migrations WHERE version='195_v3_staff_temporal_access_fix') staff_temporal_access_fix_marker,
      to_regprocedure('app.save_country_profile_override_v3(uuid,uuid,uuid,jsonb)') IS NOT NULL country_profile_override_write,
      to_regprocedure('app.acknowledge_staff_communication_v3(uuid,uuid,uuid)') IS NOT NULL staff_communication_ack`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.123.0-native-operational-runtime", checksum],
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
