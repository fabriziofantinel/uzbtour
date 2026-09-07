import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const fixture = (
    await client.query(`SELECT map.legacy_id,profile.user_id actor_user_id,party.agency_id,party.departure_id,party.id party_id,day.id day_id
  FROM travel.party_memberships membership JOIN travel.travel_parties party ON party.agency_id=membership.agency_id AND party.departure_id=membership.departure_id AND party.id=membership.party_id
  JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id AND profile.user_id IS NOT NULL
  JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=profile.user_id
  LEFT JOIN LATERAL(SELECT id FROM travel.departure_days WHERE agency_id=party.agency_id AND departure_id=party.departure_id ORDER BY service_date LIMIT 1) day ON true
  WHERE membership.status='active' AND NOT EXISTS(SELECT 1 FROM iam.agency_memberships agency_member
    WHERE agency_member.user_id=profile.user_id AND agency_member.status='active') LIMIT 1`)
  ).rows[0];
  if (!fixture) throw new Error("Fixture viaggiatore attivo non disponibile");
  await client.query("GRANT smf_app TO CURRENT_USER");
  await client.query("SET LOCAL ROLE smf_app");
  const session = crypto.randomUUID(),
    operation = crypto.randomUUID();
  const first = (
    await client.query(
      `SELECT app.record_product_analytics_event_v3($1,$2,$3,$4,'programme_view',$5,$6,'{"smoke":true}'::jsonb)::text id`,
      [fixture.legacy_id, fixture.departure_id, fixture.party_id, fixture.day_id, session, operation],
    )
  ).rows[0].id;
  const second = (
    await client.query(
      `SELECT app.record_product_analytics_event_v3($1,$2,$3,$4,'programme_view',$5,$6,'{"smoke":true}'::jsonb)::text id`,
      [fixture.legacy_id, fixture.departure_id, fixture.party_id, fixture.day_id, session, operation],
    )
  ).rows[0].id;
  const sessionEvent = (
    await client.query(
      `SELECT app.record_product_analytics_event_v3($1,$2,$3,$4,'traveler_session',$5,$6,'{"smoke":true}'::jsonb)::text id`,
      [fixture.legacy_id, fixture.departure_id, fixture.party_id, fixture.day_id, session, crypto.randomUUID()],
    )
  ).rows[0].id;
  const documentEvent = (
    await client.query(
      `SELECT app.record_product_analytics_event_v3($1,$2,$3,$4,'document_download',$5,$6,$7::jsonb)::text id`,
      [
        fixture.legacy_id,
        fixture.departure_id,
        fixture.party_id,
        fixture.day_id,
        session,
        crypto.randomUUID(),
        JSON.stringify({ smoke: true, documentId: crypto.randomUUID() }),
      ],
    )
  ).rows[0].id;
  const chatId = (
    await client.query(
      "SELECT app.send_operational_message_scoped_v3($1::uuid,$2::uuid,'group',$3::uuid,NULL,'Richiesta assistenza smoke',$4::uuid)::text id",
      [fixture.actor_user_id, fixture.departure_id, fixture.party_id, crypto.randomUUID()],
    )
  ).rows[0].id;
  await client.query(`SELECT set_config('app.agency_id',$1,true)`, [fixture.agency_id]);
  const event = (
    await client.query(`SELECT event_name,properties->>'smoke' smoke FROM ops.product_analytics_events WHERE id=$1`, [
      first,
    ])
  ).rows[0];
  const aggregate = (
    await client.query(
      `SELECT count(*) events,count(DISTINCT actor_user_id) actors FROM ops.product_analytics_events WHERE agency_id=$1 AND occurred_at>=now()-interval '30 days'`,
      [fixture.agency_id],
    )
  ).rows[0];
  const measures = (
    await client.query(
      `SELECT
   count(DISTINCT actor_user_id) FILTER(WHERE event_name='traveler_session') active_users,
   count(DISTINCT actor_user_id) FILTER(WHERE event_name='document_download') document_users
   FROM ops.product_analytics_events WHERE agency_id=$1 AND departure_id=$2`,
      [fixture.agency_id, fixture.departure_id],
    )
  ).rows[0];
  const assistance = Number(
    (
      await client.query(
        `SELECT count(*) count FROM journey.operational_messages
   WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3 AND sender_role='traveler'`,
        [fixture.agency_id, fixture.departure_id, fixture.party_id],
      )
    ).rows[0].count,
  );
  const chat = (
    await client.query(
      "SELECT sender_role,sender_traveler_id::text traveler_id FROM journey.operational_messages WHERE id=$1",
      [chatId],
    )
  ).rows[0];
  if (
    first !== second ||
    event?.event_name !== "programme_view" ||
    event?.smoke !== "true" ||
    !sessionEvent ||
    !documentEvent ||
    !chatId ||
    Number(measures.active_users) < 1 ||
    Number(measures.document_users) < 1 ||
    assistance < 1
  )
    throw new Error(
      `Gate analytics fallito: ${JSON.stringify({ first, second, sessionEvent, documentEvent, chatId, chat, measures, assistance })}`,
    );
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      idempotent: first === second,
      rlsRead: true,
      aggregateReadable: Number(aggregate.events) >= 1,
      distinctActors: Number(aggregate.actors) >= 1,
      activeUsers: Number(measures.active_users),
      documentUsers: Number(measures.document_users),
      assistanceRequests: assistance,
    }),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
