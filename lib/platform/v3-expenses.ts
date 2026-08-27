import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

type Row = Record<string, unknown>;

export function v3ExpenseShadowReadEnabled() {
  return process.env.V3_EXPENSE_SHADOW_READ === "true";
}

export function v3ExpenseDualWriteEnabled() {
  return process.env.V3_EXPENSE_DUAL_WRITE === "true";
}

export function v3ExpenseCutoverReadEnabled() {
  return process.env.V3_EXPENSE_READ_SOURCE === "v3";
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

export async function addTravelerExpenseDualWrite(input: {
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
      WITH authorized_scope AS (
        SELECT departure.agency_id
        FROM public.traveler_profiles profile
        JOIN public.party_memberships membership
          ON membership.traveler_id = profile.id AND membership.status = 'active'
        JOIN public.travel_parties party
          ON party.id = membership.party_id AND party.agency_id = membership.agency_id
        JOIN public.departures departure
          ON departure.id = party.departure_id AND departure.agency_id = party.agency_id
        WHERE profile.user_id = ${input.userId}
          AND departure.agency_id = ${input.agencyId}
          AND party.id = ${input.partyId}
          AND departure.id = ${input.departureId}
          AND (${input.dayId ?? null}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM public.trip_days day
            WHERE day.id = ${input.dayId ?? null}::uuid
              AND day.agency_id = departure.agency_id
              AND day.template_version_id = departure.template_version_id
          ))
      ), rate_context AS (
        SELECT CASE
          WHEN ${input.currency}::text = 'EUR' THEN 1::numeric
          WHEN ${input.exchangeRateToBase ?? null}::numeric IS NOT NULL
            THEN ${input.exchangeRateToBase ?? null}::numeric
          ELSE (
            SELECT movement.euro_amount / movement.local_amount
            FROM public.party_cash_movements movement
            WHERE movement.party_id = ${input.partyId}
              AND movement.local_currency = ${input.currency}
              AND movement.euro_amount > 0 AND movement.local_amount > 0
            ORDER BY movement.created_at DESC, movement.id
            LIMIT 1
          )
        END AS exchange_rate_to_base
      ), inserted_legacy AS (
        INSERT INTO public.party_expenses (
          agency_id, departure_id, party_id, trip_day_id, label, amount, currency,
          paid_by_user_id, paid_by_name, client_operation_id, base_currency,
          exchange_rate_to_base, base_amount
        )
        SELECT scope.agency_id, ${input.departureId}, ${input.partyId}, ${input.dayId ?? null},
          ${input.label}, ${input.amount}, ${input.currency}, ${input.userId}, ${input.userName},
          ${input.clientOperationId}, 'EUR', rate.exchange_rate_to_base,
          round(${input.amount}::numeric * rate.exchange_rate_to_base, 4)
        FROM authorized_scope scope CROSS JOIN rate_context rate
        WHERE rate.exchange_rate_to_base IS NOT NULL
        ON CONFLICT (party_id, client_operation_id)
          WHERE client_operation_id IS NOT NULL
        DO NOTHING
        RETURNING *
      ), legacy_expense AS (
        SELECT * FROM inserted_legacy
        UNION ALL
        SELECT existing.* FROM public.party_expenses existing
        WHERE existing.party_id = ${input.partyId}
          AND existing.client_operation_id = ${input.clientOperationId}
          AND NOT EXISTS (SELECT 1 FROM inserted_legacy)
        LIMIT 1
      ), inserted_target AS (
        INSERT INTO journey.expenses (
          id, agency_id, departure_id, party_id, departure_day_id, label,
          amount_minor, currency, base_currency, exchange_rate_to_base,
          base_amount_minor, paid_by_traveler_id, paid_by_name,
          allocation_method, allocation_status, client_operation_id,
          created_at, updated_at
        )
        SELECT expense.id, expense.agency_id, expense.departure_id, expense.party_id,
          departure_day.id, expense.label,
          round(expense.amount * power(10::numeric, currency.minor_unit))::bigint,
          expense.currency, expense.base_currency, expense.exchange_rate_to_base,
          round(expense.base_amount * power(10::numeric, base_currency.minor_unit))::bigint,
          payer.id, expense.paid_by_name, 'whole_party', 'draft',
          expense.client_operation_id, expense.created_at, expense.updated_at
        FROM legacy_expense expense
        JOIN ref.currencies currency ON currency.code = expense.currency
        JOIN ref.currencies base_currency ON base_currency.code = expense.base_currency
        LEFT JOIN travel.departure_days departure_day
          ON departure_day.departure_id = expense.departure_id
          AND departure_day.template_day_id = expense.trip_day_id
        LEFT JOIN travel.traveler_profiles payer
          ON payer.agency_id = expense.agency_id
          AND payer.user_id = app.resolve_legacy_user_id(
            expense.paid_by_user_id, expense.agency_id
          )
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

export async function deleteTravelerExpenseDualWrite(input: {
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
      WITH deleted_legacy AS (
        DELETE FROM public.party_expenses expense
        USING public.traveler_profiles profile, public.party_memberships membership,
          public.travel_parties party
        WHERE expense.id = ${input.expenseId}
          AND expense.departure_id = ${input.departureId}
          AND expense.party_id = ${input.partyId}
          AND expense.agency_id = ${input.agencyId}
          AND party.id = expense.party_id
          AND party.departure_id = expense.departure_id
          AND membership.party_id = party.id
          AND membership.agency_id = party.agency_id
          AND membership.status = 'active'
          AND profile.id = membership.traveler_id
          AND profile.user_id = ${input.userId}
        RETURNING expense.id
      ), deleted_target AS (
        DELETE FROM journey.expenses target
        USING deleted_legacy source
        WHERE target.id = source.id AND target.agency_id = ${input.agencyId}
        RETURNING target.id
      )
      SELECT id::text FROM deleted_legacy
    `,
  ]);
  if (!rows[0]) throw new PlatformRequestError("Spesa non disponibile");
}
