import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export async function readV3JourneyJournalRows(input: { agencyId: string; departureId: string; partyId: string }) {
  const sql = getSql();
  const [, cash, notes, restaurants] = await sql.transaction(
    (txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
      SELECT movement.id::text, day.template_day_id::text AS trip_day_id,
        template_day.day_number, movement.kind,
        movement.source_amount_minor::numeric / power(10::numeric, source_currency.minor_unit) AS euro_amount,
        movement.target_amount_minor::numeric / power(10::numeric, target_currency.minor_unit) AS local_amount,
        movement.target_currency::text AS local_currency, NULL::numeric AS fee_euro,
        traveler.display_name AS added_by_name, movement.created_at::text
      FROM journey.cash_movements movement
      JOIN ref.currencies source_currency ON source_currency.code = movement.source_currency
      JOIN ref.currencies target_currency ON target_currency.code = movement.target_currency
      JOIN travel.departure_days day ON day.id = movement.departure_day_id
        AND day.agency_id = movement.agency_id
      JOIN travel.template_days template_day ON template_day.id = day.template_day_id
        AND template_day.agency_id = day.agency_id
        AND template_day.template_version_id = day.template_version_id
      JOIN travel.traveler_profiles traveler ON traveler.id = movement.added_by_traveler_id
        AND traveler.agency_id = movement.agency_id
      WHERE movement.agency_id = ${input.agencyId}
        AND movement.departure_id = ${input.departureId}
        AND movement.party_id = ${input.partyId}
      ORDER BY movement.created_at DESC
    `,
      txn`
      SELECT note.id::text, day.template_day_id::text AS trip_day_id,
        template_day.day_number, note.note_text AS text, traveler.display_name AS updated_by_name,
        note.updated_at::text
      FROM journey.day_notes note
      JOIN travel.departure_days day ON day.id = note.departure_day_id
        AND day.agency_id = note.agency_id
      JOIN travel.template_days template_day ON template_day.id = day.template_day_id
        AND template_day.agency_id = day.agency_id
        AND template_day.template_version_id = day.template_version_id
      JOIN travel.traveler_profiles traveler ON traveler.id = note.updated_by_traveler_id
        AND traveler.agency_id = note.agency_id
      WHERE note.agency_id = ${input.agencyId}
        AND note.departure_id = ${input.departureId}
        AND note.party_id = ${input.partyId}
      ORDER BY template_day.day_number
    `,
      txn`
      SELECT visit.id::text, day.template_day_id::text AS trip_day_id,
        template_day.day_number, visit.name, traveler.display_name AS added_by_name,
        visit.created_at::text
      FROM journey.restaurant_visits visit
      JOIN travel.departure_days day ON day.id = visit.departure_day_id
        AND day.agency_id = visit.agency_id
      JOIN travel.template_days template_day ON template_day.id = day.template_day_id
        AND template_day.agency_id = day.agency_id
        AND template_day.template_version_id = day.template_version_id
      JOIN travel.traveler_profiles traveler ON traveler.id = visit.added_by_traveler_id
        AND traveler.agency_id = visit.agency_id
      WHERE visit.agency_id = ${input.agencyId}
        AND visit.departure_id = ${input.departureId}
        AND visit.party_id = ${input.partyId}
      ORDER BY visit.created_at DESC
    `,
    ],
    { readOnly: true },
  );
  return { cash: cash as Row[], notes: notes as Row[], restaurants: restaurants as Row[] };
}
