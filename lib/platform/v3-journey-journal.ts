import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3JourneyJournalShadowReadEnabled() {
  return process.env.V3_JOURNEY_JOURNAL_SHADOW_READ === "true";
}

export function v3JourneyJournalCutoverReadEnabled() {
  return process.env.V3_JOURNEY_JOURNAL_READ_SOURCE !== "legacy";
}

export async function readV3JourneyJournalRows(input: {
  agencyId: string; departureId: string; partyId: string;
}) {
  const sql = getSql();
  const [, cash, notes, restaurants] = await sql.transaction((txn) => [
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
  ], { readOnly: true });
  return { cash: cash as Row[], notes: notes as Row[], restaurants: restaurants as Row[] };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ordered(rows: Row[]) {
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function canonicalCash(row: Row) {
  return {
    id: String(row.id), trip_day_id: String(row.trip_day_id), kind: String(row.kind),
    euro_amount: row.euro_amount == null ? null : Number(row.euro_amount),
    local_amount: Number(row.local_amount), local_currency: String(row.local_currency),
    added_by_name: String(row.added_by_name),
  };
}

function canonicalNote(row: Row) {
  return {
    id: String(row.id), trip_day_id: String(row.trip_day_id), text: String(row.text),
    updated_by_name: String(row.updated_by_name), updated_at: String(row.updated_at),
  };
}

function canonicalRestaurant(row: Row) {
  return {
    id: String(row.id), trip_day_id: String(row.trip_day_id), name: String(row.name),
    added_by_name: String(row.added_by_name), created_at: String(row.created_at),
  };
}

export async function compareV3JourneyJournalShadow(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
  legacyCash: Row[];
  legacyNotes: Row[];
  legacyRestaurants: Row[];
}) {
  if (!v3JourneyJournalShadowReadEnabled()) return;
  const sql = getSql();
  try {
    const [, cash, notes, restaurants] = await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
        SELECT movement.id::text, day.template_day_id::text AS trip_day_id,
          movement.kind,
          movement.source_amount_minor::numeric / power(10::numeric, source_currency.minor_unit) AS euro_amount,
          movement.target_amount_minor::numeric / power(10::numeric, target_currency.minor_unit) AS local_amount,
          movement.target_currency::text AS local_currency,
          traveler.display_name AS added_by_name
        FROM journey.cash_movements movement
        JOIN ref.currencies source_currency ON source_currency.code = movement.source_currency
        JOIN ref.currencies target_currency ON target_currency.code = movement.target_currency
        JOIN travel.departure_days day ON day.id = movement.departure_day_id
        JOIN travel.traveler_profiles traveler ON traveler.id = movement.added_by_traveler_id
        WHERE movement.agency_id = ${input.agencyId}
          AND movement.departure_id = ${input.departureId}
          AND movement.party_id = ${input.partyId}
        ORDER BY movement.id
      `,
      txn`
        SELECT note.id::text, day.template_day_id::text AS trip_day_id,
          note.note_text AS text, traveler.display_name AS updated_by_name,
          note.updated_at::text
        FROM journey.day_notes note
        JOIN travel.departure_days day ON day.id = note.departure_day_id
        JOIN travel.traveler_profiles traveler ON traveler.id = note.updated_by_traveler_id
        WHERE note.agency_id = ${input.agencyId}
          AND note.departure_id = ${input.departureId}
          AND note.party_id = ${input.partyId}
        ORDER BY note.id
      `,
      txn`
        SELECT visit.id::text, day.template_day_id::text AS trip_day_id,
          visit.name, traveler.display_name AS added_by_name, visit.created_at::text
        FROM journey.restaurant_visits visit
        JOIN travel.departure_days day ON day.id = visit.departure_day_id
        JOIN travel.traveler_profiles traveler ON traveler.id = visit.added_by_traveler_id
        WHERE visit.agency_id = ${input.agencyId}
          AND visit.departure_id = ${input.departureId}
          AND visit.party_id = ${input.partyId}
        ORDER BY visit.id
      `,
    ], { readOnly: true });

    const comparisons = [
      ["cash", input.legacyCash.map(canonicalCash), (cash as Row[]).map(canonicalCash)],
      ["notes", input.legacyNotes.map(canonicalNote), (notes as Row[]).map(canonicalNote)],
      ["restaurants", input.legacyRestaurants.map(canonicalRestaurant), (restaurants as Row[]).map(canonicalRestaurant)],
    ] as const;
    for (const [domain, legacyRows, targetRows] of comparisons) {
      const legacyDigest = digest(ordered(legacyRows.map((row) => ({ ...row }))));
      const targetDigest = digest(ordered(targetRows.map((row) => ({ ...row }))));
      if (legacyDigest !== targetDigest) {
        console.error(`[v3-shadow] ${domain} mismatch`, {
          agencyId: input.agencyId,
          departureId: input.departureId,
          partyId: input.partyId,
          legacyCount: legacyRows.length,
          targetCount: targetRows.length,
          legacyDigest,
          targetDigest,
        });
      }
    }
  } catch (error) {
    console.error("[v3-shadow] journey journal comparison failed", {
      agencyId: input.agencyId,
      departureId: input.departureId,
      partyId: input.partyId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
