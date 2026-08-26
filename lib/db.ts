import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

let sqlClient: NeonQueryFunction<false, false> | null = null;
let migrationClient: NeonQueryFunction<false, false> | null = null;

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL non configurata");
  }

  if (!sqlClient) sqlClient = neon(databaseUrl);
  return sqlClient;
}

/**
 * Connessione diretta riservata a DDL e migrazioni. Il runtime deve invece
 * continuare a usare DATABASE_URL, configurata con l'endpoint Neon pooled.
 */
export function getMigrationSql() {
  const databaseUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_DIRECT_URL o DATABASE_URL non configurata");
  }

  if (!migrationClient) migrationClient = neon(databaseUrl);
  return migrationClient;
}
