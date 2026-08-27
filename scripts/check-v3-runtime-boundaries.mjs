import { readFile } from "node:fs/promises";

const runtimeFiles = [
  new URL("../lib/platform/v3-expenses.ts", import.meta.url),
  new URL("../lib/platform/v3-journey-journal.ts", import.meta.url),
  new URL("../lib/platform/v3-programme-feedback.ts", import.meta.url),
  new URL("../lib/platform/v3-traveler-experience.ts", import.meta.url),
  new URL("../lib/platform/v3-travel-catalog.ts", import.meta.url),
  new URL("../lib/platform/v3-traveler-scope.ts", import.meta.url),
  new URL("../lib/platform/v3-media-download.ts", import.meta.url),
  new URL("../lib/platform/v3-media-mutations.ts", import.meta.url),
  new URL("../lib/platform/v3-identity-access.ts", import.meta.url),
  new URL("../lib/platform/v3-invitations.ts", import.meta.url),
  new URL("../lib/platform/v3-journey-provisioning.ts", import.meta.url),
  new URL("../lib/platform/v3-journey-management.ts", import.meta.url),
  new URL("../lib/platform/v3-superadmin-read.ts", import.meta.url),
  new URL("../lib/platform/v3-superadmin-mutations.ts", import.meta.url),
  new URL("../lib/platform/v3-journey-mutations.ts", import.meta.url),
  new URL("../lib/platform/v3-feedback-mutations.ts", import.meta.url),
  new URL("../lib/platform/v3-gamification-mutations.ts", import.meta.url),
  new URL("../app/api/traveler/challenges/route.ts", import.meta.url),
  new URL("../app/api/traveler/feedback/route.ts", import.meta.url),
  new URL("../lib/platform/repository.ts", import.meta.url),
  new URL("../lib/platform/travel-companions.ts", import.meta.url),
  new URL("../lib/platform/import-repository.ts", import.meta.url),
  new URL("../lib/platform/programme-repository.ts", import.meta.url),
  new URL("../lib/platform/reference-enrichment.ts", import.meta.url),
];

const forbiddenPatterns = [
  /\b(?:FROM|JOIN)\s+ops\.legacy_id_map\b/i,
  /\bSELECT\b[\s\S]*?\bops\.legacy_id_map\b/i,
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:party_expenses|party_day_notes|party_restaurants|party_cash_movements|traveler_programme_feedback|party_activity_results|party_photo_contest_entries|party_memories|media_assets|generated_content)\b/i,
  /\b(?:FROM|JOIN)\s+(?:public\.)?(?:party_expenses|party_day_notes|party_restaurants|party_cash_movements|traveler_programme_feedback|party_activity_results|party_photo_contest_entries|party_memories|generated_content)\b/i,
  /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:agencies|agency_memberships|platform_users|traveler_profiles|party_memberships|travel_parties|departures|trip_templates|trip_template_versions|trip_days|itinerary_items|countries|cities|visit_sites|hotels|reference_contents|media_assets|travel_documents|import_jobs|platform_jobs|trip_countries|trip_day_cities|trip_day_sites|trip_day_hotels|accommodations|audit_events|itinerary_item_documents|phrasebook_entries|useful_information|user_invitations)\b/i,
];

const violations = [];

for (const file of runtimeFiles) {
  const source = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push(`${file.pathname}: dipendenza runtime legacy vietata`);
      break;
    }
  }
}

if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}

console.log(JSON.stringify({ status: "passed", checkedFiles: runtimeFiles.length }));
