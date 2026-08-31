import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL ??
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl) throw new Error("DATABASE_RUNTIME_URL non configurata");

const sql = neon(databaseUrl);
const ownerUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL_UNPOOLED;
const ownerSql = ownerUrl ? neon(ownerUrl) : null;

const [imports, programme, runtime, migrations] = await Promise.all([
  sql`
    SELECT count(*)::int AS count
    FROM ops.import_jobs import_job
    JOIN travel.trip_templates template
      ON template.id = import_job.template_id
     AND template.agency_id = import_job.agency_id
    JOIN ops.travel_documents document
      ON document.id = import_job.source_document_id
     AND document.agency_id = import_job.agency_id
    JOIN ops.media_assets asset
      ON asset.id = document.media_asset_id
     AND asset.agency_id = import_job.agency_id
  `,
  sql`
    SELECT count(*)::int AS count
    FROM travel.departures departure
    JOIN travel.trip_template_versions version
      ON version.id = departure.template_version_id
     AND version.agency_id = departure.agency_id
    JOIN travel.template_days day
      ON day.template_version_id = version.id
     AND day.agency_id = version.agency_id
  `,
  sql`
    SELECT
      (SELECT count(*)::int FROM journey.expenses) AS expenses,
      (SELECT count(*)::int FROM journey.cash_movements) AS cash_movements,
      (SELECT count(*)::int FROM journey.programme_feedback) AS feedback,
      (SELECT count(*)::int FROM content.activities) AS activities,
      (SELECT count(*)::int FROM travel.template_accommodation_stays) AS template_stays,
      (SELECT count(*)::int FROM travel.departure_accommodation_stays) AS departure_stays
  `,
  sql`
    SELECT count(*)::int AS count
    FROM public.platform_schema_migrations
    WHERE version = ANY(ARRAY[
      '026_v3_travel_catalog_runtime',
      '028_v3_documents_import_runtime',
      '030_v3_operational_read_cutover',
      '031_v3_gamification_read_cutover',
      '032_v3_traveler_scope_read_cutover',
      '044_v3_ops_import_write_cutover',
      '045_v3_operational_stays',
      '046_v3_programme_write_cutover'
    ])
  `,
]);

if (Number(migrations[0]?.count ?? 0) !== 8) {
  throw new Error("Migrazioni V3 richieste non complete");
}

let scopedRuntime = null;
let scopedImportReview = null;
if (ownerSql) {
  const scopes = await ownerSql`
    SELECT departure.agency_id::text AS agency_id,
      departure.id::text AS departure_id, actor_map.legacy_id AS actor_id
    FROM travel.departures departure
    JOIN iam.agency_memberships membership
      ON membership.agency_id = departure.agency_id
     AND membership.status = 'active'
     AND membership.role IN ('owner','admin','editor')
    JOIN iam.users actor ON actor.id = membership.user_id AND actor.status = 'active'
    JOIN ops.legacy_id_map actor_map
      ON actor_map.target_id = actor.id
     AND actor_map.source_system = 'public-v2'
     AND actor_map.entity_type = 'user'
    ORDER BY (
      SELECT count(*) FROM travel.departure_itinerary_items item
      WHERE item.agency_id = departure.agency_id AND item.departure_id = departure.id
    ) DESC, departure.created_at
    LIMIT 1
  `;
  if (scopes[0]) {
    const scope = scopes[0];
    const authorization = await sql`
      SELECT count(*)::int AS count
      FROM app.read_journey_management(${scope.actor_id}, ${scope.departure_id})
    `;
    const [, scopedRows] = await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id', ${scope.agency_id}, true)`,
      txn`
        SELECT
          (SELECT count(*)::int FROM travel.departure_days
            WHERE agency_id = ${scope.agency_id} AND departure_id = ${scope.departure_id}) AS days,
          (SELECT count(*)::int FROM travel.departure_itinerary_items
            WHERE agency_id = ${scope.agency_id} AND departure_id = ${scope.departure_id}) AS items,
          (SELECT count(*)::int FROM travel.departure_accommodation_stays
            WHERE agency_id = ${scope.agency_id} AND departure_id = ${scope.departure_id}) AS stays,
          (SELECT count(*)::int FROM ops.travel_documents
            WHERE agency_id = ${scope.agency_id} AND departure_id = ${scope.departure_id}) AS documents,
          (SELECT count(*)::int FROM content.activities
            WHERE agency_id = ${scope.agency_id}) AS activities
      `,
    ], { readOnly: true });
    if (Number(authorization[0]?.count ?? 0) < 1) {
      throw new Error("Autorizzazione IAM del programma operativo non riuscita");
    }
    scopedRuntime = scopedRows[0] ?? null;
  }
  const importScopes = await ownerSql`
    SELECT id::text AS import_id, agency_id::text AS agency_id
    FROM ops.import_jobs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (importScopes[0]) {
    const scope = importScopes[0];
    const [, reviewRows] = await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id', ${scope.agency_id}, true)`,
      txn`
        SELECT import_job.id::text, template.title,
          source_asset.original_name AS source_file_name,
          import_job.result->>'legacyAiProvider' AS ai_provider
        FROM ops.import_jobs import_job
        JOIN travel.trip_templates template
          ON template.id = import_job.template_id
         AND template.agency_id = import_job.agency_id
        JOIN ops.travel_documents source_document
          ON source_document.id = import_job.source_document_id
         AND source_document.agency_id = import_job.agency_id
        JOIN ops.media_assets source_asset
          ON source_asset.id = source_document.media_asset_id
         AND source_asset.agency_id = import_job.agency_id
        WHERE import_job.id = ${scope.import_id}
          AND import_job.agency_id = ${scope.agency_id}
        LIMIT 1
      `,
    ], { readOnly: true });
    if (!reviewRows[0]) throw new Error("Lettura V3 della revisione import non riuscita");
    scopedImportReview = true;
  }
}

console.log(JSON.stringify({
  status: "passed",
  imports: Number(imports[0]?.count ?? 0),
  programmeDays: Number(programme[0]?.count ?? 0),
  travelerRuntime: runtime[0] ?? {},
  scopedRuntime,
  scopedImportReview,
}));
