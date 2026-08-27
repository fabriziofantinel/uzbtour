import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

type Row = Record<string, unknown>;

export function v3ProgrammeFeedbackShadowReadEnabled() {
  return process.env.V3_PROGRAMME_FEEDBACK_SHADOW_READ === "true";
}

export function v3ProgrammeFeedbackDualWriteEnabled() {
  return process.env.V3_PROGRAMME_FEEDBACK_DUAL_WRITE !== "false";
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

export async function saveTravelerProgrammeFeedbackDualWrite(input: {
  agencyId: string;
  userId: string;
  departureId: string;
  partyId: string;
  dayId: string;
  targetId: string;
  targetType: "itinerary_item" | "hotel";
  rating: number;
  clientOperationId: string;
}) {
  return input.targetType === "itinerary_item"
    ? saveItineraryItemFeedback(input)
    : saveHotelFeedback(input);
}

async function saveItineraryItemFeedback(input: Parameters<typeof saveTravelerProgrammeFeedbackDualWrite>[0]) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH legacy_actor AS (
        SELECT profile.id
        FROM public.traveler_profiles profile
        JOIN public.party_memberships membership
          ON membership.agency_id = profile.agency_id
         AND membership.traveler_id = profile.id
         AND membership.party_id = ${input.partyId}
         AND membership.status = 'active'
        WHERE profile.agency_id = ${input.agencyId} AND profile.user_id = ${input.userId}
      ), target_actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id = traveler.agency_id
         AND membership.traveler_id = traveler.id
         AND membership.party_id = ${input.partyId}
         AND membership.departure_id = ${input.departureId}
         AND membership.status = 'active'
        WHERE traveler.agency_id = ${input.agencyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
      ), target_day AS (
        SELECT id FROM travel.departure_days
        WHERE agency_id = ${input.agencyId} AND departure_id = ${input.departureId}
          AND template_day_id = ${input.dayId}
      ), target_item AS (
        SELECT item.id
        FROM travel.departure_itinerary_items item, target_day
        WHERE item.agency_id = ${input.agencyId} AND item.departure_id = ${input.departureId}
          AND item.departure_day_id = target_day.id
          AND item.source_template_item_id = ${input.targetId}
      ), legacy AS (
        INSERT INTO public.traveler_programme_feedback
          (agency_id, departure_id, party_id, traveler_id, trip_day_id, target_type,
           itinerary_item_id, rating, client_operation_id)
        SELECT ${input.agencyId}, ${input.departureId}, ${input.partyId}, legacy_actor.id,
          ${input.dayId}, 'itinerary_item', ${input.targetId}, ${input.rating}, ${input.clientOperationId}
        FROM legacy_actor, target_actor, target_day, target_item
        ON CONFLICT (departure_id, party_id, traveler_id, itinerary_item_id)
          WHERE itinerary_item_id IS NOT NULL
        DO UPDATE SET rating = EXCLUDED.rating,
          client_operation_id = EXCLUDED.client_operation_id, updated_at = clock_timestamp()
        RETURNING *
      ), target AS (
        INSERT INTO journey.programme_feedback
          (id, agency_id, departure_id, party_id, traveler_id, departure_day_id,
           target_type, departure_item_id, hotel_id, rating, comment,
           client_operation_id, created_at, updated_at)
        SELECT legacy.id, legacy.agency_id, legacy.departure_id, legacy.party_id,
          target_actor.id, target_day.id, 'itinerary_item', target_item.id, NULL,
          legacy.rating, '', legacy.client_operation_id, legacy.created_at, legacy.updated_at
        FROM legacy, target_actor, target_day, target_item
        ON CONFLICT (party_id, traveler_id, departure_item_id)
          WHERE target_type = 'itinerary_item'
        DO UPDATE SET rating = EXCLUDED.rating,
          client_operation_id = EXCLUDED.client_operation_id, updated_at = EXCLUDED.updated_at
        RETURNING id, rating, updated_at
      )
      SELECT id::text, rating, updated_at::text FROM target
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Valutazione non disponibile");
  return rows[0] as Row;
}

async function saveHotelFeedback(input: Parameters<typeof saveTravelerProgrammeFeedbackDualWrite>[0]) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH legacy_actor AS (
        SELECT profile.id
        FROM public.traveler_profiles profile
        JOIN public.party_memberships membership
          ON membership.agency_id = profile.agency_id
         AND membership.traveler_id = profile.id
         AND membership.party_id = ${input.partyId}
         AND membership.status = 'active'
        WHERE profile.agency_id = ${input.agencyId} AND profile.user_id = ${input.userId}
      ), target_actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id = traveler.agency_id
         AND membership.traveler_id = traveler.id
         AND membership.party_id = ${input.partyId}
         AND membership.departure_id = ${input.departureId}
         AND membership.status = 'active'
        WHERE traveler.agency_id = ${input.agencyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
      ), target_day AS (
        SELECT id FROM travel.departure_days
        WHERE agency_id = ${input.agencyId} AND departure_id = ${input.departureId}
          AND template_day_id = ${input.dayId}
      ), target_hotel AS (
        SELECT hotel.id
        FROM ref.hotels hotel
        JOIN public.trip_day_hotels legacy_link
          ON legacy_link.hotel_id = hotel.id AND legacy_link.trip_day_id = ${input.dayId}
        WHERE hotel.id = ${input.targetId}
      ), legacy AS (
        INSERT INTO public.traveler_programme_feedback
          (agency_id, departure_id, party_id, traveler_id, trip_day_id, target_type,
           hotel_id, rating, client_operation_id)
        SELECT ${input.agencyId}, ${input.departureId}, ${input.partyId}, legacy_actor.id,
          ${input.dayId}, 'hotel', target_hotel.id, ${input.rating}, ${input.clientOperationId}
        FROM legacy_actor, target_actor, target_day, target_hotel
        ON CONFLICT (departure_id, party_id, traveler_id, trip_day_id, hotel_id)
          WHERE hotel_id IS NOT NULL
        DO UPDATE SET rating = EXCLUDED.rating,
          client_operation_id = EXCLUDED.client_operation_id, updated_at = clock_timestamp()
        RETURNING *
      ), target AS (
        INSERT INTO journey.programme_feedback
          (id, agency_id, departure_id, party_id, traveler_id, departure_day_id,
           target_type, departure_item_id, hotel_id, rating, comment,
           client_operation_id, created_at, updated_at)
        SELECT legacy.id, legacy.agency_id, legacy.departure_id, legacy.party_id,
          target_actor.id, target_day.id, 'hotel', NULL, target_hotel.id,
          legacy.rating, '', legacy.client_operation_id, legacy.created_at, legacy.updated_at
        FROM legacy, target_actor, target_day, target_hotel
        ON CONFLICT (party_id, traveler_id, departure_day_id, hotel_id)
          WHERE target_type = 'hotel'
        DO UPDATE SET rating = EXCLUDED.rating,
          client_operation_id = EXCLUDED.client_operation_id, updated_at = EXCLUDED.updated_at
        RETURNING id, rating, updated_at
      )
      SELECT id::text, rating, updated_at::text FROM target
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Valutazione non disponibile");
  return rows[0] as Row;
}
