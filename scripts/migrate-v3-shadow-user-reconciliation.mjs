import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "@neondatabase/serverless";

const name = "092_v3_shadow_user_reconciliation";
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

if (!url) throw new Error("Connessione Neon non configurata");

const source = await readFile(
  new URL(`../database/migrations/${name}.sql`, import.meta.url),
  "utf8",
);
const historicalCore = await readFile(
  new URL("../database/backfill-v3-shadow-core.sql", import.meta.url),
  "utf8",
);
const historicalOperational = await readFile(
  new URL("../database/backfill-v3-shadow-operational.sql", import.meta.url),
  "utf8",
);
const insertColumns = "  (id, display_name, email, phone, platform_role, status, created_at, updated_at)";
const refreshedColumns = "  (id, username, display_name, email, phone, platform_role, status, created_at, updated_at)";
const insertValues = "SELECT m.target_id, u.display_name, u.email, u.phone, u.platform_role, u.status,";
const refreshedValues = "SELECT m.target_id, u.username, u.display_name, u.email, u.phone, u.platform_role, u.status,";

if (!historicalCore.includes(insertColumns) || !historicalCore.includes(insertValues)) {
  throw new Error("Contratto del backfill core storico non riconosciuto");
}

const replacements = [
  [insertColumns, refreshedColumns],
  [insertValues, refreshedValues],
  [
    "SELECT id, country_id, name, normalized_name, google_url,\n       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL",
    "SELECT city_map.target_id, city.country_id, city.name, city.normalized_name, city.google_url,\n       CASE WHEN city.latitude IS NOT NULL AND city.longitude IS NOT NULL",
  ],
  [
    "THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,\n       NULL, last_verified_at, content_refresh_after, created_at, updated_at\nFROM public.cities",
    "THEN ST_SetSRID(ST_MakePoint(city.longitude, city.latitude), 4326)::geography END,\n       NULL, city.last_verified_at, city.content_refresh_after, city.created_at, city.updated_at\nFROM public.cities city\nJOIN ops.legacy_id_map city_map ON city_map.source_system='public-v2'\n AND city_map.entity_type='city' AND city_map.legacy_id=city.id::text",
  ],
  [
    "SELECT id, city_id, name, normalized_name, google_url, official_url,\n       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL",
    "SELECT site_map.target_id, city_map.target_id, site.name, site.normalized_name, site.google_url, site.official_url,\n       CASE WHEN site.latitude IS NOT NULL AND site.longitude IS NOT NULL",
  ],
  [
    "THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,\n       last_verified_at, content_refresh_after, created_at, updated_at\nFROM public.visit_sites",
    "THEN ST_SetSRID(ST_MakePoint(site.longitude, site.latitude), 4326)::geography END,\n       site.last_verified_at, site.content_refresh_after, site.created_at, site.updated_at\nFROM public.visit_sites site\nJOIN ops.legacy_id_map site_map ON site_map.source_system='public-v2'\n AND site_map.entity_type='visit_site' AND site_map.legacy_id=site.id::text\nJOIN ops.legacy_id_map city_map ON city_map.source_system='public-v2'\n AND city_map.entity_type='city' AND city_map.legacy_id=site.city_id::text",
  ],
  [
    "SELECT id, city_id, name, normalized_name, google_url, website_url,\n       CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL",
    "SELECT hotel_map.target_id, city_map.target_id, hotel.name, hotel.normalized_name, hotel.google_url, hotel.website_url,\n       CASE WHEN hotel.latitude IS NOT NULL AND hotel.longitude IS NOT NULL",
  ],
  [
    "THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END,\n       last_verified_at, created_at, updated_at\nFROM public.hotels",
    "THEN ST_SetSRID(ST_MakePoint(hotel.longitude, hotel.latitude), 4326)::geography END,\n       hotel.last_verified_at, hotel.created_at, hotel.updated_at\nFROM public.hotels hotel\nJOIN ops.legacy_id_map hotel_map ON hotel_map.source_system='public-v2'\n AND hotel_map.entity_type='hotel' AND hotel_map.legacy_id=hotel.id::text\nJOIN ops.legacy_id_map city_map ON city_map.source_system='public-v2'\n AND city_map.entity_type='city' AND city_map.legacy_id=hotel.city_id::text",
  ],
  [
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.city_id,",
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, city_map.target_id,",
  ],
  [
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nON CONFLICT (template_day_id, city_id)",
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nJOIN ops.legacy_id_map city_map ON city_map.source_system='public-v2'\n AND city_map.entity_type='city' AND city_map.legacy_id=x.city_id::text\nON CONFLICT (template_day_id, city_id)",
  ],
  [
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.site_id,",
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, site_map.target_id,",
  ],
  [
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nON CONFLICT (template_day_id, visit_site_id)",
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nJOIN ops.legacy_id_map site_map ON site_map.source_system='public-v2'\n AND site_map.entity_type='visit_site' AND site_map.legacy_id=x.site_id::text\nON CONFLICT (template_day_id, visit_site_id)",
  ],
  [
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, x.hotel_id,",
    "SELECT d.agency_id, d.template_version_id, x.trip_day_id, hotel_map.target_id,",
  ],
  [
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nON CONFLICT (template_day_id, hotel_id)",
    "JOIN public.trip_days d ON d.id = x.trip_day_id\nJOIN ops.legacy_id_map hotel_map ON hotel_map.source_system='public-v2'\n AND hotel_map.entity_type='hotel' AND hotel_map.legacy_id=x.hotel_id::text\nON CONFLICT (template_day_id, hotel_id)",
  ],
];

let refreshedCore = historicalCore;
for (const [before, after] of replacements) {
  if (!refreshedCore.includes(before)) {
    throw new Error(`Contratto del backfill core non riconosciuto: ${before.slice(0, 48)}`);
  }
  refreshedCore = refreshedCore.replace(before, after);
}

const referenceContentStart = refreshedCore.indexOf("INSERT INTO ref.reference_contents");
const tripTemplateStart = refreshedCore.indexOf("INSERT INTO travel.trip_templates");
if (referenceContentStart < 0 || tripTemplateStart <= referenceContentStart) {
  throw new Error("Blocco reference contents del backfill core non riconosciuto");
}
refreshedCore = `${refreshedCore.slice(0, referenceContentStart)}-- Reference contents V3 gia canonici: nessuna sovrascrittura dal legacy.\n\n${refreshedCore.slice(tripTemplateStart)}`;

const cashActorJoin = `JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = c.added_by_user_id
JOIN travel.traveler_profiles actor
  ON actor.agency_id = c.agency_id AND actor.user_id = um.target_id`;
const refreshedCashActorJoin = `LEFT JOIN ops.legacy_id_map um
  ON um.source_system = 'public-v2' AND um.entity_type = 'user'
 AND um.legacy_id = c.added_by_user_id
JOIN LATERAL (
  SELECT traveler.id
    FROM travel.party_memberships membership
    JOIN travel.traveler_profiles traveler
      ON traveler.agency_id=membership.agency_id
     AND traveler.id=membership.traveler_id
   WHERE membership.agency_id=c.agency_id
     AND membership.departure_id=p.departure_id
     AND membership.party_id=c.party_id
     AND membership.status='active'
   ORDER BY CASE WHEN traveler.user_id=um.target_id THEN 0
                 WHEN membership.role='organizer' THEN 1 ELSE 2 END,
            membership.joined_at,membership.traveler_id
   LIMIT 1
) actor ON true`;
if (!historicalOperational.includes(cashActorJoin)) {
  throw new Error("Contratto cash movement del backfill operativo non riconosciuto");
}
const refreshedOperational = historicalOperational.replace(cashActorJoin, refreshedCashActorJoin);
const client = new Client(url);
let open = false;

try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='15min'");
  await client.query(source);
  await client.query(refreshedCore);
  await client.query(refreshedOperational);

  const gate = (
    await client.query(`
      SELECT
        (SELECT count(*)::int
        FROM public.platform_users legacy
        LEFT JOIN ops.legacy_id_map map
          ON map.source_system='public-v2'
         AND map.entity_type='user'
         AND map.legacy_id=legacy.id
        LEFT JOIN iam.users target ON target.id=map.target_id
       WHERE target.id IS NULL OR target.username IS DISTINCT FROM legacy.username) AS missing_users,
        (SELECT count(*)::int
           FROM public.party_cash_movements legacy
           LEFT JOIN journey.cash_movements target ON target.id=legacy.id
          WHERE target.id IS NULL) AS missing_cash_movements
    `)
  ).rows[0];
  if (gate?.missing_users !== 0 || gate?.missing_cash_movements !== 0) {
    throw new Error("Riconciliazione shadow incompleta");
  }

  if (apply) {
    await client.query(
      `INSERT INTO ops.schema_migrations(version,checksum_sha256,execution_ms)
       VALUES($1,$2,0)
       ON CONFLICT(version) DO UPDATE SET applied_at=clock_timestamp()`,
      [
        "3.62.0-shadow-user-reconciliation",
        createHash("sha256").update(source).update("\0").update(refreshedCore)
          .update("\0").update(refreshedOperational).digest("hex"),
      ],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  open = false;
  console.log(JSON.stringify({ status: apply ? "applied" : "dry_run_passed", gate }));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
