import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const name = "093_v3_web_push_subscriptions",
  model = "3.60.0-web-push-subscriptions",
  apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
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
    await client.query(
      `SELECT to_regclass('journey.web_push_subscriptions') IS NOT NULL table_ok,has_function_privilege('smf_app','app.upsert_own_web_push_subscription_v3(text,text,text,text,text,timestamptz)','EXECUTE') function_ok,has_function_privilege('smf_app','app.list_departure_web_push_subscriptions_v3(uuid)','EXECUTE') list_ok`,
    )
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms) VALUES($1,$2,0) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [model, checksum],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: apply ? "applied" : "dry_run_passed", gate, migration: { name, model, checksum } },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
