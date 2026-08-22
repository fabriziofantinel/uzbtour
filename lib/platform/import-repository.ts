import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { travelProgrammeDraftSchema, type TravelProgrammeDraft } from "./import-schema";
import type { PlatformImportReview } from "./types";

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
  const rows = await sql`
    SELECT pj.job_type, pj.payload, pj.idempotency_key
    FROM platform_jobs pj
    JOIN import_jobs ij
      ON ij.id::text = pj.payload->>'importId' AND ij.agency_id = pj.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
      AND pj.job_type = 'travel-programme.import'
    ORDER BY pj.created_at DESC
    LIMIT 1
  `;
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
      ma.content_type, ma.size_bytes, ci.status
    FROM changed_import ci
    JOIN travel_documents td ON td.id = ci.document_id AND td.agency_id = ci.agency_id
    JOIN media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ci.agency_id
  `;
  if (!rows[0]) {
    throw new PlatformRequestError("Importazione già in elaborazione o non accodabile");
  }
  return rows[0] as ImportSourceRow;
}

export async function getPlatformJobStatus(jobId: string, agencyId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT status
    FROM platform_jobs
    WHERE id = ${jobId} AND agency_id = ${agencyId}
    LIMIT 1
  `;
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
      WHERE id = (SELECT document_id FROM import_jobs WHERE id = ${input.importId})
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
      WHERE id = (SELECT document_id FROM import_jobs WHERE id = ${importId})
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
  const sql = getSql();
  const rows = await sql`
    SELECT
      ij.id::text, ij.agency_id::text, ij.template_id::text, ij.status,
      ij.result, ij.error_message, ij.ai_provider, ij.created_at::text,
      tt.title AS trip_title, ma.original_name AS file_name
    FROM import_jobs ij
    JOIN trip_templates tt ON tt.id = ij.template_id AND tt.agency_id = ij.agency_id
    JOIN travel_documents td ON td.id = ij.document_id AND td.agency_id = ij.agency_id
    JOIN media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
    LIMIT 1
  `;
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
    fileName: String(row.file_name),
  };
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
  const sql = getSql();
  const versionRows = await sql`
    SELECT tv.id::text AS version_id, ij.template_id::text
    FROM import_jobs ij
    JOIN trip_template_versions tv
      ON tv.template_id = ij.template_id AND tv.agency_id = ij.agency_id
    WHERE ij.id = ${input.importId} AND ij.agency_id = ${input.agencyId}
      AND ij.status = 'ready_for_review'
    ORDER BY tv.version_number DESC
    LIMIT 1
  `;
  if (!versionRows[0]) throw new PlatformRequestError("Importazione non pubblicabile");
  const versionId = String(versionRows[0].version_id);
  const templateId = String(versionRows[0].template_id);

  const dayIds = input.draft.days.map(() => crypto.randomUUID());
  await sql.transaction((txn) => {
    const queries = [
      txn`DELETE FROM useful_information WHERE agency_id = ${input.agencyId} AND template_version_id = ${versionId}`,
      txn`DELETE FROM trip_days WHERE agency_id = ${input.agencyId} AND template_version_id = ${versionId}`,
    ];
    input.draft.days.forEach((day, dayIndex) => {
      const dayId = dayIds[dayIndex];
      queries.push(txn`
        INSERT INTO trip_days (
          id, agency_id, template_version_id, day_number, day_offset, label,
          title, city, description, source_date, metadata
        ) VALUES (
          ${dayId}, ${input.agencyId}, ${versionId}, ${dayIndex + 1}, ${dayIndex},
          ${day.label}, ${day.title}, ${day.city}, ${day.description}, ${validDate(day.date)},
          ${JSON.stringify({ importedDayNumber: day.dayNumber })}::jsonb
        )
      `);
      day.activities.forEach((activity, activityIndex) => {
        queries.push(txn`
          INSERT INTO itinerary_items (
            agency_id, trip_day_id, item_type, title, description,
            starts_at, ends_at, sort_order, metadata
          ) VALUES (
            ${input.agencyId}, ${dayId}, ${activity.type}, ${activity.title},
            ${activity.description}, ${validTime(activity.startsAt)}, ${validTime(activity.endsAt)},
            ${activityIndex}, ${JSON.stringify({ placeName: activity.placeName })}::jsonb
          )
        `);
      });
      if (day.accommodation.name.trim()) {
        queries.push(txn`
          INSERT INTO accommodations (
            agency_id, trip_day_id, name, notes, metadata
          ) VALUES (
            ${input.agencyId}, ${dayId}, ${day.accommodation.name}, ${day.accommodation.notes},
            ${JSON.stringify({ city: day.accommodation.city })}::jsonb
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
            description = ${input.draft.summary}, status = 'active', updated_at = NOW()
        WHERE id = ${templateId} AND agency_id = ${input.agencyId}
      `,
      txn`
        UPDATE trip_template_versions
        SET status = 'published', published_at = NOW(),
            revision_note = 'Programma revisionato e pubblicato dall’agenzia.'
        WHERE id = ${versionId} AND agency_id = ${input.agencyId}
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
}
