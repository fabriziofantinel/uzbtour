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
    ? await (async () => {
        const scopeRows =
          await sql`SELECT agency_id::text,agency_name FROM app.read_staff_trip_cards_v3(${actorNativeId}::uuid)
          WHERE departure_id=${departureId}::uuid LIMIT 1`;
        if (!scopeRows[0]) return [];
        const agencyId = String(scopeRows[0].agency_id);
        const agencyName = String(scopeRows[0].agency_name);
        const [, journeyRows] = await sql.transaction(
          (transaction) => [
            transaction`SELECT set_config('app.agency_id',${agencyId},true)`,
            transaction`SELECT departure.id AS departure_id,departure.agency_id,departure.title,departure.code,
              departure.starts_on,departure.ends_on,departure.status AS departure_status,${agencyName} AS agency_name,
              COALESCE(country.name,'') AS destination_country,party.id AS party_id,party.name AS party_name,
              party.code AS party_code,party.status AS party_status,
              COALESCE(experience.profile,departure.experience_profile) AS party_experience_profile,
              traveler.id AS traveler_id,traveler.display_name AS traveler_name,
              '' AS traveler_username,COALESCE(traveler.email,'') AS traveler_email,
              COALESCE(traveler.phone,'') AS traveler_phone,membership.role AS membership_role,
              membership.status AS membership_status,membership.status AS user_status,membership.member_type,
              COALESCE(consent.decision,'missing') AS minor_image_consent,
              COALESCE(membership.participates_in_trip_games,false) AS traveler_participates_in_trip_games
            FROM travel.departures departure
            JOIN travel.trip_templates template ON template.id=departure.template_id AND template.agency_id=departure.agency_id
            LEFT JOIN ref.countries country ON country.id=template.primary_country_id
            LEFT JOIN travel.travel_parties party ON party.departure_id=departure.id AND party.agency_id=departure.agency_id
            LEFT JOIN travel.departure_party_experience_profiles experience ON experience.agency_id=departure.agency_id
              AND experience.departure_id=departure.id AND experience.party_id=party.id
            LEFT JOIN travel.party_memberships membership ON membership.party_id=party.id
              AND membership.agency_id=departure.agency_id AND membership.status<>'removed'
            LEFT JOIN travel.traveler_profiles traveler ON traveler.id=membership.traveler_id
              AND traveler.agency_id=departure.agency_id
            LEFT JOIN LATERAL (
              SELECT record.decision FROM privacy.consent_records record
              WHERE record.agency_id=departure.agency_id AND record.departure_id=departure.id
                AND record.party_id=party.id AND record.subject_traveler_id=traveler.id
                AND record.consent_type='minor_image_upload' AND record.consent_scope='party'
                AND (record.expires_at IS NULL OR record.expires_at>clock_timestamp())
              ORDER BY record.effective_at DESC,record.id DESC LIMIT 1
            ) consent ON true
            WHERE departure.id=${departureId}::uuid AND departure.agency_id=${agencyId}::uuid
            ORDER BY party.name,membership.role,traveler.display_name`,
          ],
          { readOnly: true },
        );
        return journeyRows;
      })()
    : await sql`SELECT * FROM app.read_journey_management(${actorId},${departureId}::uuid)`;
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
