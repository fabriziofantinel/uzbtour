import { randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");

const client = new Client(runtimeUrl);
let transactionOpen = false;

try {
  await client.connect();
  const role = (await client.query("SELECT current_user AS role_name")).rows[0];
  if (!role || role.role_name !== "smf_app") {
    throw new Error(`Smoke test eseguito con ruolo inatteso: ${role?.role_name ?? "sconosciuto"}`);
  }

  const scope = (await client.query(`
    SELECT agency_id::text, departure_id::text, party_id::text
      FROM public.party_expenses
     ORDER BY created_at, id
     LIMIT 1
  `)).rows[0];
  if (!scope) throw new Error("Nessuna spesa disponibile per lo smoke test runtime");

  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL statement_timeout = '2min'");
  await client.query("SELECT set_config('app.agency_id', $1, true)", [scope.agency_id]);

  const reconciliation = (await client.query(`
    WITH legacy AS (
      SELECT expense.id, expense.trip_day_id, expense.label,
        expense.amount, expense.currency, expense.base_currency,
        expense.exchange_rate_to_base, expense.base_amount, expense.paid_by_name
      FROM public.party_expenses expense
      WHERE expense.agency_id = $1 AND expense.departure_id = $2 AND expense.party_id = $3
    ), target AS (
      SELECT expense.id, day.template_day_id AS trip_day_id, expense.label,
        expense.amount_minor::numeric / power(10::numeric, currency.minor_unit) AS amount,
        expense.currency::text, expense.base_currency::text,
        expense.exchange_rate_to_base,
        expense.base_amount_minor::numeric / power(10::numeric, base_currency.minor_unit) AS base_amount,
        expense.paid_by_name
      FROM journey.expenses expense
      JOIN ref.currencies currency ON currency.code = expense.currency
      JOIN ref.currencies base_currency ON base_currency.code = expense.base_currency
      LEFT JOIN travel.departure_days day ON day.id = expense.departure_day_id
      WHERE expense.agency_id = $1 AND expense.departure_id = $2 AND expense.party_id = $3
    )
    SELECT
      (SELECT count(*)::int FROM legacy) AS legacy_count,
      (SELECT count(*)::int FROM target) AS target_count,
      count(*) FILTER (WHERE legacy.id IS NULL OR target.id IS NULL OR
        legacy.trip_day_id IS DISTINCT FROM target.trip_day_id OR
        legacy.label IS DISTINCT FROM target.label OR
        legacy.amount IS DISTINCT FROM target.amount OR
        legacy.currency IS DISTINCT FROM target.currency OR
        legacy.base_currency IS DISTINCT FROM target.base_currency OR
        legacy.exchange_rate_to_base IS DISTINCT FROM target.exchange_rate_to_base OR
        legacy.base_amount IS DISTINCT FROM target.base_amount OR
        legacy.paid_by_name IS DISTINCT FROM target.paid_by_name)::int AS mismatch_count
    FROM legacy FULL JOIN target USING (id)
  `, [scope.agency_id, scope.departure_id, scope.party_id])).rows[0];
  if (!reconciliation || reconciliation.mismatch_count !== 0 ||
      reconciliation.legacy_count !== reconciliation.target_count) {
    throw new Error(`Riconciliazione runtime fallita: ${JSON.stringify(reconciliation)}`);
  }

  const smokeId = randomUUID();
  const operationId = randomUUID();
  const inserted = await client.query(`
    INSERT INTO journey.expenses (
      id, agency_id, departure_id, party_id, departure_day_id, label,
      amount_minor, currency, base_currency, exchange_rate_to_base,
      base_amount_minor, paid_by_traveler_id, paid_by_name,
      allocation_method, allocation_status, client_operation_id
    )
    SELECT $1::uuid, agency_id, departure_id, party_id, departure_day_id,
      'SMOKE V3 - rollback', amount_minor, currency, base_currency,
      exchange_rate_to_base, base_amount_minor, paid_by_traveler_id, paid_by_name,
      allocation_method, allocation_status, $2::uuid
    FROM journey.expenses
    WHERE agency_id = $3 AND departure_id = $4 AND party_id = $5
    ORDER BY created_at, id LIMIT 1
    RETURNING id
  `, [smokeId, operationId, scope.agency_id, scope.departure_id, scope.party_id]);
  if (inserted.rowCount !== 1) throw new Error("INSERT runtime v3 non eseguito");

  const updated = await client.query(
    "UPDATE journey.expenses SET label = 'SMOKE V3 - updated' WHERE id = $1 RETURNING id",
    [smokeId],
  );
  if (updated.rowCount !== 1) throw new Error("UPDATE runtime v3 non eseguito");

  const deleted = await client.query(
    "DELETE FROM journey.expenses WHERE id = $1 RETURNING id",
    [smokeId],
  );
  if (deleted.rowCount !== 1) throw new Error("DELETE runtime v3 non eseguito");

  await client.query("ROLLBACK");
  transactionOpen = false;
  console.log(JSON.stringify({
    status: "passed_with_rollback",
    role: role.role_name,
    reconciliation,
    dml: { insert: true, update: true, delete: true },
  }, null, 2));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
