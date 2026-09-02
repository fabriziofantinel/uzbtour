import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";

const name = "053_v3_legacy_normalized_read_retirement",
  model = "3.25.0-legacy-normalized-read-retirement";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const source = await readFile(new URL(`../database/migrations/${name}.sql`, import.meta.url), "utf8");
const checksum = createHash("sha256").update(source).digest("hex"),
  client = new Client(url);
let open = false;
const retiredTables = [
  "accommodations",
  "agencies",
  "agency_memberships",
  "audit_events",
  "cities",
  "countries",
  "departures",
  "generated_content",
  "hotels",
  "import_jobs",
  "itinerary_item_documents",
  "itinerary_items",
  "media_assets",
  "party_activity_results",
  "party_cash_movements",
  "party_day_notes",
  "party_expenses",
  "party_memberships",
  "party_memories",
  "party_photo_contest_entries",
  "party_restaurants",
  "phrasebook_entries",
  "platform_jobs",
  "platform_users",
  "reference_contents",
  "travel_documents",
  "travel_parties",
  "traveler_profiles",
  "traveler_programme_feedback",
  "trip_countries",
  "trip_day_cities",
  "trip_day_hotels",
  "trip_day_sites",
  "trip_days",
  "trip_template_versions",
  "trip_templates",
  "useful_information",
  "user_invitations",
  "visit_sites",
];
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if (!role || role.runtime) throw new Error("Ruolo owner richiesto");
  const started = performance.now();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:v3-legacy-normalized-read-retirement',0))",
  );
  await client.query(source);
  const grants = (
    await client.query(
      `SELECT table_name FROM information_schema.role_table_grants
   WHERE grantee='smf_app' AND table_schema='public' AND privilege_type='SELECT'
     AND table_name=ANY($1::text[]) ORDER BY table_name`,
      [retiredTables],
    )
  ).rows.map((row) => row.table_name);
  if (grants.length) throw new Error(`Letture legacy ancora autorizzate: ${grants.join(",")}`);
  const demo = (await client.query("SELECT has_table_privilege('smf_app','public.trip_notes','SELECT') readable"))
    .rows[0];
  if (!demo?.readable) throw new Error("Il perimetro indipendente della demo è stato alterato");
  const executionMs = Math.round(performance.now() - started);
  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
   VALUES($1,$2,$3) ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp(),execution_ms=EXCLUDED.execution_ms`,
      [model, checksum, executionMs],
    );
    await client.query("COMMIT");
  } else await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run_passed",
        role: role.role_name,
        executionMs,
        gates: { legacySelectGrants: grants.length, demoReadable: demo.readable },
        migration: { name, model, checksum },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
