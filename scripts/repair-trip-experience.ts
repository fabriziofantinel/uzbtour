import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { processReferenceEnrichment } from "@/lib/platform/reference-enrichment";
import type { ReferenceTarget } from "@/lib/platform/travel-catalog";

async function main() {
  const tripOrDepartureId = process.argv[2];
  const refreshCountry = process.argv.includes("--refresh-country");
  const refreshDestinations = process.argv.includes("--refresh-destinations");
  const profileOnly = process.argv.includes("--profile-only");
  if (!tripOrDepartureId || !/^[0-9a-f-]{36}$/i.test(tripOrDepartureId)) throw new Error("Viaggio non valido");

  const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATION_URL o DATABASE_URL non configurata");
  process.env.DATABASE_URL = databaseUrl;
  const sql = neon(databaseUrl);
  const scope = await sql`
  SELECT departure.agency_id::text,departure.template_id::text
  FROM travel.departures departure WHERE departure.id=${tripOrDepartureId}
  UNION ALL
  SELECT template.agency_id::text,template.id::text
  FROM travel.trip_templates template WHERE template.id=${tripOrDepartureId}
  LIMIT 1
`;
  const agencyId = String(scope[0]?.agency_id || "");
  const templateId = String(scope[0]?.template_id || "");
  if (!agencyId) throw new Error("Viaggio non trovato");

  const targetRows = await sql`
  WITH version AS(
    SELECT id FROM travel.trip_template_versions
    WHERE agency_id=${agencyId} AND template_id=${templateId} AND status='published'
    ORDER BY version_number DESC LIMIT 1
  ), targets AS(
    SELECT 'country'::text entity_type,country.id::text entity_id,country.name
    FROM travel.template_countries link JOIN ref.countries country ON country.id=link.country_id
    WHERE link.agency_id=${agencyId} AND link.template_id=${templateId}
    UNION
    SELECT 'city',city.id::text,city.name
    FROM travel.template_day_cities link JOIN version ON version.id=link.template_version_id
    JOIN ref.cities city ON city.id=link.city_id WHERE link.agency_id=${agencyId}
    UNION
    SELECT 'site',site.id::text,site.name
    FROM travel.template_day_sites link JOIN version ON version.id=link.template_version_id
    JOIN ref.visit_sites site ON site.id=link.visit_site_id WHERE link.agency_id=${agencyId}
  ) SELECT * FROM targets ORDER BY entity_type,entity_id
`;
  const targets = targetRows
    .map((row) => ({
      entityType: String(row.entity_type) as ReferenceTarget["entityType"],
      entityId: String(row.entity_id),
      name: String(row.name),
    }))
    .filter((target) => !profileOnly || target.entityType === "country");
  if (!targets.length) throw new Error("Anagrafiche del viaggio non disponibili");

  if (refreshCountry) {
    await sql`
    UPDATE ref.reference_contents content SET refresh_after=clock_timestamp()-interval '1 second'
    FROM travel.template_countries country
    WHERE country.agency_id=${agencyId} AND country.template_id=${templateId}
      AND content.country_id=country.country_id
      AND content.locale='it-IT' AND content.content_type IN('useful_info','phrasebook','bingo')
  `;
  }

  if (refreshDestinations) {
    await sql`
    UPDATE ref.reference_contents content SET refresh_after=clock_timestamp()-interval '1 second'
    WHERE content.locale='it-IT' AND content.content_type IN('quiz','mission','game','photo_contest')
      AND (content.city_id IN(SELECT link.city_id FROM travel.template_day_cities link
            JOIN travel.trip_template_versions version ON version.id=link.template_version_id
            WHERE link.agency_id=${agencyId} AND version.template_id=${templateId})
        OR content.visit_site_id IN(SELECT link.visit_site_id FROM travel.template_day_sites link
            JOIN travel.trip_template_versions version ON version.id=link.template_version_id
            WHERE link.agency_id=${agencyId} AND version.template_id=${templateId}))
  `;
  }

  const jobId = randomUUID();
  await sql`
  INSERT INTO ops.platform_jobs(id,agency_id,job_type,provider,status,payload,idempotency_key)
  VALUES(${jobId},${agencyId},'travel-reference.enrich','database','queued',
    ${JSON.stringify({ templateId, referenceTargets: targets })}::jsonb,
    ${`maintenance:travel-reference.enrich:${templateId}:${jobId}`})
`;

  const result = await processReferenceEnrichment(
    jobId,
    agencyId,
    templateId,
    targets,
    profileOnly ? ["country_profile"] : undefined,
  );
  console.log(JSON.stringify({ status: "completed", jobId, agencyId, targets: targets.length, ...result }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
