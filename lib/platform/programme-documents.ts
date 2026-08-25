import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

export async function requireAgencyTicketItem(input: { departureId: string; itemId: string; actorId: string }) {
  const sql = getSql();
  const rows = await sql`
    SELECT departure.agency_id::text, item.item_type
    FROM departures departure
    JOIN agency_memberships membership
      ON membership.agency_id = departure.agency_id AND membership.user_id = ${input.actorId}
      AND membership.role IN ('owner', 'admin', 'editor')
    JOIN itinerary_items item
      ON item.id = ${input.itemId} AND item.agency_id = departure.agency_id
    JOIN trip_days day
      ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
      AND day.template_version_id = departure.template_version_id
    WHERE departure.id = ${input.departureId}
      AND item.item_type IN ('flight', 'train')
    LIMIT 1
  `;
  if (!rows[0]) throw new PlatformRequestError("Volo o treno non disponibile");
  return { agencyId: String(rows[0].agency_id), itemType: String(rows[0].item_type) };
}
