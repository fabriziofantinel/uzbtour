import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationRoot = resolve(root, "database/migrations");
const immutableMigrationMax = 59;
const files = (await readdir(migrationRoot)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
const seen = new Set(),
  failures = [];

for (const file of files) {
  const number = Number(file.slice(0, 3));
  if (seen.has(number)) failures.push(`${file}: prefisso migrazione duplicato ${number}`);
  seen.add(number);
  if (number <= immutableMigrationMax) continue;
  const source = await readFile(resolve(migrationRoot, file), "utf8");
  const approved = /^-- consolidation-approval:\s+\S+/im.test(source);
  const destructive = [/\bDROP\s+(?:TABLE|SCHEMA)\b/i, /\bTRUNCATE\b/i, /\bALTER\s+TABLE[\s\S]*?\bDROP\s+COLUMN\b/i];
  if (destructive.some((pattern) => pattern.test(source)) && !approved) {
    failures.push(`${file}: DDL distruttivo senza consolidation-approval`);
  }
  if (!/INSERT\s+INTO\s+public\.platform_schema_migrations\s*\(/i.test(source)) {
    failures.push(`${file}: marker platform_schema_migrations mancante`);
  }
  if (
    /GRANT[\s\S]*?ON\s+(?:TABLE\s+)?(?:public\.)?(?:agencies|agency_memberships|platform_users|traveler_profiles|party_memberships|travel_parties|departures|trip_templates|trip_template_versions|trip_days|itinerary_items|countries|cities|visit_sites|hotels|reference_contents|media_assets|travel_documents|import_jobs|platform_jobs)[\s\S]*?TO\s+smf_app/i.test(
      source,
    )
  ) {
    failures.push(`${file}: tentativo di riaprire l'accesso runtime V2`);
  }
  if (/SECURITY\s+DEFINER/i.test(source) && !/SET\s+search_path\s*=/i.test(source)) {
    failures.push(`${file}: SECURITY DEFINER senza search_path fissato`);
  }
}

if (failures.length) throw new Error(failures.join("\n"));
console.log(JSON.stringify({ status: "passed", migrations: files.length, immutableThrough: immutableMigrationMax }));
