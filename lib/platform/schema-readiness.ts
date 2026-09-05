import { getSql } from "@/lib/db";

const checks = new Map<string, Promise<void>>();

const SIMPLE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
export const CURRENT_SCHEMA_VERSION = "184_v3_staff_past_trip_test_access";

export function assertDatabaseTables(requiredTables: string[]) {
  const tables = [...new Set(requiredTables)].sort();
  if (tables.some((table) => !SIMPLE_IDENTIFIER.test(table))) {
    throw new Error("Controllo schema non valido: nome tabella non consentito");
  }
  const cacheKey = `tables:${tables.join(",")}`;
  const existing = checks.get(cacheKey);
  if (existing) return existing;

  const check = (async () => {
    const sql = getSql();
    const rows = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${tables}::text[])
    `;
    const available = new Set(rows.map((row) => String(row.table_name)));
    const missing = tables.filter((table) => !available.has(table));
    if (missing.length > 0) {
      throw new Error(`Schema database non aggiornato. Tabelle mancanti: ${missing.join(", ")}`);
    }
  })().catch((error) => {
    checks.delete(cacheKey);
    throw error;
  });

  checks.set(cacheKey, check);
  return check;
}

export function assertSchemaVersions(requiredVersions: string[]) {
  const versions = [...new Set(requiredVersions)].sort();
  const cacheKey = versions.join(",");
  const existing = checks.get(cacheKey);
  if (existing) return existing;

  const check = (async () => {
    const sql = getSql();
    const rows = await sql`
      SELECT version
      FROM platform_schema_migrations
      WHERE version = ANY(${versions}::text[])
    `;
    const available = new Set(rows.map((row) => String(row.version)));
    const missing = versions.filter((version) => !available.has(version));
    if (missing.length > 0) {
      throw new Error(`Schema database non aggiornato. Migrazioni mancanti: ${missing.join(", ")}`);
    }
  })().catch((error) => {
    checks.delete(cacheKey);
    throw error;
  });

  checks.set(cacheKey, check);
  return check;
}

export function assertProgrammeFeedbackSchema() {
  return assertSchemaVersions(["010_programme_tickets_feedback"]);
}

export function assertNormalizedImportSchema() {
  return assertSchemaVersions(["011_normalized_import_document"]);
}

export function assertArchitectureHardeningSchema() {
  return assertSchemaVersions(["012_neon_architecture_hardening"]);
}

export function assertCurrentSchema() {
  return assertSchemaVersions([CURRENT_SCHEMA_VERSION]);
}
