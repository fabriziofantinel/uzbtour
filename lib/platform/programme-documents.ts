import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export async function requireAgencyTicketItem(input: { departureId: string; itemId: string; actorId: string }) {
  const sql = getSql();
  const scope=await sql`SELECT agency_id::text FROM app.read_journey_management(
    ${input.actorId},${input.departureId}) LIMIT 1`;
  if(!scope[0]) throw new PlatformRequestError("Volo o treno non disponibile");
  const agencyId=String(scope[0].agency_id);
  const [,rows]=await sql.transaction((txn)=>[
    txn`SELECT set_config('app.agency_id',${agencyId},true)`,
    txn`SELECT item.item_type FROM travel.departure_itinerary_items item
      WHERE item.id=${input.itemId} AND item.agency_id=${agencyId}
        AND item.departure_id=${input.departureId} AND item.item_type IN('flight','train')
      LIMIT 1`,
  ],{readOnly:true});
  if (!rows[0]) throw new PlatformRequestError("Volo o treno non disponibile");
  return { agencyId, itemType: String(rows[0].item_type) };
}
