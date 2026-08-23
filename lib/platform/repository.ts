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
  destination_country: string | null;
  template_starts_on: string | null;
  template_ends_on: string | null;
  departure_id: string | null;
  departure_code: string | null;
  departure_title: string | null;
  starts_on: string | null;
  ends_on: string | null;
  departure_status: string | null;
  party_count: string;
  traveler_names: string | null;
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

type ReferenceContentRow = {
  template_id: string;
  entity_type: "country" | "city" | "site";
  entity_id: string;
  content_type: string | null;
  status: string | null;
  content: unknown;
};

type EnrichmentJobRow = {
  template_id: string;
  status: string;
  error_message: string | null;
  updated_at: string;
};

const expectedReferenceTypes = {
  country: new Set(["useful_info", "phrasebook", "bingo"]),
  city: new Set(["quiz", "mission", "game", "photo_contest"]),
  site: new Set(["quiz", "mission", "game", "photo_contest"]),
} as const;

export async function getPlatformOverview(
  actor: { id: string; name: string }
): Promise<PlatformOverview> {
  const sql = getSql();
  const [overviewRows, importRows, referenceRows, enrichmentRows] = await Promise.all([sql`
    WITH latest_imports AS (
      SELECT DISTINCT ON (agency_id, template_id)
        agency_id,
        template_id,
        result
      FROM import_jobs
      WHERE result IS NOT NULL
        AND status IN ('ready_for_review', 'published')
      ORDER BY agency_id, template_id, created_at DESC
    )
    SELECT
      a.id::text AS agency_id,
      a.slug AS agency_slug,
      a.name AS agency_name,
      a.status AS agency_status,
      am.role AS agency_role,
      tt.id::text AS template_id,
      tt.title AS template_title,
      tt.status AS template_status,
      COALESCE(NULLIF(li.result->>'destinationCountry', ''), tt.destination_country) AS destination_country,
      COALESCE(NULLIF(li.result->>'startDate', ''), tt.starts_on::text) AS template_starts_on,
      COALESCE(NULLIF(li.result->>'endDate', ''), tt.ends_on::text) AS template_ends_on,
      d.id::text AS departure_id,
      d.code AS departure_code,
      d.title AS departure_title,
      d.starts_on::text AS starts_on,
      d.ends_on::text AS ends_on,
      d.status AS departure_status,
      COUNT(DISTINCT tp.id)::text AS party_count,
      STRING_AGG(DISTINCT traveler.display_name, '|' ORDER BY traveler.display_name) AS traveler_names
    FROM agency_memberships am
    JOIN agencies a ON a.id = am.agency_id
    LEFT JOIN trip_templates tt ON tt.agency_id = a.id
    LEFT JOIN latest_imports li ON li.agency_id = a.id AND li.template_id = tt.id
    LEFT JOIN departures d ON d.template_id = tt.id AND d.agency_id = a.id
    LEFT JOIN travel_parties tp ON tp.departure_id = d.id AND tp.agency_id = a.id
    LEFT JOIN party_memberships pm ON pm.party_id = tp.id AND pm.agency_id = a.id AND pm.status <> 'removed'
    LEFT JOIN traveler_profiles traveler ON traveler.id = pm.traveler_id AND traveler.agency_id = a.id
    WHERE am.user_id = ${actor.id} AND am.role IN ('owner', 'admin', 'editor')
    GROUP BY a.id, a.slug, a.name, a.status, am.role, tt.id, tt.title, tt.status,
      tt.destination_country, tt.starts_on, tt.ends_on, li.result,
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
      AND am.role IN ('owner', 'admin', 'editor')
    JOIN trip_templates tt ON tt.id = ij.template_id AND tt.agency_id = ij.agency_id
    JOIN travel_documents td ON td.id = ij.document_id AND td.agency_id = ij.agency_id
    JOIN media_assets ma ON ma.id = td.media_asset_id AND ma.agency_id = ij.agency_id
    ORDER BY ij.created_at DESC
    LIMIT 12
  `, sql`
    WITH latest_versions AS (
      SELECT DISTINCT ON (ttv.template_id)
        ttv.id, ttv.template_id
      FROM trip_template_versions ttv
      JOIN trip_templates tt ON tt.id = ttv.template_id AND tt.agency_id = ttv.agency_id
      JOIN agency_memberships am ON am.agency_id = tt.agency_id
      WHERE am.user_id = ${actor.id} AND am.role IN ('owner', 'admin', 'editor')
      ORDER BY ttv.template_id, ttv.version_number DESC
    ), trip_entities AS (
      SELECT tc.template_id, 'country'::text AS entity_type, tc.country_id AS entity_id
      FROM trip_countries tc
      JOIN trip_templates tt ON tt.id = tc.template_id
      JOIN agency_memberships am ON am.agency_id = tt.agency_id
      WHERE am.user_id = ${actor.id} AND am.role IN ('owner', 'admin', 'editor')
      UNION
      SELECT lv.template_id, 'city'::text, tdc.city_id
      FROM latest_versions lv
      JOIN trip_days td ON td.template_version_id = lv.id
      JOIN trip_day_cities tdc ON tdc.trip_day_id = td.id
      UNION
      SELECT lv.template_id, 'site'::text, tds.site_id
      FROM latest_versions lv
      JOIN trip_days td ON td.template_version_id = lv.id
      JOIN trip_day_sites tds ON tds.trip_day_id = td.id
    )
    SELECT
      te.template_id::text,
      te.entity_type,
      te.entity_id::text,
      rc.content_type,
      rc.status,
      rc.content
    FROM trip_entities te
    LEFT JOIN reference_contents rc
      ON rc.entity_type = te.entity_type
      AND rc.entity_id = te.entity_id
      AND rc.locale = 'it-IT'
  `, sql`
    SELECT DISTINCT ON (resolved.template_id)
      resolved.template_id::text,
      resolved.status,
      resolved.error_message,
      resolved.updated_at::text
    FROM (
      SELECT
        COALESCE(NULLIF(pj.payload->>'templateId', '')::uuid, ij.template_id) AS template_id,
        pj.status,
        pj.error_message,
        pj.updated_at,
        pj.created_at
      FROM platform_jobs pj
      LEFT JOIN import_jobs ij
        ON ij.id::text = pj.payload->>'importId'
        AND ij.agency_id = pj.agency_id
      JOIN agency_memberships am ON am.agency_id = pj.agency_id
      WHERE pj.job_type = 'travel-reference.enrich'
        AND am.user_id = ${actor.id}
        AND am.role IN ('owner', 'admin', 'editor')
    ) resolved
    WHERE resolved.template_id IS NOT NULL
    ORDER BY resolved.template_id, resolved.created_at DESC
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
        destinationCountry: row.destination_country ?? "",
        startsOn: row.template_starts_on,
        endsOn: row.template_ends_on,
        contentGeneration: null,
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
        travelerNames: row.traveler_names ? row.traveler_names.split("|") : [],
      });
    }
  }

  const contentByTrip = new Map<string, {
    entities: Map<string, { entityType: "country" | "city" | "site"; ready: Set<string> }>;
    contestTitles: Set<string>;
  }>();
  for (const row of referenceRows as ReferenceContentRow[]) {
    let tripContent = contentByTrip.get(row.template_id);
    if (!tripContent) {
      tripContent = { entities: new Map(), contestTitles: new Set() };
      contentByTrip.set(row.template_id, tripContent);
    }
    const entityKey = `${row.entity_type}:${row.entity_id}`;
    let entity = tripContent.entities.get(entityKey);
    if (!entity) {
      entity = { entityType: row.entity_type, ready: new Set() };
      tripContent.entities.set(entityKey, entity);
    }
    if (
      row.content_type && row.status === "ready" &&
      expectedReferenceTypes[row.entity_type].has(row.content_type)
    ) {
      entity.ready.add(row.content_type);
    }
    if (row.content_type === "photo_contest" && row.status === "ready" && Array.isArray(row.content)) {
      for (const contest of row.content) {
        if (contest && typeof contest === "object" && "title" in contest && typeof contest.title === "string") {
          tripContent.contestTitles.add(contest.title);
        }
      }
    }
  }

  const jobsByTrip = new Map(
    (enrichmentRows as EnrichmentJobRow[]).map((row) => [row.template_id, row])
  );
  for (const agency of agencies.values()) {
    for (const trip of agency.trips) {
      const content = contentByTrip.get(trip.id);
      const job = jobsByTrip.get(trip.id);
      if (!content && !job) continue;
      const entities = [...(content?.entities.values() ?? [])];
      trip.contentGeneration = {
        status: job?.status ?? "not_started",
        expectedSections: entities.reduce(
          (total, entity) => total + expectedReferenceTypes[entity.entityType].size,
          0
        ),
        readySections: entities.reduce((total, entity) => total + entity.ready.size, 0),
        contestTitles: [...(content?.contestTitles ?? [])],
        errorMessage: job?.error_message ?? null,
        updatedAt: job?.updated_at ?? null,
      };
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
        'Versione iniziale in attesa del programma di viaggio.', ${input.actorId}
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

export async function getTripEnrichmentQueueRecord(templateId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      pj.agency_id::text,
      pj.payload,
      pj.idempotency_key
    FROM platform_jobs pj
    LEFT JOIN import_jobs ij
      ON ij.id::text = pj.payload->>'importId'
      AND ij.agency_id = pj.agency_id
    WHERE pj.job_type = 'travel-reference.enrich'
      AND COALESCE(NULLIF(pj.payload->>'templateId', '')::uuid, ij.template_id) = ${templateId}
    ORDER BY pj.created_at DESC
    LIMIT 1
  `;
  if (!rows[0]) throw new PlatformRequestError("Generazione dei contenuti non trovata");
  const payload = rows[0].payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PlatformRequestError("Dati della generazione non validi");
  }
  return {
    agencyId: String(rows[0].agency_id),
    payload: { ...(payload as Record<string, unknown>), templateId },
    idempotencyKey: String(rows[0].idempotency_key),
  };
}

export async function getTripDeletionTarget(templateId: string) {
  const sql = getSql();
  const trips = await sql`
    SELECT id::text, agency_id::text, title
    FROM trip_templates
    WHERE id = ${templateId}
    LIMIT 1
  `;
  if (!trips[0]) throw new PlatformRequestError("Viaggio non trovato");
  const agencyId = String(trips[0].agency_id);
  const assets = await sql`
    SELECT DISTINCT ma.id::text, ma.provider, ma.bucket, ma.object_key
    FROM media_assets ma
    WHERE ma.agency_id = ${agencyId}
      AND (
        ma.departure_id IN (
          SELECT id FROM departures WHERE agency_id = ${agencyId} AND template_id = ${templateId}
        )
        OR ma.party_id IN (
          SELECT tp.id
          FROM travel_parties tp
          JOIN departures d ON d.id = tp.departure_id AND d.agency_id = tp.agency_id
          WHERE tp.agency_id = ${agencyId} AND d.template_id = ${templateId}
        )
        OR ma.id IN (
          SELECT media_asset_id FROM travel_documents
          WHERE agency_id = ${agencyId} AND template_id = ${templateId}
        )
      )
  `;
  return {
    id: String(trips[0].id),
    agencyId,
    title: String(trips[0].title),
    assets: assets.map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      bucket: String(row.bucket),
      objectKey: String(row.object_key),
    })),
  };
}

export async function deleteTripRecords(input: {
  templateId: string;
  agencyId: string;
  actorId: string;
  title: string;
  mediaAssetIds: string[];
}) {
  const sql = getSql();
  const assetIds = input.mediaAssetIds.length > 0 ? input.mediaAssetIds : [crypto.randomUUID()];
  const results = await sql.transaction((txn) => [
    txn`
      DELETE FROM platform_jobs
      WHERE agency_id = ${input.agencyId}
        AND payload->>'importId' IN (
          SELECT id::text FROM import_jobs
          WHERE agency_id = ${input.agencyId} AND template_id = ${input.templateId}
        )
    `,
    txn`
      DELETE FROM departures
      WHERE agency_id = ${input.agencyId} AND template_id = ${input.templateId}
    `,
    txn`
      DELETE FROM trip_templates
      WHERE id = ${input.templateId} AND agency_id = ${input.agencyId}
      RETURNING id
    `,
    txn`
      DELETE FROM media_assets
      WHERE agency_id = ${input.agencyId} AND id = ANY(${assetIds}::uuid[])
    `,
    txn`
      INSERT INTO audit_events (
        agency_id, actor_user_id, entity_type, entity_id, action, changes
      ) VALUES (
        ${input.agencyId}, ${input.actorId}, 'trip_template', ${input.templateId}, 'deleted',
        ${JSON.stringify({ title: input.title, deletedAssets: input.mediaAssetIds.length })}::jsonb
      )
    `,
  ]);
  if (results[2].length !== 1) throw new PlatformRequestError("Eliminazione del viaggio non riuscita");
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
