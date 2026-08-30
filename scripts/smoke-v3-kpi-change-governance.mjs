import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");

const client = new Client(url);
try {
  await client.connect();
  const migration = (await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM public.platform_schema_migrations
      WHERE version='103_v3_kpi_change_content_governance'
    ) AS applied
  `)).rows[0];
  if (!migration?.applied) throw new Error("Migrazione 103 non applicata");

  const definitions = (await client.query(`
    SELECT code, formula, cardinality(source_events) AS source_count
    FROM ops.analytics_kpi_definitions
    WHERE version=1
    ORDER BY code
  `)).rows;
  const required = new Set(["activation_rate", "departure_adoption", "programme_usage", "document_usage", "engagement_rate", "notification_open_rate"]);
  for (const row of definitions) {
    if (!row.formula || Number(row.source_count) < 1) throw new Error(`KPI incompleto: ${row.code}`);
    required.delete(row.code);
  }
  if (required.size) throw new Error(`KPI mancanti: ${[...required].join(", ")}`);

  const columns = (await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='travel' AND table_name='template_useful_information'
      AND column_name IN ('source_name','source_url','source_retrieved_at','verified_at','expires_at','review_status','reviewed_by','disclaimer')
  `)).rows.map((row) => row.column_name);
  if (columns.length !== 8) throw new Error(`Governance fonti incompleta: ${columns.join(", ")}`);

  const gates = (await client.query(`
    SELECT
      has_function_privilege('smf_app','app.acknowledge_traveler_change_notice_v3(text,uuid,uuid)','EXECUTE') AS acknowledge,
      has_function_privilege('smf_app','app.publish_traveler_change_notice_v3(text,uuid,uuid,text,text,text,text,jsonb,jsonb)','EXECUTE') AS publish_notice,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops' AND c.relname='traveler_change_notices') AS notices_rls,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops' AND c.relname='traveler_change_notice_receipts') AS receipts_rls
  `)).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gates)}`);

  console.log(JSON.stringify({
    status: "passed",
    migration: "103_v3_kpi_change_content_governance",
    kpiDefinitions: definitions.length,
    governedSourceColumns: columns.length,
    gates,
  }));
} finally {
  await client.end().catch(() => undefined);
}
