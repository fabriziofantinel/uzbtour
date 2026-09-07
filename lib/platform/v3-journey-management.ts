import "server-only";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

function toIsoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? "");
  const prefix = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (prefix) return prefix;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10);
}

export async function readV3JourneyManagement(
  departureId: string,
  actorId: string,
  actorNativeId: string,
  staffAccess = false,
) {
  const sql = getSql();
  const rows = staffAccess
    ? await sql`SELECT * FROM app.read_staff_journey_management_v3(
        ${actorNativeId}::uuid,${departureId}::uuid
      )`
    : await sql`SELECT * FROM app.read_journey_management(${actorNativeId}::uuid,${departureId}::uuid)`;
  const brandingRows =
    await sql`SELECT agency_id::text,branding FROM app.read_agency_branding_v3(${actorNativeId}::uuid)`;
  const first = rows[0];
  if (!first) throw new PlatformRequestError("Viaggio non trovato");
  const brandingRow = brandingRows.find((row) => String(row.agency_id) === String(first.agency_id));
  const branding =
    brandingRow?.branding && typeof brandingRow.branding === "object" && !Array.isArray(brandingRow.branding)
      ? (brandingRow.branding as Record<string, unknown>)
      : {};
  const partyIds = [...new Set(rows.filter((row) => row.party_id).map((row) => String(row.party_id)))];
  return {
    journey: {
      id: String(first.departure_id),
      agencyId: String(first.agency_id),
      title: String(first.title),
      code: String(first.code),
      startsOn: toIsoDate(first.starts_on),
      endsOn: toIsoDate(first.ends_on),
      status: String(first.departure_status),
      agencyName: String(first.agency_name),
      agencyPrimaryColor: String(branding.primaryColor || "#247A6B"),
      destinationCountry: String(first.destination_country || ""),
      quoteImportId: null,
    },
    groups: partyIds.map((id) => {
      const groupRows = rows.filter((row) => String(row.party_id) === id);
      const group = groupRows[0];
      return {
        id,
        name: String(group.party_name),
        code: String(group.party_code),
        status: String(group.party_status),
        experienceProfile: String(group.party_experience_profile || "complete") as
          | "essential"
          | "standard"
          | "complete",
        travelers: groupRows
          .filter((row) => row.traveler_id)
          .map((row) => ({
            id: String(row.traveler_id),
            name: String(row.traveler_name),
            username: String(row.traveler_username || ""),
            email: String(row.traveler_email || ""),
            phone: String(row.traveler_phone || ""),
            role: String(row.membership_role),
            memberType: String(row.member_type || "adult"),
            minorImageConsent: String(row.minor_image_consent || "missing"),
            status: String(row.user_status || row.membership_status),
            participatesInTripGames: Boolean(row.traveler_participates_in_trip_games),
          })),
      };
    }),
  };
}
