import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { linkImportCountryCatalog } from "@/lib/platform/import-repository";
import { travelProgrammeDraftSchema } from "@/lib/platform/import-schema";
import { processReferenceEnrichment } from "@/lib/platform/reference-enrichment";
import { prepareCountryCatalog } from "@/lib/platform/travel-catalog";

async function main() {
  const templateId = process.argv[2];
  if (!templateId || !/^[0-9a-f-]{36}$/i.test(templateId)) throw new Error("Viaggio non valido");
  const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL o DATABASE_URL non configurata");
  process.env.DATABASE_URL = databaseUrl;
  const sql = neon(databaseUrl);
  const rows = await sql`
    SELECT import_job.id::text import_id,import_job.agency_id::text,
      COALESCE(import_job.created_by_user_id,template.created_by_user_id)::text actor_id,
      import_job.result
    FROM ops.import_jobs import_job
    JOIN travel.trip_templates template ON template.id=import_job.template_id
      AND template.agency_id=import_job.agency_id
    WHERE import_job.template_id=${templateId} AND import_job.status='ready_for_review'
    ORDER BY import_job.completed_at DESC NULLS LAST,import_job.created_at DESC LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Importazione revisionabile non trovata");
  const actorId = String(row.actor_id || "");
  const agencyId = String(row.agency_id);
  const importId = String(row.import_id);
  if (!actorId) throw new Error("Utente dell'importazione non disponibile");
  const draft = travelProgrammeDraftSchema.parse(row.result);
  const catalog = await prepareCountryCatalog(draft, { actorId, agencyId });
  await linkImportCountryCatalog({
    actorId,
    importId,
    agencyId,
    primaryCountryId: catalog.primaryCountry.id,
    countryIds: catalog.countries.map((country) => country.id),
  });

  const jobId = randomUUID();
  await sql`
    INSERT INTO ops.platform_jobs(id,agency_id,job_type,provider,status,payload,idempotency_key)
    VALUES(${jobId},${agencyId},'travel-reference.enrich','database','queued',
      ${JSON.stringify({ templateId, targets: catalog.targets, contentTypes: ["country_profile"] })}::jsonb,
      ${`maintenance:country-profile:${templateId}:${jobId}`})
  `;
  const result = await processReferenceEnrichment(jobId, agencyId, templateId, catalog.targets, ["country_profile"]);
  console.log(
    JSON.stringify(
      {
        status: "completed",
        templateId,
        countries: catalog.countries.map((country) => country.name),
        ...result,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
