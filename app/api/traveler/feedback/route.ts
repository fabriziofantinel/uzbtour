import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { assertTravelerPartyScope } from "@/lib/platform/traveler-experience";
import { assertArchitectureHardeningSchema, assertProgrammeFeedbackSchema } from "@/lib/platform/schema-readiness";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    await assertProgrammeFeedbackSchema();
    await assertArchitectureHardeningSchema();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const departureId = String(body?.departureId || "");
    const partyId = String(body?.partyId || "");
    const dayId = String(body?.dayId || "");
    const targetId = String(body?.targetId || "");
    const targetType = String(body?.targetType || "");
    const rating = Number(body?.rating);
    const clientOperationId = body?.clientOperationId == null
      ? crypto.randomUUID()
      : String(body.clientOperationId);
    if (!/^[0-9a-f-]{36}$/i.test(clientOperationId) || !['itinerary_item', 'hotel'].includes(targetType) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Valutazione non valida" }, { status: 400 });
    }
    const agencyId = await assertTravelerPartyScope({ userId: user.id, departureId, partyId, dayId });
    const sql = getSql();
    const profiles = await sql`
      SELECT profile.id::text
      FROM traveler_profiles profile
      JOIN party_memberships membership
        ON membership.traveler_id = profile.id AND membership.agency_id = profile.agency_id
        AND membership.party_id = ${partyId} AND membership.status = 'active'
      WHERE profile.agency_id = ${agencyId} AND profile.user_id = ${user.id}
      LIMIT 1
    `;
    if (!profiles[0]) return NextResponse.json({ error: "Viaggiatore non disponibile" }, { status: 403 });
    const travelerId = String(profiles[0].id);

    if (targetType === "itinerary_item") {
      const valid = await sql`
        SELECT 1
        FROM itinerary_items item
        JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
        JOIN departures departure
          ON departure.id = ${departureId} AND departure.agency_id = item.agency_id
          AND departure.template_version_id = day.template_version_id
        WHERE item.id = ${targetId} AND item.trip_day_id = ${dayId} AND item.agency_id = ${agencyId}
        LIMIT 1
      `;
      if (!valid[0]) return NextResponse.json({ error: "Tappa non disponibile" }, { status: 404 });
      const rows = await sql`
        INSERT INTO traveler_programme_feedback (agency_id, departure_id, party_id, traveler_id,
          trip_day_id, target_type, itinerary_item_id, rating, client_operation_id)
        VALUES (${agencyId}, ${departureId}, ${partyId}, ${travelerId}, ${dayId},
          'itinerary_item', ${targetId}, ${rating}, ${clientOperationId})
        ON CONFLICT (departure_id, party_id, traveler_id, itinerary_item_id)
          WHERE itinerary_item_id IS NOT NULL
        DO UPDATE SET rating = EXCLUDED.rating,
          client_operation_id = EXCLUDED.client_operation_id, updated_at = NOW()
        RETURNING id::text, rating, updated_at::text
      `;
      return NextResponse.json({ feedback: rows[0] });
    }

    const valid = await sql`
      SELECT 1
      FROM trip_day_hotels link
      JOIN trip_days day ON day.id = link.trip_day_id
      JOIN departures departure
        ON departure.id = ${departureId} AND departure.agency_id = day.agency_id
        AND departure.template_version_id = day.template_version_id
      WHERE link.trip_day_id = ${dayId} AND link.hotel_id = ${targetId} AND day.agency_id = ${agencyId}
      LIMIT 1
    `;
    if (!valid[0]) return NextResponse.json({ error: "Pernottamento non disponibile" }, { status: 404 });
    const rows = await sql`
      INSERT INTO traveler_programme_feedback (agency_id, departure_id, party_id, traveler_id,
        trip_day_id, target_type, hotel_id, rating, client_operation_id)
      VALUES (${agencyId}, ${departureId}, ${partyId}, ${travelerId}, ${dayId}, 'hotel', ${targetId}, ${rating}, ${clientOperationId})
      ON CONFLICT (departure_id, party_id, traveler_id, trip_day_id, hotel_id)
        WHERE hotel_id IS NOT NULL
      DO UPDATE SET rating = EXCLUDED.rating,
        client_operation_id = EXCLUDED.client_operation_id, updated_at = NOW()
      RETURNING id::text, rating, updated_at::text
    `;
    return NextResponse.json({ feedback: rows[0] });
  } catch (error) {
    console.error("Salvataggio valutazione programma non riuscito", error);
    return NextResponse.json({ error: "Valutazione non salvata" }, { status: 503 });
  }
}
