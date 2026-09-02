import { Client } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED, DATABASE_DIRECT_URL o DATABASE_URL non configurata");
}

const sourceTables = [
  "platform_users",
  "agencies",
  "agency_memberships",
  "countries",
  "cities",
  "visit_sites",
  "hotels",
  "reference_contents",
  "trip_templates",
  "trip_template_versions",
  "trip_days",
  "trip_countries",
  "trip_day_cities",
  "trip_day_sites",
  "trip_day_hotels",
  "itinerary_items",
  "places",
  "accommodations",
  "departures",
  "departure_item_overrides",
  "travel_parties",
  "traveler_profiles",
  "party_memberships",
  "useful_information",
  "phrasebook_entries",
  "generated_content",
  "media_assets",
  "travel_documents",
  "import_jobs",
  "platform_jobs",
  "audit_events",
  "impersonation_sessions",
  "user_invitations",
  "party_expenses",
  "party_activity_results",
  "party_memories",
  "party_photo_contest_entries",
  "party_day_notes",
  "party_restaurants",
  "party_cash_movements",
  "itinerary_item_documents",
  "traveler_programme_feedback",
];

const client = new Client(databaseUrl);
const includeColumns = process.argv.includes("--columns");

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");

  const availableResult = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [sourceTables],
  );
  const available = new Set(availableResult.rows.map((row) => row.table_name));
  const counts = {};

  for (const table of sourceTables) {
    if (!available.has(table)) {
      counts[table] = null;
      continue;
    }
    // I nomi sono esclusivamente quelli della allow-list statica sourceTables.
    const result = await client.query(`SELECT count(*)::int AS count FROM public.${table}`);
    counts[table] = result.rows[0].count;
  }

  const identities = available.has("platform_users")
    ? (
        await client.query(`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (
              WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            )::int AS uuid_compatible,
            count(*) FILTER (WHERE auth_subject IS NULL OR btrim(auth_subject) = '')::int AS without_auth_subject,
            count(*) FILTER (WHERE email IS NULL OR btrim(email) = '')::int AS without_email
          FROM public.platform_users
        `)
      ).rows[0]
    : null;

  const userStates = available.has("platform_users")
    ? (
        await client.query(`
          SELECT platform_role, status, count(*)::int AS count
            FROM public.platform_users
           GROUP BY platform_role, status
           ORDER BY platform_role, status
        `)
      ).rows
    : [];

  const integrity = {};
  const orphanChecks = [
    [
      "agency_memberships_without_user",
      "agency_memberships",
      `SELECT count(*)::int AS count FROM public.agency_memberships m LEFT JOIN public.platform_users u ON u.id = m.user_id WHERE u.id IS NULL`,
    ],
    [
      "templates_without_agency",
      "trip_templates",
      `SELECT count(*)::int AS count FROM public.trip_templates t LEFT JOIN public.agencies a ON a.id = t.agency_id WHERE a.id IS NULL`,
    ],
    [
      "versions_without_template",
      "trip_template_versions",
      `SELECT count(*)::int AS count FROM public.trip_template_versions v LEFT JOIN public.trip_templates t ON t.id = v.template_id WHERE t.id IS NULL`,
    ],
    [
      "days_without_version",
      "trip_days",
      `SELECT count(*)::int AS count FROM public.trip_days d LEFT JOIN public.trip_template_versions v ON v.id = d.template_version_id WHERE v.id IS NULL`,
    ],
    [
      "items_without_day",
      "itinerary_items",
      `SELECT count(*)::int AS count FROM public.itinerary_items i LEFT JOIN public.trip_days d ON d.id = i.trip_day_id WHERE d.id IS NULL`,
    ],
    [
      "departures_without_template",
      "departures",
      `SELECT count(*)::int AS count FROM public.departures d LEFT JOIN public.trip_templates t ON t.id = d.template_id WHERE t.id IS NULL`,
    ],
    [
      "parties_without_departure",
      "travel_parties",
      `SELECT count(*)::int AS count FROM public.travel_parties p LEFT JOIN public.departures d ON d.id = p.departure_id WHERE d.id IS NULL`,
    ],
    [
      "memberships_without_party_or_traveler",
      "party_memberships",
      `SELECT count(*)::int AS count FROM public.party_memberships m LEFT JOIN public.travel_parties p ON p.id = m.party_id LEFT JOIN public.traveler_profiles t ON t.id = m.traveler_id WHERE p.id IS NULL OR t.id IS NULL`,
    ],
  ];

  for (const [name, requiredTable, query] of orphanChecks) {
    integrity[name] = available.has(requiredTable) ? (await client.query(query)).rows[0].count : null;
  }

  const migrationBlockers = {
    agencies_without_reference_name: available.has("agencies")
      ? (await client.query(`SELECT count(*)::int AS count FROM public.agencies WHERE btrim(reference_name) = ''`))
          .rows[0].count
      : null,
    countries_without_valid_iso: available.has("countries")
      ? (
          await client.query(
            `SELECT count(*)::int AS count FROM public.countries WHERE iso_code IS NULL OR iso_code !~ '^[A-Z]{2}$'`,
          )
        ).rows[0].count
      : null,
    version_publication_mismatch: available.has("trip_template_versions")
      ? (
          await client.query(
            `SELECT count(*)::int AS count FROM public.trip_template_versions WHERE (status = 'draft' AND published_at IS NOT NULL) OR (status IN ('published','archived') AND published_at IS NULL)`,
          )
        ).rows[0].count
      : null,
    day_number_offset_mismatch: available.has("trip_days")
      ? (await client.query(`SELECT count(*)::int AS count FROM public.trip_days WHERE day_number <> day_offset + 1`))
          .rows[0].count
      : null,
    timed_non_transport_items: available.has("itinerary_items")
      ? (
          await client.query(
            `SELECT count(*)::int AS count FROM public.itinerary_items WHERE (starts_at IS NOT NULL OR ends_at IS NOT NULL OR scheduled_start_at IS NOT NULL OR scheduled_end_at IS NOT NULL) AND item_type NOT IN ('transport','flight','train')`,
          )
        ).rows[0].count
      : null,
    itinerary_place_links: available.has("itinerary_items")
      ? (
          await client.query(`
            SELECT
              count(*) FILTER (WHERE i.place_id IS NOT NULL)::int AS linked,
              count(*) FILTER (WHERE i.place_id IS NOT NULL AND p.id IS NULL)::int AS orphaned,
              count(*) FILTER (WHERE s.id IS NOT NULL)::int AS exact_site_matches,
              count(*) FILTER (WHERE h.id IS NOT NULL)::int AS exact_hotel_matches
            FROM public.itinerary_items i
            LEFT JOIN public.places p ON p.id = i.place_id
            LEFT JOIN public.visit_sites s ON lower(btrim(s.name)) = lower(btrim(p.name))
            LEFT JOIN public.hotels h ON lower(btrim(h.name)) = lower(btrim(p.name))
          `)
        ).rows[0]
      : null,
  };

  const targetVisibility = await client.query(`
    SELECT n.nspname AS schema_name,
           has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use
      FROM pg_namespace n
     WHERE n.nspname = ANY(ARRAY['iam','ref','travel','content','ops','journey','privacy'])
     ORDER BY n.nspname
  `);

  const columns = includeColumns
    ? (
        await client.query(
          `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
          [sourceTables],
        )
      ).rows.reduce((catalog, column) => {
        (catalog[column.table_name] ??= []).push({
          name: column.column_name,
          type: column.data_type,
          nullable: column.is_nullable === "YES",
        });
        return catalog;
      }, {})
    : undefined;

  const referenceQuality = available.has("countries")
    ? (
        await client.query(`
          SELECT name, normalized_name, iso_code
            FROM public.countries
           ORDER BY normalized_name
        `)
      ).rows
    : [];

  await client.query("ROLLBACK");
  console.log(
    JSON.stringify(
      {
        status: "passed",
        sourceTableCounts: counts,
        identities,
        userStates,
        integrity,
        migrationBlockers,
        referenceQuality,
        columns,
        targetSchemaVisibility: targetVisibility.rows,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
