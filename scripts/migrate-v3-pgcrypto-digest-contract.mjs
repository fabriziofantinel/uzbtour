import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const name = "109_v3_pgcrypto_digest_contract";
const model = "3.35.0-pgcrypto-digest-contract";
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-pgcrypto-digest-contract',0))");
  await client.query(source);
  const gate = (
    await client.query(`SELECT
    to_regprocedure('app.digest(text,text)') IS NOT NULL function_exists,
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') extension_exists,
    app.digest('smf-travel','sha256')=extensions.digest('smf-travel','sha256') output_matches,
    NOT has_schema_privilege('smf_app','extensions','CREATE') extension_schema_locked,
    NOT has_function_privilege('smf_app','app.digest(text,text)','EXECUTE') runtime_direct_execute_denied`)
  ).rows[0];
  if (!gate || Object.values(gate).some((value) => value !== true))
    throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256)
      VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
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
