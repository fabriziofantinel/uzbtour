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
    await client.query(
      `SELECT profile.user_id actor_user_id,member.departure_id::text,member.party_id::text FROM travel.traveler_profiles profile JOIN travel.party_memberships member ON member.agency_id=profile.agency_id AND member.traveler_id=profile.id AND member.status='active' WHERE profile.user_id IS NOT NULL LIMIT 1`,
    )
  ).rows[0];
  if (!candidate) throw new Error("Nessun viaggiatore attivo disponibile per lo smoke test");
  const operation = crypto.randomUUID(),
    body = `smoke-chat-${operation}`;
  const sent = await client.query(
    `SELECT app.send_operational_message_scoped_v3($1::uuid,$2::uuid,'group',$3::uuid,NULL,$4,$5::uuid)::text id`,
    [candidate.actor_user_id, candidate.departure_id, candidate.party_id, body, operation],
  );
  const listed = await client.query(
    `SELECT body,is_mine FROM app.list_operational_messages_scoped_v3($1::uuid,$2::uuid,'group',$3::uuid,NULL,10) WHERE body=$4`,
    [candidate.actor_user_id, candidate.departure_id, candidate.party_id, body],
  );
  if (sent.rowCount !== 1 || listed.rowCount !== 1 || listed.rows[0].is_mine !== true)
    throw new Error("Contratto chat non verificato");
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({ status: "passed", send_idempotency: true, traveler_scope: true, transaction_rolled_back: true }),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
