import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@neondatabase/serverless";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apply = process.argv.includes("--apply");
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
const expectedNumbers = [...[12, 13, 14, 15], ...Array.from({ length: 110 }, (_, index) => index + 19)];

const files = (await readdir(resolve(root, "database/migrations")))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const numbered = files.map((name) => ({ name, number: Number(name.slice(0, 3)) }));
const actualNumbers = numbered.map(({ number }) => number);

if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
  throw new Error(`Catena migrazioni inattesa: ${actualNumbers.join(",")}`);
}

const plan = {
  status: apply ? "ready_to_apply" : "dry_run_passed",
  foundation: "scripts/migrate-platform.mjs (versioni legacy 001-011)",
  hardening: numbered.slice(0, 4).map(({ name }) => name),
  targetModel: "database/schema-v3-review.sql (modello 3.2.0)",
  incremental: numbered.slice(4).map(({ name }) => name),
  latest: numbered.at(-1)?.name,
};

if (!apply) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

if (process.env.ALLOW_EMPTY_DATABASE_BOOTSTRAP !== "1") {
  throw new Error("Impostare ALLOW_EMPTY_DATABASE_BOOTSTRAP=1 per autorizzare il bootstrap di un database vuoto");
}
if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL o DATABASE_URL_UNPOOLED non configurata");

function runNode(script) {
  const result = spawnSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_DIRECT_URL: migrationUrl,
      DATABASE_URL_UNPOOLED: migrationUrl,
      DATABASE_URL: migrationUrl,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} terminato con codice ${result.status}`);
}

// Migration 012 contains CREATE INDEX CONCURRENTLY and must be sent one
// statement at a time, outside a transaction. It contains no dollar-quoted bodies.
function splitConcurrentMigration(source) {
  return source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const client = new Client(migrationUrl);
await client.connect();
try {
  const role = (
    await client.query(`
    SELECT current_user AS role_name,
           current_user = 'smf_app' AS runtime_role,
           has_database_privilege(current_user, current_database(), 'CREATE') AS can_create
  `)
  ).rows[0];
  if (!role?.can_create || role.runtime_role) throw new Error(`Ruolo bootstrap non valido: ${role?.role_name}`);

  const inventory = await client.query(`
    SELECT count(*)::int AS table_count
      FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  `);
  if (inventory.rows[0]?.table_count !== 0) {
    throw new Error(`Bootstrap rifiutato: il database contiene ${inventory.rows[0]?.table_count} tabelle`);
  }
} finally {
  await client.end();
}

runNode("scripts/migrate-platform.mjs");

const ddlClient = new Client(migrationUrl);
await ddlClient.connect();
try {
  for (const { name } of numbered.slice(0, 4)) {
    const source = await readFile(resolve(root, "database/migrations", name), "utf8");
    if (name.startsWith("012_")) {
      for (const statement of splitConcurrentMigration(source)) await ddlClient.query(statement);
    } else {
      await ddlClient.query("BEGIN");
      try {
        await ddlClient.query(source);
        await ddlClient.query("COMMIT");
      } catch (error) {
        await ddlClient.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  }
} finally {
  await ddlClient.end();
}

runNode("scripts/migrate-v3-target.mjs");

const incrementalClient = new Client(migrationUrl);
await incrementalClient.connect();
try {
  await incrementalClient.query(`
    CREATE TABLE IF NOT EXISTS ops.repository_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
  for (const { name } of numbered.slice(4)) {
    const source = await readFile(resolve(root, "database/migrations", name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await incrementalClient.query(
      "SELECT checksum_sha256 FROM ops.repository_migrations WHERE filename=$1",
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) throw new Error(`Checksum modificato: ${name}`);
      continue;
    }
    await incrementalClient.query("BEGIN");
    try {
      await incrementalClient.query("SET LOCAL lock_timeout='5s'");
      await incrementalClient.query("SET LOCAL statement_timeout='15min'");
      await incrementalClient.query(source);
      await incrementalClient.query("INSERT INTO ops.repository_migrations(filename,checksum_sha256) VALUES($1,$2)", [
        name,
        checksum,
      ]);
      await incrementalClient.query("COMMIT");
    } catch (error) {
      await incrementalClient.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Migrazione ${name} fallita`, { cause: error });
    }
  }
} finally {
  await incrementalClient.end();
}

runNode("scripts/validate-v3-target.mjs");
console.log(JSON.stringify({ ...plan, status: "applied_and_validated" }, null, 2));
