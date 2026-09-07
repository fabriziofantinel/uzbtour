import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export async function requireAgencyTicketItem(input: { departureId: string; itemId: string; actorId: string }) {
  const sql = getSql();
  const scope = await sql`SELECT agency_id::text FROM app.read_journey_management(
    ${input.actorId},${input.departureId}) LIMIT 1`;
  if (!scope[0]) throw new PlatformRequestError("Volo o treno non disponibile");
  const agencyId = String(scope[0].agency_id);
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id',${agencyId},true)`,
      txn`SELECT item.item_type FROM travel.departure_itinerary_items item
      WHERE item.id=${input.itemId} AND item.agency_id=${agencyId}
        AND item.departure_id=${input.departureId} AND item.item_type IN('flight','train')
      LIMIT 1`,
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Volo o treno non disponibile");
  return { agencyId, itemType: String(rows[0].item_type) };
}

export async function requireAgencyDepartureDay(input: {
  departureId: string;
  dayId: string;
  actorId: string;
  actorNativeId?: string;
}) {
  const sql = getSql();
  const scope = input.actorNativeId
    ? await sql`SELECT departure.agency_id::text FROM travel.departures departure
        WHERE departure.id=${input.departureId}::uuid
          AND app.is_departure_operator_v3(${input.actorNativeId}::uuid,departure.id) LIMIT 1`
    : await sql`SELECT agency_id::text FROM app.read_journey_management(
        ${input.actorId},${input.departureId}) LIMIT 1`;
  if (!scope[0]) throw new PlatformRequestError("Partenza non disponibile");
  const agencyId = String(scope[0].agency_id);
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id',${agencyId},true)`,
      txn`SELECT id::text FROM travel.departure_days
      WHERE id=${input.dayId} AND agency_id=${agencyId} AND departure_id=${input.departureId} LIMIT 1`,
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Giornata non disponibile");
  return { agencyId };
}

export async function requireAgencyDepartureDayGroup(input: {
  departureId: string;
  dayId: string;
  partyId: string;
  actorId: string;
  actorNativeId?: string;
}) {
  const { agencyId } = await requireAgencyDepartureDay(input);
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id',${agencyId},true)`,
      txn`SELECT id::text FROM travel.travel_parties
      WHERE id=${input.partyId} AND agency_id=${agencyId}
        AND departure_id=${input.departureId} AND status<>'archived' LIMIT 1`,
    ],
    { readOnly: true },
  );
  if (!rows[0]) throw new PlatformRequestError("Gruppo non disponibile");
  return { agencyId };
}

export async function requireAgencyDepartureDayDocumentAudience(input: {
  departureId: string;
  dayId: string;
  partyId?: string | null;
  travelerId?: string | null;
  actorId: string;
  actorNativeId?: string;
}) {
  const { agencyId } = await requireAgencyDepartureDay(input);
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id',${agencyId},true)`,
      txn`SELECT membership.traveler_id::text
        FROM travel.party_memberships membership
        WHERE membership.agency_id=${agencyId} AND membership.departure_id=${input.departureId}
          AND membership.status='active'
          AND (${input.partyId ?? null}::uuid IS NULL OR membership.party_id=${input.partyId ?? null}::uuid)
          AND (${input.travelerId ?? null}::uuid IS NULL OR membership.traveler_id=${input.travelerId ?? null}::uuid)
        LIMIT 1`,
    ],
    { readOnly: true },
  );
  if ((input.partyId || input.travelerId) && !rows[0]) throw new PlatformRequestError("Destinatario non disponibile");
  if (input.travelerId && !input.partyId) throw new PlatformRequestError("Seleziona anche il gruppo del viaggiatore");
  return { agencyId };
}
