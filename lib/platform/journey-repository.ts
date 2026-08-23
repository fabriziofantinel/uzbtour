import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";
import { createHash, randomBytes } from "node:crypto";

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
  const sql = getSql();
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO travel_parties (agency_id, departure_id, code, name, status)
      VALUES (${input.agencyId}, ${input.departureId}, ${familyCode(input.name)}, ${input.name}, 'invited')
      RETURNING id
    ), audit AS (
      INSERT INTO audit_events (agency_id, actor_user_id, departure_id, entity_type, entity_id, action, changes)
      SELECT ${input.agencyId}, ${input.actorId}, ${input.departureId}, 'travel_party', id::text, 'created', '{}'::jsonb FROM inserted
    ) SELECT id::text FROM inserted
  `;
  return String(rows[0].id);
}

export async function addJourneyTraveler(input: {
  agencyId: string; partyId: string; name: string; email: string; phone: string;
  birthDate?: string; role: "organizer" | "member"; actorId: string;
}) {
  const sql = getSql();
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  let users = await sql`SELECT id, status FROM platform_users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1`;
  if (!users[0]) users = await sql`
    INSERT INTO platform_users (id, display_name, initials, email, phone, auth_provider, status)
    VALUES (${`traveler:${crypto.randomUUID()}`}, ${input.name}, ${initialsFor(input.name)}, ${normalizedEmail}, ${input.phone || null}, 'neon', 'invited')
    RETURNING id, status
  `;
  const userId = String(users[0].id);
  const profiles = await sql`
    INSERT INTO traveler_profiles (agency_id, user_id, display_name, email, phone, birth_date)
    VALUES (${input.agencyId}, ${userId}, ${input.name}, ${normalizedEmail}, ${input.phone || null}, ${input.birthDate || null})
    ON CONFLICT (agency_id, user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
      birth_date = COALESCE(EXCLUDED.birth_date, traveler_profiles.birth_date), updated_at = NOW()
    RETURNING id::text
  `;
  const travelerId = String(profiles[0].id);
  await sql`
    INSERT INTO party_memberships (agency_id, party_id, traveler_id, role, status)
    VALUES (${input.agencyId}, ${input.partyId}, ${travelerId}, ${input.role}, 'invited')
    ON CONFLICT (party_id, traveler_id) DO UPDATE SET role = EXCLUDED.role, status = 'invited'
  `;
  if (String(users[0].status) === "active") return { travelerId, activationToken: null };
  const token = randomBytes(32).toString("base64url");
  await sql`
    UPDATE user_invitations SET used_at = NOW() WHERE user_id = ${userId} AND used_at IS NULL
  `;
  await sql`
    INSERT INTO user_invitations (user_id, created_by_user_id, token_hash, expires_at)
    VALUES (${userId}, ${input.actorId}, ${createHash("sha256").update(token).digest("hex")}, NOW() + INTERVAL '14 days')
  `;
  return { travelerId, activationToken: token };
}
