import { PlatformRequestError } from "./errors";
import { geocodeCity } from "./geocoding";
import { assertProgrammeFeedbackSchema } from "./schema-readiness";
import { assertArchitectureHardeningSchema } from "./schema-readiness";
import {
  addTravelerExpenseV3,
  deleteTravelerExpenseV3,
  readV3ExpenseRows,
} from "./v3-expenses";
import {
  readV3JourneyJournalRows,
} from "./v3-journey-journal";
import { addTravelerCashMovementV3, addTravelerRestaurantV3, deleteTravelerCashMovementV3, saveTravelerNoteV3 } from "./v3-journey-mutations";
import {
  readV3ProgrammeFeedbackRows,
} from "./v3-programme-feedback";
import {
  readV3TravelCatalog,
} from "./v3-travel-catalog";
import {
  readV3Gamification,
} from "./v3-gamification";
import {
  readV3TravelerJourneys,
  resolveV3TravelerContext,
} from "./v3-traveler-scope";
import { readTravelerChangeNotices } from "./traveler-change-notices";

type Row = Record<string, unknown>;

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function withoutAnswerKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { answer: _answer, correctIndex: _correctIndex, answerSpec: _answerSpec, ...safe } = value as Record<string, unknown>;
  return safe;
}

function contestCriteria(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const criteria: Record<string, number | boolean> = {};
  if (typeof source.eligible === "boolean") criteria.eligible = source.eligible;
  for (const key of ["composition", "technical", "storytelling", "originality", "relevance"] as const) {
    const score = Number(source[key]);
    if (Number.isFinite(score) && score >= 0) criteria[key] = score;
  }
  return criteria;
}

export async function getTravelerExperience(userId: string, requestedDepartureId?: string) {
  const journeys = await readV3TravelerJourneys(userId);
  if (journeys.length === 0) return null;
  const selected = (requestedDepartureId
    ? journeys.find((row) => String(row.departure_id) === requestedDepartureId)
    : journeys[0]) ?? journeys[0];
  const departureId = String(selected.departure_id);
  const agencyId = String(selected.agency_id);
  const versionId = String(selected.template_version_id);
  const partyId = String(selected.party_id);
  await assertProgrammeFeedbackSchema();

  const [activeExpenseRows, v3Journal, activeFeedbackRows, v3Catalog, v3Gamification, changeNotices] = await Promise.all([
    readV3ExpenseRows({ agencyId, departureId, partyId }),
    readV3JourneyJournalRows({ agencyId, departureId, partyId }),
    readV3ProgrammeFeedbackRows({ agencyId, departureId, partyId, userId }),
    readV3TravelCatalog({ agencyId, departureId, templateVersionId: versionId, partyId, userId }),
    readV3Gamification({ agencyId, departureId, templateVersionId: versionId, partyId, userId }),
    readTravelerChangeNotices({agencyId,departureId,userId}),
  ]);
  const activeNoteRows = v3Journal.notes;
  const activeRestaurantRows = v3Journal.restaurants;
  const activeCashRows = v3Journal.cash;
  const activeChallengeRows = v3Gamification.challenges;
  const activePhotoRows = v3Gamification.photos;
  const activeResultRows = v3Gamification.results;
  const activeContestRows = v3Gamification.contests;
  const competitionGroupRows = v3Gamification.competitionGroups;
  const competitionResultRows = v3Gamification.competitionResults;
  const competitionContestRows = v3Gamification.competitionContests;
  const activeDayRows = v3Catalog.days;
  const activeItemRows = v3Catalog.items;
  const activeCityRows = v3Catalog.cities;
  const activeSiteRows = v3Catalog.sites;
  const activeHotelRows = v3Catalog.hotels;
  const activeTravelerRows = v3Catalog.travelers;
  const activeInfoRows = v3Catalog.usefulInfo;
  const activePhraseRows = v3Catalog.phrases;
  const activeTicketRows = v3Catalog.tickets;
  const activeDayDocumentRows = v3Catalog.dayDocuments;
  const items = activeItemRows;
  const cities = activeCityRows;
  const missingCities = [...new Map(cities
    .filter((city) => city.latitude == null || city.longitude == null)
    .map((city) => [String(city.id), city])).values()];
  if (missingCities.length > 0) {
    const recovered = await Promise.allSettled(missingCities.map(async (city) => {
      const coordinates = await geocodeCity(String(city.name), String(city.country));
      if (!coordinates) return;
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
  const sites = activeSiteRows;
  const hotels = activeHotelRows;
  const tickets = activeTicketRows;
  const feedback = activeFeedbackRows;
  const itemRatings = new Map(feedback
    .filter((entry) => entry.target_type === "itinerary_item")
    .map((entry) => [String(entry.itinerary_item_id), Number(entry.rating)]));
  const hotelRatings = new Map(feedback
    .filter((entry) => entry.target_type === "hotel")
    .map((entry) => [`${String(entry.trip_day_id)}:${String(entry.hotel_id)}`, Number(entry.rating)]));
  return {
    journey: {
      agencyId,
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
      agencyBranding: (() => {
        const branding = selected.agency_branding;
        if (!branding || typeof branding !== "object" || Array.isArray(branding)) return {};
        const value = branding as Record<string, unknown>;
        return {
          primaryColor: stringValue(value.primaryColor),
          logoUrl: stringValue(value.logoUrl),
        };
      })(),
      partyName: String(selected.party_name),
      catalogReady: activeCityRows.length > 0 || activeSiteRows.length > 0,
      travelers: activeTravelerRows.map((row) => ({
        id: String(row.id), name: String(row.display_name), role: String(row.role),
        memberType: String(row.member_type), participatesInTripGames: Boolean(row.participates_in_trip_games),
        isCurrent: Boolean(row.is_current),
      })),
    },
    availableJourneys: (journeys as Row[]).map((row) => ({
      departureId: String(row.departure_id),
      title: String(row.title),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
    })),
    days: activeDayRows.map((row) => {
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
        documents: activeDayDocumentRows.filter((document) => String(document.day_id) === id).map((document) => ({
          id: String(document.id), title: String(document.title), description: stringValue(document.description),
          contentType: String(document.content_type), sizeBytes: Number(document.size_bytes || 0),
          createdAt: String(document.created_at),
          downloadUrl: `/api/travel-documents/${String(document.id)}/content?download=1`,
        })),
        items: items.filter((item) => String(item.trip_day_id) === id).map((item) => ({
          id: String(item.id),
          type: String(item.item_type),
          title: String(item.title),
          description: stringValue(item.description),
          startsAt: stringValue(item.starts_at),
          endsAt: stringValue(item.ends_at),
          latitude: item.latitude == null ? null : Number(item.latitude),
          longitude: item.longitude == null ? null : Number(item.longitude),
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
          latitude: site.latitude == null ? null : Number(site.latitude),
          longitude: site.longitude == null ? null : Number(site.longitude),
        })),
        hotels: hotels.filter((hotel) => String(hotel.trip_day_id) === id).map((hotel) => ({
          id: String(hotel.id), name: String(hotel.name), city: String(hotel.city),
          googleUrl: String(hotel.google_url), websiteUrl: stringValue(hotel.website_url),
          latitude: hotel.latitude == null ? null : Number(hotel.latitude),
          longitude: hotel.longitude == null ? null : Number(hotel.longitude),
          rating: hotelRatings.get(`${id}:${String(hotel.id)}`) ?? null,
        })),
      };
    }),
    usefulInfo: activeInfoRows.map((row) => ({
      category: String(row.category), title: String(row.title), body: String(row.body),
      phone: stringValue(row.phone), url: stringValue(row.url),sourceName:stringValue(row.source_name),
      sourceUrl:stringValue(row.source_url),verifiedAt:stringValue(row.verified_at),expiresAt:stringValue(row.expires_at),
      reviewStatus:stringValue(row.review_status),disclaimer:stringValue(row.disclaimer),
    })),
    changeNotices,
    phrases: activePhraseRows.map((row) => ({
      language: String(row.language_code), category: String(row.category), term: String(row.term),
      pronunciation: stringValue(row.pronunciation), translation: String(row.translation),
    })),
    challenges: activeChallengeRows.map((row) => ({
      id: String(row.id), dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      dayNumber: row.day_number == null ? null : Number(row.day_number), type: String(row.content_type),
      title: String(row.title), content: withoutAnswerKeys(row.content),
    })),
    expenses: activeExpenseRows.map((row) => ({
      id: String(row.id), dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      dayNumber: row.day_number == null ? null : Number(row.day_number), label: String(row.label),
      amount: Number(row.amount), currency: String(row.currency), paidBy: String(row.paid_by_name),
      paidByTravelerId: stringValue(row.paid_by_traveler_id),
      baseCurrency: String(row.base_currency || "EUR"),
      exchangeRateToBase: row.exchange_rate_to_base == null ? null : Number(row.exchange_rate_to_base),
      baseAmount: row.base_amount == null ? null : Number(row.base_amount),
      createdAt: String(row.created_at),
      shares: Array.isArray(row.shares) ? row.shares.map((share) => {
        const value=share as Record<string,unknown>;
        return {travelerId:String(value.travelerId),travelerName:String(value.travelerName),amount:Number(value.amount),baseAmount:Number(value.baseAmount)};
      }) : [],
    })),
    notes: activeNoteRows.map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      text: String(row.text), updatedBy: String(row.updated_by_name), updatedAt: String(row.updated_at),
    })),
    restaurants: activeRestaurantRows.map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      name: String(row.name), addedBy: String(row.added_by_name), createdAt: String(row.created_at),
    })),
    cashMovements: activeCashRows.map((row) => ({
      id: String(row.id), dayId: String(row.trip_day_id), dayNumber: Number(row.day_number),
      kind: String(row.kind), euroAmount: row.euro_amount == null ? null : Number(row.euro_amount),
      localAmount: Number(row.local_amount), localCurrency: String(row.local_currency),
      feeEuro: row.fee_euro == null ? null : Number(row.fee_euro),
      addedBy: String(row.added_by_name), createdAt: String(row.created_at),
    })),
    photos: activePhotoRows.map((row) => ({
      id: String(row.id), mediaId: String(row.media_id), dayId: String(row.trip_day_id),
      dayNumber: Number(row.day_number), originalName: String(row.original_name),
      contentType: String(row.content_type), sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      addedBy: stringValue(row.added_by) || "Viaggiatore", createdAt: String(row.created_at),
      contentUrl: `/api/traveler/photos/${String(row.id)}/content`,
      downloadUrl: `/api/traveler/photos/${String(row.id)}/content?download=1`,
      canDelete: String(row.uploaded_by_user_id) === userId,
    })),
    challengeResults: activeResultRows.map((row) => ({
      id: String(row.id), travelerId: String(row.traveler_id), travelerName: String(row.display_name),
      dayId: row.trip_day_id ? String(row.trip_day_id) : null,
      contentId: String(row.generated_content_id), type: String(row.activity_type),
      score: Number(row.score), maxScore: row.max_score == null ? null : Number(row.max_score),
      status: String(row.status), result: withoutAnswerKeys(row.result), submittedAt: String(row.submitted_at),
      evidenceUrl: row.evidence_memory_id ? `/api/traveler/photos/${String(row.evidence_memory_id)}/content` : "",
    })),
    contestEntries: activeContestRows.map((row) => ({
      id: String(row.id), travelerId: String(row.traveler_id), travelerName: String(row.display_name),
      contentId: String(row.generated_content_id), mediaId: String(row.media_asset_id),
      slot: Number(row.participant_slot), status: String(row.status),
      score: row.score == null ? null : Number(row.score), reason: String(row.reason),
      criteria: contestCriteria(row.criteria),
      isWinner: Boolean(row.is_winner), submittedAt: String(row.submitted_at),
      contentUrl: row.memory_id ? `/api/traveler/photos/${String(row.memory_id)}/content` : "",
    })),
    tripCompetition: {
      enabled: competitionGroupRows.some((row) => Boolean(row.is_current)),
      groups: competitionGroupRows.map((row) => ({ id: String(row.id), name: String(row.name) })),
      results: competitionResultRows.map((row) => ({
        id: String(row.id), partyId: String(row.party_id), partyName: String(row.party_name),
        travelerId: String(row.traveler_id), travelerName: String(row.display_name),
        contentId: String(row.generated_content_id), type: String(row.activity_type),
        score: Number(row.score), status: String(row.status),
      })),
      contestEntries: competitionContestRows.map((row) => ({
        id: String(row.id), partyId: String(row.party_id), partyName: String(row.party_name),
        travelerId: String(row.traveler_id), travelerName: String(row.display_name),
        contentId: String(row.generated_content_id), score: row.score == null ? null : Number(row.score),
        isWinner: Boolean(row.is_winner),
      })),
    },
  };
}

export async function assertTravelerPartyScope(input: {
  userId: string; departureId: string; partyId: string; dayId?: string | null;
}) {
  const context = await resolveTravelerContext(input);
  if (!context) throw new PlatformRequestError("Viaggio, gruppo o giornata non disponibili");
  return context.agencyId;
}

export async function resolveTravelerContext(input: {
  userId: string; departureId: string; partyId: string; dayId?: string | null;
}) {
  return resolveV3TravelerContext(input);
}
export async function addTravelerExpense(input: {
  userId: string;
  userName: string;
  departureId: string;
  partyId: string;
  dayId?: string | null;
  label: string;
  amount: number;
  currency: "EUR" | "USD" | "UZS" | "GBP" | "VND";
  clientOperationId: string;
  exchangeRateToBase?: number | null;
  shareTravelerIds?: string[];
}) {
  await assertArchitectureHardeningSchema();
  const agencyId = await assertTravelerPartyScope(input);
  return addTravelerExpenseV3({ agencyId, ...input });
}

export async function deleteTravelerExpense(input: {
  userId: string;
  departureId: string;
  partyId: string;
  expenseId: string;
}) {
  const agencyId = await assertTravelerPartyScope(input);
  return deleteTravelerExpenseV3({ agencyId, ...input });
}

export async function saveTravelerNote(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string; text: string;
}) {
  const agencyId = await assertTravelerPartyScope(input);
  return saveTravelerNoteV3({ agencyId, ...input });
}

export async function addTravelerRestaurant(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string; name: string;
}) {
  const agencyId = await assertTravelerPartyScope(input);
  return addTravelerRestaurantV3({ agencyId, ...input });
}

export async function addTravelerCashMovement(input: {
  userId: string; userName: string; departureId: string; partyId: string; dayId: string;
  kind: "withdrawal" | "exchange"; euroAmount: number | null; localAmount: number; feeEuro: number | null;
  localCurrency: string; clientOperationId: string;
}) {
  await assertArchitectureHardeningSchema();
  const agencyId = await assertTravelerPartyScope(input);
  return addTravelerCashMovementV3({ agencyId, ...input });
}

export async function deleteTravelerCashMovement(input: {
  userId: string; departureId: string; partyId: string; movementId: string;
}) {
  const agencyId = await assertTravelerPartyScope(input);
  return deleteTravelerCashMovementV3({ agencyId, ...input });
}

export type TravelerExperience = NonNullable<Awaited<ReturnType<typeof getTravelerExperience>>>;
