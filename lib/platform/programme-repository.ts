import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";
import { assertProgrammeFeedbackSchema } from "./schema-readiness";

type Row = Record<string, unknown>;

function value(value: unknown) {
  return value == null ? "" : String(value);
}

export async function getAgencyProgramme(departureId: string, actorId: string) {
  await assertProgrammeFeedbackSchema();
  const sql = getSql();
  const scopeRows = await sql`
    SELECT agency_id::text
    FROM app.read_journey_management(${actorId}, ${departureId})
    LIMIT 1
  `;
  if (!scopeRows[0]) throw new PlatformRequestError("Partenza non trovata");
  const agencyId = String(scopeRows[0].agency_id);
  const [, departures, brandingRows] = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    transaction`
    SELECT d.id::text, d.agency_id::text, d.template_id::text, d.template_version_id::text,
      d.title, d.code, d.starts_on::text, d.ends_on::text, d.status,
      tt.title AS programme_title, COALESCE(country.name, '') AS destination_country,
      version.version_number, quote_import.id::text AS quote_import_id
    FROM travel.departures d
    JOIN travel.trip_templates tt ON tt.id = d.template_id AND tt.agency_id = d.agency_id
    JOIN travel.trip_template_versions version
      ON version.id = d.template_version_id AND version.agency_id = d.agency_id
    LEFT JOIN ref.countries country ON country.id = tt.primary_country_id
    LEFT JOIN LATERAL (
      SELECT import_job.id
      FROM ops.import_jobs import_job
      WHERE import_job.agency_id = d.agency_id
        AND import_job.template_id = d.template_id
      ORDER BY import_job.created_at DESC
      LIMIT 1
    ) quote_import ON true
    WHERE d.id = ${departureId} AND d.agency_id = ${agencyId}
    LIMIT 1
    `,
    transaction`
      SELECT branding
      FROM app.read_agency_branding_v3(${actorId})
      WHERE agency_id = ${agencyId}
      LIMIT 1
    `,
  ], { readOnly: true });
  if (!departures[0]) throw new PlatformRequestError("Partenza non trovata");
  const departure = departures[0] as Row;
  const agencyBranding = brandingRows[0]?.branding && typeof brandingRows[0].branding === "object"
    && !Array.isArray(brandingRows[0].branding)
    ? brandingRows[0].branding as Record<string, unknown>
    : {};
  const versionId = String(departure.template_version_id);
  const [, dayRows, itemRows, hotelRows, documentRows] = await sql.transaction((transaction) => [
    transaction`SELECT set_config('app.agency_id', ${agencyId}, true)`,
    transaction`
      SELECT departure_day.id::text,template_day.day_number,template_day.day_offset,
        COALESCE(departure_day.label_override,template_day.metadata->>'legacyLabel','') AS label,
        COALESCE(departure_day.title_override,template_day.title) AS title,
        COALESCE(departure_day.city_override,template_day.metadata->>'legacyCity','') AS city,
        COALESCE(departure_day.description_override,template_day.description) AS description
      FROM travel.template_days template_day
      JOIN travel.departure_days departure_day
        ON departure_day.template_day_id=template_day.id
       AND departure_day.agency_id=template_day.agency_id
       AND departure_day.departure_id=${departureId}
      WHERE template_day.agency_id=${agencyId}
        AND template_day.template_version_id=${versionId}
      ORDER BY template_day.day_number
    `,
    transaction`
      SELECT item.id::text AS id,
        day.id::text AS trip_day_id, item.item_type, item.title,
        item.description,
        CASE WHEN item.scheduled_start_at IS NULL THEN NULL
          ELSE to_char(item.scheduled_start_at AT TIME ZONE departure.timezone, 'HH24:MI:SS') END AS starts_at,
        CASE WHEN item.scheduled_end_at IS NULL THEN NULL
          ELSE to_char(item.scheduled_end_at AT TIME ZONE departure.timezone, 'HH24:MI:SS') END AS ends_at,
        item.sort_order,item.operational_status,item.status_reason,
        item.metadata || jsonb_build_object('notes', item.notes) AS metadata
      FROM travel.departure_itinerary_items item
      JOIN travel.departure_days day
        ON day.id = item.departure_day_id AND day.agency_id = item.agency_id
      JOIN travel.departures departure
        ON departure.id = item.departure_id AND departure.agency_id = item.agency_id
      WHERE item.agency_id = ${agencyId} AND item.departure_id = ${departureId}
        AND item.template_version_id = ${versionId}
        AND item.operational_status <> 'cancelled'
      ORDER BY day.service_date, item.sort_order, item.id
    `,
    transaction`
      SELECT stay.id::text,day.id::text AS trip_day_id,
        stay.name_snapshot AS name,stay.notes,stay.sort_order
      FROM travel.departure_accommodation_stays stay
      JOIN travel.departure_days day ON day.id=stay.departure_day_id
        AND day.agency_id=stay.agency_id AND day.departure_id=stay.departure_id
      WHERE stay.agency_id=${agencyId} AND stay.departure_id=${departureId}
        AND stay.operational_status<>'cancelled'
      ORDER BY day.service_date,stay.sort_order,stay.id
    `,
    transaction`
      SELECT document.id::text,
        item.id::text AS itinerary_item_id,
        document.title,
        asset.content_type, asset.size_bytes, document.created_at::text
      FROM ops.travel_documents document
      JOIN ops.media_assets asset
        ON asset.id = document.media_asset_id AND asset.agency_id = document.agency_id
      JOIN travel.departure_itinerary_items item
        ON item.id = document.departure_item_id
       AND item.agency_id = document.agency_id
       AND item.departure_id = document.departure_id
      WHERE document.agency_id = ${agencyId} AND document.departure_id = ${departureId}
        AND item.template_version_id = ${versionId}
        AND document.status = 'ready' AND asset.status = 'ready'
      ORDER BY document.created_at
    `,
  ]);
  const items = itemRows as Row[];
  const hotels = hotelRows as Row[];
  const documents = documentRows as Row[];
  return {
    departure: {
      id: String(departure.id),
      agencyId: String(departure.agency_id),
      templateId: String(departure.template_id),
      title: String(departure.title),
      programmeTitle: String(departure.programme_title),
      code: String(departure.code),
      startsOn: String(departure.starts_on),
      endsOn: String(departure.ends_on),
      status: String(departure.status),
      destinationCountry: value(departure.destination_country),
      agencyPrimaryColor: value(agencyBranding.primaryColor || "#247A6B"),
      versionNumber: Number(departure.version_number),
      quoteImportId: value(departure.quote_import_id),
    },
    days: (dayRows as Row[]).map((day) => ({
      id: String(day.id),
      number: Number(day.day_number),
      offset: Number(day.day_offset),
      label: value(day.label),
      title: value(day.title),
      city: value(day.city),
      description: value(day.description),
      items: items.filter((item) => String(item.trip_day_id) === String(day.id)).map((item) => ({
        id: String(item.id), type: String(item.item_type), title: String(item.title),
        description: value(item.description), startsAt: value(item.starts_at).slice(0, 5),
        endsAt: value(item.ends_at).slice(0, 5), sortOrder: Number(item.sort_order),
        operationalStatus: value(item.operational_status || "planned"),
        statusReason: value(item.status_reason),
        tickets: documents.filter((document) => String(document.itinerary_item_id) === String(item.id)).map((document) => ({
          id: String(document.id), title: String(document.title), contentType: String(document.content_type),
          sizeBytes: document.size_bytes == null ? null : Number(document.size_bytes),
          createdAt: String(document.created_at),
          downloadUrl: `/api/travel-documents/${String(document.id)}/content?download=1`,
        })),
        includedInQuote: typeof (item.metadata as Record<string, unknown> | null)?.includedInQuote === "boolean"
          ? Boolean((item.metadata as Record<string, unknown>).includedInQuote) : null,
      })),
      hotels: hotels.filter((hotel) => String(hotel.trip_day_id) === String(day.id)).map((hotel) => ({
        id: String(hotel.id), name: String(hotel.name), notes: value(hotel.notes),
        sortOrder: Number(hotel.sort_order),
      })),
    })),
  };
}

export type AgencyProgramme = Awaited<ReturnType<typeof getAgencyProgramme>>;

export async function cancelAgencyProgrammeItem(input: {
  departureId: string;
  itemId: string;
  actorId: string;
  reason: string;
  clientOperationId: string;
}) {
  const sql = getSql();
  const rows = await sql`
    WITH scoped_item AS (
      SELECT item.agency_id,item.id,item.departure_day_id,item.scheduled_start_at,item.scheduled_end_at
      FROM travel.departure_itinerary_items item
      WHERE item.departure_id=${input.departureId}::uuid AND item.id=${input.itemId}::uuid
    )
    SELECT app.record_itinerary_disruption(
      scoped_item.agency_id,scoped_item.id,scoped_item.departure_day_id,
      scoped_item.scheduled_start_at,scoped_item.scheduled_end_at,'cancelled',${input.reason},NULL,
      app.resolve_legacy_user_id(${input.actorId},scoped_item.agency_id),${input.clientOperationId}::uuid
    ) AS event_id
    FROM scoped_item
  `;
  if (!rows[0]?.event_id) throw new PlatformRequestError("Attività non disponibile");
  return String(rows[0].event_id);
}

export async function updateAgencyProgrammeDay(input: {
  departureId: string;
  dayId: string;
  actorId: string;
  label: string;
  title: string;
  city: string;
  description: string;
  items: Array<{ id: string; type: string; title: string; description: string; startsAt: string; endsAt: string; sortOrder: number; includedInQuote: boolean | null }>;
  hotels: Array<{ id: string; name: string; notes: string; sortOrder: number }>;
}) {
  const sql = getSql();
  const rows = await sql`SELECT app.update_departure_programme_day_v3(
    ${input.actorId},${input.departureId},${input.dayId},${input.label},${input.title},
    ${input.city},${input.description},${JSON.stringify(input.items)}::jsonb,
    ${JSON.stringify(input.hotels)}::jsonb
  ) AS updated`;
  if (!Boolean(rows[0]?.updated)) throw new PlatformRequestError("Giornata non disponibile");
}

function departureCode(title: string) {
  const base = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "PARTENZA";
  return `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function createDepartureFromProgramme(input: {
  templateId: string;
  actorId: string;
  startsOn: string;
  endsOn: string;
  title: string;
}) {
  const sql = getSql();
  const departureId=crypto.randomUUID();
  const title=input.title||"Nuova partenza";
  const rows=await sql`SELECT app.create_departure_from_programme_v3(${input.actorId},
    ${input.templateId},${departureId},${departureCode(title)},${title},${input.startsOn},${input.endsOn})::text AS id`;
  if(!rows[0]?.id) throw new PlatformRequestError("Pubblica il programma prima di creare una nuova partenza");
  return String(rows[0].id);
}
