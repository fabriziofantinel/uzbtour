import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const client = new Client(url);
let open = false;

async function expectRejected(query, parameters, messagePattern) {
  const savepoint = `check_${randomUUID().replaceAll("-", "")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query, parameters);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (!(error instanceof Error) || !error.message.includes(messagePattern)) throw error;
    return;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  throw new Error(`Vincolo non applicato: ${messagePattern}`);
}

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const fixture = (
    await client.query(`SELECT departure.id departure_id,stay.id stay_id,party.id party_id,
      manager.user_id actor_id,array_agg(membership.traveler_id ORDER BY profile.display_name) traveler_ids
      FROM travel.departures departure
      JOIN travel.departure_accommodation_stays stay ON stay.departure_id=departure.id
        AND stay.agency_id=departure.agency_id AND stay.operational_status<>'cancelled'
      JOIN travel.travel_parties party ON party.departure_id=departure.id
        AND party.agency_id=departure.agency_id AND party.status<>'archived'
      JOIN iam.agency_memberships manager ON manager.agency_id=departure.agency_id
        AND manager.status='active' AND manager.role IN('owner','admin','editor')
      JOIN travel.party_memberships membership ON membership.agency_id=party.agency_id
        AND membership.departure_id=party.departure_id AND membership.party_id=party.id
        AND membership.status<>'removed'
      JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
        AND profile.id=membership.traveler_id
      GROUP BY departure.id,stay.id,party.id,manager.user_id
      ORDER BY departure.starts_on DESC LIMIT 1`)
  ).rows[0];
  if (!fixture) throw new Error("Fixture rooming list non disponibile");
  const travelerIds = fixture.traveler_ids.map(String);
  const roomId = randomUUID();
  const rooms = [
    {
      id: roomId,
      label: "Camera collaudo",
      type: travelerIds.length > 1 ? "double" : "single",
      specialRequirements: "Letti separati",
      occupantIds: travelerIds.slice(0, 2),
    },
  ];
  const saved = await client.query(
    "SELECT app.save_rooming_list_v3($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) saved",
    [fixture.actor_id, fixture.departure_id, fixture.stay_id, fixture.party_id, JSON.stringify(rooms)],
  );
  if (saved.rows[0]?.saved !== true) throw new Error("Salvataggio rooming list non riuscito");
  if (travelerIds.length > 1) {
    await expectRejected(
      "SELECT app.save_rooming_list_v3($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)",
      [
        fixture.actor_id,
        fixture.departure_id,
        fixture.stay_id,
        fixture.party_id,
        JSON.stringify([{ ...rooms[0], type: "single", occupantIds: travelerIds.slice(0, 2) }]),
      ],
      "room capacity exceeded",
    );
  }

  const reviewFixture = (
    await client.query(`SELECT departure.id departure_id,departure.agency_id,party.id party_id,
      profile.user_id actor_id
      FROM travel.departures departure
      JOIN travel.travel_parties party ON party.agency_id=departure.agency_id AND party.departure_id=departure.id
      JOIN travel.party_memberships membership ON membership.agency_id=party.agency_id
        AND membership.departure_id=party.departure_id AND membership.party_id=party.id AND membership.status<>'removed'
      JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
        AND profile.id=membership.traveler_id AND profile.user_id IS NOT NULL
      ORDER BY departure.starts_on DESC LIMIT 1`)
  ).rows[0];
  let review = "skipped_no_fixture";
  if (reviewFixture) {
    await client.query(
      "UPDATE travel.departures SET starts_on=current_date-10,ends_on=current_date-2,timezone='Europe/Rome' WHERE id=$1",
      [reviewFixture.departure_id],
    );
    const savedReview = await client.query(
      "SELECT * FROM app.save_own_post_trip_review_v3($1::uuid,$2::uuid,$3::uuid,10,$4,$5::uuid)",
      [
        reviewFixture.actor_id,
        reviewFixture.departure_id,
        reviewFixture.party_id,
        "Collaudo transazionale",
        randomUUID(),
      ],
    );
    if (!savedReview.rows[0]?.review_id || !savedReview.rows[0]?.referral_code)
      throw new Error("Valutazione post-viaggio non salvata");
    const readReview = await client.query(
      "SELECT * FROM app.read_own_post_trip_review_v3($1::uuid,$2::uuid,$3::uuid)",
      [reviewFixture.actor_id, reviewFixture.departure_id, reviewFixture.party_id],
    );
    if (readReview.rows[0]?.eligible !== true || readReview.rows[0]?.rating !== 10)
      throw new Error("Rilettura valutazione post-viaggio non coerente");
    review = "passed";
  }
  await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: "passed", rooming: "passed", postTripReview: review }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
