import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");
const client = new Client(runtimeUrl);
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates = (
    await client.query(`SELECT
    has_function_privilege(current_user,'app.create_journey_party(text,uuid,uuid,text,text)','EXECUTE') create_party,
    has_function_privilege(current_user,'app.provision_journey_traveler(text,uuid,uuid,text,text,text,text,text,date,text,text,timestamptz)','EXECUTE') provision_traveler,
    NOT has_table_privilege(current_user,(SELECT relation.oid FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='ops' AND relation.relname='legacy_id_map'),'SELECT') identity_map_private`)
  ).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true))
    throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);
  let partyDenied = false;
  let travelerDenied = false;
  try {
    await client.query("SELECT app.create_journey_party($1,$2,$3,$4,$5)", [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      `SMOKE-${randomUUID()}`,
      "Smoke",
    ]);
  } catch (error) {
    partyDenied = error?.code === "42501";
  }
  try {
    await client.query(
      `SELECT * FROM app.provision_journey_traveler(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        "Smoke",
        "SM",
        `smoke_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        `${randomUUID()}@invalid.example`,
        "",
        null,
        "member",
        randomBytes(32).toString("hex"),
        new Date(Date.now() + 3600000).toISOString(),
      ],
    );
  } catch (error) {
    travelerDenied = error?.code === "42501";
  }
  if (!partyDenied || !travelerDenied) throw new Error("Provisioning non autorizzato accettato");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        role,
        gates,
        unauthorizedPartyDenied: partyDenied,
        unauthorizedTravelerDenied: travelerDenied,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
}
