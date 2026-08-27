import { randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");

const client = new Client(runtimeUrl);
let open = false;
try {
  await client.connect();
  const role = (await client.query("SELECT current_user AS role_name")).rows[0]?.role_name;
  const privileges = (await client.query(`SELECT
    has_table_privilege(current_user,'journey.expenses','SELECT') AS expenses,
    has_table_privilege(current_user,'journey.cash_movements','SELECT') AS cash_movements,
    has_table_privilege(current_user,'journey.day_notes','SELECT') AS day_notes,
    has_table_privilege(current_user,'journey.restaurant_visits','SELECT') AS restaurants,
    has_table_privilege(current_user,'journey.programme_feedback','SELECT') AS feedback
  `)).rows[0];
  const missingPrivileges = Object.entries(privileges)
    .filter(([, allowed]) => allowed !== true)
    .map(([table]) => table);
  if (missingPrivileges.length) {
    throw new Error(`Ruolo runtime ${role} senza SELECT su: ${missingPrivileges.join(", ")}`);
  }
  const scope = (await client.query(`
    SELECT party.agency_id, party.departure_id, party.id AS party_id
    FROM public.travel_parties party
    ORDER BY party.created_at, party.id
    LIMIT 1
  `)).rows[0];
  if (!scope) throw new Error("Nessuna famiglia disponibile per lo smoke test");

  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [scope.agency_id]);

  const reconciliations = (await client.query(`
    SELECT domain, legacy_count, target_count
    FROM (
      SELECT 'expenses' AS domain,
        (SELECT count(*) FROM public.party_expenses
         WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3) AS legacy_count,
        (SELECT count(*) FROM journey.expenses
         WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3) AS target_count
      UNION ALL SELECT 'cash_movements',
        (SELECT count(*) FROM public.party_cash_movements WHERE agency_id=$1 AND party_id=$3),
        (SELECT count(*) FROM journey.cash_movements WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)
      UNION ALL SELECT 'day_notes',
        (SELECT count(*) FROM public.party_day_notes WHERE agency_id=$1 AND party_id=$3),
        (SELECT count(*) FROM journey.day_notes WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)
      UNION ALL SELECT 'restaurants',
        (SELECT count(*) FROM public.party_restaurants WHERE agency_id=$1 AND party_id=$3),
        (SELECT count(*) FROM journey.restaurant_visits WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)
      UNION ALL SELECT 'programme_feedback',
        (SELECT count(*) FROM public.traveler_programme_feedback
         WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3),
        (SELECT count(*) FROM journey.programme_feedback
         WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3)
    ) counts
    ORDER BY domain
  `, [scope.agency_id, scope.departure_id, scope.party_id])).rows;

  const mismatches = reconciliations.filter(
    (row) => Number(row.legacy_count) !== Number(row.target_count),
  );
  if (mismatches.length) throw new Error(`Riconciliazione fallita: ${JSON.stringify(mismatches)}`);

  const readShape = (await client.query(`SELECT
    (SELECT count(*) FROM journey.expenses expense
      LEFT JOIN travel.departure_days day ON day.id=expense.departure_day_id AND day.agency_id=expense.agency_id
      LEFT JOIN travel.template_days template_day ON template_day.id=day.template_day_id
        AND template_day.agency_id=day.agency_id AND template_day.template_version_id=day.template_version_id
      WHERE expense.agency_id=$1 AND expense.departure_id=$2 AND expense.party_id=$3
        AND (template_day.day_number IS NULL OR template_day.day_number>0)) expenses,
    (SELECT count(*) FROM journey.cash_movements movement
      JOIN travel.departure_days day ON day.id=movement.departure_day_id AND day.agency_id=movement.agency_id
      JOIN travel.template_days template_day ON template_day.id=day.template_day_id
        AND template_day.agency_id=day.agency_id AND template_day.template_version_id=day.template_version_id
      WHERE movement.agency_id=$1 AND movement.departure_id=$2 AND movement.party_id=$3
        AND template_day.day_number>0) cash_movements,
    (SELECT count(*) FROM journey.day_notes note
      JOIN travel.departure_days day ON day.id=note.departure_day_id AND day.agency_id=note.agency_id
      JOIN travel.template_days template_day ON template_day.id=day.template_day_id
        AND template_day.agency_id=day.agency_id AND template_day.template_version_id=day.template_version_id
      WHERE note.agency_id=$1 AND note.departure_id=$2 AND note.party_id=$3
        AND template_day.day_number>0) day_notes,
    (SELECT count(*) FROM journey.restaurant_visits visit
      JOIN travel.departure_days day ON day.id=visit.departure_day_id AND day.agency_id=visit.agency_id
      JOIN travel.template_days template_day ON template_day.id=day.template_day_id
        AND template_day.agency_id=day.agency_id AND template_day.template_version_id=day.template_version_id
      WHERE visit.agency_id=$1 AND visit.departure_id=$2 AND visit.party_id=$3
        AND template_day.day_number>0) restaurants
  `, [scope.agency_id, scope.departure_id, scope.party_id])).rows[0];

  await client.query("SELECT set_config('app.agency_id',$1,true)", [randomUUID()]);
  const crossTenantRows = Number((await client.query(`
    SELECT
      (SELECT count(*) FROM journey.expenses) +
      (SELECT count(*) FROM journey.cash_movements) +
      (SELECT count(*) FROM journey.day_notes) +
      (SELECT count(*) FROM journey.restaurant_visits) +
      (SELECT count(*) FROM journey.programme_feedback) AS row_count
  `)).rows[0].row_count);
  if (crossTenantRows !== 0) throw new Error(`Isolamento tenant fallito: ${crossTenantRows} righe visibili`);

  await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({
    status: "passed",
    role,
    reconciledDomains: reconciliations.length,
    queryShape: readShape,
    crossTenantRows,
  }, null, 2));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
