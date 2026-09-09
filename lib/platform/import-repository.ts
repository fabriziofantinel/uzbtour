import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";
import { catalogValidationIssues, travelProgrammeDraftSchema, type TravelProgrammeDraft } from "./import-schema";
import type { PlatformImportReview } from "./types";
import { prepareTravelCatalog } from "./travel-catalog";
import { normalizeTravelProgramme } from "./travel-programme-normalizer";
import { assertNormalizedImportSchema } from "./schema-readiness";

export type ImportSourceRow = {
  id: string;
  agency_id: string;
  template_id: string;
  document_id: string;
  provider: "r2";
  bucket: string;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number | null;
  uploaded_by_user_id: string | null;
  status: string;
};

export async function markImportOcrPending(importId: string, textractJobId: string) {
  const sql = getSql();
  const rows = await sql`SELECT app.mark_import_ocr_pending_v3(${importId},${textractJobId}) AS ok`;
  if (rows[0]?.ok !== true) throw new PlatformRequestError("Sospensione OCR non riuscita");
}

export async function resumeImportOcr(importId: string, textractJobId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text,agency_id::text,template_id::text,document_id::text,provider,bucket,
      object_key,original_name,content_type,size_bytes,uploaded_by_user_id::text,status
    FROM app.resume_import_ocr_v3(${importId},${textractJobId})`;
  if (!rows[0]) throw new PlatformRequestError("Ripresa OCR non riuscita");
  return rows[0] as ImportSourceRow;
}

export async function getImportAgency(importId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT app.resolve_import_agency(${importId})::text AS agency_id
  `;
  if (!rows[0]?.agency_id) throw new PlatformRequestError("Importazione non trovata");
  return String(rows[0].agency_id);
}

export async function getImportAgencyPrimaryColor(actorId: string, agencyId: string) {
  const sql = getSql();
  const rows =
    await sql`SELECT branding FROM app.read_agency_branding_v3(${actorId}::uuid) WHERE agency_id=${agencyId} LIMIT 1`;
  const branding =
    rows[0]?.branding && typeof rows[0].branding === "object" && !Array.isArray(rows[0].branding)
      ? (rows[0].branding as Record<string, unknown>)
      : {};
  return String(branding.primaryColor || "#247A6B");
}

export async function getImportQueueRecord(importId: string, agencyId: string) {
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
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
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Lavoro di importazione non trovato");
  return {
    type: String(rows[0].job_type),
    payload: rows[0].payload as Record<string, unknown>,
    idempotencyKey: String(rows[0].idempotency_key),
  };
}

export async function getImportTelemetryContext(importId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT pj.id::text platform_job_id,pj.agency_id::text agency_id
    FROM ops.platform_jobs pj
    JOIN ops.import_jobs ij ON ij.agency_id=pj.agency_id
      AND (ij.id=pj.import_job_id OR ij.id::text=pj.payload->>'importId')
    WHERE ij.id=${importId} AND pj.job_type='travel-programme.import'
    ORDER BY pj.created_at DESC LIMIT 1`;
  if (!rows[0]) throw new PlatformRequestError("Contesto telemetria OCR non trovato");
  return { platformJobId: String(rows[0].platform_job_id), agencyId: String(rows[0].agency_id) };
}

export async function claimImportJob(importId: string, expected?: { jobId?: string; agencyId?: string }) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text,agency_id::text,template_id::text,document_id::text,provider,
      bucket,object_key,original_name,content_type,size_bytes,
      uploaded_by_user_id::text,status
    FROM app.claim_import_job_v3(${importId},${expected?.jobId ?? null},${expected?.agencyId ?? null})
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
  const rows = await sql`
    SELECT app.register_normalized_import_document_v3(
      ${input.importId},${input.agencyId},${input.templateId},${input.uploadedByUserId},
      ${input.provider},${input.bucket},${input.objectKey},${input.originalName},
      ${input.contentType},${input.sizeBytes},${input.checksumSha256}
    )::text AS id
  `;
  if (!rows[0]) throw new PlatformRequestError("Registrazione del preventivo normalizzato non riuscita");
  return String(rows[0].id);
}

export async function getPlatformJobStatus(jobId: string, agencyId: string) {
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
      txn`SELECT status FROM ops.platform_jobs WHERE id = ${jobId} AND agency_id = ${agencyId} LIMIT 1`,
    ],
    { readOnly: true },
  );
  return rows[0]?.status ? String(rows[0].status) : null;
}

export async function markImportGenerating(importId: string) {
  const sql = getSql();
  await sql`SELECT app.set_import_generating_v3(${importId})`;
}

export async function completeImport(input: {
  importId: string;
  draft: TravelProgrammeDraft;
  model: string;
  provider: string;
  usage: unknown;
}) {
  const sql = getSql();
  await sql`SELECT app.complete_import_v3(${input.importId},${JSON.stringify(input.draft)}::jsonb,
    ${input.model},${input.provider},${JSON.stringify(input.usage ?? {})}::jsonb)`;
}

export async function failImport(importId: string, error: unknown) {
  const sql = getSql();
  const message = (error instanceof Error ? error.message : "Errore sconosciuto").slice(0, 1200);
  await sql`SELECT app.fail_import_v3(${importId},${message})`;
}

export async function getImportForReview(importId: string, agencyId: string): Promise<PlatformImportReview> {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
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
    ],
    { readOnly: true },
  );
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
  const [, rows] = await sql.transaction(
    (txn) => [
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
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Preventivo normalizzato non disponibile");
  return {
    provider: String(rows[0].provider),
    bucket: String(rows[0].bucket),
    objectKey: String(rows[0].object_key),
    originalName: String(rows[0].original_name),
    contentType: String(rows[0].content_type),
  };
}

export async function getOriginalImportDocument(importId: string, agencyId: string) {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
      txn`
    SELECT ma.provider, ma.bucket, ma.object_key, ma.original_name, ma.content_type
    FROM ops.import_jobs ij
    JOIN ops.travel_documents td
      ON td.id = ij.source_document_id AND td.agency_id = ij.agency_id
    JOIN ops.media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
      AND td.status = 'ready' AND ma.status = 'ready'
    LIMIT 1
    `,
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Preventivo originale non disponibile");
  return {
    provider: String(rows[0].provider),
    bucket: String(rows[0].bucket),
    objectKey: String(rows[0].object_key),
    originalName: String(rows[0].original_name),
    contentType: String(rows[0].content_type),
  };
}

export async function getImportDocumentPublicationContext(importId: string, agencyId: string) {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${agencyId}, true)`,
      txn`
    SELECT ij.template_id::text, source.original_name AS source_name,
      source.uploaded_by_user_id::text
    FROM ops.import_jobs ij
    JOIN ops.travel_documents source_document
      ON source_document.id = ij.source_document_id AND source_document.agency_id = ij.agency_id
    JOIN ops.media_assets source
      ON source.id = source_document.media_asset_id AND source.agency_id = ij.agency_id
    WHERE ij.id = ${importId} AND ij.agency_id = ${agencyId}
    LIMIT 1
    `,
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Documenti del preventivo non disponibili");
  return {
    templateId: String(rows[0].template_id),
    sourceName: String(rows[0].source_name),
    uploadedByUserId: rows[0].uploaded_by_user_id ? String(rows[0].uploaded_by_user_id) : null,
  };
}

export async function getImportDeletionTarget(importId: string, agencyId: string) {
  await assertNormalizedImportSchema();
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
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
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("La bozza non può essere eliminata");
  return rows.map((row) => ({
    status: String(row.status),
    documentId: String(row.document_id),
    mediaAssetId: String(row.media_asset_id),
    provider: "r2" as const,
    bucket: String(row.bucket),
    objectKey: String(row.object_key),
  }));
}

export async function deleteImportDraftRecords(input: {
  importId: string;
  agencyId: string;
  actorId: string;
  documentIds: string[];
  mediaAssetIds: string[];
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.delete_import_draft_v3(${input.actorId}::uuid,${input.importId}::uuid,
    ${input.agencyId}::uuid,${input.documentIds}::uuid[],${input.mediaAssetIds}::uuid[]) AS deleted`;
  if (!Boolean(rows[0]?.deleted)) throw new PlatformRequestError("Eliminazione della bozza non riuscita");
}

export async function saveImportDraft(input: {
  importId: string;
  agencyId: string;
  actorId: string;
  draft: TravelProgrammeDraft;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.save_import_draft_v3(${input.actorId}::uuid,${input.importId}::uuid,
    ${input.agencyId}::uuid,${JSON.stringify(input.draft)}::jsonb) AS saved`;
  if (!Boolean(rows[0]?.saved)) throw new PlatformRequestError("La bozza non è modificabile");
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
  const draft = travelProgrammeDraftSchema.parse(normalizeTravelProgramme(input.draft).value);
  const validationIssues = catalogValidationIssues(draft);
  if (validationIssues.length > 0) {
    throw new PlatformRequestError(
      `Completa la validazione delle anagrafiche: ${validationIssues.slice(0, 5).join("; ")}${validationIssues.length > 5 ? `; e altre ${validationIssues.length - 5}` : ""}`,
    );
  }
  const sql = getSql();
  const [, versionRows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
      SELECT ij.template_id::text
      FROM ops.import_jobs ij
      JOIN travel.trip_template_versions tv
        ON tv.template_id = ij.template_id AND tv.agency_id = ij.agency_id
      WHERE ij.id = ${input.importId} AND ij.agency_id = ${input.agencyId}
        AND ij.status = 'ready_for_review'
      ORDER BY tv.version_number DESC
      LIMIT 1
    `,
    ],
    { readOnly: true },
  );
  if (!versionRows[0]) throw new PlatformRequestError("Importazione non pubblicabile");
  const templateId = String(versionRows[0].template_id);
  const startDate = validDate(draft.startDate) ?? draft.days.map((day) => validDate(day.date)).find(Boolean) ?? null;
  const endDate =
    validDate(draft.endDate) ??
    draft.days
      .map((day) => validDate(day.date))
      .filter(Boolean)
      .at(-1) ??
    null;
  if (!startDate || !endDate || endDate < startDate) {
    throw new PlatformRequestError("Controlla data iniziale e finale del viaggio prima di pubblicare");
  }
  const catalog = await prepareTravelCatalog(draft, { actorId: input.actorId, agencyId: input.agencyId });
  const [, existingDepartures] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
      SELECT id::text, code FROM travel.departures
      WHERE agency_id = ${input.agencyId} AND template_id = ${templateId}
      ORDER BY created_at LIMIT 1
    `,
    ],
    { readOnly: true },
  );
  const departureId = existingDepartures[0]?.id ? String(existingDepartures[0].id) : crypto.randomUUID();
  const departureCode = existingDepartures[0]?.code
    ? String(existingDepartures[0].code)
    : `V-${startDate.slice(0, 4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const published = await sql`
    SELECT template_id::text,departure_id::text
    FROM app.publish_import_programme_v3(
      ${input.actorId}::uuid,${input.importId},${input.agencyId},
      ${JSON.stringify(draft)}::jsonb,
      ${JSON.stringify({
        countryIds: catalog.countries.map((country) => country.id),
        primaryCountryId: catalog.primaryCountry.id,
        dayReferences: catalog.dayReferences,
      })}::jsonb,
      ${startDate},${endDate},${departureId},${departureCode}
    )
  `;
  if (!published[0]) throw new PlatformRequestError("Pubblicazione del programma non riuscita");
  return {
    templateId: String(published[0].template_id),
    departureId: String(published[0].departure_id),
    referenceTargets: catalog.targets,
  };
}
