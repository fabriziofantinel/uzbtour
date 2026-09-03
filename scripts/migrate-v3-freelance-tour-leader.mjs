import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");
const name = "142_v3_freelance_tour_leader_invitation";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query(source);
  const gate = (
    await client.query(`SELECT
      to_regprocedure('app.provision_departure_tour_leader_v3(text,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NOT NULL provision_ready,
      to_regprocedure('app.assign_tour_leader_period_v3(text,uuid,text,timestamp with time zone,timestamp with time zone)') IS NOT NULL assign_ready,
      to_regprocedure('app.list_my_tour_leader_departures_v3(text)') IS NOT NULL access_ready,
      to_regprocedure('app.revoke_tour_leader_v3(text,uuid,uuid,text)') IS NOT NULL revoke_ready`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.87.0-freelance-tour-leader", checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
