import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { assertProgrammeFeedbackSchema } from "./schema-readiness";

type Row = Record<string, unknown>;

function value(value: unknown) {
  return value == null ? "" : String(value);
}

export async function getAgencyProgramme(departureId: string, actorId: string) {
  await assertProgrammeFeedbackSchema();
  const sql = getSql();
  const departures = await sql`
    SELECT d.id::text, d.agency_id::text, d.template_id::text, d.template_version_id::text,
      d.title, d.code, d.starts_on::text, d.ends_on::text, d.status,
      tt.title AS programme_title, tt.destination_country, version.version_number
    FROM departures d
    JOIN trip_templates tt ON tt.id = d.template_id AND tt.agency_id = d.agency_id
    JOIN trip_template_versions version
      ON version.id = d.template_version_id AND version.agency_id = d.agency_id
    JOIN agency_memberships membership
      ON membership.agency_id = d.agency_id AND membership.user_id = ${actorId}
      AND membership.role IN ('owner', 'admin', 'editor')
    WHERE d.id = ${departureId}
    LIMIT 1
  `;
  if (!departures[0]) throw new PlatformRequestError("Partenza non trovata");
  const departure = departures[0] as Row;
  const agencyId = String(departure.agency_id);
  const versionId = String(departure.template_version_id);
  const [dayRows, itemRows, hotelRows, documentRows] = await sql.transaction((transaction) => [
    transaction`
      SELECT id::text, day_number, day_offset, label, title, city, description
      FROM trip_days
      WHERE agency_id = ${agencyId} AND template_version_id = ${versionId}
      ORDER BY day_number
    `,
    transaction`
      SELECT item.id::text, item.trip_day_id::text, item.item_type, item.title,
        item.description, item.starts_at::text, item.ends_at::text, item.sort_order, item.metadata
      FROM itinerary_items item
      JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
      WHERE item.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, item.sort_order, item.id
    `,
    transaction`
      SELECT accommodation.id::text, accommodation.trip_day_id::text,
        accommodation.name, accommodation.notes, accommodation.sort_order
      FROM accommodations accommodation
      JOIN trip_days day ON day.id = accommodation.trip_day_id
        AND day.agency_id = accommodation.agency_id
      WHERE accommodation.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, accommodation.sort_order, accommodation.id
    `,
    transaction`
      SELECT document.id::text, document.itinerary_item_id::text, document.title,
        asset.content_type, asset.size_bytes, document.created_at::text
      FROM itinerary_item_documents document
      JOIN media_assets asset ON asset.id = document.media_asset_id AND asset.agency_id = document.agency_id
      JOIN itinerary_items item
        ON item.id = document.itinerary_item_id AND item.agency_id = document.agency_id
      JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
      WHERE document.agency_id = ${agencyId} AND document.departure_id = ${departureId}
        AND day.template_version_id = ${versionId} AND asset.status = 'ready'
      ORDER BY document.created_at
    `,
  ]);
  const items = itemRows as Row[];
  const hotels = hotelRows as Row[];
  const documents = documentRows as Row[];
  return {
    departure: {
      id: String(departure.id),
      templateId: String(departure.template_id),
      title: String(departure.title),
      programmeTitle: String(departure.programme_title),
      code: String(departure.code),
      startsOn: String(departure.starts_on),
      endsOn: String(departure.ends_on),
      status: String(departure.status),
      destinationCountry: value(departure.destination_country),
      versionNumber: Number(departure.version_number),
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

export async function updateAgencyProgrammeDay(input: {
  departureId: string;
  dayId: string;
  actorId: string;
  label: string;
  title: string;
  city: string;
  description: string;
  items: Array<{ id: string; title: string; description: string; startsAt: string; endsAt: string; sortOrder: number; includedInQuote: boolean | null }>;
  hotels: Array<{ id: string; name: string; notes: string; sortOrder: number }>;
}) {
  const sql = getSql();
  const scope = await sql`
    SELECT d.agency_id::text, d.template_version_id::text
    FROM departures d
    JOIN agency_memberships membership
      ON membership.agency_id = d.agency_id AND membership.user_id = ${input.actorId}
      AND membership.role IN ('owner', 'admin', 'editor')
    JOIN trip_days day ON day.id = ${input.dayId}
      AND day.agency_id = d.agency_id AND day.template_version_id = d.template_version_id
    WHERE d.id = ${input.departureId}
    LIMIT 1
  `;
  if (!scope[0]) throw new PlatformRequestError("Giornata non disponibile");
  const agencyId = String(scope[0].agency_id);
  const versionId = String(scope[0].template_version_id);
  const itemIds = input.items.map((item) => item.id);
  const hotelIds = input.hotels.map((hotel) => hotel.id);
  const validItems = itemIds.length === 0 ? [] : await sql`
    SELECT item.id::text
    FROM itinerary_items item
    JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
    WHERE item.id = ANY(${itemIds}::uuid[]) AND item.trip_day_id = ${input.dayId}
      AND item.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
  `;
  const validHotels = hotelIds.length === 0 ? [] : await sql`
    SELECT accommodation.id::text
    FROM accommodations accommodation
    JOIN trip_days day ON day.id = accommodation.trip_day_id
      AND day.agency_id = accommodation.agency_id
    WHERE accommodation.id = ANY(${hotelIds}::uuid[]) AND accommodation.trip_day_id = ${input.dayId}
      AND accommodation.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
  `;
  if (validItems.length !== itemIds.length || validHotels.length !== hotelIds.length) {
    throw new PlatformRequestError("Il programma contiene elementi non validi");
  }
  await sql.transaction((txn) => [
    txn`
      UPDATE trip_days SET label = ${input.label}, title = ${input.title}, city = ${input.city},
        description = ${input.description}
      WHERE id = ${input.dayId} AND agency_id = ${agencyId} AND template_version_id = ${versionId}
    `,
    ...input.items.map((item) => txn`
      UPDATE itinerary_items SET title = ${item.title}, description = ${item.description},
        starts_at = ${item.startsAt || null}, ends_at = ${item.endsAt || null}, sort_order = ${item.sortOrder}
      WHERE id = ${item.id} AND trip_day_id = ${input.dayId} AND agency_id = ${agencyId}
    `),
    ...input.hotels.map((hotel) => txn`
      UPDATE accommodations SET name = ${hotel.name}, notes = ${hotel.notes}, sort_order = ${hotel.sortOrder}
      WHERE id = ${hotel.id} AND trip_day_id = ${input.dayId} AND agency_id = ${agencyId}
    `),
    txn`
      INSERT INTO audit_events (agency_id, actor_user_id, departure_id, entity_type, entity_id, action, changes)
      VALUES (${agencyId}, ${input.actorId}, ${input.departureId}, 'trip_day', ${input.dayId},
        'updated', ${JSON.stringify({ sharedTemplateVersionId: versionId })}::jsonb)
    `,
  ]);
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
  const templates = await sql`
    SELECT template.id::text, template.agency_id::text, template.title, template.default_timezone,
      version.id::text AS version_id
    FROM trip_templates template
    JOIN agency_memberships membership
      ON membership.agency_id = template.agency_id AND membership.user_id = ${input.actorId}
      AND membership.role IN ('owner', 'admin', 'editor')
    JOIN LATERAL (
      SELECT id FROM trip_template_versions
      WHERE template_id = template.id AND agency_id = template.agency_id AND status = 'published'
      ORDER BY version_number DESC LIMIT 1
    ) version ON TRUE
    WHERE template.id = ${input.templateId} AND template.status = 'active'
    LIMIT 1
  `;
  if (!templates[0]) throw new PlatformRequestError("Pubblica il programma prima di creare una nuova partenza");
  const template = templates[0] as Row;
  const title = input.title || String(template.title);
  const rows = await sql`
    INSERT INTO departures (
      agency_id, template_id, template_version_id, code, title, starts_on, ends_on,
      timezone, status, published_at
    ) VALUES (
      ${String(template.agency_id)}, ${input.templateId}, ${String(template.version_id)},
      ${departureCode(title)}, ${title}, ${input.startsOn}, ${input.endsOn},
      ${String(template.default_timezone)}, 'confirmed', NOW()
    )
    RETURNING id::text
  `;
  return String(rows[0].id);
}
