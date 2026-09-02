import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const name = "089_v3_useful_information_isolated_materialization",
  model = "3.59.0-useful-information-isolated-materialization";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8"),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query(source);
  const gate = (
    await client.query(
      `select has_function_privilege('smf_app','app.replace_trip_useful_information_v3(uuid,uuid,uuid,jsonb)','EXECUTE') executable`,
    )
  ).rows[0];
  if (!gate?.executable) throw new Error("Contratto runtime non disponibile");
  if (apply) {
    await client.query(
      `insert into ops.schema_migrations(version,checksum_sha256,execution_ms) values($1,$2,0) on conflict(version) do update set applied_at=clock_timestamp()`,
      [model, createHash("sha256").update(source).digest("hex")],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
