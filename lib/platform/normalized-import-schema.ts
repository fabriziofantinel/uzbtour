import { getSql } from "@/lib/db";

let schemaPromise: Promise<void> | null = null;

export function ensureNormalizedImportSchema() {
  schemaPromise ??= (async () => {
    const sql = getSql();
    await sql`
      ALTER TABLE import_jobs
      ADD COLUMN IF NOT EXISTS normalized_document_id UUID REFERENCES travel_documents(id) ON DELETE SET NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS import_jobs_normalized_document_idx
      ON import_jobs (normalized_document_id)
      WHERE normalized_document_id IS NOT NULL
    `;
    await sql`
      INSERT INTO platform_schema_migrations (version) VALUES ('011_normalized_import_document')
      ON CONFLICT (version) DO NOTHING
    `;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}
