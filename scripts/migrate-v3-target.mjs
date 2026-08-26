import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { Client } from "@neondatabase/serverless";

const migrationVersion = "016_v3_target_foundation";
const modelVersion = "3.2.0";
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;

if (!migrationUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL o DATABASE_URL_UNPOOLED non configurata: il DDL non può usare il ruolo runtime",
  );
}

const ddlUrl = new URL("../database/schema-v3-review.sql", import.meta.url);
const ddl = await readFile(ddlUrl, "utf8");
const checksum = createHash("sha256").update(ddl).digest("hex");
const client = new Client(migrationUrl);
let transactionOpen = false;

try {
  await client.connect();

  const capability = await client.query(`
    SELECT current_user AS role_name,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,
      current_user = 'smf_app' AS is_runtime_role
  `);
  const role = capability.rows[0];
  if (!role || role.is_runtime_role || !role.can_create_schema) {
    throw new Error(
      `Ruolo di migrazione non valido: ${role?.role_name ?? "sconosciuto"}`,
    );
  }

  const existing = await client.query(
    `SELECT to_regclass('ops.schema_migrations') AS registry`,
  );
  if (existing.rows[0]?.registry) {
    const marker = await client.query(
      `SELECT checksum_sha256 FROM ops.schema_migrations WHERE version = $1`,
      [modelVersion],
    );
    if (marker.rowCount > 0) {
      if (marker.rows[0].checksum_sha256 !== checksum) {
        throw new Error(
          `Checksum differente per il modello ${modelVersion}: migrazione interrotta`,
        );
      }
      console.log(
        JSON.stringify({
          status: "already_applied",
          migrationVersion,
          modelVersion,
          checksum,
          role: role.role_name,
        }),
      );
      process.exitCode = 0;
    } else {
      throw new Error(
        "Schema target già presente senza marker 3.2.0: richiesta verifica manuale",
      );
    }
  } else {
    const startedAt = performance.now();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15min'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-target', 0))",
    );
    await client.query(ddl);
    const executionMs = Math.round(performance.now() - startedAt);
    await client.query(
      `INSERT INTO ops.schema_migrations
         (version, checksum_sha256, execution_ms)
       VALUES ($1, $2, $3)`,
      [modelVersion, checksum, executionMs],
    );
    await client.query(
      `INSERT INTO public.platform_schema_migrations (version)
       VALUES ($1)
       ON CONFLICT (version) DO NOTHING`,
      [migrationVersion],
    );
    await client.query("COMMIT");
    transactionOpen = false;

    console.log(
      JSON.stringify({
        status: "applied",
        migrationVersion,
        modelVersion,
        checksum,
        executionMs,
        role: role.role_name,
      }),
    );
  }
} catch (error) {
  if (transactionOpen) {
    await client.query("ROLLBACK").catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
