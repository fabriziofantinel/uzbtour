import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const candidate = (
    await client.query(`SELECT identity.subject,profile.agency_id::text,profile.id::text traveler_id,
    membership.departure_id::text,membership.party_id::text
    FROM iam.user_identities identity
    JOIN travel.traveler_profiles profile ON profile.user_id=identity.user_id AND identity.provider='cognito'
    JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id AND membership.status='active'
    JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
    WHERE departure.status IN('open','confirmed','in_progress') ORDER BY departure.starts_on DESC LIMIT 1`)
  ).rows[0];
  if (!candidate) throw new Error("Nessun viaggiatore attivo disponibile per il test push");
  const endpoint = `https://push.invalid/${randomUUID()}`;
  const first = (
    await client.query(`SELECT app.upsert_own_web_push_subscription_v3($1,$2,$3,$4,$5,NULL)::text id`, [
      candidate.subject,
      endpoint,
      "p256dh-acceptance-key-000000000000",
      "auth-acceptance-secret",
      "SMF acceptance",
    ])
  ).rows[0].id;
  const second = (
    await client.query(`SELECT app.upsert_own_web_push_subscription_v3($1,$2,$3,$4,$5,NULL)::text id`, [
      candidate.subject,
      endpoint,
      "p256dh-acceptance-key-updated-000000",
      "auth-updated-secret",
      "SMF acceptance updated",
    ])
  ).rows[0].id;
  if (first !== second) throw new Error("Upsert push non idempotente");
  const stored = (
    await client.query(`SELECT count(*)::int count,max(p256dh) key FROM journey.web_push_subscriptions WHERE id=$1`, [
      first,
    ])
  ).rows[0];
  if (stored.count !== 1 || stored.key !== "p256dh-acceptance-key-updated-000000")
    throw new Error("Aggiornamento subscription non verificato");
  const departure = (
    await client.query(
      `SELECT endpoint FROM app.list_departure_web_push_subscriptions_v3($1::uuid) WHERE endpoint=$2`,
      [candidate.departure_id, endpoint],
    )
  ).rows;
  if (departure.length !== 1) throw new Error("Subscription non visibile nella partenza autorizzata");
  const party = (
    await client.query(
      `SELECT endpoint FROM app.list_party_web_push_subscriptions_v3($1::uuid,$2::uuid) WHERE endpoint=$3`,
      [candidate.departure_id, candidate.party_id, endpoint],
    )
  ).rows;
  if (party.length !== 1) throw new Error("Subscription non visibile nel gruppo autorizzato");
  await client.query(`SELECT app.revoke_web_push_subscription_v3($1::uuid)`, [first]);
  const afterRevoke = (
    await client.query(
      `SELECT endpoint FROM app.list_departure_web_push_subscriptions_v3($1::uuid) WHERE endpoint=$2`,
      [candidate.departure_id, endpoint],
    )
  ).rowCount;
  if (afterRevoke !== 0) throw new Error("Subscription revocata ancora attiva");
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      idempotentUpsert: true,
      departureScope: true,
      partyScope: true,
      revocation: true,
    }),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
