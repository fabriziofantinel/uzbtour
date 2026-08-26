import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const migrationVersion = "018_v3_shadow_operational_backfill";
const modelVersion = "3.3.0-shadow-operational";
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;

if (!migrationUrl) {
  throw new Error("Connessione diretta Neon non configurata: richiesto il ruolo owner di migrazione");
}

const sqlUrl = new URL("../database/backfill-v3-shadow-operational.sql", import.meta.url);
const backfillSql = await readFile(sqlUrl, "utf8");
const checksum = createHash("sha256").update(backfillSql).digest("hex");
const client = new Client(migrationUrl);
let transactionOpen = false;

const reconciliationSql = `
  WITH source_activity_groups AS (
    SELECT template_version_id, trip_day_id, content_type,
           min(id::text)::uuid AS discriminator
      FROM public.generated_content
     WHERE content_type IN ('quiz_question', 'mission', 'bingo_item')
     GROUP BY template_version_id, trip_day_id, content_type
    UNION ALL
    SELECT template_version_id, trip_day_id, content_type, id
      FROM public.generated_content
     WHERE content_type IN ('word_game', 'order_game', 'photo_contest')
  ), source_attempt_groups AS (
    SELECT party_id, traveler_id, generated_content_id
      FROM public.party_activity_results
     GROUP BY party_id, traveler_id, generated_content_id
  ), checks AS (
    SELECT 'template_useful_information' AS entity,
           (SELECT count(*) FROM public.useful_information) AS source_count,
           (SELECT count(*) FROM travel.template_useful_information) AS target_count
    UNION ALL SELECT 'template_phrasebook_entries',
           (SELECT count(*) FROM public.phrasebook_entries),
           (SELECT count(*) FROM travel.template_phrasebook_entries)
    UNION ALL SELECT 'content_activities',
           (SELECT count(*) FROM source_activity_groups),
           (SELECT count(*) FROM content.activities)
    UNION ALL SELECT 'content_activity_items',
           (SELECT count(*) FROM public.generated_content),
           (SELECT count(*) FROM content.activity_items)
    UNION ALL SELECT 'generated_content_map',
           (SELECT count(*) FROM public.generated_content),
           (SELECT count(*) FROM ops.legacy_generated_content_map)
    UNION ALL SELECT 'media_assets',
           (SELECT count(*) FROM public.media_assets),
           (SELECT count(*) FROM ops.media_assets)
    UNION ALL SELECT 'travel_documents',
           ((SELECT count(*) FROM public.travel_documents) +
            (SELECT count(*) FROM public.itinerary_item_documents)),
           (SELECT count(*) FROM ops.travel_documents)
    UNION ALL SELECT 'travel_imports',
           (SELECT count(*) FROM public.import_jobs),
           (SELECT count(*) FROM ops.import_jobs)
    UNION ALL SELECT 'platform_jobs',
           (SELECT count(*) FROM public.platform_jobs),
           (SELECT count(*) FROM ops.platform_jobs)
    UNION ALL SELECT 'audit_events',
           (SELECT count(*) FROM public.audit_events),
           (SELECT count(*) FROM ops.audit_events a
             WHERE EXISTS (
               SELECT 1 FROM public.audit_events source
                WHERE source.id = a.id
             ))
    UNION ALL SELECT 'expenses',
           (SELECT count(*) FROM public.party_expenses),
           (SELECT count(*) FROM journey.expenses)
    UNION ALL SELECT 'cash_movements',
           (SELECT count(*) FROM public.party_cash_movements),
           (SELECT count(*) FROM journey.cash_movements)
    UNION ALL SELECT 'day_notes',
           (SELECT count(*) FROM public.party_day_notes),
           (SELECT count(*) FROM journey.day_notes)
    UNION ALL SELECT 'restaurant_visits',
           (SELECT count(*) FROM public.party_restaurants),
           (SELECT count(*) FROM journey.restaurant_visits)
    UNION ALL SELECT 'memories',
           (SELECT count(*) FROM public.party_memories),
           (SELECT count(*) FROM journey.memories)
    UNION ALL SELECT 'activity_attempts',
           (SELECT count(*) FROM source_attempt_groups),
           (SELECT count(*) FROM journey.activity_attempts)
    UNION ALL SELECT 'activity_evidence',
           (SELECT count(*) FROM public.party_activity_results
             WHERE result->>'mediaId' ~* '^[0-9a-f-]{36}$'
               AND EXISTS (
                 SELECT 1 FROM public.media_assets media
                  WHERE media.id = (result->>'mediaId')::uuid
               )),
           (SELECT count(*) FROM journey.activity_evidence)
    UNION ALL SELECT 'photo_contest_entries',
           (SELECT count(*) FROM public.party_photo_contest_entries),
           (SELECT count(*) FROM journey.photo_contest_entries)
    UNION ALL SELECT 'photo_contest_judgements',
           (SELECT count(*) FROM public.party_photo_contest_entries WHERE score IS NOT NULL),
           (SELECT count(*) FROM journey.photo_contest_judgements)
    UNION ALL SELECT 'programme_feedback',
           (SELECT count(*) FROM public.traveler_programme_feedback),
           (SELECT count(*) FROM journey.programme_feedback)
  )
  SELECT entity, source_count::int, target_count::int,
         (source_count = target_count) AS reconciled
    FROM checks
   ORDER BY entity
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
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-shadow-operational', 0))");
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
