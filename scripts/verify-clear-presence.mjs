// Manual regression check. All test changes are rolled back; no messages or AI calls.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const client = new Client(process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED);
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query(
    await readFile(new URL("../database/migrations/183_v3_clear_departure_presence_fix.sql", import.meta.url), "utf8"),
  );
  const {
    rows: [fixture],
  } = await client.query(`
    SELECT d.id departure_id, m.user_id
    FROM travel.departures d JOIN iam.agency_memberships m ON m.agency_id=d.agency_id
    WHERE m.status='active' AND m.role IN ('owner','admin','editor')
      AND app.is_departure_operator_v3(m.user_id,d.id)
      AND (SELECT count(DISTINCT p.traveler_id) FROM travel.party_memberships p
        WHERE p.departure_id=d.id AND p.status='active') >= 2 LIMIT 1`);
  assert.ok(fixture, "Serve un viaggio con almeno due viaggiatori e un operatore autorizzato");
  const args = [fixture.user_id, fixture.departure_id];
  await client.query("SELECT app.clear_departure_presence_v3($1,$2)", args);
  const clear = async () =>
    Number((await client.query("SELECT app.clear_departure_presence_v3($1,$2) n", args)).rows[0].n);
  assert.equal(await clear(), 0);
  const { rows: travelers } = await client.query(
    "SELECT DISTINCT traveler_id FROM travel.party_memberships WHERE departure_id=$1 AND status='active' LIMIT 2",
    [fixture.departure_id],
  );
  await client.query("SELECT app.set_departure_presence_v3($1,$2,$3,true)", [...args, travelers[0].traveler_id]);
  assert.equal(await clear(), 1);
  for (const traveler of travelers) {
    await client.query("SELECT app.set_departure_presence_v3($1,$2,$3,true)", [...args, traveler.traveler_id]);
  }
  const otherCount = async () =>
    (
      await client.query("SELECT count(*)::integer n FROM journey.departure_presence_register WHERE departure_id<>$1", [
        fixture.departure_id,
      ])
    ).rows[0].n;
  const before = await otherCount();
  assert.equal(await clear(), 2);
  assert.equal(await clear(), 0);
  assert.equal(await otherCount(), before);
  await client.query("SAVEPOINT unauthorized");
  await assert.rejects(
    client.query("SELECT app.clear_departure_presence_v3(gen_random_uuid(),$1)", [fixture.departure_id]),
    (error) => error.code === "42501",
  );
  await client.query("ROLLBACK TO SAVEPOINT unauthorized");
  console.log(
    JSON.stringify({
      status: "passed",
      cases: ["empty", "single", "multiple", "repeat", "other_departures_unchanged", "unauthorized_denied"],
      persistence: "rollback",
    }),
  );
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
