import { getSql } from "@/lib/db";
import { getPlatformProviderConfig } from "./provider-config";
import { PlatformRequestError } from "./errors";
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
  const [overviewRows, importRows, referenceRows, enrichmentRows] = await Promise.all([
    sql`SELECT * FROM app.read_agency_overview_v3(${actor.id})`,
    sql`SELECT * FROM app.read_agency_recent_imports_v3(${actor.id})`,
    sql`SELECT * FROM app.read_agency_reference_contents_v3(${actor.id})`,
    sql`SELECT * FROM app.read_agency_enrichment_jobs_v3(${actor.id})`,
  ]);
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
    SELECT id::text,agency_id::text,slug,title,status,default_timezone,
      version_id::text,${input.destinationCountry}::text AS destination_country
    FROM app.create_trip_template_v3(${input.actorId},${input.agencyId},${templateId},
      ${versionId},${slug},${input.title},${input.timezone})
  `;
  return rows[0];
}

export async function assertTripBelongsToAgency(agencyId: string, templateId: string) {
  const sql = getSql();
  const [,rows]=await sql.transaction((txn)=>[
    txn`SELECT set_config('app.agency_id',${agencyId},true)`,
    txn`SELECT id::text,title FROM travel.trip_templates
      WHERE id=${templateId} AND agency_id=${agencyId} LIMIT 1`,
  ],{readOnly:true});
  if (rows.length === 0) throw new PlatformRequestError("Viaggio non trovato");
  return rows[0] as { id: string; title: string };
}

export async function assertTripHasNoProgramme(agencyId: string, templateId: string) {
  const sql = getSql();
  const [,rows] = await sql.transaction((txn)=>[
    txn`SELECT set_config('app.agency_id',${agencyId},true)`,
    txn`
    SELECT EXISTS (
      SELECT 1 FROM ops.travel_documents
      WHERE agency_id = ${agencyId} AND template_id = ${templateId}
    ) AS value
    `,
  ],{readOnly:true});
  if (Boolean(rows[0]?.value)) {
    throw new PlatformRequestError("Il viaggio ha già un programma: eliminalo per caricare un nuovo preventivo");
  }
}

export async function getTripEnrichmentQueueRecord(templateId: string) {
  const sql = getSql();
  const agencyRows=await sql`SELECT agency_id::text FROM app.resolve_template_agency_v3(${templateId})`;
  if(!agencyRows[0]?.agency_id) throw new PlatformRequestError("Generazione dei contenuti non trovata");
  const agencyId=String(agencyRows[0].agency_id);
  const [,rows] = await sql.transaction((txn)=>[
    txn`SELECT set_config('app.agency_id',${agencyId},true)`,
    txn`
    SELECT
      pj.agency_id::text,
      pj.payload,
      pj.idempotency_key
    FROM ops.platform_jobs pj
    LEFT JOIN ops.import_jobs ij
      ON ij.id=pj.import_job_id AND ij.agency_id=pj.agency_id
    WHERE pj.job_type = 'travel-reference.enrich'
      AND COALESCE(NULLIF(pj.payload->>'templateId', '')::uuid, ij.template_id) = ${templateId}
    ORDER BY pj.created_at DESC
    LIMIT 1
    `,
  ],{readOnly:true});
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

export async function getTripDeletionTarget(templateId: string, actorId?: string) {
  const sql = getSql();
  const trips = await sql`
    SELECT id::text, agency_id::text, title
    FROM travel.trip_templates
    WHERE id = ${templateId}
    LIMIT 1
  `;
  if (!trips[0]) throw new PlatformRequestError("Viaggio non trovato");
  const agencyId = String(trips[0].agency_id);
  const assets = actorId ? await sql`
    SELECT id::text,provider,bucket,object_key
    FROM app.read_trip_deletion_assets_v3(${actorId},${agencyId},${templateId})
  ` : [];
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
  const rows=await sql`SELECT app.delete_trip_template_v3(${input.actorId},${input.agencyId},
    ${input.templateId},${input.mediaAssetIds}::uuid[]) AS deleted`;
  if (!Boolean(rows[0]?.deleted)) throw new PlatformRequestError("Eliminazione del viaggio non riuscita");
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
  if(input.provider!=="r2"||input.sizeBytes==null) throw new PlatformRequestError("Il documento deve essere archiviato su R2");
  const rows=await sql`SELECT id::text,document_id::text,status,created_at::text
    FROM app.register_import_document_v3(${input.actorId},${input.agencyId},${input.templateId},
      ${input.provider},${input.bucket},${input.objectKey},${input.originalName},
      ${input.contentType},${input.sizeBytes})`;
  return rows[0] as { id: string; document_id: string; status: string; created_at: string };
}
