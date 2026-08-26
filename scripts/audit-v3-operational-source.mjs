import { Client } from "@neondatabase/serverless";

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Connessione runtime Neon non configurata");

const tables = [
  "generated_content", "useful_information", "phrasebook_entries", "media_assets",
  "travel_documents", "import_jobs", "platform_jobs", "audit_events",
  "party_expenses", "party_activity_results", "party_memories",
  "party_photo_contest_entries", "party_day_notes", "party_restaurants",
  "party_cash_movements", "itinerary_item_documents", "traveler_programme_feedback",
];

const client = new Client(databaseUrl);

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");

  const columns = (
    await client.query(`
      SELECT table_name, jsonb_agg(column_name ORDER BY ordinal_position) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      GROUP BY table_name ORDER BY table_name
    `, [tables])
  ).rows;

  const generated = await client.query(`
    SELECT content_type, status, source, count(DISTINCT g.id)::int AS count,
           array_agg(DISTINCT key ORDER BY key) AS json_keys
    FROM public.generated_content g
    LEFT JOIN LATERAL jsonb_object_keys(
      CASE WHEN jsonb_typeof(g.content) = 'object' THEN g.content ELSE '{}'::jsonb END
    ) key ON true
    GROUP BY content_type, status, source
    ORDER BY content_type, status, source
  `);

  const generatedExamples = await client.query(`
    SELECT DISTINCT ON (content_type)
      content_type, title, content
    FROM public.generated_content
    ORDER BY content_type, status = 'approved' DESC, sort_order, id
  `);

  const generatedProfiles = await client.query(`
    WITH grouped AS (
      SELECT template_version_id, trip_day_id, content_type,
             count(*)::int AS item_count
      FROM public.generated_content
      GROUP BY template_version_id, trip_day_id, content_type
    )
    SELECT content_type, trip_day_id IS NULL AS trip_level, item_count,
           count(*)::int AS group_count
    FROM grouped
    GROUP BY content_type, trip_day_id IS NULL, item_count
    ORDER BY content_type, trip_level DESC, item_count
  `);

  const gameSubtypes = await client.query(`
    SELECT content_type, coalesce(content->>'type', '') AS subtype, count(*)::int AS count
    FROM public.generated_content
    WHERE content_type IN ('word_game', 'order_game')
    GROUP BY content_type, coalesce(content->>'type', '')
    ORDER BY content_type, subtype
  `);

  const contestInference = await client.query(`
    WITH inferred AS (
      SELECT template_version_id, trip_day_id,
             CASE WHEN lower(title || ' ' || content::text) ~ 'liber[oaie]'
                  THEN 'free' ELSE 'theme' END AS category
      FROM public.generated_content
      WHERE content_type = 'photo_contest'
    ), per_day AS (
      SELECT template_version_id, trip_day_id,
             count(*) FILTER (WHERE category = 'free')::int AS free_count,
             count(*) FILTER (WHERE category = 'theme')::int AS theme_count
      FROM inferred GROUP BY template_version_id, trip_day_id
    )
    SELECT free_count, theme_count, count(*)::int AS day_groups
    FROM per_day GROUP BY free_count, theme_count ORDER BY free_count, theme_count
  `);

  const operationalGroups = await client.query(`
    SELECT 'media_assets' AS entity, provider AS dimension_a, purpose AS dimension_b,
           status AS dimension_c, count(*)::int AS count
      FROM public.media_assets GROUP BY provider, purpose, status
    UNION ALL
    SELECT 'travel_documents', document_type, status, '', count(*)::int
      FROM public.travel_documents GROUP BY document_type, status
    UNION ALL
    SELECT 'import_jobs', status, coalesce(extraction_provider, ''), coalesce(ai_provider, ''), count(*)::int
      FROM public.import_jobs GROUP BY status, extraction_provider, ai_provider
    UNION ALL
    SELECT 'platform_jobs', provider, status, job_type, count(*)::int
      FROM public.platform_jobs GROUP BY provider, status, job_type
    ORDER BY entity, dimension_a, dimension_b, dimension_c
  `);

  const blockers = (
    await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.media_assets WHERE provider = 'vercel_blob') AS vercel_blob_assets,
        (SELECT count(*)::int FROM public.media_assets WHERE size_bytes IS NULL) AS assets_without_size,
        (SELECT count(*)::int FROM public.media_assets
          WHERE checksum_sha256 IS NOT NULL AND checksum_sha256 !~ '^[0-9a-f]{64}$') AS invalid_asset_checksums,
        (SELECT count(*)::int FROM public.media_assets
          WHERE party_id IS NOT NULL AND departure_id IS NULL) AS party_assets_without_departure,
        (SELECT count(*)::int FROM public.travel_documents
          WHERE num_nonnulls(template_id, departure_id) <> 1) AS invalid_document_scopes,
        (SELECT count(*)::int FROM public.party_expenses e
          LEFT JOIN public.traveler_profiles t
            ON t.agency_id = e.agency_id AND t.user_id = e.paid_by_user_id
          WHERE e.paid_by_user_id IS NOT NULL AND t.id IS NULL) AS expenses_without_payer_profile,
        (SELECT count(*)::int FROM public.party_cash_movements c
          LEFT JOIN public.traveler_profiles t
            ON t.agency_id = c.agency_id AND t.user_id = c.added_by_user_id
          WHERE c.added_by_user_id IS NOT NULL AND t.id IS NULL) AS cash_without_actor_profile,
        (SELECT count(*)::int FROM public.party_expenses WHERE client_operation_id IS NULL) AS expenses_without_client_operation,
        (SELECT count(*)::int FROM public.party_cash_movements WHERE client_operation_id IS NULL) AS cash_without_client_operation,
        (SELECT count(*)::int FROM public.party_cash_movements WHERE coalesce(fee_euro, 0) <> 0) AS cash_with_legacy_fee,
        (SELECT count(*)::int FROM public.import_jobs
          WHERE result IS NOT NULL AND jsonb_typeof(result) <> 'object') AS imports_with_non_object_result,
        (SELECT count(*)::int FROM public.import_jobs i
          LEFT JOIN public.travel_documents d ON d.id = i.normalized_document_id
          WHERE i.normalized_document_id IS NOT NULL AND d.id IS NULL) AS orphan_normalized_documents
    `)
  ).rows[0];

  const journeyCounts = (
    await client.query(`
      SELECT jsonb_object_agg(table_name, row_count ORDER BY table_name) AS counts
      FROM (
        SELECT 'party_expenses' AS table_name, count(*)::int AS row_count FROM public.party_expenses
        UNION ALL SELECT 'party_activity_results', count(*)::int FROM public.party_activity_results
        UNION ALL SELECT 'party_memories', count(*)::int FROM public.party_memories
        UNION ALL SELECT 'party_photo_contest_entries', count(*)::int FROM public.party_photo_contest_entries
        UNION ALL SELECT 'party_day_notes', count(*)::int FROM public.party_day_notes
        UNION ALL SELECT 'party_restaurants', count(*)::int FROM public.party_restaurants
        UNION ALL SELECT 'party_cash_movements', count(*)::int FROM public.party_cash_movements
        UNION ALL SELECT 'itinerary_item_documents', count(*)::int FROM public.itinerary_item_documents
        UNION ALL SELECT 'traveler_programme_feedback', count(*)::int FROM public.traveler_programme_feedback
      ) x
    `)
  ).rows[0].counts;

  const contentCounts = (
    await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.useful_information) AS useful_information,
        (SELECT count(*)::int FROM public.phrasebook_entries) AS phrasebook_entries,
        (SELECT count(*)::int FROM public.generated_content) AS generated_content,
        (SELECT count(*)::int FROM public.generated_content WHERE trip_day_id IS NULL) AS trip_level_content,
        (SELECT count(*)::int FROM public.generated_content WHERE trip_day_id IS NOT NULL) AS day_level_content
    `)
  ).rows[0];

  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    status: "passed",
    columns,
    contentCounts,
    generated: generated.rows,
    generatedExamples: generatedExamples.rows,
    generatedProfiles: generatedProfiles.rows,
    gameSubtypes: gameSubtypes.rows,
    contestInference: contestInference.rows,
    operationalGroups: operationalGroups.rows,
    journeyCounts,
    blockers,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
