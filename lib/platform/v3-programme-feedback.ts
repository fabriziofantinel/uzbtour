import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export async function readV3ProgrammeFeedbackRows(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
  actorUserId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
      SELECT day.template_day_id::text AS trip_day_id, feedback.target_type,
        item.source_template_item_id::text AS itinerary_item_id,
        feedback.hotel_id::text, feedback.rating
      FROM journey.programme_feedback feedback
      JOIN travel.departure_days day ON day.id = feedback.departure_day_id
        AND day.agency_id = feedback.agency_id AND day.departure_id = feedback.departure_id
      JOIN travel.traveler_profiles traveler ON traveler.id = feedback.traveler_id
        AND traveler.agency_id = feedback.agency_id
      LEFT JOIN travel.departure_itinerary_items item ON item.id = feedback.departure_item_id
        AND item.agency_id = feedback.agency_id AND item.departure_id = feedback.departure_id
      WHERE feedback.agency_id = ${input.agencyId}
        AND feedback.departure_id = ${input.departureId}
        AND feedback.party_id = ${input.partyId}
        AND traveler.user_id = ${input.actorUserId}::uuid
    `,
    ],
    { readOnly: true },
  );
  return rows as Row[];
}
