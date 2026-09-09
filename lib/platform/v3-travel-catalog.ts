import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3TravelCatalogCutoverReadEnabled() {
  return process.env.V3_TRAVEL_CATALOG_READ_SOURCE !== "legacy";
}

export async function readV3TravelCatalog(input: {
  agencyId: string;
  departureId: string;
  templateVersionId: string;
  partyId: string;
  actorUserId: string;
}) {
  const sql = getSql();
  const [, days, items, cities, sites, hotels, travelers, usefulInfo, phrases, tickets, dayDocuments] =
    await sql.transaction(
      (txn) => [
        txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
        txn`
        SELECT day.id::text, day.day_number, day.day_offset,
          COALESCE(day.metadata->>'legacyLabel', '') AS label,
          day.title, COALESCE(day.metadata->>'legacyCity', '') AS city,
          day.description, day.metadata->>'sourceDate' AS source_date, day.metadata
        FROM travel.template_days day
        WHERE day.agency_id = ${input.agencyId}
          AND day.template_version_id = ${input.templateVersionId}
        ORDER BY day.day_number
      `,
        txn`
        SELECT COALESCE(item.source_template_item_id, item.id)::text AS id,
          day.template_day_id::text AS trip_day_id, item.item_type, item.title,
          item.description,
          CASE WHEN item.scheduled_start_at IS NULL THEN NULL
            ELSE to_char(item.scheduled_start_at AT TIME ZONE departure.timezone, 'HH24:MI:SS') END AS starts_at,
          CASE WHEN item.scheduled_end_at IS NULL THEN NULL
            ELSE to_char(item.scheduled_end_at AT TIME ZONE departure.timezone, 'HH24:MI:SS') END AS ends_at,
          item.sort_order,
          item.metadata || jsonb_build_object(
            'notes', item.notes,
            'operationalStatus', item.operational_status,
            'statusReason', item.status_reason
          ) AS metadata,
          CASE WHEN place.location IS NULL THEN NULL ELSE ST_Y(place.location::geometry) END AS latitude,
          CASE WHEN place.location IS NULL THEN NULL ELSE ST_X(place.location::geometry) END AS longitude
        FROM travel.departure_itinerary_items item
        JOIN travel.departure_days day
          ON day.id = item.departure_day_id
         AND day.agency_id = item.agency_id
         AND day.departure_id = item.departure_id
        JOIN travel.departures departure
          ON departure.id = item.departure_id AND departure.agency_id = item.agency_id
        LEFT JOIN LATERAL (
          SELECT site.location
          FROM ref.visit_sites site
          WHERE site.id = item.visit_site_id
          UNION ALL
          SELECT hotel.location
          FROM ref.hotels hotel
          WHERE hotel.id = item.hotel_id
          LIMIT 1
        ) place ON true
        WHERE item.agency_id = ${input.agencyId}
          AND item.departure_id = ${input.departureId}
          AND item.template_version_id = ${input.templateVersionId}
        ORDER BY day.service_date, item.sort_order
      `,
        txn`
        SELECT link.template_day_id::text AS trip_day_id, city.id::text,
          city.name, city.google_url,
          CASE WHEN city.location IS NULL THEN NULL ELSE ST_Y(city.location::geometry) END AS latitude,
          CASE WHEN city.location IS NULL THEN NULL ELSE ST_X(city.location::geometry) END AS longitude,
          country.name AS country
        FROM travel.template_day_cities link
        JOIN ref.cities city ON city.id = link.city_id
        JOIN ref.countries country ON country.id = city.country_id
        WHERE link.agency_id = ${input.agencyId}
          AND link.template_version_id = ${input.templateVersionId}
        ORDER BY link.template_day_id, link.sort_order
      `,
        txn`
        SELECT link.template_day_id::text AS trip_day_id, site.id::text,
          site.name, site.google_url, site.official_url,
          CASE WHEN site.location IS NULL THEN NULL ELSE ST_Y(site.location::geometry) END AS latitude,
          CASE WHEN site.location IS NULL THEN NULL ELSE ST_X(site.location::geometry) END AS longitude,
          city.name AS city
        FROM travel.template_day_sites link
        JOIN ref.visit_sites site ON site.id = link.visit_site_id
        JOIN ref.cities city ON city.id = site.city_id
        WHERE link.agency_id = ${input.agencyId}
          AND link.template_version_id = ${input.templateVersionId}
        ORDER BY link.template_day_id, link.sort_order
      `,
        txn`
        SELECT link.template_day_id::text AS trip_day_id, hotel.id::text,
          hotel.name, hotel.google_url, hotel.website_url,
          CASE WHEN hotel.location IS NULL THEN NULL ELSE ST_Y(hotel.location::geometry) END AS latitude,
          CASE WHEN hotel.location IS NULL THEN NULL ELSE ST_X(hotel.location::geometry) END AS longitude,
          city.name AS city
        FROM travel.template_day_hotels link
        JOIN ref.hotels hotel ON hotel.id = link.hotel_id
        JOIN ref.cities city ON city.id = hotel.city_id
        WHERE link.agency_id = ${input.agencyId}
          AND link.template_version_id = ${input.templateVersionId}
        ORDER BY link.template_day_id, link.sort_order
      `,
        txn`
        SELECT profile.id::text,profile.display_name,membership.role,membership.member_type,
          membership.participates_in_trip_games,
          profile.user_id=${input.actorUserId}::uuid AS is_current
        FROM travel.party_memberships membership
        JOIN travel.traveler_profiles profile
          ON profile.id = membership.traveler_id AND profile.agency_id = membership.agency_id
        WHERE membership.agency_id = ${input.agencyId}
          AND membership.departure_id = ${input.departureId}
          AND membership.party_id = ${input.partyId}
          AND membership.status = 'active'
        ORDER BY membership.role, profile.display_name
      `,
        txn`
        WITH agency_information AS (
          SELECT country.name AS country_name,entry.item,entry.ordinality::integer AS sort_order,
            candidate.grounded_at,candidate.refresh_after
          FROM travel.trip_template_versions version
          JOIN travel.template_countries link ON link.agency_id=version.agency_id
            AND link.template_id=version.template_id
          JOIN ref.countries country ON country.id=link.country_id
          JOIN ref.country_verified_profiles candidate ON candidate.country_id=country.id
          JOIN ref.country_profile_agency_reviews review ON review.agency_id=version.agency_id
            AND review.country_id=country.id AND review.profile_version=candidate.version
            AND review.status='approved'
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(review.profile_override,candidate.profile)->'usefulInfo'
          ) WITH ORDINALITY AS entry(item,ordinality)
          WHERE version.agency_id=${input.agencyId}
            AND version.id=${input.templateVersionId}
        )
        SELECT COALESCE(item->>'category','Generale') AS category,
          COALESCE(item->>'title',item->>'category','Informazione utile') AS title,
          COALESCE(item->>'body','') AS body,NULLIF(item->>'phone','') AS phone,
          NULLIF(item->>'url','') AS url,'Profilo Paese validato dall’agenzia' AS source_name,
          NULLIF(item->>'url','') AS source_url,grounded_at AS verified_at,
          refresh_after AS expires_at,'approved' AS review_status,
          'Informazione personalizzata e validata dall’agenzia. Per dati sensibili consulta comunque la fonte ufficiale.' AS disclaimer
        FROM agency_information
        UNION ALL
        SELECT info.category,info.title,info.body,info.phone,info.url,info.source_name,info.source_url,
          info.verified_at,info.expires_at,info.review_status,info.disclaimer
        FROM travel.template_useful_information info
        WHERE info.agency_id=${input.agencyId}
          AND info.template_version_id=${input.templateVersionId}
          AND NOT EXISTS(SELECT 1 FROM agency_information)
        ORDER BY category,title
      `,
        txn`
        SELECT phrase.language_code, phrase.category, phrase.term,
          phrase.pronunciation, phrase.translation
        FROM travel.template_phrasebook_entries phrase
        WHERE phrase.agency_id = ${input.agencyId}
          AND phrase.template_version_id = ${input.templateVersionId}
        ORDER BY phrase.sort_order, phrase.language_code, phrase.term
      `,
        txn`
        SELECT document.id::text,
          COALESCE(item.source_template_item_id, item.id)::text AS itinerary_item_id,
          document.title, asset.content_type, asset.size_bytes, document.created_at::text
        FROM ops.travel_documents document
        JOIN ops.media_assets asset
          ON asset.id = document.media_asset_id AND asset.agency_id = document.agency_id
        JOIN travel.departure_itinerary_items item
          ON item.id = document.departure_item_id
         AND item.agency_id = document.agency_id
         AND item.departure_id = document.departure_id
        WHERE document.agency_id = ${input.agencyId}
          AND document.departure_id = ${input.departureId}
          AND document.party_id = ${input.partyId}
          AND document.status = 'ready' AND asset.status = 'ready'
        ORDER BY document.created_at
      `,
        txn`
        SELECT document.id::text,day.template_day_id::text AS day_id,
          document.title,document.description,asset.content_type,asset.size_bytes,
          document.created_at::text
        FROM ops.travel_documents document
        JOIN ops.media_assets asset
          ON asset.id=document.media_asset_id AND asset.agency_id=document.agency_id
        JOIN travel.departure_days day
          ON day.id=document.departure_day_id AND day.agency_id=document.agency_id
         AND day.departure_id=document.departure_id
        JOIN travel.traveler_profiles requester
          ON requester.agency_id=document.agency_id AND requester.user_id=${input.actorUserId}::uuid
        WHERE document.agency_id=${input.agencyId}
          AND document.departure_id=${input.departureId}
          AND (document.party_id IS NULL OR document.party_id=${input.partyId})
          AND (document.traveler_id IS NULL OR document.traveler_id=requester.id)
          AND document.departure_day_id IS NOT NULL
          AND document.status='ready' AND asset.status='ready' AND asset.deleted_at IS NULL
        ORDER BY document.created_at
      `,
      ],
      { readOnly: true },
    );

  return {
    days: days as Row[],
    items: items as Row[],
    cities: cities as Row[],
    sites: sites as Row[],
    hotels: hotels as Row[],
    travelers: travelers as Row[],
    usefulInfo: usefulInfo as Row[],
    phrases: phrases as Row[],
    tickets: tickets as Row[],
    dayDocuments: dayDocuments as Row[],
  };
}
