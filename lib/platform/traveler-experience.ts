import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { geocodeCity } from "./geocoding";
import { ensureProgrammeFeedbackSchema } from "./programme-feedback-schema";

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
  await ensureProgrammeFeedbackSchema();

  const [dayRows, itemRows, cityRows, siteRows, hotelRows, travelerRows, infoRows, phraseRows, challengeRows, expenseRows, noteRows, restaurantRows, cashRows, photoRows, resultRows, contestRows, ticketRows, feedbackRows] = await Promise.all([
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
    sql`
      SELECT note.id::text, note.trip_day_id::text, day.day_number, note.text,
        note.updated_by_name, note.updated_at::text
      FROM party_day_notes note
      JOIN trip_days day ON day.id = note.trip_day_id AND day.agency_id = note.agency_id
      WHERE note.agency_id = ${agencyId} AND note.party_id = ${partyId}
      ORDER BY day.day_number
    `,
    sql`
      SELECT restaurant.id::text, restaurant.trip_day_id::text, day.day_number,
        restaurant.name, restaurant.added_by_name, restaurant.created_at::text
      FROM party_restaurants restaurant
      JOIN trip_days day ON day.id = restaurant.trip_day_id AND day.agency_id = restaurant.agency_id
      WHERE restaurant.agency_id = ${agencyId} AND restaurant.party_id = ${partyId}
      ORDER BY restaurant.created_at DESC
    `,
    sql`
      SELECT movement.id::text, movement.trip_day_id::text, day.day_number,
        movement.kind, movement.euro_amount, movement.local_amount, movement.local_currency,
        movement.fee_euro, movement.added_by_name, movement.created_at::text
      FROM party_cash_movements movement
      JOIN trip_days day ON day.id = movement.trip_day_id AND day.agency_id = movement.agency_id
      WHERE movement.agency_id = ${agencyId} AND movement.party_id = ${partyId}
      ORDER BY movement.created_at DESC
    `,
    sql`
      SELECT memory.id::text, memory.trip_day_id::text, day.day_number,
        asset.id::text AS media_id, asset.original_name, asset.content_type, asset.size_bytes,
        asset.uploaded_by_user_id, uploader.display_name AS added_by, memory.created_at::text
      FROM party_memories memory
      JOIN media_assets asset ON asset.id = memory.media_asset_id AND asset.agency_id = memory.agency_id
      JOIN trip_days day ON day.id = memory.trip_day_id AND day.agency_id = memory.agency_id
      LEFT JOIN platform_users uploader ON uploader.id = asset.uploaded_by_user_id
      WHERE memory.agency_id = ${agencyId} AND memory.party_id = ${partyId} AND asset.status = 'ready'
      ORDER BY memory.created_at DESC
    `,
    sql`
      SELECT result.id::text, result.traveler_id::text, profile.display_name,
        result.trip_day_id::text, result.generated_content_id::text, result.activity_type,
        result.score, result.max_score, result.status, result.result, result.submitted_at::text
      FROM party_activity_results result
      JOIN traveler_profiles profile ON profile.id = result.traveler_id AND profile.agency_id = result.agency_id
      WHERE result.agency_id = ${agencyId} AND result.party_id = ${partyId}
      ORDER BY result.submitted_at DESC
    `,
    sql`
      SELECT entry.id::text, entry.traveler_id::text, profile.display_name,
        entry.generated_content_id::text, entry.media_asset_id::text, entry.participant_slot,
        entry.status, entry.score, entry.reason, entry.is_winner, entry.submitted_at::text,
        memory.id::text AS memory_id
      FROM party_photo_contest_entries entry
      JOIN traveler_profiles profile ON profile.id = entry.traveler_id AND profile.agency_id = entry.agency_id
      LEFT JOIN party_memories memory ON memory.media_asset_id = entry.media_asset_id AND memory.party_id = entry.party_id
      WHERE entry.agency_id = ${agencyId} AND entry.party_id = ${partyId}
      ORDER BY entry.submitted_at DESC
    `,
    sql`
      SELECT document.id::text, document.itinerary_item_id::text, document.title,
        asset.content_type, asset.size_bytes, document.created_at::text
      FROM itinerary_item_documents document
      JOIN media_assets asset ON asset.id = document.media_asset_id AND asset.agency_id = document.agency_id
      JOIN itinerary_items item
        ON item.id = document.itinerary_item_id AND item.agency_id = document.agency_id
      JOIN trip_days day ON day.id = item.trip_day_id AND day.agency_id = item.agency_id
      WHERE document.agency_id = ${agencyId} AND document.departure_id = ${departureId}
        AND day.template_version_id = ${versionId} AND asset.status = 'ready'
      ORDER BY document.created_at
    `,
    sql`
      SELECT feedback.trip_day_id::text, feedback.target_type,
        feedback.itinerary_item_id::text, feedback.hotel_id::text, feedback.rating
      FROM traveler_programme_feedback feedback
      JOIN traveler_profiles profile
        ON profile.id = feedback.traveler_id AND profile.agency_id = feedback.agency_id
      WHERE feedback.agency_id = ${agencyId} AND feedback.departure_id = ${departureId}
        AND feedback.party_id = ${partyId} AND profile.user_id = ${userId}
    `,
  ]);

  const items = itemRows as Row[];
  const cities = cityRows as Row[];
  const missingCities = [...new Map(cities
    .filter((city) => city.latitude == null || city.longitude == null)
    .map((city) => [String(city.id), city])).values()];
  if (missingCities.length > 0) {
    const recovered = await Promise.allSettled(missingCities.map(async (city) => {
      const coordinates = await geocodeCity(String(city.name), String(city.country));
      if (!coordinates) return;
      await sql`
        UPDATE cities
        SET latitude = ${coordinates.latitude}, longitude = ${coordinates.longitude}, updated_at = NOW()
        WHERE id = ${String(city.id)} AND (latitude IS NULL OR longitude IS NULL)
      `;
      for (const row of cities.filter((item) => String(item.id) === String(city.id))) {
        row.latitude = coordinates.latitude;
        row.longitude = coordinates.longitude;
      }
    }));
    recovered.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(`Coordinate non recuperate per ${String(missingCities[index].name)}`,
          result.reason instanceof Error ? result.reason.message : result.reason);
      }
    });
  }
  const sites = siteRows as Row[];
  const hotels = hotelRows as Row[];
  const tickets = ticketRows as Row[];
  const feedback = feedbackRows as Row[];
  const itemRatings = new Map(feedback
    .filter((entry) => entry.target_type === "itinerary_item")
    .map((entry) => [String(entry.itinerary_item_id), Number(entry.rating)]));
  const hotelRatings = new Map(feedback
    .filter((entry) => entry.target_type === "hotel")
    .map((entry) => [`${String(entry.trip_day_id)}:${String(entry.hotel_id)}`, Number(entry.rating)]));
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
        date: (() => {
          const date = new Date(`${String(selected.starts_on)}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + Number(row.day_offset));
          return date.toISOString().slice(0, 10);
        })(),
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
          rating: itemRatings.get(String(item.id)) ?? null,
          tickets: tickets.filter((ticket) => String(ticket.itinerary_item_id) === String(item.id)).map((ticket) => ({
            id: String(ticket.id), title: String(ticket.title), contentType: String(ticket.content_type),
            sizeBytes: ticket.size_bytes == null ? null : Number(ticket.size_bytes),
            createdAt: String(ticket.created_at),
            downloadUrl: `/api/travel-documents/${String(ticket.id)}/content?download=1`,
          })),
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
          rating: hotelRatings.get(`${id}:${String(hotel.id)}`) ?? null,
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
    notes: (noteRows as Row[]).map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      text: String(row.text), updatedBy: String(row.updated_by_name), updatedAt: String(row.updated_at),
    })),
    restaurants: (restaurantRows as Row[]).map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      name: String(row.name), addedBy: String(row.added_by_name), createdAt: String(row.created_at),
    })),
    cashMovements: (cashRows as Row[]).map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      kind: String(row.kind), euroAmount: row.euro_amount == null ? null : Number(row.euro_amount),
      localAmount: Number(row.local_amount), localCurrency: String(row.local_currency),
      feeEuro: row.fee_euro == null ? null : Number(row.fee_euro),
      addedBy: String(row.added_by_name), createdAt: String(row.created_at),
    })),
    photos: (photoRows as Row[]).map((row) => ({
      id: String(row.id), mediaId: String(row.media_id), dayId: String(row.trip_day_id),
      dayNumber: Number(row.day_number), originalName: String(row.original_name),
      contentType: String(row.content_type), sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      addedBy: stringValue(row.added_by) || "Viaggiatore", createdAt: String(row.created_at),
      contentUrl: `/api/traveler/photos/${String(row.id)}/content`,
      downloadUrl: `/api/traveler/photos/${String(row.id)}/content?download=1`,
      canDelete: String(row.uploaded_by_user_id) === userId,
    })),
    challengeResults: (resultRows as Row[]).map((row) => ({
      id: String(row.id), travelerId: String(row.traveler_id), travelerName: String(row.display_name),
      dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      contentId: String(row.generated_content_id), type: String(row.activity_type),
      score: Number(row.score), maxScore: row.max_score == null ? null : Number(row.max_score),
      status: String(row.status), result: row.result, submittedAt: String(row.submitted_at),
    })),
    contestEntries: (contestRows as Row[]).map((row) => ({
      id: String(row.id), travelerId: String(row.traveler_id), travelerName: String(row.display_name),
      contentId: String(row.generated_content_id), mediaId: String(row.media_asset_id),
      slot: Number(row.participant_slot), status: String(row.status),
      score: row.score == null ? null : Number(row.score), reason: String(row.reason),
      isWinner: Boolean(row.is_winner), submittedAt: String(row.submitted_at),
      contentUrl: row.memory_id ? `/api/traveler/photos/${String(row.memory_id)}/content` : "",
    })),
  };
}

export async function assertTravelerPartyScope(input: {
  userId: string; departureId: string; partyId: string; dayId?: string | null;
}) {
  const sql = getSql();
  const rows = await sql`
    SELECT departure.agency_id::text
    FROM traveler_profiles profile
    JOIN party_memberships membership ON membership.traveler_id = profile.id AND membership.status = 'active'
    JOIN travel_parties party ON party.id = membership.party_id AND party.agency_id = membership.agency_id
    JOIN departures departure ON departure.id = party.departure_id AND departure.agency_id = party.agency_id
    WHERE profile.user_id = ${input.userId} AND party.id = ${input.partyId}
      AND departure.id = ${input.departureId}
      AND (${input.dayId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM trip_days day WHERE day.id = ${input.dayId ?? null}::uuid
          AND day.agency_id = departure.agency_id
          AND day.template_version_id = departure.template_version_id
      ))
    LIMIT 1
  `;
  if (!rows[0]) throw new PlatformRequestError("Viaggio, famiglia o giornata non disponibili");
  return String(rows[0].agency_id);
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

export async function deleteTravelerExpense(input: {
  userId: string;
  departureId: string;
  partyId: string;
  expenseId: string;
}) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM party_expenses expense
    USING traveler_profiles profile, party_memberships membership, travel_parties party
    WHERE expense.id = ${input.expenseId}
      AND expense.departure_id = ${input.departureId}
      AND expense.party_id = ${input.partyId}
      AND party.id = expense.party_id
      AND party.departure_id = expense.departure_id
      AND membership.party_id = party.id
      AND membership.agency_id = party.agency_id
      AND membership.status = 'active'
      AND profile.id = membership.traveler_id
      AND profile.user_id = ${input.userId}
    RETURNING expense.id::text
  `;
  if (!rows[0]) throw new PlatformRequestError("Spesa non disponibile");
}

export async function saveTravelerNote(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string; text: string;
}) {
  const sql = getSql();
  const agencyId = await assertTravelerPartyScope(input);
  const rows = await sql`
    INSERT INTO party_day_notes (agency_id, party_id, trip_day_id, text, updated_by_user_id, updated_by_name)
    VALUES (${agencyId}, ${input.partyId}, ${input.dayId}, ${input.text}, ${input.userId}, ${input.userName})
    ON CONFLICT (party_id, trip_day_id) DO UPDATE SET text = EXCLUDED.text,
      updated_by_user_id = EXCLUDED.updated_by_user_id, updated_by_name = EXCLUDED.updated_by_name,
      updated_at = NOW()
    RETURNING id::text, updated_at::text
  `;
  return { id: String(rows[0].id), updatedAt: String(rows[0].updated_at) };
}

export async function addTravelerRestaurant(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string; name: string;
}) {
  const sql = getSql();
  const agencyId = await assertTravelerPartyScope(input);
  const rows = await sql`
    INSERT INTO party_restaurants (agency_id, party_id, trip_day_id, name, added_by_user_id, added_by_name)
    VALUES (${agencyId}, ${input.partyId}, ${input.dayId}, ${input.name}, ${input.userId}, ${input.userName})
    RETURNING id::text, created_at::text
  `;
  return { id: String(rows[0].id), createdAt: String(rows[0].created_at) };
}

export async function addTravelerCashMovement(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string;
  kind: "withdrawal" | "exchange"; euroAmount: number | null; localAmount: number; feeEuro: number | null;
}) {
  const sql = getSql();
  const agencyId = await assertTravelerPartyScope(input);
  const rows = await sql`
    INSERT INTO party_cash_movements (
      agency_id, party_id, trip_day_id, kind, euro_amount, local_amount, local_currency,
      fee_euro, added_by_user_id, added_by_name
    ) VALUES (
      ${agencyId}, ${input.partyId}, ${input.dayId}, ${input.kind}, ${input.euroAmount},
      ${input.localAmount}, 'UZS', ${input.feeEuro}, ${input.userId}, ${input.userName}
    ) RETURNING id::text, created_at::text
  `;
  return { id: String(rows[0].id), createdAt: String(rows[0].created_at) };
}

export async function deleteTravelerCashMovement(input: {
  userId: string; departureId: string; partyId: string; movementId: string;
}) {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM party_cash_movements movement
    USING traveler_profiles profile, party_memberships membership, travel_parties party
    WHERE movement.id = ${input.movementId}
      AND movement.party_id = ${input.partyId}
      AND party.id = movement.party_id
      AND party.departure_id = ${input.departureId}
      AND membership.party_id = party.id
      AND membership.agency_id = party.agency_id
      AND membership.status = 'active'
      AND profile.id = membership.traveler_id
      AND profile.user_id = ${input.userId}
    RETURNING movement.id::text
  `;
  if (!rows[0]) throw new PlatformRequestError("Movimento non disponibile");
}

export type TravelerExperience = NonNullable<Awaited<ReturnType<typeof getTravelerExperience>>>;
