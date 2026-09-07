import { randomUUID } from "node:crypto";

import { Client } from "@neondatabase/serverless";

const runtimeUrl =
  process.env.DATABASE_RUNTIME_URL ??
  process.env.DATABASE_URL ??
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL_UNPOOLED;
if (!runtimeUrl) throw new Error("DATABASE_URL runtime non configurata");

const client = new Client(runtimeUrl);
let open = false;
try {
  await client.connect();
  const role = "smf_app";
  const requiredTables = [
    "travel.template_days",
    "travel.template_day_cities",
    "travel.template_day_sites",
    "travel.template_day_hotels",
    "travel.departures",
    "travel.departure_days",
    "travel.departure_itinerary_items",
    "travel.traveler_profiles",
    "travel.party_memberships",
    "travel.template_useful_information",
    "travel.template_phrasebook_entries",
    "ref.countries",
    "ref.cities",
    "ref.visit_sites",
    "ref.hotels",
    "ops.travel_documents",
    "ops.media_assets",
  ];
  const privileges = (
    await client.query(
      `
    SELECT table_name, has_table_privilege('smf_app', table_name, 'SELECT') AS allowed
    FROM unnest($1::text[]) AS table_name
  `,
      [requiredTables],
    )
  ).rows;
  const missing = privileges.filter((row) => row.allowed !== true).map((row) => row.table_name);
  if (missing.length) throw new Error(`Ruolo runtime ${role} senza SELECT su: ${missing.join(", ")}`);

  const scope = (
    await client.query(`
    SELECT party.agency_id, party.departure_id, party.id AS party_id,
      departure.template_version_id
    FROM public.travel_parties party
    JOIN public.departures departure
      ON departure.id=party.departure_id AND departure.agency_id=party.agency_id
    JOIN travel.departures canonical_departure
      ON canonical_departure.id=departure.id AND canonical_departure.agency_id=departure.agency_id
    JOIN travel.travel_parties canonical_party
      ON canonical_party.id=party.id AND canonical_party.departure_id=departure.id
      AND canonical_party.agency_id=departure.agency_id
    ORDER BY (
      SELECT count(*) FROM public.itinerary_items item
      JOIN public.trip_days day ON day.id=item.trip_day_id
      WHERE day.agency_id=party.agency_id
        AND day.template_version_id=departure.template_version_id
    ) DESC,party.created_at,party.id LIMIT 1
  `)
  ).rows[0];
  if (!scope) throw new Error("Nessuna famiglia disponibile per lo smoke test");

  await client.query("BEGIN");
  open = true;
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [scope.agency_id]);
  const reconciliations = (
    await client.query(
      `
    SELECT domain,legacy_count,target_count FROM (
      SELECT 'days' domain,
        (SELECT count(*) FROM public.trip_days WHERE agency_id=$1 AND template_version_id=$4) legacy_count,
        (SELECT count(*) FROM travel.template_days WHERE agency_id=$1 AND template_version_id=$4) target_count
      UNION ALL SELECT 'items',
        (SELECT count(*) FROM public.itinerary_items item JOIN public.trip_days day ON day.id=item.trip_day_id
          WHERE item.agency_id=$1 AND day.template_version_id=$4),
        (SELECT count(*) FROM travel.departure_itinerary_items WHERE agency_id=$1 AND departure_id=$2 AND template_version_id=$4)
      UNION ALL SELECT 'cities',
        (SELECT count(*) FROM public.trip_day_cities link JOIN public.trip_days day ON day.id=link.trip_day_id
          WHERE day.agency_id=$1 AND day.template_version_id=$4),
        (SELECT count(*) FROM travel.template_day_cities WHERE agency_id=$1 AND template_version_id=$4)
      UNION ALL SELECT 'sites',
        (SELECT count(*) FROM public.trip_day_sites link JOIN public.trip_days day ON day.id=link.trip_day_id
          WHERE day.agency_id=$1 AND day.template_version_id=$4),
        (SELECT count(*) FROM travel.template_day_sites WHERE agency_id=$1 AND template_version_id=$4)
      UNION ALL SELECT 'hotels',
        (SELECT count(*) FROM public.trip_day_hotels link JOIN public.trip_days day ON day.id=link.trip_day_id
          WHERE day.agency_id=$1 AND day.template_version_id=$4),
        (SELECT count(*) FROM travel.template_day_hotels WHERE agency_id=$1 AND template_version_id=$4)
      UNION ALL SELECT 'travelers',
        (SELECT count(*) FROM public.party_memberships WHERE agency_id=$1 AND party_id=$3 AND status='active'),
        (SELECT count(*) FROM travel.party_memberships WHERE agency_id=$1 AND departure_id=$2 AND party_id=$3 AND status='active')
      UNION ALL SELECT 'useful_info',
        (SELECT count(*) FROM public.useful_information WHERE agency_id=$1 AND template_version_id=$4),
        (SELECT count(*) FROM travel.template_useful_information WHERE agency_id=$1 AND template_version_id=$4)
      UNION ALL SELECT 'phrases',
        (SELECT count(*) FROM public.phrasebook_entries WHERE agency_id=$1 AND template_version_id=$4),
        (SELECT count(*) FROM travel.template_phrasebook_entries WHERE agency_id=$1 AND template_version_id=$4)
      UNION ALL SELECT 'tickets',
        (SELECT count(*) FROM public.itinerary_item_documents d JOIN public.media_assets a ON a.id=d.media_asset_id
          WHERE d.agency_id=$1 AND d.departure_id=$2 AND a.status='ready'),
        (SELECT count(*) FROM ops.travel_documents d JOIN ops.media_assets a ON a.id=d.media_asset_id
          WHERE d.agency_id=$1 AND d.departure_id=$2 AND d.departure_item_id IS NOT NULL
            AND d.status='ready' AND a.status='ready')
    ) counts ORDER BY domain
  `,
      [scope.agency_id, scope.departure_id, scope.party_id, scope.template_version_id],
    )
  ).rows;
  const mismatches = reconciliations.filter((row) => Number(row.legacy_count) !== Number(row.target_count));
  if (mismatches.length) throw new Error(`Riconciliazione catalogo fallita: ${JSON.stringify(mismatches)}`);

  const shape = (
    await client.query(
      `
    SELECT
      (SELECT count(*) FROM (
        SELECT COALESCE(item.source_template_item_id,item.id),day.template_day_id,
          to_char(item.scheduled_start_at AT TIME ZONE departure.timezone,'HH24:MI:SS'),
          CASE WHEN place.location IS NULL THEN NULL ELSE ST_Y(place.location::geometry) END
        FROM travel.departure_itinerary_items item
        JOIN travel.departure_days day ON day.id=item.departure_day_id
          AND day.agency_id=item.agency_id AND day.departure_id=item.departure_id
        JOIN travel.departures departure ON departure.id=item.departure_id
          AND departure.agency_id=item.agency_id
        LEFT JOIN LATERAL (
          SELECT site.location FROM ref.visit_sites site WHERE site.id=item.visit_site_id
          UNION ALL SELECT hotel.location FROM ref.hotels hotel WHERE hotel.id=item.hotel_id LIMIT 1
        ) place ON true
        WHERE item.agency_id=$1 AND item.departure_id=$2 AND item.template_version_id=$3
      ) effective_programme) AS programme_rows,
      (SELECT count(*) FROM travel.template_day_cities link
        JOIN ref.cities city ON city.id=link.city_id
        WHERE link.agency_id=$1 AND link.template_version_id=$3
          AND (city.location IS NULL OR ST_X(city.location::geometry) BETWEEN -180 AND 180)) AS city_rows,
      (SELECT count(*) FROM ops.travel_documents document
        JOIN ops.media_assets asset ON asset.id=document.media_asset_id
          AND asset.agency_id=document.agency_id
        JOIN travel.departure_itinerary_items item ON item.id=document.departure_item_id
          AND item.agency_id=document.agency_id AND item.departure_id=document.departure_id
        WHERE document.agency_id=$1 AND document.departure_id=$2
          AND document.status='ready' AND asset.status='ready') AS ticket_rows
  `,
      [scope.agency_id, scope.departure_id, scope.template_version_id],
    )
  ).rows[0];
  if (Number(shape.programme_rows) !== Number(reconciliations.find((row) => row.domain === "items")?.target_count)) {
    throw new Error(`Contratto query programma non coerente: ${JSON.stringify(shape)}`);
  }

  await client.query("SET LOCAL ROLE smf_app");
  await client.query("SELECT set_config('app.agency_id',$1,true)", [randomUUID()]);
  const crossTenantRows = Number(
    (
      await client.query(`SELECT
    (SELECT count(*) FROM travel.template_days)+
    (SELECT count(*) FROM travel.template_day_cities)+
    (SELECT count(*) FROM travel.template_day_sites)+
    (SELECT count(*) FROM travel.template_day_hotels)+
    (SELECT count(*) FROM travel.departure_itinerary_items)+
    (SELECT count(*) FROM travel.traveler_profiles)+
    (SELECT count(*) FROM travel.party_memberships)+
    (SELECT count(*) FROM travel.template_useful_information)+
    (SELECT count(*) FROM travel.template_phrasebook_entries)+
    (SELECT count(*) FROM ops.travel_documents)+
    (SELECT count(*) FROM ops.media_assets) AS row_count`)
    ).rows[0].row_count,
  );
  if (crossTenantRows !== 0) throw new Error(`Isolamento tenant fallito: ${crossTenantRows} righe visibili`);

  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: "passed", role, reconciledDomains: reconciliations.length, queryShape: shape, crossTenantRows },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
