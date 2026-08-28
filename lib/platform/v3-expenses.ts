import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

type Row = Record<string, unknown>;

export async function readV3ExpenseRows(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      SELECT expense.id::text, day.template_day_id::text AS trip_day_id,
        template_day.day_number, expense.label,
        expense.amount_minor::numeric / power(10::numeric, currency.minor_unit) AS amount,
        expense.currency, expense.base_currency, expense.exchange_rate_to_base,
        expense.base_amount_minor::numeric / power(10::numeric, base_currency.minor_unit) AS base_amount,
        expense.paid_by_name, expense.created_at::text
      FROM journey.expenses expense
      JOIN ref.currencies currency ON currency.code = expense.currency
      JOIN ref.currencies base_currency ON base_currency.code = expense.base_currency
      LEFT JOIN travel.departure_days day
        ON day.id = expense.departure_day_id AND day.agency_id = expense.agency_id
      LEFT JOIN travel.template_days template_day
        ON template_day.id = day.template_day_id
       AND template_day.agency_id = day.agency_id
       AND template_day.template_version_id = day.template_version_id
      WHERE expense.agency_id = ${input.agencyId}
        AND expense.departure_id = ${input.departureId}
        AND expense.party_id = ${input.partyId}
      ORDER BY expense.created_at DESC
    `,
  ], { readOnly: true });
  return rows as Row[];
}

export async function addTravelerExpenseV3(input: {
  agencyId: string;
  userId: string;
  userName: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
  label: string;
  amount: number;
  currency: "EUR" | "USD" | "UZS" | "GBP" | "VND";
  clientOperationId: string;
  exchangeRateToBase?: number | null;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      WITH actor AS (
        SELECT traveler.id
        FROM travel.traveler_profiles traveler
        JOIN travel.party_memberships membership
          ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id
         AND membership.departure_id=${input.departureId} AND membership.party_id=${input.partyId}
         AND membership.status='active'
        WHERE traveler.agency_id=${input.agencyId}
          AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
      ), departure_day AS (
        SELECT day.id FROM travel.departure_days day
        WHERE day.agency_id=${input.agencyId} AND day.departure_id=${input.departureId}
          AND day.template_day_id=${input.dayId ?? null}::uuid
      ), rate_context AS (
        SELECT CASE
          WHEN ${input.currency}::text = 'EUR' THEN 1::numeric
          WHEN ${input.exchangeRateToBase ?? null}::numeric IS NOT NULL
            THEN ${input.exchangeRateToBase ?? null}::numeric
          ELSE (
            SELECT 1 / movement.applied_rate
            FROM journey.cash_movements movement
            WHERE movement.party_id = ${input.partyId}
              AND movement.target_currency = ${input.currency}
              AND movement.applied_rate > 0
            ORDER BY movement.created_at DESC, movement.id
            LIMIT 1
          )
        END AS exchange_rate_to_base
      ), inserted_target AS (
        INSERT INTO journey.expenses (
          agency_id, departure_id, party_id, departure_day_id, label,
          amount_minor, currency, base_currency, exchange_rate_to_base,
          base_amount_minor, paid_by_traveler_id, paid_by_name,
          allocation_method, allocation_status, client_operation_id,
          created_at, updated_at
        )
        SELECT ${input.agencyId},${input.departureId},${input.partyId},departure_day.id,
          ${input.label},round(${input.amount}::numeric*power(10::numeric,currency.minor_unit))::bigint,
          ${input.currency},'EUR',rate.exchange_rate_to_base,
          round(${input.amount}::numeric*rate.exchange_rate_to_base*100)::bigint,
          actor.id,${input.userName},'whole_party','draft',${input.clientOperationId},
          clock_timestamp(),clock_timestamp()
        FROM actor CROSS JOIN rate_context rate
        JOIN ref.currencies currency ON currency.code=${input.currency}
        LEFT JOIN departure_day ON true
        WHERE rate.exchange_rate_to_base IS NOT NULL
          AND (${input.dayId ?? null}::uuid IS NULL OR departure_day.id IS NOT NULL)
        ON CONFLICT (party_id, client_operation_id) DO NOTHING
        RETURNING id
      )
      SELECT id::text FROM inserted_target
      UNION ALL
      SELECT existing.id::text FROM journey.expenses existing
      WHERE existing.party_id = ${input.partyId}
        AND existing.client_operation_id = ${input.clientOperationId}
        AND NOT EXISTS (SELECT 1 FROM inserted_target)
      LIMIT 1
    `,
  ]);
  if (!rows[0]) {
    throw new PlatformRequestError(
      input.currency === "EUR"
        ? "Viaggio o giornata non disponibili"
        : "Cambio non disponibile: registra prima un cambio o un prelievo",
    );
  }
  return String((rows[0] as Row).id);
}

export async function deleteTravelerExpenseV3(input: {
  agencyId: string;
  userId: string;
  departureId: string;
  partyId: string;
  expenseId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      DELETE FROM journey.expenses expense
      USING travel.traveler_profiles traveler,travel.party_memberships membership
      WHERE expense.id=${input.expenseId} AND expense.agency_id=${input.agencyId}
        AND expense.departure_id=${input.departureId} AND expense.party_id=${input.partyId}
        AND traveler.agency_id=expense.agency_id
        AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
        AND membership.agency_id=expense.agency_id AND membership.departure_id=expense.departure_id
        AND membership.party_id=expense.party_id AND membership.traveler_id=traveler.id
        AND membership.status='active'
      RETURNING expense.id::text
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Spesa non disponibile");
}
