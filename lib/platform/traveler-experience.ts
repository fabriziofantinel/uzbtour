import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

type Row = Record<string, unknown>;

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

export async function getTravelerExperience(userId: string, requestedDepartureId?: string) {
  const sql = getSql();
  const journeys = await sql`
    SELECT d.id::text AS departure_id, d.agency_id::text, d.template_version_id::text,
      d.title, d.code, d.starts_on::text, d.ends_on::text, d.timezone, d.status,
      tp.id::text AS party_id, tp.name AS party_name, tt.destination_country,
      a.name AS agency_name
    FROM traveler_profiles profile
    JOIN party_memberships membership
      ON membership.traveler_id = profile.id AND membership.status = 'active'
    JOIN travel_parties tp
      ON tp.id = membership.party_id AND tp.agency_id = membership.agency_id
    JOIN departures d
      ON d.id = tp.departure_id AND d.agency_id = tp.agency_id
    JOIN trip_templates tt
      ON tt.id = d.template_id AND tt.agency_id = d.agency_id
    JOIN agencies a ON a.id = d.agency_id
    WHERE profile.user_id = ${userId}
      AND d.status NOT IN ('cancelled', 'archived')
    ORDER BY
      CASE WHEN CURRENT_DATE BETWEEN d.starts_on AND d.ends_on THEN 0
           WHEN d.starts_on >= CURRENT_DATE THEN 1 ELSE 2 END,
      CASE WHEN d.starts_on >= CURRENT_DATE THEN d.starts_on END ASC,
      d.starts_on DESC
  `;
  if (journeys.length === 0) return null;
  const selected = (requestedDepartureId
    ? journeys.find((row) => String(row.departure_id) === requestedDepartureId)
    : journeys[0]) ?? journeys[0];
  const departureId = String(selected.departure_id);
  const agencyId = String(selected.agency_id);
  const versionId = String(selected.template_version_id);
  const partyId = String(selected.party_id);

  const [dayRows, itemRows, cityRows, siteRows, hotelRows, travelerRows, infoRows, phraseRows, challengeRows, expenseRows] = await Promise.all([
    sql`
      SELECT id::text, day_number, day_offset, label, title, city, description,
        source_date::text, metadata
      FROM trip_days
      WHERE agency_id = ${agencyId} AND template_version_id = ${versionId}
      ORDER BY day_number
    `,
    sql`
      SELECT item.id::text, item.trip_day_id::text, item.item_type, item.title,
        item.description, item.starts_at::text, item.ends_at::text, item.sort_order,
        item.metadata
      FROM itinerary_items item
      JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
      WHERE item.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, item.sort_order
    `,
    sql`
      SELECT link.trip_day_id::text, city.id::text, city.name, city.google_url,
        city.latitude, city.longitude, country.name AS country
      FROM trip_day_cities link
      JOIN trip_days day ON day.id = link.trip_day_id
      JOIN cities city ON city.id = link.city_id
      JOIN countries country ON country.id = city.country_id
      WHERE day.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, city.name
    `,
    sql`
      SELECT link.trip_day_id::text, site.id::text, site.name, site.google_url,
        site.official_url, city.name AS city
      FROM trip_day_sites link
      JOIN trip_days day ON day.id = link.trip_day_id
      JOIN visit_sites site ON site.id = link.site_id
      JOIN cities city ON city.id = site.city_id
      WHERE day.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, site.name
    `,
    sql`
      SELECT link.trip_day_id::text, hotel.id::text, hotel.name, hotel.google_url,
        hotel.website_url, city.name AS city
      FROM trip_day_hotels link
      JOIN trip_days day ON day.id = link.trip_day_id
      JOIN hotels hotel ON hotel.id = link.hotel_id
      JOIN cities city ON city.id = hotel.city_id
      WHERE day.agency_id = ${agencyId} AND day.template_version_id = ${versionId}
      ORDER BY day.day_number, hotel.name
    `,
    sql`
      SELECT profile.display_name, membership.role
      FROM party_memberships membership
      JOIN traveler_profiles profile ON profile.id = membership.traveler_id
      WHERE membership.party_id = ${partyId} AND membership.status = 'active'
      ORDER BY membership.role, profile.display_name
    `,
    sql`
      SELECT category, title, body, phone, url
      FROM useful_information
      WHERE agency_id = ${agencyId} AND template_version_id = ${versionId}
      ORDER BY sort_order, title
    `,
    sql`
      SELECT language_code, category, term, pronunciation, translation
      FROM phrasebook_entries
      WHERE agency_id = ${agencyId} AND template_version_id = ${versionId}
      ORDER BY sort_order, language_code, term
    `,
    sql`
      SELECT content.id::text, content.trip_day_id::text, day.day_number,
        content.content_type, content.title, content.content
      FROM generated_content content
      LEFT JOIN trip_days day ON day.id = content.trip_day_id
      WHERE content.agency_id = ${agencyId}
        AND content.template_version_id = ${versionId}
        AND content.status = 'approved'
      ORDER BY COALESCE(day.day_number, 0), content.sort_order
    `,
    sql`
      SELECT expense.id::text, expense.trip_day_id::text, day.day_number,
        expense.label, expense.amount, expense.currency, expense.paid_by_name,
        expense.created_at::text
      FROM party_expenses expense
      LEFT JOIN trip_days day ON day.id = expense.trip_day_id
      WHERE expense.agency_id = ${agencyId} AND expense.departure_id = ${departureId}
        AND expense.party_id = ${partyId}
      ORDER BY expense.created_at DESC
    `,
  ]);

  const items = itemRows as Row[];
  const cities = cityRows as Row[];
  const sites = siteRows as Row[];
  const hotels = hotelRows as Row[];
  return {
    journey: {
      departureId,
      partyId,
      title: String(selected.title),
      code: String(selected.code),
      startsOn: String(selected.starts_on),
      endsOn: String(selected.ends_on),
      timezone: String(selected.timezone),
      status: String(selected.status),
      destinationCountry: stringValue(selected.destination_country),
      agencyName: String(selected.agency_name),
      partyName: String(selected.party_name),
      catalogReady: cityRows.length > 0 || siteRows.length > 0,
      travelers: (travelerRows as Row[]).map((row) => ({ name: String(row.display_name), role: String(row.role) })),
    },
    availableJourneys: (journeys as Row[]).map((row) => ({
      departureId: String(row.departure_id),
      title: String(row.title),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
    })),
    days: (dayRows as Row[]).map((row) => {
      const id = String(row.id);
      return {
        id,
        number: Number(row.day_number),
        offset: Number(row.day_offset),
        date: stringValue(row.source_date),
        label: stringValue(row.label),
        title: stringValue(row.title),
        city: stringValue(row.city),
        description: stringValue(row.description),
        metadata: row.metadata,
        items: items.filter((item) => String(item.trip_day_id) === id).map((item) => ({
          id: String(item.id),
          type: String(item.item_type),
          title: String(item.title),
          description: stringValue(item.description),
          startsAt: stringValue(item.starts_at),
          endsAt: stringValue(item.ends_at),
          metadata: item.metadata,
        })),
        cities: cities.filter((city) => String(city.trip_day_id) === id).map((city) => ({
          id: String(city.id), name: String(city.name), country: String(city.country),
          googleUrl: String(city.google_url), latitude: city.latitude == null ? null : Number(city.latitude),
          longitude: city.longitude == null ? null : Number(city.longitude),
        })),
        sites: sites.filter((site) => String(site.trip_day_id) === id).map((site) => ({
          id: String(site.id), name: String(site.name), city: String(site.city),
          googleUrl: String(site.google_url), officialUrl: stringValue(site.official_url),
        })),
        hotels: hotels.filter((hotel) => String(hotel.trip_day_id) === id).map((hotel) => ({
          id: String(hotel.id), name: String(hotel.name), city: String(hotel.city),
          googleUrl: String(hotel.google_url), websiteUrl: stringValue(hotel.website_url),
        })),
      };
    }),
    usefulInfo: (infoRows as Row[]).map((row) => ({
      category: String(row.category), title: String(row.title), body: String(row.body),
      phone: stringValue(row.phone), url: stringValue(row.url),
    })),
    phrases: (phraseRows as Row[]).map((row) => ({
      language: String(row.language_code), category: String(row.category), term: String(row.term),
      pronunciation: stringValue(row.pronunciation), translation: String(row.translation),
    })),
    challenges: (challengeRows as Row[]).map((row) => ({
      id: String(row.id), dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      dayNumber: row.day_number == null ? null : Number(row.day_number), type: String(row.content_type),
      title: String(row.title), content: row.content,
    })),
    expenses: (expenseRows as Row[]).map((row) => ({
      id: String(row.id), dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      dayNumber: row.day_number == null ? null : Number(row.day_number), label: String(row.label),
      amount: Number(row.amount), currency: String(row.currency), paidBy: String(row.paid_by_name),
      createdAt: String(row.created_at),
    })),
  };
}

export async function addTravelerExpense(input: {
  userId: string;
  userName: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
  label: string;
  amount: number;
  currency: "EUR" | "USD" | "UZS" | "GBP";
}) {
  const sql = getSql();
  const allowed = await sql`
    SELECT d.agency_id::text
    FROM traveler_profiles profile
    JOIN party_memberships membership
      ON membership.traveler_id = profile.id AND membership.status = 'active'
    JOIN travel_parties party
      ON party.id = membership.party_id AND party.agency_id = membership.agency_id
    JOIN departures d ON d.id = party.departure_id AND d.agency_id = party.agency_id
    WHERE profile.user_id = ${input.userId} AND party.id = ${input.partyId}
      AND d.id = ${input.departureId}
      AND (${input.dayId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM trip_days day
        WHERE day.id = ${input.dayId ?? null}::uuid
          AND day.template_version_id = d.template_version_id
          AND day.agency_id = d.agency_id
      ))
    LIMIT 1
  `;
  if (!allowed[0]) throw new PlatformRequestError("Viaggio o giornata non disponibili");
  const rows = await sql`
    INSERT INTO party_expenses (
      agency_id, departure_id, party_id, trip_day_id, label, amount, currency,
      paid_by_user_id, paid_by_name
    ) VALUES (
      ${String(allowed[0].agency_id)}, ${input.departureId}, ${input.partyId},
      ${input.dayId ?? null}, ${input.label}, ${input.amount}, ${input.currency},
      ${input.userId}, ${input.userName}
    )
    RETURNING id::text
  `;
  return String(rows[0].id);
}

export type TravelerExperience = NonNullable<Awaited<ReturnType<typeof getTravelerExperience>>>;
