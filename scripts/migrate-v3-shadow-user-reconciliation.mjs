import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "@neondatabase/serverless";

const name = "092_v3_shadow_user_reconciliation";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

if (!url) throw new Error("Connessione Neon non configurata");

const source = await readFile(
  new URL(`../database/migrations/${name}.sql`, import.meta.url),
  "utf8",
);
const client = new Client(url);
let open = false;

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await client.query(source);

  const gate = (
    await client.query(`
      SELECT count(*)::int AS missing_users
        FROM public.platform_users legacy
        LEFT JOIN ops.legacy_id_map map
          ON map.source_system='public-v2'
         AND map.entity_type='user'
         AND map.legacy_id=legacy.id
        LEFT JOIN iam.users target ON target.id=map.target_id
       WHERE target.id IS NULL OR target.username IS DISTINCT FROM legacy.username
    `)
  ).rows[0];
  if (gate?.missing_users !== 0) throw new Error("Riconciliazione utenti shadow incompleta");

  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
       VALUES($1,$2,0)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [
        "3.62.0-shadow-user-reconciliation",
        createHash("sha256").update(source).digest("hex"),
      ],
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
