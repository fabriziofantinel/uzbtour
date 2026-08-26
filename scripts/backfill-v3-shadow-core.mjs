import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const migrationVersion = "017_v3_shadow_core_backfill";
const modelVersion = "3.2.1-shadow-core";
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;

if (!migrationUrl) {
  throw new Error("Connessione owner diretta non configurata per il backfill core");
}

const sqlUrl = new URL("../database/backfill-v3-shadow-core.sql", import.meta.url);
const backfillSql = await readFile(sqlUrl, "utf8");
const checksum = createHash("sha256").update(backfillSql).digest("hex");
const client = new Client(migrationUrl);
let transactionOpen = false;

const reconciliationSql = `
  WITH checks AS (
    SELECT 'users' AS entity, (SELECT count(*) FROM public.platform_users) AS source_count,
           (SELECT count(*) FROM iam.users) AS target_count
    UNION ALL SELECT 'agencies', (SELECT count(*) FROM public.agencies), (SELECT count(*) FROM iam.agencies)
    UNION ALL SELECT 'agency_memberships', (SELECT count(*) FROM public.agency_memberships), (SELECT count(*) FROM iam.agency_memberships)
    UNION ALL SELECT 'countries', (SELECT count(*) FROM public.countries), (SELECT count(*) FROM ref.countries)
    UNION ALL SELECT 'cities', (SELECT count(*) FROM public.cities), (SELECT count(*) FROM ref.cities)
    UNION ALL SELECT 'visit_sites', (SELECT count(*) FROM public.visit_sites), (SELECT count(*) FROM ref.visit_sites)
    UNION ALL SELECT 'hotels', (SELECT count(*) FROM public.hotels), (SELECT count(*) FROM ref.hotels)
    UNION ALL SELECT 'reference_contents', (SELECT count(*) FROM public.reference_contents), (SELECT count(*) FROM ref.reference_contents)
    UNION ALL SELECT 'trip_templates', (SELECT count(*) FROM public.trip_templates), (SELECT count(*) FROM travel.trip_templates)
    UNION ALL SELECT 'template_countries',
      (SELECT count(*) FROM (
        SELECT t.id, t.primary_country_id AS country_id FROM public.trip_templates t WHERE t.primary_country_id IS NOT NULL
        UNION SELECT tc.template_id, tc.country_id FROM public.trip_countries tc
      ) source_countries),
      (SELECT count(*) FROM travel.template_countries)
    UNION ALL SELECT 'trip_template_versions', (SELECT count(*) FROM public.trip_template_versions), (SELECT count(*) FROM travel.trip_template_versions)
    UNION ALL SELECT 'template_days', (SELECT count(*) FROM public.trip_days), (SELECT count(*) FROM travel.template_days)
    UNION ALL SELECT 'template_day_cities', (SELECT count(*) FROM public.trip_day_cities), (SELECT count(*) FROM travel.template_day_cities)
    UNION ALL SELECT 'template_day_sites', (SELECT count(*) FROM public.trip_day_sites), (SELECT count(*) FROM travel.template_day_sites)
    UNION ALL SELECT 'template_day_hotels', (SELECT count(*) FROM public.trip_day_hotels), (SELECT count(*) FROM travel.template_day_hotels)
    UNION ALL SELECT 'template_items', (SELECT count(*) FROM public.itinerary_items), (SELECT count(*) FROM travel.template_itinerary_items)
    UNION ALL SELECT 'departures', (SELECT count(*) FROM public.departures), (SELECT count(*) FROM travel.departures)
    UNION ALL SELECT 'departure_days',
      (SELECT count(*) FROM public.departures d JOIN public.trip_days td ON td.template_version_id = d.template_version_id),
      (SELECT count(*) FROM travel.departure_days)
    UNION ALL SELECT 'departure_items',
      (SELECT count(*) FROM public.departures d JOIN public.trip_days td ON td.template_version_id = d.template_version_id JOIN public.itinerary_items i ON i.trip_day_id = td.id),
      (SELECT count(*) FROM travel.departure_itinerary_items)
    UNION ALL SELECT 'traveler_profiles', (SELECT count(*) FROM public.traveler_profiles), (SELECT count(*) FROM travel.traveler_profiles)
    UNION ALL SELECT 'travel_parties', (SELECT count(*) FROM public.travel_parties), (SELECT count(*) FROM travel.travel_parties)
    UNION ALL SELECT 'party_memberships', (SELECT count(*) FROM public.party_memberships), (SELECT count(*) FROM travel.party_memberships)
  )
  SELECT entity, source_count::int, target_count::int,
         (source_count = target_count) AS reconciled
  FROM checks ORDER BY entity
`;

try {
  await client.connect();
  const capability = await client.query(`
    SELECT current_user AS role_name,
           has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
           current_user = 'smf_app' AS is_runtime_role
  `);
  const role = capability.rows[0];
  if (!role || role.is_runtime_role || !role.can_create) {
    throw new Error(`Ruolo non autorizzato al backfill: ${role?.role_name ?? "sconosciuto"}`);
  }

  const startedAt = performance.now();
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '15min'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-shadow-core', 0))");
  await client.query(backfillSql);

  const reconciliation = (await client.query(reconciliationSql)).rows;
  const failures = reconciliation.filter((row) => !row.reconciled);
  if (failures.length > 0) {
    throw new Error(`Riconciliazione fallita: ${JSON.stringify(failures)}`);
  }

  const executionMs = Math.round(performance.now() - startedAt);
  if (apply) {
    const previous = await client.query(
      "SELECT checksum_sha256 FROM ops.schema_migrations WHERE version = $1",
      [modelVersion],
    );
    if (previous.rowCount > 0 && previous.rows[0].checksum_sha256 !== checksum) {
      throw new Error(`Checksum differente per ${modelVersion}: applicazione interrotta`);
    }
    await client.query(
      `INSERT INTO ops.schema_migrations (version, checksum_sha256, execution_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE SET execution_ms = EXCLUDED.execution_ms,
         applied_at = clock_timestamp()`,
      [modelVersion, checksum, executionMs],
    );
    await client.query(
      `INSERT INTO public.platform_schema_migrations (version)
       VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      [migrationVersion],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  transactionOpen = false;

  console.log(JSON.stringify({
    status: apply ? "applied" : "dry_run_passed",
    migrationVersion,
    modelVersion,
    checksum,
    executionMs,
    role: role.role_name,
    reconciliation,
  }, null, 2));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
