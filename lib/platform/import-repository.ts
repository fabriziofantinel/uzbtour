import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { catalogValidationIssues, travelProgrammeDraftSchema, type TravelProgrammeDraft } from "./import-schema";
import type { PlatformImportReview } from "./types";
import { prepareTravelCatalog } from "./travel-catalog";
import { assertNormalizedImportSchema } from "./schema-readiness";

type ImportSourceRow = {
  id: string;
  agency_id: string;
  template_id: string;
  document_id: string;
  provider: "vercel_blob" | "r2";
  bucket: string;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number | null;
  uploaded_by_user_id: string | null;
  status: string;
};

export async function getImportAgency(importId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT agency_id::text
    FROM import_jobs
    WHERE id = ${importId}
    LIMIT 1
  `;
  if (!rows[0]) throw new PlatformRequestError("Importazione non trovata");
  return String(rows[0].agency_id);
}

export async function getImportQueueRecord(importId: string, agencyId: string) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    txn`
      SELECT pj.job_type, pj.payload, pj.idempotency_key
      FROM ops.platform_jobs pj
      JOIN ops.import_jobs ij
        ON ij.agency_id = pj.agency_id
       AND (ij.id = pj.import_job_id OR ij.id::text = pj.payload->>'importId')
      WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
        AND pj.job_type = 'travel-programme.import'
      ORDER BY pj.created_at DESC
      LIMIT 1
    `,
  ], { readOnly: true });
  if (!rows[0]) throw new PlatformRequestError("Lavoro di importazione non trovato");
  return {
    type: String(rows[0].job_type),
    payload: rows[0].payload as Record<string, unknown>,
    idempotencyKey: String(rows[0].idempotency_key),
  };
}

export async function claimImportJob(
  importId: string,
  expected?: { jobId?: string; agencyId?: string }
) {
  const sql = getSql();
  const rows = await sql`
    WITH claimed_job AS (
      UPDATE platform_jobs
      SET status = 'processing', locked_at = NOW(), attempt_count = attempt_count + 1,
          error_message = NULL, updated_at = NOW()
      WHERE id = (
        SELECT id FROM platform_jobs
        WHERE payload->>'importId' = ${importId}
          AND job_type = 'travel-programme.import'
          AND (
            status IN ('queued', 'failed')
            OR (status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes')
          )
          AND (${expected?.jobId ?? null}::text IS NULL OR id::text = ${expected?.jobId ?? null})
          AND (${expected?.agencyId ?? null}::text IS NULL OR agency_id::text = ${expected?.agencyId ?? null})
        ORDER BY created_at
        LIMIT 1
      )
      RETURNING id
    ), changed_import AS (
      UPDATE import_jobs
      SET status = 'extracting', attempt_count = attempt_count + 1,
          error_message = NULL, started_at = NOW(), updated_at = NOW()
      WHERE id = ${importId} AND EXISTS (SELECT 1 FROM claimed_job)
      RETURNING *
    )
    SELECT
      ci.id::text, ci.agency_id::text, ci.template_id::text, ci.document_id::text,
      ma.provider, ma.bucket, ma.object_key, ma.original_name,
      ma.content_type, ma.size_bytes, ma.uploaded_by_user_id, ci.status
    FROM changed_import ci
    JOIN travel_documents td ON td.id = ci.document_id AND td.agency_id = ci.agency_id
    JOIN media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ci.agency_id
  `;
  if (!rows[0]) {
    throw new PlatformRequestError("Importazione già in elaborazione o non accodabile");
  }
  return rows[0] as ImportSourceRow;
}

export async function saveNormalizedImportDocument(input: {
  importId: string;
  agencyId: string;
  templateId: string;
  uploadedByUserId: string | null;
  provider: "r2";
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}) {
  const sql = getSql();
  const mediaId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const rows = await sql`
    WITH media AS (
      INSERT INTO media_assets (
        id, agency_id, uploaded_by_user_id, provider, bucket, object_key,
        original_name, content_type, size_bytes, checksum_sha256,
        purpose, visibility, status, metadata
      ) VALUES (
        ${mediaId}, ${input.agencyId}, ${input.uploadedByUserId}, ${input.provider},
        ${input.bucket}, ${input.objectKey}, ${input.originalName}, ${input.contentType},
        ${input.sizeBytes}, ${input.checksumSha256}, 'travel_programme_normalized',
        'agency', 'ready', ${JSON.stringify({ format: "smf-travel-canonical-v1", sourceImportId: input.importId })}::jsonb
      )
      ON CONFLICT (provider, bucket, object_key) DO UPDATE SET
        original_name = EXCLUDED.original_name,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        checksum_sha256 = EXCLUDED.checksum_sha256,
        status = 'ready', metadata = EXCLUDED.metadata, updated_at = NOW()
      RETURNING id
    ), document AS (
      INSERT INTO travel_documents (
        id, agency_id, template_id, media_asset_id, document_type, title, status
      ) SELECT
        ${documentId}, ${input.agencyId}, ${input.templateId}, media.id,
        'normalized_programme', ${input.originalName}, 'ready'
      FROM media
      ON CONFLICT (media_asset_id) DO UPDATE SET title = EXCLUDED.title, status = 'ready'
      RETURNING id
    ), updated AS (
      UPDATE import_jobs
      SET normalized_document_id = document.id, updated_at = NOW()
      FROM document
      WHERE import_jobs.id = ${input.importId}
        AND import_jobs.agency_id = ${input.agencyId}
        AND import_jobs.template_id = ${input.templateId}
      RETURNING document.id
    )
    SELECT id::text FROM updated
  `;
  if (!rows[0]) throw new PlatformRequestError("Registrazione del preventivo normalizzato non riuscita");
  return String(rows[0].id);
}

export async function getPlatformJobStatus(jobId: string, agencyId: string) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    txn`SELECT status FROM ops.platform_jobs WHERE id = ${jobId} AND agency_id = ${agencyId} LIMIT 1`,
  ], { readOnly: true });
  return rows[0]?.status ? String(rows[0].status) : null;
}

export async function markImportGenerating(importId: string) {
  const sql = getSql();
  await sql`
    UPDATE import_jobs SET status = 'generating', updated_at = NOW() WHERE id = ${importId}
  `;
}

export async function completeImport(input: {
  importId: string;
  draft: TravelProgrammeDraft;
  model: string;
  provider: string;
  usage: unknown;
}) {
  const sql = getSql();
  await sql.transaction((txn) => [
    txn`
      UPDATE import_jobs
      SET status = 'ready_for_review', result = ${JSON.stringify(input.draft)}::jsonb,
          extraction_provider = ${input.provider}, ai_provider = ${input.model},
          completed_at = NOW(), updated_at = NOW()
      WHERE id = ${input.importId}
    `,
    txn`
      UPDATE travel_documents SET status = 'ready'
      WHERE id IN (
        SELECT document_id FROM import_jobs WHERE id = ${input.importId}
        UNION
        SELECT normalized_document_id FROM import_jobs
        WHERE id = ${input.importId} AND normalized_document_id IS NOT NULL
      )
    `,
    txn`
      UPDATE platform_jobs
      SET status = 'completed', completed_at = NOW(), locked_at = NULL,
          payload = payload || ${JSON.stringify({ usage: input.usage })}::jsonb,
          updated_at = NOW()
      WHERE payload->>'importId' = ${input.importId} AND job_type = 'travel-programme.import'
    `,
  ]);
}

export async function failImport(importId: string, error: unknown) {
  const sql = getSql();
  const message = (error instanceof Error ? error.message : "Errore sconosciuto").slice(0, 1200);
  await sql.transaction((txn) => [
    txn`
      UPDATE import_jobs
      SET status = 'failed', error_message = ${message}, completed_at = NOW(), updated_at = NOW()
      WHERE id = ${importId}
    `,
    txn`
      UPDATE travel_documents SET status = 'failed'
      WHERE id IN (
        SELECT document_id FROM import_jobs WHERE id = ${importId}
        UNION
        SELECT normalized_document_id FROM import_jobs
        WHERE id = ${importId} AND normalized_document_id IS NOT NULL
      )
    `,
    txn`
      UPDATE platform_jobs
      SET status = 'failed', error_message = ${message}, locked_at = NULL, updated_at = NOW()
      WHERE payload->>'importId' = ${importId} AND job_type = 'travel-programme.import'
    `,
  ]);
}

export async function getImportForReview(
  importId: string,
  agencyId: string
): Promise<PlatformImportReview> {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    txn`
    SELECT
      ij.id::text, ij.agency_id::text, ij.template_id::text, ij.status,
      ij.result, ij.error_message, ij.result->>'legacyAiProvider' AS ai_provider,
      ij.created_at::text,
      tt.title AS trip_title, ma.original_name AS source_file_name,
      normalized_media.original_name AS normalized_file_name
    FROM ops.import_jobs ij
    JOIN travel.trip_templates tt ON tt.id = ij.template_id AND tt.agency_id = ij.agency_id
    JOIN ops.travel_documents td ON td.id = ij.source_document_id AND td.agency_id = ij.agency_id
    JOIN ops.media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    LEFT JOIN ops.travel_documents normalized_document
      ON normalized_document.id = ij.normalized_document_id
      AND normalized_document.agency_id = ij.agency_id
    LEFT JOIN ops.media_assets normalized_media
      ON normalized_media.id = normalized_document.media_asset_id
      AND normalized_media.agency_id = ij.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
    LIMIT 1
    `,
  ], { readOnly: true });
  if (!rows[0]) throw new PlatformRequestError("Importazione non trovata");
  const row = rows[0];
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    templateId: String(row.template_id),
    status: String(row.status),
    draft: row.result ? travelProgrammeDraftSchema.parse(row.result) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    model: row.ai_provider ? String(row.ai_provider) : null,
    createdAt: String(row.created_at),
    tripTitle: String(row.trip_title),
    sourceFileName: String(row.source_file_name),
    normalizedFileName: row.normalized_file_name ? String(row.normalized_file_name) : null,
  };
}

export async function getNormalizedImportDocument(importId: string, agencyId: string) {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    txn`
    SELECT ma.provider, ma.bucket, ma.object_key, ma.original_name, ma.content_type
    FROM ops.import_jobs ij
    JOIN ops.travel_documents td
      ON td.id = ij.normalized_document_id AND td.agency_id = ij.agency_id
    JOIN ops.media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
      AND td.status = 'ready' AND ma.status = 'ready'
    LIMIT 1
    `,
  ], { readOnly: true });
  if (!rows[0]) throw new PlatformRequestError("Preventivo normalizzato non disponibile");
  return {
    provider: String(rows[0].provider), bucket: String(rows[0].bucket),
    objectKey: String(rows[0].object_key), originalName: String(rows[0].original_name),
    contentType: String(rows[0].content_type),
  };
}

export async function getImportDeletionTarget(importId: string, agencyId: string) {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    txn`
    SELECT ij.status, documents.document_id::text, documents.media_asset_id::text,
      documents.provider, documents.bucket, documents.object_key
    FROM ops.import_jobs ij
    CROSS JOIN LATERAL (
      SELECT td.id AS document_id, ma.id AS media_asset_id,
        ma.provider, ma.bucket, ma.object_key
      FROM ops.travel_documents td
      JOIN ops.media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = td.agency_id
      WHERE td.agency_id = ij.agency_id
        AND td.id IN (ij.source_document_id, ij.normalized_document_id)
    ) documents
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
      AND ij.status IN ('ready_for_review', 'failed')
      AND documents.provider = 'r2'
    `,
  ], { readOnly: true });
  if (!rows[0]) throw new PlatformRequestError("La bozza non può essere eliminata");
  return rows.map((row) => ({
    status: String(row.status), documentId: String(row.document_id),
    mediaAssetId: String(row.media_asset_id), provider: "r2" as const,
    bucket: String(row.bucket), objectKey: String(row.object_key),
  }));
}

export async function deleteImportDraftRecords(input: {
  importId: string;
  agencyId: string;
  documentIds: string[];
  mediaAssetIds: string[];
}) {
  const sql = getSql();
  const results = await sql.transaction((transaction) => [
    transaction`
      DELETE FROM audit_events
      WHERE agency_id = ${input.agencyId}
        AND entity_type = 'import_job' AND entity_id = ${input.importId}
    `,
    transaction`
      DELETE FROM platform_jobs
      WHERE agency_id = ${input.agencyId} AND payload->>'importId' = ${input.importId}
    `,
    transaction`
      DELETE FROM import_jobs
      WHERE id = ${input.importId} AND agency_id = ${input.agencyId}
        AND status IN ('ready_for_review', 'failed')
      RETURNING id
    `,
    transaction`
      DELETE FROM travel_documents
      WHERE id = ANY(${input.documentIds}::uuid[]) AND agency_id = ${input.agencyId}
    `,
    transaction`
      DELETE FROM media_assets
      WHERE id = ANY(${input.mediaAssetIds}::uuid[]) AND agency_id = ${input.agencyId}
    `,
  ]);
  if (results[2].length !== 1) throw new PlatformRequestError("Eliminazione della bozza non riuscita");
}

export async function saveImportDraft(input: {
  importId: string;
  agencyId: string;
  actorId: string;
  draft: TravelProgrammeDraft;
}) {
  const sql = getSql();
  const rows = await sql`
    WITH updated AS (
      UPDATE import_jobs
      SET result = ${JSON.stringify(input.draft)}::jsonb, updated_at = NOW()
      WHERE id = ${input.importId} AND agency_id = ${input.agencyId}
        AND status = 'ready_for_review'
      RETURNING id
    ), audit AS (
      INSERT INTO audit_events (
        agency_id, actor_user_id, entity_type, entity_id, action, changes
      )
      SELECT ${input.agencyId}, ${input.actorId}, 'import_job', id::text, 'review_saved', '{}'::jsonb
      FROM updated
    )
    SELECT id::text FROM updated
  `;
  if (!rows[0]) throw new PlatformRequestError("La bozza non è modificabile");
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function publishImport(input: {
  importId: string;
  agencyId: string;
  actorId: string;
  draft: TravelProgrammeDraft;
}) {
  const validationIssues = catalogValidationIssues(input.draft);
  if (validationIssues.length > 0) {
    throw new PlatformRequestError(
      `Completa la validazione delle anagrafiche: ${validationIssues.slice(0, 5).join("; ")}${validationIssues.length > 5 ? `; e altre ${validationIssues.length - 5}` : ""}`
    );
  }
  const sql = getSql();
  const [, versionRows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      SELECT tv.id::text AS version_id, ij.template_id::text
      FROM ops.import_jobs ij
      JOIN travel.trip_template_versions tv
        ON tv.template_id = ij.template_id AND tv.agency_id = ij.agency_id
      WHERE ij.id = ${input.importId} AND ij.agency_id = ${input.agencyId}
        AND ij.status = 'ready_for_review'
      ORDER BY tv.version_number DESC
      LIMIT 1
    `,
  ], { readOnly: true });
  if (!versionRows[0]) throw new PlatformRequestError("Importazione non pubblicabile");
  const versionId = String(versionRows[0].version_id);
  const templateId = String(versionRows[0].template_id);
  const startDate = validDate(input.draft.startDate) ?? input.draft.days.map((day) => validDate(day.date)).find(Boolean) ?? null;
  const endDate = validDate(input.draft.endDate) ?? input.draft.days.map((day) => validDate(day.date)).filter(Boolean).at(-1) ?? null;
  if (!startDate || !endDate || endDate < startDate) {
    throw new PlatformRequestError("Controlla data iniziale e finale del viaggio prima di pubblicare");
  }
  const catalog = await prepareTravelCatalog(input.draft);
  const [, existingDepartures] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      SELECT id::text, code FROM travel.departures
      WHERE agency_id = ${input.agencyId} AND template_id = ${templateId}
      ORDER BY created_at LIMIT 1
    `,
  ], { readOnly: true });
  const departureId = existingDepartures[0]?.id ? String(existingDepartures[0].id) : crypto.randomUUID();
  const departureCode = existingDepartures[0]?.code
    ? String(existingDepartures[0].code)
    : `V-${startDate.slice(0, 4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const dayIds = input.draft.days.map(() => crypto.randomUUID());
  await sql.transaction((txn) => {
    const queries = [
      txn`DELETE FROM useful_information WHERE agency_id = ${input.agencyId} AND template_version_id = ${versionId}`,
      txn`DELETE FROM trip_days WHERE agency_id = ${input.agencyId} AND template_version_id = ${versionId}`,
      txn`DELETE FROM trip_countries WHERE template_id = ${templateId}`,
    ];
    catalog.countries.forEach((country) => queries.push(txn`
      INSERT INTO trip_countries (template_id, country_id) VALUES (${templateId}, ${country.id})
      ON CONFLICT DO NOTHING
    `));
    input.draft.days.forEach((day, dayIndex) => {
      const dayId = dayIds[dayIndex];
      const references = catalog.dayReferences[dayIndex];
      queries.push(txn`
        INSERT INTO trip_days (
          id, agency_id, template_version_id, day_number, day_offset, label,
          title, city, description, source_date, metadata
        ) VALUES (
          ${dayId}, ${input.agencyId}, ${versionId}, ${dayIndex + 1}, ${dayIndex},
          ${day.label}, ${day.title}, ${day.city}, ${day.description}, ${validDate(day.date)},
          ${JSON.stringify({
            importedDayNumber: day.dayNumber,
            country: day.country,
            countryValidation: day.countryValidation,
            cityValidation: day.cityValidation,
          })}::jsonb
        )
      `);
      references.cityIds.forEach((cityId) => queries.push(txn`
        INSERT INTO trip_day_cities (trip_day_id, city_id) VALUES (${dayId}, ${cityId})
        ON CONFLICT DO NOTHING
      `));
      references.siteIds.forEach((siteId) => queries.push(txn`
        INSERT INTO trip_day_sites (trip_day_id, site_id) VALUES (${dayId}, ${siteId})
        ON CONFLICT DO NOTHING
      `));
      if (references.hotelId) queries.push(txn`
        INSERT INTO trip_day_hotels (trip_day_id, hotel_id) VALUES (${dayId}, ${references.hotelId})
        ON CONFLICT DO NOTHING
      `);
      day.activities.forEach((activity, activityIndex) => {
        queries.push(txn`
          INSERT INTO itinerary_items (
            agency_id, trip_day_id, item_type, title, description,
            starts_at, ends_at, sort_order, metadata
          ) VALUES (
            ${input.agencyId}, ${dayId}, ${activity.type}, ${activity.title},
            ${activity.description}, ${validTime(activity.startsAt)}, ${validTime(activity.endsAt)},
            ${activityIndex}, ${JSON.stringify({
              placeName: activity.placeName,
              placeCity: activity.placeCity,
              placeCountry: activity.placeCountry,
              placeValidation: activity.placeValidation,
              includedInQuote: activity.includedInQuote,
            })}::jsonb
          )
        `);
      });
      if (day.accommodation.name.trim()) {
        queries.push(txn`
          INSERT INTO accommodations (
            agency_id, trip_day_id, name, notes, metadata
          ) VALUES (
            ${input.agencyId}, ${dayId}, ${day.accommodation.name}, ${day.accommodation.notes},
            ${JSON.stringify({
              city: day.accommodation.city,
              country: day.accommodation.country,
              validation: day.accommodation.validation,
            })}::jsonb
          )
        `);
      }
    });
    input.draft.usefulInformation.forEach((info, index) => {
      queries.push(txn`
        INSERT INTO useful_information (
          agency_id, template_version_id, category, title, body, phone, url, sort_order
        ) VALUES (
          ${input.agencyId}, ${versionId}, ${info.category}, ${info.title}, ${info.body},
          ${info.phone || null}, ${info.url || null}, ${index}
        )
      `);
    });
    queries.push(
      txn`
        UPDATE trip_templates
        SET title = ${input.draft.title}, destination_country = ${input.draft.destinationCountry || null},
            description = ${input.draft.summary}, starts_on = ${startDate}, ends_on = ${endDate},
            primary_country_id = ${catalog.primaryCountry.id}, status = 'active', updated_at = NOW()
        WHERE id = ${templateId} AND agency_id = ${input.agencyId}
      `,
      txn`
        UPDATE trip_template_versions
        SET status = 'published', published_at = NOW(),
            revision_note = 'Programma revisionato e pubblicato dall’agenzia.'
        WHERE id = ${versionId} AND agency_id = ${input.agencyId}
      `,
      txn`
        INSERT INTO departures (
          id, agency_id, template_id, template_version_id, code, title,
          starts_on, ends_on, timezone, status, published_at
        ) VALUES (
          ${departureId}, ${input.agencyId}, ${templateId}, ${versionId}, ${departureCode},
          ${input.draft.title}, ${startDate}, ${endDate}, 'Europe/Rome', 'confirmed', NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
          template_version_id = EXCLUDED.template_version_id, status = 'confirmed', updated_at = NOW()
      `,
      txn`
        UPDATE import_jobs SET status = 'published', updated_at = NOW()
        WHERE id = ${input.importId} AND agency_id = ${input.agencyId}
      `,
      txn`
        INSERT INTO audit_events (
          agency_id, actor_user_id, entity_type, entity_id, action, changes
        ) VALUES (
          ${input.agencyId}, ${input.actorId}, 'trip_template', ${templateId}, 'programme_published',
          ${JSON.stringify({ importId: input.importId, days: input.draft.days.length })}::jsonb
        )
      `,
    );
    return queries;
  });
  const [, publishedRows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`SELECT departure.id::text
    FROM travel.departures departure
    JOIN travel.trip_template_versions version
      ON version.id = departure.template_version_id
     AND version.agency_id = departure.agency_id
    JOIN ops.import_jobs import_job
      ON import_job.template_id = departure.template_id
     AND import_job.agency_id = departure.agency_id
    WHERE departure.id = ${departureId}
      AND departure.agency_id = ${input.agencyId}
      AND version.status = 'published'
      AND import_job.id = ${input.importId}
      AND import_job.status = 'published'
      AND EXISTS (
        SELECT 1 FROM travel.departure_days day
        WHERE day.agency_id = departure.agency_id
          AND day.departure_id = departure.id
      )
      LIMIT 1
    `,
  ], { readOnly: true });
  if (!publishedRows[0]) {
    throw new PlatformRequestError("Pubblicazione incompleta nel modello dati consolidato");
  }
  return { templateId, departureId, referenceTargets: catalog.targets };
}
