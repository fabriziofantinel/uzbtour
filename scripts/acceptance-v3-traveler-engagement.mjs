import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione Neon owner non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  const fixture = (
    await client.query(`SELECT membership.agency_id,membership.departure_id,membership.party_id,
  profile.id traveler_id,map.legacy_id,day.id departure_day_id,day.template_day_id,item.id departure_item_id,
  item.source_template_item_id,item.title
  FROM travel.party_memberships membership
  JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
  JOIN ops.legacy_id_map map ON map.source_system='public-v2' AND map.entity_type='user' AND map.target_id=profile.user_id
  JOIN travel.departure_days day ON day.agency_id=membership.agency_id AND day.departure_id=membership.departure_id
  JOIN travel.departure_itinerary_items item ON item.agency_id=day.agency_id AND item.departure_id=day.departure_id
    AND item.departure_day_id=day.id AND item.source_template_item_id IS NOT NULL
 WHERE membership.status='active' LIMIT 1`)
  ).rows[0];
  if (!fixture) throw new Error("Fixture engagement non disponibile");
  const ticketFixture = (
    await client.query(`SELECT item.agency_id,item.departure_id,
  split_part(item_map.legacy_id,':',2) legacy_item_id,user_map.legacy_id actor_legacy_id
  FROM travel.departure_itinerary_items item
  JOIN ops.legacy_id_map item_map ON item_map.source_system='public-v2' AND item_map.entity_type='departure_item' AND item_map.target_id=item.id
  JOIN iam.agency_memberships membership ON membership.agency_id=item.agency_id AND membership.status='active' AND membership.role IN('owner','admin','editor')
  JOIN ops.legacy_id_map user_map ON user_map.source_system='public-v2' AND user_map.entity_type='user' AND user_map.target_id=membership.user_id
  WHERE item.item_type IN('flight','train') LIMIT 1`)
  ).rows[0];
  await client.query("BEGIN");
  open = true;
  await client.query("GRANT smf_app TO current_user");
  await client.query("SET LOCAL ROLE smf_app");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [fixture.agency_id]);
  const mediaId = randomUUID(),
    memoryId = randomUUID(),
    feedbackOp = randomUUID();
  const objectKey = `agencies/${fixture.agency_id}/departures/${fixture.departure_id}/parties/${fixture.party_id}/days/${fixture.template_day_id}/memories/${mediaId}.jpg`;
  const memory = (
    await client.query(
      `SELECT memory_id::text,created_at::text FROM app.register_legacy_memory_upload($1,$2,$3,$4,$5,$6,'r2','acceptance',$7,'ricordo.jpg','image/jpeg',1024)`,
      [
        fixture.legacy_id,
        fixture.departure_id,
        fixture.party_id,
        fixture.template_day_id,
        mediaId,
        memoryId,
        objectKey,
      ],
    )
  ).rows[0];
  let ticketRegistered = null;
  if (ticketFixture) {
    const ticketMedia = randomUUID(),
      ticketDocument = randomUUID();
    const ticketKey = `agencies/${ticketFixture.agency_id}/departures/${ticketFixture.departure_id}/tickets/${ticketFixture.legacy_item_id}/${ticketMedia}.pdf`;
    ticketRegistered = (
      await client.query(
        `SELECT document_id::text,title FROM app.register_legacy_ticket_upload($1,$2,$3,$4,$5,'r2','acceptance',$6,'biglietto.pdf','application/pdf',2048)`,
        [
          ticketFixture.actor_legacy_id,
          ticketFixture.departure_id,
          ticketFixture.legacy_item_id,
          ticketMedia,
          ticketDocument,
          ticketKey,
        ],
      )
    ).rows[0];
  }
  const feedback = (
    await client.query(
      `WITH actor AS(SELECT traveler.id FROM travel.traveler_profiles traveler
   JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id AND membership.traveler_id=traveler.id
    AND membership.departure_id=$2 AND membership.party_id=$3 AND membership.status='active'
   WHERE traveler.agency_id=$1 AND traveler.user_id=app.resolve_legacy_user_id($4,$1))
  INSERT INTO journey.programme_feedback(agency_id,departure_id,party_id,traveler_id,departure_day_id,target_type,
   departure_item_id,hotel_id,rating,comment,client_operation_id)
  SELECT $1,$2,$3,actor.id,$5,'itinerary_item',$6,NULL,4,'Acceptance feedback',$7 FROM actor
  ON CONFLICT(party_id,traveler_id,departure_item_id) WHERE target_type='itinerary_item'
  DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,client_operation_id=EXCLUDED.client_operation_id,updated_at=clock_timestamp()
  RETURNING id::text,rating`,
      [
        fixture.agency_id,
        fixture.departure_id,
        fixture.party_id,
        fixture.legacy_id,
        fixture.departure_day_id,
        fixture.departure_item_id,
        feedbackOp,
      ],
    )
  ).rows[0];
  const checks = (
    await client.query(
      `SELECT
   (SELECT count(*) FROM journey.memories WHERE agency_id=$1 AND party_id=$2 AND id=$3) memories,
   (SELECT count(*) FROM ops.media_assets WHERE agency_id=$1 AND party_id=$2 AND id=$4 AND status='ready') media,
   (SELECT count(*) FROM journey.programme_feedback WHERE agency_id=$1 AND departure_id=$5 AND departure_item_id=$6 AND rating=4) feedback,
   (SELECT avg(rating)::numeric(4,2) FROM journey.programme_feedback WHERE agency_id=$1 AND departure_id=$5) feedback_average`,
      [fixture.agency_id, fixture.party_id, memoryId, mediaId, fixture.departure_id, fixture.departure_item_id],
    )
  ).rows[0];
  const list = (
    await client.query(
      `SELECT item.title,avg(feedback.rating)::numeric(4,2) average,count(*) responses
   FROM journey.programme_feedback feedback JOIN travel.departure_itinerary_items item
    ON item.agency_id=feedback.agency_id AND item.departure_id=feedback.departure_id AND item.id=feedback.departure_item_id
   WHERE feedback.agency_id=$1 AND feedback.departure_id=$2 AND item.id=$3 GROUP BY item.id,item.title`,
      [fixture.agency_id, fixture.departure_id, fixture.departure_item_id],
    )
  ).rows[0];
  if (
    !memory?.memory_id ||
    !feedback?.id ||
    Number(checks.memories) !== 1 ||
    Number(checks.media) !== 1 ||
    Number(checks.feedback) < 1 ||
    !list?.title
  )
    throw new Error(`Gate engagement fallito: ${JSON.stringify({ memory, feedback, checks, list })}`);
  if (ticketFixture && !ticketRegistered?.document_id) throw new Error("Registrazione biglietto V3 non riuscita");
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      memoryRegistered: true,
      ticketRegistered: ticketFixture ? true : "no_fixture",
      partyScoped: true,
      feedbackSaved: true,
      feedbackAnalytics: true,
      itemTitle: list.title,
      rating: Number(list.average),
      responses: Number(list.responses),
    }),
  );
} catch (e) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end().catch(() => {});
}
