import { createHash, randomUUID } from "node:crypto";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

type Row = Record<string, unknown>;

export function v3JourneyJournalShadowReadEnabled() {
  return process.env.V3_JOURNEY_JOURNAL_SHADOW_READ === "true";
}

export function v3JourneyJournalDualWriteEnabled() {
  return process.env.V3_JOURNEY_JOURNAL_DUAL_WRITE === "true";
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

export async function saveTravelerNoteDualWrite(input: {
  agencyId: string; userId: string; userName: string; departureId: string;
  partyId: string; dayId: string; text: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id = traveler.agency_id
          AND membership.party_id = ${input.partyId} AND membership.traveler_id = traveler.id
        WHERE traveler.agency_id = ${input.agencyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
          AND membership.status = 'active'
      ), departure_day AS (
        SELECT id FROM travel.departure_days
        WHERE agency_id = ${input.agencyId} AND departure_id = ${input.departureId}
          AND template_day_id = ${input.dayId}
      ), legacy AS (
        INSERT INTO public.party_day_notes
          (agency_id, party_id, trip_day_id, text, updated_by_user_id, updated_by_name)
        SELECT ${input.agencyId}, ${input.partyId}, ${input.dayId}, ${input.text},
          ${input.userId}, ${input.userName}
        FROM actor, departure_day
        ON CONFLICT (party_id, trip_day_id) DO UPDATE SET
          text = EXCLUDED.text, updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_by_name = EXCLUDED.updated_by_name, updated_at = clock_timestamp()
        RETURNING *
      ), target AS (
        INSERT INTO journey.day_notes
          (id, agency_id, departure_id, party_id, departure_day_id, note_text,
           updated_by_traveler_id, client_operation_id, created_at, updated_at)
        SELECT legacy.id, legacy.agency_id, ${input.departureId}, legacy.party_id,
          departure_day.id, legacy.text, actor.id, legacy.id, legacy.created_at, legacy.updated_at
        FROM legacy, actor, departure_day
        ON CONFLICT (party_id, departure_day_id) DO UPDATE SET
          note_text = EXCLUDED.note_text,
          updated_by_traveler_id = EXCLUDED.updated_by_traveler_id,
          updated_at = EXCLUDED.updated_at
        RETURNING id, updated_at
      )
      SELECT id::text, updated_at::text FROM target
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Nota non disponibile");
  return { id: String((rows[0] as Row).id), updatedAt: String((rows[0] as Row).updated_at) };
}

export async function addTravelerRestaurantDualWrite(input: {
  agencyId: string; userId: string; userName: string; departureId: string;
  partyId: string; dayId: string; name: string; clientOperationId?: string;
}) {
  const sql = getSql();
  const clientOperationId = input.clientOperationId ?? randomUUID();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id = traveler.agency_id
          AND membership.party_id = ${input.partyId} AND membership.traveler_id = traveler.id
        WHERE traveler.agency_id = ${input.agencyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
          AND membership.status = 'active'
      ), departure_day AS (
        SELECT id FROM travel.departure_days
        WHERE agency_id = ${input.agencyId} AND departure_id = ${input.departureId}
          AND template_day_id = ${input.dayId}
      ), legacy AS (
        INSERT INTO public.party_restaurants
          (agency_id, party_id, trip_day_id, name, added_by_user_id, added_by_name, client_operation_id)
        SELECT ${input.agencyId}, ${input.partyId}, ${input.dayId}, ${input.name},
          ${input.userId}, ${input.userName}, ${clientOperationId}
        FROM actor, departure_day
        ON CONFLICT (party_id, client_operation_id) WHERE client_operation_id IS NOT NULL
        DO NOTHING
        RETURNING *
      ), source AS (
        SELECT * FROM legacy
        UNION ALL
        SELECT * FROM public.party_restaurants
        WHERE party_id = ${input.partyId} AND client_operation_id = ${clientOperationId}
          AND NOT EXISTS (SELECT 1 FROM legacy)
        LIMIT 1
      ), source_actor AS (
        SELECT traveler.id
        FROM source
        JOIN travel.traveler_profiles traveler
          ON traveler.agency_id = source.agency_id
          AND traveler.user_id = app.resolve_legacy_user_id(
            source.added_by_user_id, source.agency_id
          )
      ), target AS (
        INSERT INTO journey.restaurant_visits
          (id, agency_id, departure_id, party_id, departure_day_id, name,
           added_by_traveler_id, client_operation_id, created_at)
        SELECT source.id, source.agency_id, ${input.departureId}, source.party_id,
          departure_day.id, source.name, source_actor.id, ${clientOperationId}, source.created_at
        FROM source, source_actor, departure_day
        ON CONFLICT (party_id, client_operation_id) DO NOTHING
        RETURNING id, created_at
      )
      SELECT id::text, created_at::text FROM target
      UNION ALL
      SELECT id::text, created_at::text FROM journey.restaurant_visits
      WHERE party_id = ${input.partyId} AND client_operation_id = ${clientOperationId}
        AND NOT EXISTS (SELECT 1 FROM target)
      LIMIT 1
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Locale non disponibile");
  return { id: String((rows[0] as Row).id), createdAt: String((rows[0] as Row).created_at) };
}

export async function addTravelerCashMovementDualWrite(input: {
  agencyId: string; userId: string; userName: string; departureId: string;
  partyId: string; dayId: string; kind: "withdrawal" | "exchange";
  euroAmount: number | null; localAmount: number; feeEuro: number | null;
  clientOperationId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id = traveler.agency_id
          AND membership.party_id = ${input.partyId} AND membership.traveler_id = traveler.id
        WHERE traveler.agency_id = ${input.agencyId}
          AND traveler.user_id = app.resolve_legacy_user_id(${input.userId}, ${input.agencyId})
          AND membership.status = 'active'
      ), departure_day AS (
        SELECT id FROM travel.departure_days
        WHERE agency_id = ${input.agencyId} AND departure_id = ${input.departureId}
          AND template_day_id = ${input.dayId}
      ), legacy AS (
        INSERT INTO public.party_cash_movements
          (agency_id, party_id, trip_day_id, kind, euro_amount, local_amount, local_currency,
           fee_euro, added_by_user_id, added_by_name, client_operation_id)
        SELECT ${input.agencyId}, ${input.partyId}, ${input.dayId}, ${input.kind},
          ${input.euroAmount}, ${input.localAmount}, 'UZS', ${input.feeEuro},
          ${input.userId}, ${input.userName}, ${input.clientOperationId}
        FROM actor, departure_day
        ON CONFLICT (party_id, client_operation_id) WHERE client_operation_id IS NOT NULL
        DO NOTHING
        RETURNING *
      ), source AS (
        SELECT * FROM legacy
        UNION ALL
        SELECT * FROM public.party_cash_movements
        WHERE party_id = ${input.partyId} AND client_operation_id = ${input.clientOperationId}
          AND NOT EXISTS (SELECT 1 FROM legacy)
        LIMIT 1
      ), source_actor AS (
        SELECT traveler.id
        FROM source
        JOIN travel.traveler_profiles traveler
          ON traveler.agency_id = source.agency_id
          AND traveler.user_id = app.resolve_legacy_user_id(
            source.added_by_user_id, source.agency_id
          )
      ), target AS (
        INSERT INTO journey.cash_movements
          (id, agency_id, departure_id, party_id, departure_day_id, kind,
           source_amount_minor, source_currency, target_amount_minor, target_currency,
           applied_rate, added_by_traveler_id, client_operation_id, created_at)
        SELECT source.id, source.agency_id, ${input.departureId}, source.party_id,
          departure_day.id, source.kind,
          CASE WHEN source.euro_amount IS NULL THEN NULL ELSE round(source.euro_amount * 100)::bigint END,
          'EUR', round(source.local_amount * power(10::numeric, currency.minor_unit))::bigint,
          source.local_currency,
          CASE WHEN source.euro_amount IS NULL THEN NULL ELSE source.local_amount / source.euro_amount END,
          source_actor.id, ${input.clientOperationId}, source.created_at
        FROM source
        CROSS JOIN source_actor
        CROSS JOIN departure_day
        JOIN ref.currencies currency ON currency.code = source.local_currency
        ON CONFLICT (party_id, client_operation_id) DO NOTHING
        RETURNING id, created_at
      )
      SELECT id::text, created_at::text FROM target
      UNION ALL
      SELECT id::text, created_at::text FROM journey.cash_movements
      WHERE party_id = ${input.partyId} AND client_operation_id = ${input.clientOperationId}
        AND NOT EXISTS (SELECT 1 FROM target)
      LIMIT 1
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Movimento non disponibile");
  return { id: String((rows[0] as Row).id), createdAt: String((rows[0] as Row).created_at) };
}

export async function deleteTravelerCashMovementDualWrite(input: {
  agencyId: string; userId: string; departureId: string; partyId: string; movementId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH deleted_legacy AS (
        DELETE FROM public.party_cash_movements movement
        USING public.traveler_profiles profile, public.party_memberships membership,
          public.travel_parties party
        WHERE movement.id = ${input.movementId}
          AND movement.agency_id = ${input.agencyId} AND movement.party_id = ${input.partyId}
          AND party.id = movement.party_id AND party.departure_id = ${input.departureId}
          AND membership.party_id = party.id AND membership.agency_id = party.agency_id
          AND membership.status = 'active' AND profile.id = membership.traveler_id
          AND profile.user_id = ${input.userId}
        RETURNING movement.id
      ), deleted_target AS (
        DELETE FROM journey.cash_movements target
        USING deleted_legacy source
        WHERE target.id = source.id AND target.agency_id = ${input.agencyId}
        RETURNING target.id
      )
      SELECT id::text FROM deleted_legacy
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Movimento non disponibile");
}
