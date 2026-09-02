import { randomBytes, randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!runtimeUrl) throw new Error("Connessione Neon non configurata");

const client = new Client(runtimeUrl);
let transactionOpen = false;

try {
  await client.connect();
  const usingOwnerFallback = !process.env.DATABASE_URL;
  let scope;
  const candidate = usingOwnerFallback
    ? (
        await client.query(`SELECT actor.id actor_id,departure.agency_id,departure.id departure_id
    FROM public.agency_memberships membership
    JOIN public.platform_users actor ON actor.id=membership.user_id AND actor.status='active'
    JOIN public.departures departure ON departure.agency_id=membership.agency_id
    WHERE membership.role IN('owner','admin','editor') ORDER BY departure.created_at DESC LIMIT 1`)
      ).rows[0]
    : null;
  if (!usingOwnerFallback)
    scope = (
      await client.query(`
    SELECT membership.agency_id::text,membership.departure_id::text,membership.party_id::text,
      (array_agg(membership.traveler_id ORDER BY membership.traveler_id))[1]::text traveler_a,
      (array_agg(membership.traveler_id ORDER BY membership.traveler_id))[2]::text traveler_b,
      min(profile.display_name) paid_by_name
    FROM travel.party_memberships membership
    JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
      AND profile.id=membership.traveler_id
    WHERE membership.status='active'
    GROUP BY membership.agency_id,membership.departure_id,membership.party_id
    HAVING count(DISTINCT membership.traveler_id)>=2
    ORDER BY membership.departure_id LIMIT 1
  `)
    ).rows[0];
  await client.query("BEGIN");
  transactionOpen = true;
  if (usingOwnerFallback) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET LOCAL ROLE smf_app");
    if (!candidate) throw new Error("Nessuna partenza amministrabile per la fixture spese");
    await client.query("SELECT set_config('app.agency_id',$1,true)", [candidate.agency_id]);
    const suffix = randomUUID();
    const partyId = (
      await client.query("SELECT app.create_journey_party($1,$2,$3,$4,$5)::text id", [
        candidate.actor_id,
        candidate.agency_id,
        candidate.departure_id,
        `EXP-${suffix.slice(0, 8)}`,
        `Gruppo spese ${suffix.slice(0, 8)}`,
      ])
    ).rows[0].id;
    const travelers = [];
    for (const [index, role] of ["organizer", "member"].entries()) {
      const username = `expense_${suffix.replaceAll("-", "").slice(0, 18)}_${index + 1}`;
      const row = (
        await client.query(
          `SELECT traveler_id::text FROM app.provision_journey_traveler(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            candidate.actor_id,
            candidate.agency_id,
            partyId,
            `Viaggiatore ${index + 1}`,
            `V${index + 1}`,
            username,
            `${username}@invalid.example`,
            "",
            null,
            role,
            randomBytes(32).toString("hex"),
            new Date(Date.now() + 3600000).toISOString(),
          ],
        )
      ).rows[0];
      travelers.push(row.traveler_id);
    }
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE iam.users users SET status='active' FROM travel.traveler_profiles profile
      WHERE profile.user_id=users.id AND profile.id=ANY($1::uuid[])`,
      [travelers],
    );
    await client.query("UPDATE travel.party_memberships SET status='active' WHERE party_id=$1", [partyId]);
    await client.query("SET LOCAL ROLE smf_app");
    scope = {
      agency_id: candidate.agency_id,
      departure_id: candidate.departure_id,
      party_id: partyId,
      traveler_a: travelers[0],
      traveler_b: travelers[1],
      paid_by_name: "Viaggiatore 1",
    };
  }
  if (!scope) throw new Error("Nessun gruppo con almeno due viaggiatori disponibile");
  const role = (await client.query("SELECT current_user AS role_name")).rows[0];
  if (!role || role.role_name !== "smf_app") {
    throw new Error(`Smoke test eseguito con ruolo inatteso: ${role?.role_name ?? "sconosciuto"}`);
  }
  await client.query("SET LOCAL statement_timeout = '2min'");
  await client.query("SELECT set_config('app.agency_id', $1, true)", [scope.agency_id]);

  const smokeId = randomUUID();
  const operationId = randomUUID();
  const inserted = await client.query(
    `
    INSERT INTO journey.expenses (
      id, agency_id, departure_id, party_id, label,
      amount_minor, currency, base_currency, exchange_rate_to_base,
      base_amount_minor, paid_by_traveler_id, paid_by_name,
      allocation_method, allocation_status, client_operation_id
    )
    VALUES($1::uuid,$3::uuid,$4::uuid,$5::uuid,'SMOKE V3 - 130000 UZS',130000,'UZS','EUR',
      0.000061,793,$6::uuid,$7,'equal','draft',$2::uuid)
    RETURNING id
  `,
    [smokeId, operationId, scope.agency_id, scope.departure_id, scope.party_id, scope.traveler_a, scope.paid_by_name],
  );
  if (inserted.rowCount !== 1) throw new Error("INSERT runtime v3 non eseguito");
  await client.query(
    `INSERT INTO journey.expense_shares(agency_id,departure_id,expense_id,
    beneficiary_party_id,beneficiary_traveler_id,share_amount_minor,share_base_amount_minor)
    VALUES($1,$2,$3,$4,$5,65000,397),($1,$2,$3,$4,$6,65000,396)`,
    [scope.agency_id, scope.departure_id, smokeId, scope.party_id, scope.traveler_a, scope.traveler_b],
  );
  await client.query("UPDATE journey.expenses SET allocation_status='allocated' WHERE id=$1", [smokeId]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  const reconciliation = (
    await client.query(
      `SELECT expense.amount_minor,sum(share.share_amount_minor)::bigint share_total,
    expense.base_amount_minor,sum(share.share_base_amount_minor)::bigint base_share_total
    FROM journey.expenses expense JOIN journey.expense_shares share ON share.expense_id=expense.id
    WHERE expense.id=$1 GROUP BY expense.id`,
      [smokeId],
    )
  ).rows[0];
  if (
    Number(reconciliation?.amount_minor) !== Number(reconciliation?.share_total) ||
    Number(reconciliation?.base_amount_minor) !== Number(reconciliation?.base_share_total)
  )
    throw new Error(`Quadratura quote fallita: ${JSON.stringify(reconciliation)}`);
  const duplicate = (
    await client.query(
      `INSERT INTO journey.expenses(id,agency_id,departure_id,party_id,label,
    amount_minor,currency,base_currency,exchange_rate_to_base,base_amount_minor,paid_by_traveler_id,paid_by_name,
    allocation_method,allocation_status,client_operation_id)
    VALUES($1,$2,$3,$4,'DUPLICATE',1,'EUR','EUR',1,1,$5,$6,'whole_party','draft',$7)
    ON CONFLICT(party_id,client_operation_id) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        scope.agency_id,
        scope.departure_id,
        scope.party_id,
        scope.traveler_a,
        scope.paid_by_name,
        operationId,
      ],
    )
  ).rowCount;
  if (duplicate !== 0) throw new Error("Idempotenza client_operation_id non rispettata");

  await client.query("ROLLBACK");
  transactionOpen = false;
  console.log(
    JSON.stringify(
      {
        status: "passed_with_rollback",
        role: role.role_name,
        reconciliation,
        dml: { insert: true, split: true, idempotency: true },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
