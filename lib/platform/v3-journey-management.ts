import "server-only";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

export async function readV3JourneyManagement(departureId: string, actorId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM app.read_journey_management(${actorId},${departureId}::uuid)
  `;
  const first = rows[0];
  if (!first) throw new PlatformRequestError("Viaggio non trovato");
  const partyIds = [...new Set(rows.filter((row) => row.party_id).map((row) => String(row.party_id)))];
  return {
    journey: {
      id: String(first.departure_id),
      agencyId: String(first.agency_id),
      title: String(first.title),
      code: String(first.code),
      startsOn: String(first.starts_on),
      endsOn: String(first.ends_on),
      status: String(first.departure_status),
      agencyName: String(first.agency_name),
      destinationCountry: String(first.destination_country || ""),
    },
    families: partyIds.map((id) => {
      const familyRows = rows.filter((row) => String(row.party_id) === id);
      const family = familyRows[0];
      return {
        id,
        name: String(family.party_name),
        code: String(family.party_code),
        status: String(family.party_status),
        travelers: familyRows.filter((row) => row.traveler_id).map((row) => ({
          id: String(row.traveler_id),
          name: String(row.traveler_name),
          email: String(row.traveler_email || ""),
          phone: String(row.traveler_phone || ""),
          role: String(row.membership_role),
          status: String(row.user_status || row.membership_status),
        })),
      };
    }),
  };
}
