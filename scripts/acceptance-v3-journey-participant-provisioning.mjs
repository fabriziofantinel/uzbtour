import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!runtimeUrl) throw new Error("Connessione Neon non configurata");
const client = new Client(runtimeUrl);
let open = false;
try {
  await client.connect();
  const candidate = (
    await client.query(`SELECT actor.id actor_id,
    departure.agency_id,departure.id departure_id
    FROM public.agency_memberships membership
    JOIN public.platform_users actor ON actor.id=membership.user_id
      AND actor.status='active'
    JOIN public.departures departure ON departure.agency_id=membership.agency_id
    WHERE membership.role IN('owner','admin','editor')
    ORDER BY departure.created_at DESC LIMIT 1`)
  ).rows[0];
  if (!candidate) throw new Error("Nessuna partenza amministrabile disponibile per il collaudo");
  await client.query("BEGIN");
  open = true;
  if (!process.env.DATABASE_URL) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET LOCAL ROLE smf_app");
  }
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  if (role !== "smf_app") throw new Error(`Ruolo runtime inatteso: ${role}`);

  const suffix = randomUUID();
  const email = `acceptance-${suffix}@invalid.example`;
  const username = `test_${suffix.replaceAll("-", "").slice(0, 24)}`;
  const tokenHash = randomBytes(32).toString("hex");
  const partyId = (
    await client.query("SELECT app.create_journey_party($1,$2,$3,$4,$5)::text id", [
      candidate.actor_id,
      candidate.agency_id,
      candidate.departure_id,
      `ACCEPTANCE-${suffix}`,
      "Famiglia collaudo rollback",
    ])
  ).rows[0]?.id;
  const traveler = (
    await client.query(
      `SELECT traveler_id::text,activation_required
    FROM app.provision_journey_traveler($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        candidate.actor_id,
        candidate.agency_id,
        partyId,
        "Viaggiatore collaudo",
        "VC",
        username,
        email,
        "",
        null,
        "member",
        tokenHash,
        new Date(Date.now() + 3600000).toISOString(),
      ],
    )
  ).rows[0];
  const invitation = (await client.query("SELECT * FROM app.inspect_account_invitation($1)", [tokenHash])).rows[0];
  const activated = (
    await client.query("SELECT * FROM app.activate_account_invitation($1,$2,$3)", [
      tokenHash,
      `acceptance-subject-${suffix}`,
      username,
    ])
  ).rows[0];
  const reused = (
    await client.query("SELECT * FROM app.activate_account_invitation($1,$2,$3)", [
      tokenHash,
      `acceptance-subject-reuse-${suffix}`,
      username,
    ])
  ).rowCount;
  const hiddenAfterUse =
    (await client.query("SELECT * FROM app.inspect_account_invitation($1)", [tokenHash])).rowCount === 0;
  if (!process.env.DATABASE_URL) await client.query("RESET ROLE");
  const reconciliation = (
    await client.query(
      `SELECT
    EXISTS(SELECT 1 FROM travel.travel_parties WHERE id=$1) v3_party,
    EXISTS(SELECT 1 FROM travel.traveler_profiles WHERE id=$2) v3_traveler,
    EXISTS(SELECT 1 FROM iam.invitations WHERE token_hash=$3 AND used_at IS NOT NULL) v3_invitation_consumed`,
      [partyId, traveler?.traveler_id, tokenHash],
    )
  ).rows[0];
  const passed =
    partyId &&
    traveler?.activation_required === true &&
    invitation?.email === email &&
    activated?.username === username &&
    reused === 0 &&
    hiddenAfterUse &&
    Object.values(reconciliation).every((value) => value === true);
  if (!passed)
    throw new Error(`Collaudo provisioning incompleto: ${JSON.stringify({ traveler, invitation, reconciliation })}`);
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: "passed", role, rolledBack: true, tokenSingleUse: true, hiddenAfterUse, reconciliation },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
