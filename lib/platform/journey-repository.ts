import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { createHash, randomBytes } from "node:crypto";
import { createV3JourneyParty, provisionV3JourneyTraveler } from "./v3-journey-provisioning";

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
function familyCode(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "FAMIGLIA";
  return `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function getJourneyManagement(departureId: string, actorId: string) {
  const sql = getSql();
  const journeys = await sql`
    SELECT d.id::text, d.agency_id::text, d.title, d.code, d.starts_on::text, d.ends_on::text,
           d.status, a.name AS agency_name, tt.destination_country
    FROM departures d
    JOIN agencies a ON a.id = d.agency_id
    JOIN trip_templates tt ON tt.id = d.template_id AND tt.agency_id = d.agency_id
    JOIN agency_memberships am ON am.agency_id = d.agency_id AND am.user_id = ${actorId}
      AND am.role IN ('owner', 'admin', 'editor')
    WHERE d.id = ${departureId}
    LIMIT 1
  `;
  if (!journeys[0]) throw new PlatformRequestError("Viaggio non trovato");
  const families = await sql`
    SELECT parties.id::text, parties.name, parties.code, parties.status,
           profiles.id::text AS traveler_id, profiles.display_name, profiles.email, profiles.phone,
           memberships.role, memberships.status AS membership_status, users.status AS user_status
    FROM travel_parties parties
    LEFT JOIN party_memberships memberships ON memberships.party_id = parties.id AND memberships.status <> 'removed'
    LEFT JOIN traveler_profiles profiles ON profiles.id = memberships.traveler_id
    LEFT JOIN platform_users users ON users.id = profiles.user_id
    WHERE parties.departure_id = ${departureId}
    ORDER BY parties.name, memberships.role, profiles.display_name
  `;
  return {
    journey: {
      id: String(journeys[0].id), agencyId: String(journeys[0].agency_id),
      title: String(journeys[0].title), code: String(journeys[0].code),
      startsOn: String(journeys[0].starts_on), endsOn: String(journeys[0].ends_on),
      status: String(journeys[0].status), agencyName: String(journeys[0].agency_name),
      destinationCountry: String(journeys[0].destination_country || ""),
    },
    families: [...new Set(families.map((row) => String(row.id)))].map((id) => {
      const familyRows = families.filter((row) => String(row.id) === id);
      return {
        id, name: String(familyRows[0].name), code: String(familyRows[0].code), status: String(familyRows[0].status),
        travelers: familyRows.filter((row) => row.traveler_id).map((row) => ({
          id: String(row.traveler_id), name: String(row.display_name), email: String(row.email || ""),
          phone: String(row.phone || ""), role: String(row.role), status: String(row.user_status || row.membership_status),
        })),
      };
    }),
  };
}

export async function createJourneyFamily(input: { departureId: string; agencyId: string; name: string; actorId: string }) {
  return createV3JourneyParty({ ...input, code: familyCode(input.name) });
}

export async function addJourneyTraveler(input: {
  agencyId: string; partyId: string; name: string; email: string; phone: string;
  birthDate?: string; role: "organizer" | "member"; actorId: string;
}) {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  const token = randomBytes(32).toString("base64url");
  const result = await provisionV3JourneyTraveler({
    ...input,
    email: normalizedEmail,
    initials: initialsFor(input.name),
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return {
    travelerId: result.travelerId,
    activationToken: result.activationRequired ? token : null,
  };
}
