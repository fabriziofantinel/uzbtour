import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "@neondatabase/serverless";

const name = "091_v3_travel_document_constraint_validation";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

if (!url) {
  throw new Error("Connessione Neon non configurata");
}

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
      SELECT convalidated AS validated
        FROM pg_constraint
       WHERE conrelid = 'ops.travel_documents'::regclass
         AND conname = 'travel_documents_day_requires_party_ck'
    `)
  ).rows[0];

  if (!gate?.validated) {
    throw new Error("Vincolo documenti viaggio non validato");
  }

  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
       VALUES($1,$2,0)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [
        "3.61.0-travel-document-constraint-validation",
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
  if (open) {
    await client.query("ROLLBACK").catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
