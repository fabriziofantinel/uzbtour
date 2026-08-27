import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

type Row = Record<string, unknown>;

export function v3ExpenseShadowReadEnabled() {
  return process.env.V3_EXPENSE_SHADOW_READ === "true";
}

export function v3ExpenseCutoverReadEnabled() {
  return process.env.V3_EXPENSE_READ_SOURCE !== "legacy";
}

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

function canonicalExpense(row: Row) {
  return {
    id: String(row.id),
    dayId: row.trip_day_id ? String(row.trip_day_id) : null,
    label: String(row.label),
    amount: Number(row.amount),
    currency: String(row.currency),
    baseCurrency: String(row.base_currency || "EUR"),
    exchangeRateToBase: row.exchange_rate_to_base == null ? null : Number(row.exchange_rate_to_base),
    baseAmount: row.base_amount == null ? null : Number(row.base_amount),
    paidBy: String(row.paid_by_name),
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function compareV3ExpenseShadow(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
  legacyRows: Row[];
}) {
  if (!v3ExpenseShadowReadEnabled()) return;
  const sql = getSql();
  try {
    const [, targetRows] = await sql.transaction((txn) => [
      txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
      txn`
        SELECT expense.id::text, day.template_day_id::text AS trip_day_id,
          expense.label,
          expense.amount_minor::numeric / power(10::numeric, currency.minor_unit) AS amount,
          expense.currency, expense.base_currency, expense.exchange_rate_to_base,
          expense.base_amount_minor::numeric / power(10::numeric, base_currency.minor_unit) AS base_amount,
          expense.paid_by_name
        FROM journey.expenses expense
        JOIN ref.currencies currency ON currency.code = expense.currency
        JOIN ref.currencies base_currency ON base_currency.code = expense.base_currency
        LEFT JOIN travel.departure_days day ON day.id = expense.departure_day_id
        WHERE expense.agency_id = ${input.agencyId}
          AND expense.departure_id = ${input.departureId}
          AND expense.party_id = ${input.partyId}
        ORDER BY expense.id
      `,
    ], { readOnly: true });

    const legacy = input.legacyRows.map(canonicalExpense).sort((a, b) => a.id.localeCompare(b.id));
    const target = (targetRows as Row[]).map(canonicalExpense).sort((a, b) => a.id.localeCompare(b.id));
    const legacyDigest = digest(legacy);
    const targetDigest = digest(target);
    if (legacyDigest !== targetDigest) {
      const legacyIds = new Set(legacy.map((row) => row.id));
      const targetIds = new Set(target.map((row) => row.id));
      console.error("[v3-shadow] expense mismatch", {
        agencyId: input.agencyId,
        departureId: input.departureId,
        partyId: input.partyId,
        legacyCount: legacy.length,
        targetCount: target.length,
        missingInV3: legacy.filter((row) => !targetIds.has(row.id)).map((row) => row.id),
        missingInLegacy: target.filter((row) => !legacyIds.has(row.id)).map((row) => row.id),
        legacyDigest,
        targetDigest,
      });
    }
  } catch (error) {
    console.error("[v3-shadow] expense comparison failed", {
      agencyId: input.agencyId,
      departureId: input.departureId,
      partyId: input.partyId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
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
  currency: "EUR" | "USD" | "UZS" | "GBP";
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
