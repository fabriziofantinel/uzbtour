import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const name = "110_v3_photo_contest_two_entry_contract",
  model = "3.36.0-photo-contest-two-entry-contract";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
  NOT EXISTS(SELECT 1 FROM content.activities WHERE activity_type='photo_contest' AND max_entries<>2) activities_bounded,
  NOT EXISTS(SELECT 1 FROM journey.photo_contest_entries WHERE participant_slot NOT BETWEEN 1 AND 2) entries_bounded,
  pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='content.activities'::regclass AND conname='activities_check1')) LIKE '%max_entries = 2%' activity_constraint,
  pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='journey.photo_contest_entries'::regclass AND conname='photo_contest_entries_participant_slot_check')) LIKE '%participant_slot <= 2%' entry_constraint`)
  ).rows[0];
  if (!gate || Object.values(gate).some((v) => v !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256)VALUES($1,$2)ON CONFLICT(version)DO UPDATE SET applied_at=clock_timestamp()`,
      [model, checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate, migration: { name, model, checksum } }),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
