import { Client } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";

const apply = process.argv.includes("--apply");
const source = await readFile(
  new URL("../database/migrations/074_v3_generated_useful_information_contacts.sql", import.meta.url),
  "utf8",
);
const client = new Client(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query(source);
  const check = (
    await client.query(`SELECT
    to_regprocedure('app.apply_generated_useful_information_contacts_v3(uuid,uuid,uuid,jsonb)') IS NOT NULL AS function_ready,
    has_function_privilege('smf_app','app.apply_generated_useful_information_contacts_v3(uuid,uuid,uuid,jsonb)','EXECUTE') AS runtime_grant`)
  ).rows[0];
  if (!check?.function_ready || !check?.runtime_grant)
    throw new Error(`Verifica migrazione fallita: ${JSON.stringify(check)}`);
  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", check }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
