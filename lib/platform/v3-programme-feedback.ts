import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3ProgrammeFeedbackShadowReadEnabled() {
  return process.env.V3_PROGRAMME_FEEDBACK_SHADOW_READ === "true";
}

export function v3ProgrammeFeedbackCutoverReadEnabled() {
  return process.env.V3_PROGRAMME_FEEDBACK_READ_SOURCE !== "legacy";
}

export async function readV3ProgrammeFeedbackRows(input: {
  agencyId: string; departureId: string; partyId: string; userId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
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
        AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
    `,
  ], { readOnly: true });
  return rows as Row[];
}

function canonicalFeedback(row: Row) {
  return {
    id: String(row.id),
    dayId: String(row.trip_day_id),
    targetType: String(row.target_type),
    itineraryItemId: row.itinerary_item_id ? String(row.itinerary_item_id) : null,
    hotelId: row.hotel_id ? String(row.hotel_id) : null,
    rating: Number(row.rating),
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function compareV3ProgrammeFeedbackShadow(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
  userId: string;
  legacyRows: Row[];
}) {
  if (!v3ProgrammeFeedbackShadowReadEnabled()) return;
  const sql = getSql();
  try {
    const [, targetRows] = await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
        SELECT feedback.id::text, day.template_day_id::text AS trip_day_id,
          feedback.target_type, item.source_template_item_id::text AS itinerary_item_id,
          feedback.hotel_id::text, feedback.rating
        FROM journey.programme_feedback feedback
        JOIN travel.departure_days day
          ON day.id = feedback.departure_day_id
         AND day.agency_id = feedback.agency_id
         AND day.departure_id = feedback.departure_id
        JOIN travel.traveler_profiles traveler
          ON traveler.id = feedback.traveler_id
         AND traveler.agency_id = feedback.agency_id
        LEFT JOIN travel.departure_itinerary_items item
          ON item.id = feedback.departure_item_id
         AND item.agency_id = feedback.agency_id
         AND item.departure_id = feedback.departure_id
        WHERE feedback.agency_id = ${input.agencyId}
          AND feedback.departure_id = ${input.departureId}
          AND feedback.party_id = ${input.partyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
        ORDER BY feedback.id
      `,
    ], { readOnly: true });

    const legacy = input.legacyRows.map(canonicalFeedback).sort((a, b) => a.id.localeCompare(b.id));
    const target = (targetRows as Row[]).map(canonicalFeedback).sort((a, b) => a.id.localeCompare(b.id));
    const legacyDigest = digest(legacy);
    const targetDigest = digest(target);
    if (legacyDigest !== targetDigest) {
      console.error("[v3-shadow] programme feedback mismatch", {
        agencyId: input.agencyId,
        departureId: input.departureId,
        partyId: input.partyId,
        legacyCount: legacy.length,
        targetCount: target.length,
        legacyDigest,
        targetDigest,
      });
    }
  } catch (error) {
    console.error("[v3-shadow] programme feedback comparison failed", {
      agencyId: input.agencyId,
      departureId: input.departureId,
      partyId: input.partyId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
