import { createHash, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione Neon owner non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  const owner = (
    await client.query(`SELECT membership.agency_id,users.id actor_id FROM iam.agency_memberships membership
 JOIN iam.users users ON users.id=membership.user_id AND users.status='active'
 WHERE membership.role='owner' AND membership.status='active' LIMIT 1`)
  ).rows[0];
  if (!owner) throw new Error("Owner agenzia non disponibile");
  await client.query("BEGIN");
  open = true;
  await client.query("GRANT smf_app TO current_user");
  await client.query("SET LOCAL ROLE smf_app");
  const suffix = randomUUID(),
    username = `acceptance.${suffix}`,
    email = `acceptance-${suffix}@invalid.example`,
    hash = createHash("sha256").update(suffix).digest("hex");
  const created = (
    await client.query(
      `SELECT * FROM app.provision_agency_agent_v3($1,$2,'Agente Acceptance','AA',$3,$4,'+39000000000',$5,clock_timestamp()+interval '1 hour')`,
      [owner.actor_id, owner.agency_id, username, email, hash],
    )
  ).rows[0];
  const listed = (
    await client.query("SELECT * FROM app.read_agency_agents_v3($1,$2) WHERE id=$3", [
      owner.actor_id,
      owner.agency_id,
      created.legacy_user_id,
    ])
  ).rows[0];
  const removed = (
    await client.query("SELECT app.remove_agency_agent_v3($1,$2,$3) removed", [
      owner.actor_id,
      owner.agency_id,
      created.legacy_user_id,
    ])
  ).rows[0]?.removed;
  const after = Number(
    (
      await client.query("SELECT count(*) n FROM app.read_agency_agents_v3($1,$2) WHERE id=$3", [
        owner.actor_id,
        owner.agency_id,
        created.legacy_user_id,
      ])
    ).rows[0].n,
  );
  await client.query("RESET ROLE");
  const audit = Number(
    (
      await client.query(
        "SELECT count(*) n FROM ops.audit_events WHERE agency_id=$1 AND entity_id=$2 AND action='removed'",
        [owner.agency_id, created.legacy_user_id],
      )
    ).rows[0].n,
  );
  if (
    !created?.legacy_user_id ||
    created.activation_required !== true ||
    listed?.username !== username ||
    removed !== true ||
    after !== 0 ||
    audit !== 1
  )
    throw new Error("Gate ciclo agente non superato");
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({
      status: "passed_with_rollback",
      invited: true,
      listed: true,
      activationRequired: true,
      removed: true,
      audited: true,
    }),
  );
} catch (e) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await client.end().catch(() => {});
}
