import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import { PlatformRequestError } from "./http";
import type { AgencyRole, PlatformOverview } from "./types";

type OverviewRow = {
  agency_id: string;
  agency_slug: string;
  agency_name: string;
  agency_status: string;
  agency_role: AgencyRole;
  template_id: string | null;
  template_title: string | null;
  template_status: string | null;
  departure_id: string | null;
  departure_code: string | null;
  departure_title: string | null;
  starts_on: string | null;
  ends_on: string | null;
  departure_status: string | null;
  party_count: string;
};

type ImportRow = {
  id: string;
  agency_id: string;
  template_id: string;
  trip_title: string;
  file_name: string;
  status: string;
  created_at: string;
  error_message: string | null;
};

export async function getPlatformOverview(
  actor: { id: string; name: string }
): Promise<PlatformOverview> {
  const sql = getSql();
  const [overviewRows, importRows] = await Promise.all([sql`
    SELECT
      a.id::text AS agency_id,
      a.slug AS agency_slug,
      a.name AS agency_name,
      a.status AS agency_status,
      am.role AS agency_role,
      tt.id::text AS template_id,
      tt.title AS template_title,
      tt.status AS template_status,
      d.id::text AS departure_id,
      d.code AS departure_code,
      d.title AS departure_title,
      d.starts_on::text AS starts_on,
      d.ends_on::text AS ends_on,
      d.status AS departure_status,
      COUNT(DISTINCT tp.id)::text AS party_count
    FROM agency_memberships am
    JOIN agencies a ON a.id = am.agency_id
    LEFT JOIN trip_templates tt ON tt.agency_id = a.id
    LEFT JOIN departures d ON d.template_id = tt.id AND d.agency_id = a.id
    LEFT JOIN travel_parties tp ON tp.departure_id = d.id AND tp.agency_id = a.id
    WHERE am.user_id = ${actor.id} AND am.role IN ('owner', 'admin')
    GROUP BY a.id, a.slug, a.name, a.status, am.role, tt.id, tt.title, tt.status,
      d.id, d.code, d.title, d.starts_on, d.ends_on, d.status
    ORDER BY a.name, tt.title NULLS LAST, d.starts_on DESC NULLS LAST
  `, sql`
    SELECT
      ij.id::text,
      ij.agency_id::text,
      ij.template_id::text,
      tt.title AS trip_title,
      ma.original_name AS file_name,
      ij.status,
      ij.created_at::text,
      ij.error_message
    FROM import_jobs ij
    JOIN agency_memberships am
      ON am.agency_id = ij.agency_id AND am.user_id = ${actor.id}
      AND am.role IN ('owner', 'admin')
    JOIN trip_templates tt ON tt.id = ij.template_id AND tt.agency_id = ij.agency_id
    JOIN travel_documents td ON td.id = ij.document_id AND td.agency_id = ij.agency_id
    JOIN media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    ORDER BY ij.created_at DESC
    LIMIT 12
  `]);
  const rows = overviewRows as OverviewRow[];

  const agencies = new Map<string, PlatformOverview["agencies"][number]>();
  for (const row of rows) {
    let agency = agencies.get(row.agency_id);
    if (!agency) {
      agency = {
        id: row.agency_id,
        slug: row.agency_slug,
        name: row.agency_name,
        status: row.agency_status,
        role: row.agency_role,
        trips: [],
      };
      agencies.set(row.agency_id, agency);
    }
    if (!row.template_id || !row.template_title || !row.template_status) continue;

    let trip = agency.trips.find((candidate) => candidate.id === row.template_id);
    if (!trip) {
      trip = {
        id: row.template_id,
        title: row.template_title,
        status: row.template_status,
        departures: [],
      };
      agency.trips.push(trip);
    }
    if (
      row.departure_id && row.departure_code && row.departure_title && row.starts_on &&
      row.ends_on && row.departure_status
    ) {
      trip.departures.push({
        id: row.departure_id,
        code: row.departure_code,
        title: row.departure_title,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        status: row.departure_status,
        partyCount: Number(row.party_count),
      });
    }
  }

  return {
    actor: { id: actor.id, name: actor.name },
    providers: getPlatformProviderConfig(),
    agencies: [...agencies.values()],
    recentImports: (importRows as ImportRow[]).map((row) => ({
      id: row.id,
      agencyId: row.agency_id,
      templateId: row.template_id,
      tripTitle: row.trip_title,
      fileName: row.file_name,
      status: row.status,
      createdAt: row.created_at,
      errorMessage: row.error_message,
    })),
  };
}

function tripSlug(title: string) {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "viaggio";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createTripTemplate(input: {
  agencyId: string;
  title: string;
  destinationCountry: string;
  timezone: string;
  actorId: string;
}) {
  const sql = getSql();
  const templateId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const slug = tripSlug(input.title);
  const rows = await sql`
    WITH inserted_template AS (
      INSERT INTO trip_templates (
        id, agency_id, slug, title, destination_country, status,
        default_locale, default_timezone, created_by_user_id
      ) VALUES (
        ${templateId}, ${input.agencyId}, ${slug}, ${input.title},
        ${input.destinationCountry || null}, 'draft', 'it-IT', ${input.timezone}, ${input.actorId}
      )
      RETURNING id, agency_id, slug, title, destination_country, status, default_timezone
    ), inserted_version AS (
      INSERT INTO trip_template_versions (
        id, agency_id, template_id, version_number, status, revision_note, created_by_user_id
      ) VALUES (
        ${versionId}, ${input.agencyId}, ${templateId}, 1, 'draft',
        'Versione iniziale in attesa del programma PDF.', ${input.actorId}
      )
      RETURNING id
    ), audit AS (
      INSERT INTO audit_events (
        agency_id, actor_user_id, entity_type, entity_id, action, changes
      ) VALUES (
        ${input.agencyId}, ${input.actorId}, 'trip_template', ${templateId}, 'created',
        ${JSON.stringify({ title: input.title })}::jsonb
      )
    )
    SELECT
      t.id::text, t.agency_id::text, t.slug, t.title, t.destination_country,
      t.status, t.default_timezone, ${versionId}::text AS version_id
    FROM inserted_template t
    CROSS JOIN inserted_version
  `;
  return rows[0];
}

export async function assertTripBelongsToAgency(agencyId: string, templateId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT id::text, title
    FROM trip_templates
    WHERE id = ${templateId} AND agency_id = ${agencyId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new PlatformRequestError("Viaggio non trovato");
  return rows[0] as { id: string; title: string };
}

export async function registerImportedDocument(input: {
  agencyId: string;
  templateId: string;
  actorId: string;
  provider: "vercel_blob" | "r2";
  bucket: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number | null;
}) {
  const sql = getSql();
  const mediaId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const rows = await sql`
    WITH media AS (
      INSERT INTO media_assets (
        id, agency_id, uploaded_by_user_id, provider, bucket, object_key,
        original_name, content_type, size_bytes, purpose, visibility, status
      ) VALUES (
        ${mediaId}, ${input.agencyId}, ${input.actorId}, ${input.provider}, ${input.bucket}, ${input.objectKey},
        ${input.originalName}, ${input.contentType}, ${input.sizeBytes}, 'travel_programme',
        'agency', 'ready'
      )
      ON CONFLICT (provider, bucket, object_key) DO UPDATE SET updated_at = NOW()
      RETURNING id
    ), document AS (
      INSERT INTO travel_documents (
        id, agency_id, template_id, media_asset_id, document_type, title, status
      )
      SELECT
        ${documentId}, ${input.agencyId}, ${input.templateId}, media.id,
        'programme', ${input.originalName}, 'processing'
      FROM media
      ON CONFLICT (media_asset_id) DO UPDATE SET status = 'processing'
      RETURNING id
    ), imported AS (
      INSERT INTO import_jobs (
        id, agency_id, template_id, document_id, status, created_by_user_id
      )
      SELECT ${importId}, ${input.agencyId}, ${input.templateId}, document.id, 'queued', ${input.actorId}
      FROM document
      ON CONFLICT (document_id) DO UPDATE SET updated_at = NOW()
      RETURNING id, document_id, status, created_at
    ), audit AS (
      INSERT INTO audit_events (
        agency_id, actor_user_id, entity_type, entity_id, action, changes
      )
      SELECT
        ${input.agencyId}, ${input.actorId}, 'import_job', imported.id::text, 'queued',
        ${JSON.stringify({ objectKey: input.objectKey, originalName: input.originalName })}::jsonb
      FROM imported
    )
    SELECT id::text, document_id::text, status, created_at::text FROM imported
  `;
  return rows[0] as { id: string; document_id: string; status: string; created_at: string };
}
