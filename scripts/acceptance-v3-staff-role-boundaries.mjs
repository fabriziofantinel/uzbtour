import { createHash, randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!databaseUrl) throw new Error("Connessione Neon owner non configurata");

const client = new Client(databaseUrl);
let transactionOpen = false;

async function expectDenied(operation, message) {
  await client.query(`SAVEPOINT ${operation}`);
  try {
    await message();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${operation}`);
    await client.query(`RELEASE SAVEPOINT ${operation}`);
    if (error?.code === "42501") return;
    throw error;
  }
  await client.query(`RELEASE SAVEPOINT ${operation}`);
  throw new Error(`${operation}: operazione non autorizzata accettata`);
}

try {
  await client.connect();
  await client.query("BEGIN");
  transactionOpen = true;

  const fixture = (
    await client.query(`
      SELECT departure.agency_id,departure.id departure_id,membership.user_id manager_id,
        manager.email manager_email,
        array_agg(day.id ORDER BY day.service_date,day.id) day_ids,
        (array_agg(traveler.traveler_id) FILTER (WHERE traveler.traveler_id IS NOT NULL))[1] traveler_id
      FROM travel.departures departure
      JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
      JOIN iam.agency_memberships membership ON membership.agency_id=departure.agency_id
        AND membership.status='active' AND membership.role IN('owner','admin','editor')
      JOIN iam.users manager ON manager.id=membership.user_id AND manager.status='active'
      LEFT JOIN travel.party_memberships traveler ON traveler.agency_id=departure.agency_id
        AND traveler.departure_id=departure.id AND traveler.status='active'
      WHERE departure.status NOT IN('cancelled','archived')
      GROUP BY departure.agency_id,departure.id,membership.user_id,manager.email
      HAVING count(DISTINCT day.id)>=2
      ORDER BY count(DISTINCT day.id) DESC
      LIMIT 1
    `)
  ).rows[0];
  if (!fixture) throw new Error("Fixture viaggio con almeno due giornate non disponibile");

  const [assignedDay, foreignDay] = fixture.day_ids;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const users = {};
  for (const role of ["accompagnatore", "guida"]) {
    const username = `accept.${role}.${suffix}`;
    const tokenHash = createHash("sha256").update(`${role}:${randomUUID()}`).digest("hex");
    const provisioned = (
      await client.query(
        `SELECT * FROM app.provision_agency_staff_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '1 hour')`,
        [
          fixture.manager_id,
          fixture.agency_id,
          role,
          `Acceptance ${role}`,
          role === "guida" ? "GU" : "AC",
          username,
          fixture.manager_email ?? `${username}@example.invalid`,
          "3330000000",
          tokenHash,
        ],
      )
    ).rows[0];
    if (!provisioned?.legacy_user_id) throw new Error(`Provisioning ${role} non riuscito`);
    const native = (
      await client.query(
        `SELECT target_id FROM ops.legacy_id_map
         WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=$1`,
        [provisioned.legacy_user_id],
      )
    ).rows[0]?.target_id;
    if (!native) throw new Error(`Identità nativa ${role} non creata`);
    await client.query("UPDATE iam.users SET status='active' WHERE id=$1", [native]);
    await client.query("UPDATE iam.agency_memberships SET status='active' WHERE agency_id=$1 AND user_id=$2", [
      fixture.agency_id,
      native,
    ]);
    const assignmentId = (
      await client.query("SELECT app.assign_departure_staff_days_v3($1,$2,$3,$4,$5::uuid[]) assignment_id", [
        fixture.manager_id,
        fixture.departure_id,
        native,
        role,
        [assignedDay],
      ])
    ).rows[0]?.assignment_id;
    await client.query(
      `UPDATE travel.departure_staff_assignments
       SET test_access_until=clock_timestamp()+interval '1 hour'
       WHERE id=$1`,
      [assignmentId],
    );
    users[role] = { native, legacy: provisioned.legacy_user_id, assignmentId };
  }

  for (const role of ["accompagnatore", "guida"]) {
    const actor = users[role].native;
    const cards = Number(
      (
        await client.query("SELECT count(*)::int total FROM app.read_staff_trip_cards_v3($1) WHERE departure_id=$2", [
          actor,
          fixture.departure_id,
        ])
      ).rows[0].total,
    );
    if (cards !== 1) throw new Error(`${role}: viaggio assegnato non visibile`);

    const permissions = (
      await client.query(
        `SELECT app.can_edit_departure_day_v3($1,$2,$3) assigned,
          app.can_edit_departure_day_v3($1,$2,$4) foreign_day`,
        [actor, fixture.departure_id, assignedDay, foreignDay],
      )
    ).rows[0];
    if (!permissions.assigned || permissions.foreign_day) {
      throw new Error(`${role}: confine modifica giornate errato ${JSON.stringify(permissions)}`);
    }

    const managementRows = Number(
      (
        await client.query("SELECT count(*)::int total FROM app.read_staff_journey_management_v3($1,$2)", [
          actor,
          fixture.departure_id,
        ])
      ).rows[0].total,
    );
    if (managementRows < 1) throw new Error(`${role}: gestione viaggio non leggibile`);
  }

  const sourceDay = (
    await client.query(
      `SELECT day.label_override,day.title_override,day.city_override,day.description_override,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',item.id,'type',item.item_type,'title',item.title,
          'description',item.description,'sortOrder',item.sort_order) ORDER BY item.sort_order,item.id)
          FROM travel.departure_itinerary_items item WHERE item.agency_id=day.agency_id
            AND item.departure_id=day.departure_id AND item.departure_day_id=day.id
            AND item.operational_status<>'cancelled'),'[]'::jsonb) items,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',stay.id,'name',stay.name_snapshot,
          'notes',stay.notes,'sortOrder',stay.sort_order) ORDER BY stay.sort_order,stay.id)
          FROM travel.departure_accommodation_stays stay WHERE stay.agency_id=day.agency_id
            AND stay.departure_id=day.departure_id AND stay.departure_day_id=day.id),'[]'::jsonb) stays
       FROM travel.departure_days day WHERE day.id=$1 AND day.departure_id=$2`,
      [assignedDay, fixture.departure_id],
    )
  ).rows[0];
  const writeResult = (
    await client.query(
      `SELECT app.update_departure_programme_day_staff_v3($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) updated`,
      [
        users.accompagnatore.native,
        fixture.departure_id,
        assignedDay,
        sourceDay.label_override,
        sourceDay.title_override,
        sourceDay.city_override,
        sourceDay.description_override,
        JSON.stringify(sourceDay.items),
        JSON.stringify(sourceDay.stays),
      ],
    )
  ).rows[0]?.updated;
  if (!writeResult) throw new Error("Scrittura della giornata assegnata non riuscita");

  await expectDenied("deny_unassigned_day", () =>
    client.query(`SELECT app.update_departure_programme_day_staff_v3($1,$2,$3,'','','','',$4::jsonb,$4::jsonb)`, [
      users.guida.native,
      fixture.departure_id,
      foreignDay,
      "[]",
    ]),
  );
  await expectDenied("deny_guide_standard_chat", () =>
    client.query("SELECT * FROM app.list_operational_messages_scoped_v3($1::uuid,$2::uuid,'trip',NULL,NULL,10)", [
      users.guida.native,
      fixture.departure_id,
    ]),
  );
  await client.query("SELECT * FROM app.list_operational_messages_scoped_v3($1::uuid,$2::uuid,'trip',NULL,NULL,10)", [
    users.accompagnatore.native,
    fixture.departure_id,
  ]);

  if (fixture.traveler_id) {
    await client.query("SELECT app.set_departure_presence_v3($1,$2,$3,true)", [
      users.accompagnatore.native,
      fixture.departure_id,
      fixture.traveler_id,
    ]);
    const cleared = Number(
      (
        await client.query("SELECT app.clear_departure_presence_v3($1,$2) total", [
          users.accompagnatore.native,
          fixture.departure_id,
        ])
      ).rows[0].total,
    );
    if (cleared < 1) throw new Error("Azzeramento presenze non ha eliminato il registro di prova");
  }

  await client.query(
    "UPDATE travel.departure_staff_assignments SET test_access_until=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [users.guida.assignmentId],
  );
  const expiredCards = Number(
    (
      await client.query("SELECT count(*)::int total FROM app.read_staff_trip_cards_v3($1) WHERE departure_id=$2", [
        users.guida.native,
        fixture.departure_id,
      ])
    ).rows[0].total,
  );
  if (expiredCards !== 0) throw new Error("Accesso temporale scaduto ancora visibile");

  await client.query("SELECT app.remove_agency_staff_v3($1,$2,$3)", [
    fixture.manager_id,
    fixture.agency_id,
    users.accompagnatore.legacy,
  ]);
  const removedVisible = Number(
    (
      await client.query("SELECT count(*)::int total FROM app.read_agency_staff_v3($1,$2) WHERE user_id=$3", [
        fixture.manager_id,
        fixture.agency_id,
        users.accompagnatore.native,
      ])
    ).rows[0].total,
  );
  if (removedVisible !== 0) throw new Error("Personale revocato ancora visibile nell’elenco attivo");

  await client.query("ROLLBACK");
  transactionOpen = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      roles: ["accompagnatore", "guida"],
      assignedTripVisible: true,
      fullProgrammeReadable: true,
      assignedDayWritable: true,
      unassignedDayDenied: true,
      guideTravelerChatDenied: true,
      accompanimentTripChatAllowed: true,
      presenceSetAndCleared: Boolean(fixture.traveler_id),
      expiredAccessHidden: true,
      revokedStaffHidden: true,
    }),
  );
} finally {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  await client.end().catch(() => undefined);
}
