import { readFile } from "node:fs/promises";
import { Client } from "@neondatabase/serverless";
const apply = process.argv.includes("--apply"),
  url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const source = await readFile(
    new URL("../database/migrations/106_v3_runtime_identity_resolver_final.sql", import.meta.url),
    "utf8",
  ),
  client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query(source);
  const gate = (
    await client.query(
      `SELECT has_function_privilege('smf_app','app.resolve_legacy_user_id(text,uuid)','EXECUTE') function_ok,NOT has_table_privilege('smf_app','ops.legacy_id_map','SELECT') map_private,pg_get_functiondef('app.resolve_legacy_user_id(text,uuid)'::regprocedure) LIKE '%travel.traveler_profiles%' v3_profile_scope`,
    )
  ).rows[0];
  if (!gate || Object.values(gate).some((v) => v !== true)) throw new Error(`Gate incompleti: ${JSON.stringify(gate)}`);
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
