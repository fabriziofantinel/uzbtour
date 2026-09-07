import { readFile } from "node:fs/promises";

import { Client } from "@neondatabase/serverless";

const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!migrationUrl) {
  throw new Error("Connessione diretta Neon non configurata");
}

const smokeUrl = new URL("../database/schema-v3-smoke.sql", import.meta.url);
const smokeSql = await readFile(smokeUrl, "utf8");
const tableInventory = JSON.parse(
  await readFile(new URL("../database/v3-table-inventory.json", import.meta.url), "utf8"),
);
const expectedApplicationTables = [...tableInventory.applicationTables].sort();
const optionalBootstrapTables = new Set(tableInventory.optionalBootstrapTables);
const client = new Client(migrationUrl);

try {
  await client.connect();
  const inventory = await client.query(`
    SELECT
      (SELECT count(*)::int
         FROM information_schema.tables
        WHERE table_schema IN ('iam','ref','travel','content','ops','journey','privacy'))
        AS table_count,
      (SELECT count(*)::int
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('iam','travel','content','ops','journey','privacy')
          AND c.relrowsecurity) AS rls_table_count,
      (SELECT count(*)::int
         FROM pg_constraint
        WHERE NOT convalidated
          AND connamespace IN (
            'iam'::regnamespace, 'ref'::regnamespace, 'travel'::regnamespace,
            'content'::regnamespace, 'ops'::regnamespace,
            'journey'::regnamespace, 'privacy'::regnamespace
          )) AS unvalidated_constraints,
      (SELECT count(*)::int
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('iam','ref','travel','content','ops','journey','privacy')
          AND (NOT i.indisvalid OR NOT i.indisready)) AS invalid_indexes,
      (SELECT count(*)::int
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('iam','travel','content','ops','journey','privacy')
          AND c.relrowsecurity
          AND NOT (n.nspname = 'iam' AND c.relname = 'agencies')
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attname = 'agency_id' AND NOT a.attisdropped
          )
          AND NOT EXISTS (
            SELECT 1
              FROM pg_index i
              JOIN pg_attribute a
                ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
             WHERE i.indrelid = c.oid AND i.indisvalid AND i.indisready
               AND a.attname = 'agency_id'
          )) AS tenant_tables_without_leading_index
  `);

  const result = inventory.rows[0];
  const actualTables = (
    await client.query(`
      SELECT table_schema || '.' || table_name AS name
        FROM information_schema.tables
       WHERE table_schema IN ('iam','ref','travel','content','ops','journey','privacy')
       ORDER BY name
    `)
  ).rows.map((row) => row.name);
  const actualApplicationTables = actualTables.filter((name) => !optionalBootstrapTables.has(name));
  const missingTables = expectedApplicationTables.filter((name) => !actualApplicationTables.includes(name));
  const unexpectedTables = actualApplicationTables.filter((name) => !expectedApplicationTables.includes(name));
  const shadowCoreInstalled = result.table_count >= 62;
  const shadowOperationalInstalled = result.table_count >= 65;
  const expectedRlsTableCounts =
    result.table_count >= 99
      ? [73]
      : result.table_count >= 96
        ? [70]
        : result.table_count >= 85
          ? [68]
          : result.table_count >= 82
            ? [65]
            : result.table_count >= 80
              ? [62]
              : result.table_count >= 79
                ? [61, 62]
                : result.table_count >= 75
                  ? [61]
                  : result.table_count >= 74
                    ? [60]
                    : result.table_count >= 71
                      ? [58]
                      : result.table_count >= 70
                        ? [57]
                        : result.table_count >= 69
                          ? [56]
                          : result.table_count >= 68
                            ? [55]
                            : result.table_count >= 67
                              ? [54]
                              : shadowOperationalInstalled
                                ? [52]
                                : shadowCoreInstalled
                                  ? [49]
                                  : [47];
  let shadowCore = null;
  if (shadowCoreInstalled) {
    shadowCore = (
      await client.query(`
        SELECT
          (SELECT count(*)::int FROM ops.schema_migrations
            WHERE version = '3.2.1-shadow-core') AS marker_count,
          (SELECT count(*)::int FROM (
            SELECT entity_type, target_id FROM ops.legacy_id_map
            GROUP BY entity_type, target_id HAVING count(*) > 1
          ) duplicated) AS duplicate_target_ids
      `)
    ).rows[0];
  }
  let shadowOperational = null;
  if (shadowOperationalInstalled) {
    shadowOperational = (
      await client.query(`
        SELECT
          (SELECT count(*)::int FROM ops.schema_migrations
            WHERE version = '3.3.0-shadow-operational') AS marker_count,
          (SELECT count(*)::int FROM (
            SELECT legacy_generated_content_id
              FROM ops.legacy_generated_content_map
             GROUP BY legacy_generated_content_id HAVING count(*) > 1
          ) duplicated) AS duplicate_legacy_content_ids,
          (SELECT count(*)::int FROM (
            SELECT activity_item_id
              FROM ops.legacy_generated_content_map
             GROUP BY activity_item_id HAVING count(*) > 1
          ) duplicated) AS duplicate_activity_item_ids
      `)
    ).rows[0];
  }
  if (
    missingTables.length !== 0 ||
    unexpectedTables.length !== 0 ||
    !expectedRlsTableCounts.includes(result.rls_table_count) ||
    result.unvalidated_constraints !== 0 ||
    result.invalid_indexes !== 0 ||
    result.tenant_tables_without_leading_index !== 0 ||
    (shadowCoreInstalled && (shadowCore?.marker_count !== 1 || shadowCore?.duplicate_target_ids !== 0)) ||
    (shadowOperationalInstalled &&
      (shadowOperational?.marker_count !== 1 ||
        shadowOperational?.duplicate_legacy_content_ids !== 0 ||
        shadowOperational?.duplicate_activity_item_ids !== 0))
  ) {
    throw new Error(
      `Validazione catalogo fallita: ${JSON.stringify({ ...result, missingTables, unexpectedTables, shadowCore, shadowOperational })}`,
    );
  }

  await client.query(smokeSql);
  console.log(
    JSON.stringify({
      status: "passed",
      ...result,
      application_table_count: actualApplicationTables.length,
      bootstrap_ledger_present: actualTables.includes("ops.repository_migrations"),
      missing_tables: missingTables,
      unexpected_tables: unexpectedTables,
      shadowCore,
      shadowOperational,
    }),
  );
} finally {
  await client.end().catch(() => undefined);
}
