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
];

const forbiddenPatterns = [
  /\b(?:FROM|JOIN)\s+ops\.legacy_id_map\b/i,
  /\bSELECT\b[\s\S]*?\bops\.legacy_id_map\b/i,
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:party_expenses|party_day_notes|party_restaurants|party_cash_movements|traveler_programme_feedback|party_activity_results|party_photo_contest_entries|party_memories|media_assets|generated_content)\b/i,
  /\b(?:FROM|JOIN)\s+(?:public\.)?(?:party_expenses|party_day_notes|party_restaurants|party_cash_movements|traveler_programme_feedback|party_activity_results|party_photo_contest_entries|party_memories|generated_content)\b/i,
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
