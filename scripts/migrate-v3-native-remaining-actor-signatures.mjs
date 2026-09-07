import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_MIGRATION_URL non configurata");

const name = "198_v3_native_remaining_actor_signatures";
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
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-native-remaining-actor-signatures',0))",
  );
  await client.query(source);
  const gate = (
    await client.query(`
      SELECT
        count(*)::integer AS legacy_signatures,
        count(*) FILTER(
          WHERE to_regprocedure(format(
            'app.%I(%s)',
            procedure.proname,
            regexp_replace(oidvectortypes(procedure.proargtypes),'^text','uuid')
          )) IS NULL
        )::integer AS missing_native_signatures
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='app'
        AND pg_get_function_identity_arguments(procedure.oid)~'p_actor_legacy[^,]* text'
    `)
  ).rows[0];
  if (gate?.legacy_signatures !== 51 || gate?.missing_native_signatures !== 0) {
    throw new Error(`Cutover UUID incompleto: ${JSON.stringify(gate)}`);
  }
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256) VALUES($1,$2)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),checksum_sha256=EXCLUDED.checksum_sha256`,
      ["3.124.0-native-remaining-actor-signatures", checksum],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
